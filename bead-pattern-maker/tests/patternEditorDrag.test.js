import { describe, it, expect, vi, afterEach } from 'vitest';
import { initPatternEditorUI } from '../src/ui/patternEditor.js';
import { createAppState } from '../src/state.js';
import { calculateUsedColors } from '../src/ui/colorList.js';

// =============================================================================
// 図案手動編集UI — ドラッグ連続編集の「結合テスト」（tests/patternEditorDrag.test.js）
// -----------------------------------------------------------------------------
// 対象: src/ui/patternEditor.js の initPatternEditorUI(canvas, toolContainer, state, options)
// タスク19.2 / 要件12.6, 12.7, 12.8, 12.9, 12.11
//
// 本ファイルは「イベント結線（mousedown→mousemove→mouseup／mouseleave）」の検証に
// 焦点を当てる。純関数 canvasPointToCell / applyCellEdit の単体検証は既存の
// tests/patternEditor.test.js（タスク16.5/16.6）が担うため、ここでは重複させず、
// 実際に jsdom の canvas 要素へ MouseEvent を dispatch してUIの振る舞いを確認する。
//
// 検証する受け入れ基準:
//   - 要件12.6 : ドラッグ経路上で通過した各セルへ、選択中ツール（描画色／消しゴム）を
//                連続適用する
//   - 要件12.7 : 同一セルへの重複 mousemove で重複適用・余計な再描画
//                （onPatternEdit の余計な発火）が起きない
//   - 要件12.8 : mouseup（window/document）後の mousemove では編集されない
//   - 要件12.9 : mouseleave 後の mousemove では編集されない
//   - 要件12.11: 移動を伴わない単一クリック（mousedown→同一セルで mouseup）は1セルのみ編集
//
// 【jsdom でのイベント／座標制御の方針】
//   - canvas は document.createElement('canvas') の実 DOM 要素を使う。
//   - jsdom の getBoundingClientRect は 0 を返すため、内部解像度（canvas.width/height）と
//     等倍（scale=1・左上=原点）になるよう getBoundingClientRect をスタブする。
//   - MouseEvent には clientX/clientY を渡してクリック位置を制御する。jsdom はレイアウトを
//     持たず offsetX/offsetY の算出が不定なため、各イベントへ offsetX=clientX・
//     offsetY=clientY を明示設定し、座標→セルの対応を決定的にする
//     （等倍スタブにより canvasPointToCell 内では offset/client いずれの経路でも同値）。
//   - 実効セルサイズ = cellSize(=CELL_SIZE) × zoom(=1.0) = CELL_SIZE px。
//     canvas の内部解像度を「図案サイズ × CELL_SIZE」に合わせ、canvasPointToCell が
//     導出するグリッド寸法（cols/rows）と図案（pattern.width/height）を一致させる。
// =============================================================================

/** 描画時の基本セルサイズ（実効セルサイズ = CELL_SIZE × zoom）。座標計算と editor で共有する。 */
const CELL_SIZE = 10;

// テスト用のビーズ色（id 付き。calculateUsedColors の集約は id 基準）。
const RED = { id: 'P06', name: 'あか', r: 219, g: 46, b: 52 };
const BLUE = { id: 'P11', name: 'あお', r: 39, g: 90, b: 170 };

// 生成した editor ハンドルを記録し、各テスト後に確実に破棄する
// （特に window への mouseup リスナーをテスト間で残さないため）。
let activeEditors = [];

afterEach(() => {
  for (const handle of activeEditors) {
    try {
      handle.destroy();
    } catch {
      // 破棄時の例外は無視（クリーンアップ目的のため）
    }
  }
  activeEditors = [];
  vi.restoreAllMocks();
});

/**
 * 全セルを fill で埋めた PatternGrid を生成する。
 * @param {number} width - 横ビーズ数
 * @param {number} height - 縦ビーズ数
 * @param {object|null} [fill] - 各セルの初期値（既定: null = 未配置）
 * @returns {object} PatternGrid
 */
function makePattern(width, height, fill = null) {
  const cells = [];
  for (let row = 0; row < height; row += 1) {
    const cols = [];
    for (let col = 0; col < width; col += 1) {
      cols.push(fill);
    }
    cells.push(cols);
  }
  return {
    width,
    height,
    cells,
    originalCells: cells.map((row) => row.slice()),
    beadType: 'perler',
    plateConfig: { cols: 1, rows: 1 },
  };
}

/**
 * 内部解像度を持ち、getBoundingClientRect が内部解像度と等倍を返す canvas を生成する。
 * @param {number} pxWidth - canvas.width（内部解像度・ピクセル）
 * @param {number} pxHeight - canvas.height（内部解像度・ピクセル）
 * @returns {HTMLCanvasElement} スタブ済み canvas
 */
function makeCanvas(pxWidth, pxHeight) {
  const canvas = document.createElement('canvas');
  canvas.width = pxWidth;
  canvas.height = pxHeight;
  // jsdom は実レイアウトを持たず getBoundingClientRect が全て 0 を返す。
  // 内部解像度と等倍（scaleX=scaleY=1・原点(0,0)）になるようスタブし、
  // clientX/clientY をそのまま canvas 内部座標として扱えるようにする。
  canvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: pxWidth,
    bottom: pxHeight,
    width: pxWidth,
    height: pxHeight,
    x: 0,
    y: 0,
  });
  return canvas;
}

/**
 * セル[row][col] の中心を指す client 座標を返す。
 * 中心を狙うことでセル境界の丸め誤差を避ける。
 * @param {number} row - 行（0始まり）
 * @param {number} col - 列（0始まり）
 * @returns {{clientX: number, clientY: number}} client 座標
 */
function cellCenter(row, col) {
  return {
    clientX: col * CELL_SIZE + Math.floor(CELL_SIZE / 2),
    clientY: row * CELL_SIZE + Math.floor(CELL_SIZE / 2),
  };
}

/**
 * MouseEvent を生成する。jsdom 向けに offsetX/offsetY を clientX/clientY と一致させ、
 * 座標→セル変換を決定的にする（getBoundingClientRect 等倍スタブ前提）。
 * @param {string} type - イベント種別（'mousedown' | 'mousemove' | 'mouseup' | 'mouseleave'）
 * @param {{clientX?: number, clientY?: number, button?: number}} [init] - 座標・ボタン
 * @returns {MouseEvent} 生成したイベント
 */
function makeMouseEvent(type, { clientX = 0, clientY = 0, button = 0 } = {}) {
  const event = new MouseEvent(type, {
    clientX,
    clientY,
    button,
    bubbles: true,
    cancelable: true,
  });
  // jsdom はレイアウト非対応のため offset を明示設定（= client、左上原点・等倍）。
  Object.defineProperty(event, 'offsetX', { value: clientX, configurable: true });
  Object.defineProperty(event, 'offsetY', { value: clientY, configurable: true });
  return event;
}

/** canvas にセル[row][col]中心で mousedown を dispatch する。 */
function dispatchMouseDown(canvas, row, col, button = 0) {
  canvas.dispatchEvent(makeMouseEvent('mousedown', { ...cellCenter(row, col), button }));
}

/** canvas にセル[row][col]中心で mousemove を dispatch する。 */
function dispatchMouseMove(canvas, row, col) {
  canvas.dispatchEvent(makeMouseEvent('mousemove', cellCenter(row, col)));
}

/** window に mouseup を dispatch する（要件12.8: ドラッグ終了は window/document で捕捉）。 */
function dispatchWindowMouseUp() {
  window.dispatchEvent(makeMouseEvent('mouseup', {}));
}

/** canvas に mouseleave を dispatch する（要件12.9: 図案領域外でドラッグ終了）。 */
function dispatchMouseLeave(canvas) {
  canvas.dispatchEvent(makeMouseEvent('mouseleave', {}));
}

/**
 * editor をセットアップする。state・canvas・toolContainer・onPatternEdit スパイを用意し、
 * initPatternEditorUI を実 DOM へ結線する。
 * @param {object} opts
 * @param {number} opts.width - 図案の横ビーズ数
 * @param {number} opts.height - 図案の縦ビーズ数
 * @param {{type: 'paint'|'erase', color: object|null}} opts.tool - 編集ツール
 * @param {object|null} [opts.patternFill] - 図案の初期セル値（既定: null）
 * @returns {{state, canvas, toolContainer, onPatternEdit, handle}} セットアップ結果
 */
function setupEditor({ width, height, tool, patternFill = null }) {
  const state = createAppState();
  state.setPattern(makePattern(width, height, patternFill));
  state.setEditTool(tool);

  const canvas = makeCanvas(width * CELL_SIZE, height * CELL_SIZE);
  const toolContainer = document.createElement('div');
  const onPatternEdit = vi.fn();

  const handle = initPatternEditorUI(canvas, toolContainer, state, {
    onPatternEdit,
    cellSize: CELL_SIZE,
  });
  activeEditors.push(handle);

  return { state, canvas, toolContainer, onPatternEdit, handle };
}

/**
 * 図案の指定セルが、指定色（id 一致）になっているか検証するヘルパー。
 * @param {object} pattern - PatternGrid
 * @param {number} row - 行
 * @param {number} col - 列
 * @param {object} color - 期待色（id を比較）
 */
function expectCellColor(pattern, row, col, color) {
  expect(pattern.cells[row][col]).not.toBeNull();
  expect(pattern.cells[row][col].id).toBe(color.id);
}

// =============================================================================
// 要件12.6: ドラッグで通過した各セルが選択ツールで編集される
// =============================================================================
describe('要件12.6: ドラッグ経路上の各セルへ選択ツールを連続適用する', () => {
  it('描画ツール: mousedown→複数mousemove→mouseup で通過した各セルが選択色になる', () => {
    const { state, canvas, onPatternEdit } = setupEditor({
      width: 6,
      height: 5,
      tool: { type: 'paint', color: RED },
    });

    // row0 を (0,0)→(0,1)→(0,2)→(0,3) と横方向にドラッグする。
    dispatchMouseDown(canvas, 0, 0);
    dispatchMouseMove(canvas, 0, 1);
    dispatchMouseMove(canvas, 0, 2);
    dispatchMouseMove(canvas, 0, 3);
    dispatchWindowMouseUp();

    const pattern = state.pattern;
    // 通過した4セルはすべて選択色（あか）に編集される（要件12.6）。
    expectCellColor(pattern, 0, 0, RED);
    expectCellColor(pattern, 0, 1, RED);
    expectCellColor(pattern, 0, 2, RED);
    expectCellColor(pattern, 0, 3, RED);
    // 通過していないセルは未編集（null のまま）。
    expect(pattern.cells[0][4]).toBeNull();
    expect(pattern.cells[0][5]).toBeNull();
    expect(pattern.cells[1][0]).toBeNull();

    // 合計ビーズ数は編集した4セルと一致する。
    expect(calculateUsedColors(pattern).totalBeads).toBe(4);
    // 再描画通知は通過した新規セル数（=4: mousedown 1 + mousemove 3）だけ発火する。
    expect(onPatternEdit).toHaveBeenCalledTimes(4);
  });

  it('消しゴムツール: ドラッグで通過した各セルが未配置(null)になる', () => {
    // 全セルを BLUE で埋めた図案を消しゴムでドラッグする。
    const { state, canvas, onPatternEdit } = setupEditor({
      width: 6,
      height: 5,
      tool: { type: 'erase', color: null },
      patternFill: BLUE,
    });

    dispatchMouseDown(canvas, 1, 0);
    dispatchMouseMove(canvas, 1, 1);
    dispatchMouseMove(canvas, 1, 2);
    dispatchWindowMouseUp();

    const pattern = state.pattern;
    // 通過した3セルは未配置（null）になる（要件12.6・消しゴム）。
    expect(pattern.cells[1][0]).toBeNull();
    expect(pattern.cells[1][1]).toBeNull();
    expect(pattern.cells[1][2]).toBeNull();
    // 通過していないセルは BLUE のまま保持される。
    expectCellColor(pattern, 1, 3, BLUE);
    expectCellColor(pattern, 0, 0, BLUE);

    // 全30セル中3セルを消したので、残りは27個。
    expect(calculateUsedColors(pattern).totalBeads).toBe(6 * 5 - 3);
    expect(onPatternEdit).toHaveBeenCalledTimes(3);
  });

  it('斜め方向のドラッグでも、mousemove が当たった各セルが編集される', () => {
    // ドラッグ経路の各 mousemove が当たったセルを編集する（セル間の補間はしない）。
    const { state, canvas, onPatternEdit } = setupEditor({
      width: 5,
      height: 5,
      tool: { type: 'paint', color: RED },
    });

    dispatchMouseDown(canvas, 0, 0);
    dispatchMouseMove(canvas, 1, 1);
    dispatchMouseMove(canvas, 2, 2);
    dispatchWindowMouseUp();

    const pattern = state.pattern;
    // サンプリングした対角セルが編集される。
    expectCellColor(pattern, 0, 0, RED);
    expectCellColor(pattern, 1, 1, RED);
    expectCellColor(pattern, 2, 2, RED);
    // mousemove が当たっていない中間セルは未編集（補間は行わない）。
    expect(pattern.cells[0][1]).toBeNull();
    expect(pattern.cells[1][0]).toBeNull();
    expect(pattern.cells[1][2]).toBeNull();

    expect(calculateUsedColors(pattern).totalBeads).toBe(3);
    expect(onPatternEdit).toHaveBeenCalledTimes(3);
  });
});

// =============================================================================
// 要件12.7: 同一セルへの重複 mousemove で重複適用・余計な再描画が起きない
// =============================================================================
describe('要件12.7: 同一セルへの重複 mousemove は重複適用・余計な再描画を起こさない', () => {
  it('連続して同一セルに mousemove しても onPatternEdit は新規セル数だけ発火する', () => {
    const { state, canvas, onPatternEdit } = setupEditor({
      width: 6,
      height: 5,
      tool: { type: 'paint', color: RED },
    });

    dispatchMouseDown(canvas, 1, 1); // 編集#1（lastCell=(1,1)）
    dispatchMouseMove(canvas, 1, 1); // 同一セル → スキップ
    dispatchMouseMove(canvas, 1, 2); // 編集#2（lastCell=(1,2)）
    dispatchMouseMove(canvas, 1, 2); // 同一セル → スキップ
    dispatchMouseMove(canvas, 1, 2); // 同一セル → スキップ
    dispatchMouseMove(canvas, 1, 3); // 編集#3（lastCell=(1,3)）
    dispatchWindowMouseUp();

    const pattern = state.pattern;
    // 実際に編集されたのは3つの異なるセルのみ。
    expectCellColor(pattern, 1, 1, RED);
    expectCellColor(pattern, 1, 2, RED);
    expectCellColor(pattern, 1, 3, RED);
    expect(calculateUsedColors(pattern).totalBeads).toBe(3);

    // 重複 mousemove では再描画通知（onPatternEdit）が発火しない。
    // 発火回数は新規に通過したセル数（3）と一致する（要件12.7）。
    expect(onPatternEdit).toHaveBeenCalledTimes(3);
  });
});

// =============================================================================
// 要件12.8: mouseup（window）後の mousemove では編集されない
// =============================================================================
describe('要件12.8: mouseup 後の mousemove では編集されない', () => {
  it('window への mouseup でドラッグが終了し、以降の mousemove は無視される', () => {
    const { state, canvas, onPatternEdit } = setupEditor({
      width: 6,
      height: 5,
      tool: { type: 'paint', color: RED },
    });

    dispatchMouseDown(canvas, 0, 0); // 編集#1
    dispatchWindowMouseUp(); // ドラッグ終了（要件12.8）

    // mouseup 後の mousemove は編集を起こさない。
    dispatchMouseMove(canvas, 0, 1);
    dispatchMouseMove(canvas, 0, 2);

    const pattern = state.pattern;
    expectCellColor(pattern, 0, 0, RED); // mousedown の1セルのみ
    expect(pattern.cells[0][1]).toBeNull();
    expect(pattern.cells[0][2]).toBeNull();

    expect(calculateUsedColors(pattern).totalBeads).toBe(1);
    expect(onPatternEdit).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// 要件12.9: mouseleave 後の mousemove では編集されない
// =============================================================================
describe('要件12.9: mouseleave 後の mousemove では編集されない', () => {
  it('canvas の mouseleave でドラッグが終了し、以降の mousemove は無視される', () => {
    const { state, canvas, onPatternEdit } = setupEditor({
      width: 6,
      height: 5,
      tool: { type: 'paint', color: RED },
    });

    dispatchMouseDown(canvas, 2, 0); // 編集#1
    dispatchMouseMove(canvas, 2, 1); // 編集#2
    dispatchMouseLeave(canvas); // 図案領域外へ → ドラッグ終了（要件12.9）

    // mouseleave 後の mousemove は編集を起こさない。
    dispatchMouseMove(canvas, 2, 2);
    dispatchMouseMove(canvas, 2, 3);

    const pattern = state.pattern;
    expectCellColor(pattern, 2, 0, RED);
    expectCellColor(pattern, 2, 1, RED);
    expect(pattern.cells[2][2]).toBeNull();
    expect(pattern.cells[2][3]).toBeNull();

    expect(calculateUsedColors(pattern).totalBeads).toBe(2);
    expect(onPatternEdit).toHaveBeenCalledTimes(2);
  });

  it('mouseleave で終了後、再度 mousedown すれば新しいドラッグを開始できる', () => {
    const { state, canvas, onPatternEdit } = setupEditor({
      width: 6,
      height: 5,
      tool: { type: 'paint', color: RED },
    });

    // 1回目のドラッグ → mouseleave で終了
    dispatchMouseDown(canvas, 0, 0);
    dispatchMouseMove(canvas, 0, 1);
    dispatchMouseLeave(canvas);
    // 終了後の mousemove は無視される
    dispatchMouseMove(canvas, 0, 2);

    // 2回目のドラッグ（新しい mousedown から再開）
    dispatchMouseDown(canvas, 3, 0);
    dispatchMouseMove(canvas, 3, 1);
    dispatchWindowMouseUp();

    const pattern = state.pattern;
    // 1回目で (0,0),(0,1)、2回目で (3,0),(3,1) が編集される。
    expectCellColor(pattern, 0, 0, RED);
    expectCellColor(pattern, 0, 1, RED);
    expect(pattern.cells[0][2]).toBeNull(); // 終了後の mousemove は無視
    expectCellColor(pattern, 3, 0, RED);
    expectCellColor(pattern, 3, 1, RED);

    expect(calculateUsedColors(pattern).totalBeads).toBe(4);
    // 発火: 1回目 (mousedown + mousemove = 2) + 2回目 (mousedown + mousemove = 2) = 4
    expect(onPatternEdit).toHaveBeenCalledTimes(4);
  });
});

// =============================================================================
// 要件12.11: 移動を伴わない単一クリックは1セルのみ編集（後方互換）
// =============================================================================
describe('要件12.11: 単一クリック（移動なし）は1セルのみ編集する', () => {
  it('mousedown→同一セルで mouseup（mousemove なし）は当該1セルのみ編集する', () => {
    const { state, canvas, onPatternEdit } = setupEditor({
      width: 6,
      height: 5,
      tool: { type: 'paint', color: RED },
    });

    // 移動を伴わない単一クリック（mousedown → mouseup、mousemove なし）。
    dispatchMouseDown(canvas, 2, 3);
    dispatchWindowMouseUp();

    const pattern = state.pattern;
    expectCellColor(pattern, 2, 3, RED);
    // それ以外のセルは未編集。
    expect(calculateUsedColors(pattern).totalBeads).toBe(1);
    // 単一クリックでは onPatternEdit はちょうど1回。
    expect(onPatternEdit).toHaveBeenCalledTimes(1);
  });

  it('消しゴムの単一クリックも当該1セルのみ未配置にする', () => {
    const { state, canvas, onPatternEdit } = setupEditor({
      width: 4,
      height: 4,
      tool: { type: 'erase', color: null },
      patternFill: BLUE,
    });

    dispatchMouseDown(canvas, 1, 2);
    dispatchWindowMouseUp();

    const pattern = state.pattern;
    expect(pattern.cells[1][2]).toBeNull();
    // 他セルは保持。16セル中1セルを消したので残り15個。
    expect(calculateUsedColors(pattern).totalBeads).toBe(4 * 4 - 1);
    expect(onPatternEdit).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// 結線の補助的検証（ドラッグ開始条件・破棄）
// -----------------------------------------------------------------------------
// 上記4基準の前提となる「いつ編集が起こる／起こらないか」の境界を補強する。
// =============================================================================
describe('結線の補助的検証: ドラッグ開始条件とリスナー解除', () => {
  it('mousedown なしの mousemove は編集を起こさない（ドラッグ未開始）', () => {
    const { state, canvas, onPatternEdit } = setupEditor({
      width: 5,
      height: 5,
      tool: { type: 'paint', color: RED },
    });

    // mousedown を伴わない mousemove だけでは編集されない。
    dispatchMouseMove(canvas, 0, 0);
    dispatchMouseMove(canvas, 1, 1);

    expect(calculateUsedColors(state.pattern).totalBeads).toBe(0);
    expect(onPatternEdit).not.toHaveBeenCalled();
  });

  it('主ボタン以外（右クリック等）の mousedown はドラッグ編集を開始しない', () => {
    const { state, canvas, onPatternEdit } = setupEditor({
      width: 5,
      height: 5,
      tool: { type: 'paint', color: RED },
    });

    // button=2（副ボタン）での mousedown は無視される。
    dispatchMouseDown(canvas, 0, 0, 2);
    dispatchMouseMove(canvas, 0, 1); // ドラッグ未開始のため編集されない

    expect(calculateUsedColors(state.pattern).totalBeads).toBe(0);
    expect(onPatternEdit).not.toHaveBeenCalled();
  });

  it('destroy() 後は canvas/window のイベントで編集が起こらない', () => {
    const { state, canvas, onPatternEdit, handle } = setupEditor({
      width: 5,
      height: 5,
      tool: { type: 'paint', color: RED },
    });

    handle.destroy();

    // 破棄後は mousedown/mousemove/mouseup いずれでも編集されない。
    dispatchMouseDown(canvas, 0, 0);
    dispatchMouseMove(canvas, 0, 1);
    dispatchWindowMouseUp();

    expect(calculateUsedColors(state.pattern).totalBeads).toBe(0);
    expect(onPatternEdit).not.toHaveBeenCalled();
  });
});
