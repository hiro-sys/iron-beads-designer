// =============================================================================
// 図案手動編集UI（patternEditor.js）
// -----------------------------------------------------------------------------
// 生成済み図案（PatternGrid）のセルを、ユーザーのクリック操作で手動編集する
// UIコンポーネント。以下を担う:
//   - ツール選択（要件12.1）:
//       state.editTool で現在のツールを保持する。ツールは
//         ・「描画」: 有効パレットから選んだ任意の色（BeadColor）を塗る
//         ・「消しゴム（未配置）」: セルを null（未配置）にする
//       のいずれか。ツールセレクタには有効パレットの色スウォッチと
//       「消しゴム（未配置）」ボタンを並べる。
//   - クリック編集／ドラッグ連続編集（要件12.2, 12.3, 12.6〜12.11）:
//       Canvas 上のポインタ位置を canvasPointToCell でセル[row][col]に変換し、
//       「描画」なら選択色、「消しゴム」なら null をそのセルへ設定する。
//       イベントモデルは mousedown → mousemove → mouseup（＋ Canvas の mouseleave、
//       window の mouseup）ベースで、単一クリック（1セル編集・後方互換）と
//       ドラッグによる複数セルの連続編集の両方を同一の仕組みで扱う。
//   - 編集後の反映（要件12.4, 12.5, 12.10, 6.5）:
//       セル編集のたびに state.pattern を更新し、onPatternEdit を発火して
//       使用色一覧・合計の即時再計算と図案の再描画を呼び出し側（main.js /
//       タスク17.1）に促す。連続編集中も逐次更新されるため、ドラッグ終了時点で
//       使用色一覧・合計は最新の図案内容と一致する（要件12.10）。
//
// 設計書「コンポーネントとインターフェース > 12. 図案手動編集UIコンポーネント
// （patternEditor.js）」の更新済みイベントモデル（表）に対応。
// Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10, 12.11, 6.5
//
// 【座標マッピングの純関数化について】
//   canvasPointToCell は純関数として切り出し、後続のユニットテスト（タスク16.6）
//   で「ズーム1.0/2.0・境界セル・グリッド外（null）」を検証できるようにする。
//   セル編集ロジックも applyCellEdit として純関数化し、プロパティテスト
//   （タスク16.5 / Property 22）で検証できるようにする。
//   UI部分（ツールセレクタ・Canvasクリック結線）は手動テスト対象。
// =============================================================================

import { initializePalette } from '../data/beadConfig.js';
import { PARLER_PALETTE } from '../data/parlerPalette.js';
import { NANO_PALETTE } from '../data/nanoPalette.js';
import { t, getColorName } from '../i18n.js';

/** @typedef {import('../engine/ConversionStrategy.js').PatternGrid} PatternGrid */
/** @typedef {import('../engine/ConversionStrategy.js').BeadColor} BeadColor */
/** @typedef {'perler' | 'nano'} BeadType */

/**
 * ビーズタイプ → 生パレット（{ id, name, r, g, b }[]）の対応表。
 * 有効パレットの算出（getActivePalette 未指定時のフォールバック）に用いる。
 * @type {Record<BeadType, Array<{id: string, name: string, r: number, g: number, b: number}>>}
 */
const RAW_PALETTES = {
  perler: PARLER_PALETTE,
  nano: NANO_PALETTE,
};

/**
 * canvasRenderer.js の DEFAULT_CELL_SIZE と一致させる、1セルの基本ピクセルサイズ。
 * 座標変換は描画時と同じ cellSize を使う必要があるため、既定値を揃えておく。
 */
const DEFAULT_CELL_SIZE = 10;

/**
 * Canvas上のクリック座標を図案のセル[row][col]に変換する純関数。
 *
 * 表示サイズ（CSSピクセル）と内部解像度（canvas.width/height）の比、および
 * ズーム倍率を補正したうえで、セル座標を算出する。グリッド外は null を返す。
 *
 * 変換手順（design.md「座標マッピング」）:
 *   1. 実効セルサイズ = cellSize × zoom（px）を求める。
 *   2. 表示/内部解像度の比 scaleX = canvas.width / 表示幅、scaleY も同様。
 *      （表示幅は getBoundingClientRect().width。取得不能・0 のときは内部解像度に
 *       フォールバックして比 = 1 とする）
 *   3. event.offsetX/offsetY に比を掛けて Canvas 内部座標 (canvasX, canvasY) を得る。
 *      offset が無いイベントには clientX/Y − rect.left/top でフォールバックする。
 *   4. col = floor(canvasX / 実効セルサイズ)、row = floor(canvasY / 実効セルサイズ)。
 *      グリッド原点は (0,0)（canvasRenderer はセルを col×実効, row×実効 に描画し、
 *      先頭セルにオフセットを設けていない）。
 *   5. グリッド寸法 cols/rows は内部解像度から導出（canvas.width = cols×実効、
 *      canvas.height = rows×実効）。row/col が [0, rows)/[0, cols) の外なら null。
 *
 * @param {HTMLCanvasElement} canvas - 図案描画Canvas
 * @param {MouseEvent} event - クリックイベント（offsetX/offsetY を優先使用）
 * @param {number} cellSize - 1セルの基本ピクセルサイズ（描画時と同値）
 * @param {number} zoom - 現在のズーム倍率（描画時と同値）
 * @returns {{row: number, col: number} | null} セル座標（グリッド外・不正入力は null）
 */
export function canvasPointToCell(canvas, event, cellSize, zoom) {
  if (!canvas || !event) {
    return null;
  }

  // 1. 実効セルサイズ（px）。0以下・非数値は編集不能としてnull。
  const effectiveCellSize = Number(cellSize) * Number(zoom);
  if (!Number.isFinite(effectiveCellSize) || effectiveCellSize <= 0) {
    return null;
  }

  const internalWidth = Number(canvas.width);
  const internalHeight = Number(canvas.height);
  if (!Number.isFinite(internalWidth) || !Number.isFinite(internalHeight)) {
    return null;
  }

  // 2. 表示サイズ（CSSピクセル）を取得し、内部解像度との比を求める。
  //    表示サイズが取得不能・0 の場合は比 = 1（内部解像度と等倍）とみなす。
  const rect =
    typeof canvas.getBoundingClientRect === 'function'
      ? canvas.getBoundingClientRect()
      : null;
  const displayWidth = rect && rect.width ? rect.width : internalWidth;
  const displayHeight = rect && rect.height ? rect.height : internalHeight;
  const scaleX = displayWidth ? internalWidth / displayWidth : 1;
  const scaleY = displayHeight ? internalHeight / displayHeight : 1;

  // 3. クリック位置（表示座標）→ Canvas内部座標へ変換する。
  //    offsetX/offsetY を優先し、無ければ clientX/Y − rect.left/top でフォールバック。
  let pointX = event.offsetX;
  let pointY = event.offsetY;
  if (pointX === undefined || pointY === undefined || pointX === null || pointY === null) {
    if (rect && event.clientX !== undefined && event.clientY !== undefined) {
      pointX = event.clientX - rect.left;
      pointY = event.clientY - rect.top;
    } else {
      return null;
    }
  }

  const canvasX = pointX * scaleX;
  const canvasY = pointY * scaleY;

  // 4. セル座標を算出（グリッド原点は (0,0)）。
  const col = Math.floor(canvasX / effectiveCellSize);
  const row = Math.floor(canvasY / effectiveCellSize);

  // 5. 内部解像度からグリッド寸法を導出し、範囲外は null。
  const cols = Math.round(internalWidth / effectiveCellSize);
  const rows = Math.round(internalHeight / effectiveCellSize);
  if (col < 0 || col >= cols || row < 0 || row >= rows) {
    return null;
  }

  return { row, col };
}

/**
 * 図案グリッドの1セルを編集ツールに従って書き換えた、新しい PatternGrid を返す純関数。
 *
 * - ツールが「描画（paint）」かつ色が指定されている場合: 当該セルを選択色に設定（要件12.2）
 * - ツールが「消しゴム（erase）」の場合: 当該セルを null（未配置）に設定（要件12.3）
 * - paint だが色が null の場合: 塗る色が無いため変更しない（元の pattern をそのまま返す）
 *
 * 元の図案を破壊しないよう、cells 配列と編集対象の行のみを複製して差し替える
 * （単一セル編集のため全行コピーは避け、変更行だけを新規化する）。新しいオブジェクト
 * 参照を返すので、呼び出し側が state.setPattern に渡すと変更通知が発火する。
 * background除外復元用の originalCells は手動編集の対象外として保持する。
 *
 * @param {PatternGrid} pattern - 編集対象の図案グリッド
 * @param {number} row - 編集するセルの行（0始まり）
 * @param {number} col - 編集するセルの列（0始まり）
 * @param {{type: 'paint'|'erase', color: BeadColor|null}} editTool - 現在の編集ツール
 * @returns {PatternGrid} 1セルを更新した新しい図案グリッド（範囲外・無効入力時は元のまま）
 */
export function applyCellEdit(pattern, row, col, editTool) {
  if (!pattern || !Array.isArray(pattern.cells)) {
    return pattern;
  }
  // 範囲チェック（canvasPointToCell でも検証済みだが、純関数単体の正当性を担保する）。
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    row < 0 ||
    row >= pattern.height ||
    col < 0 ||
    col >= pattern.width
  ) {
    return pattern;
  }

  // 編集後のセル値を決定する。
  let nextValue;
  if (editTool && editTool.type === 'paint') {
    // 塗る色が未選択（null）なら変更しない。
    if (!editTool.color) {
      return pattern;
    }
    nextValue = editTool.color;
  } else {
    // 消しゴム（erase）または未知ツールは未配置（null）にする。
    nextValue = null;
  }

  // cells 配列と対象行のみ複製して差し替える（元配列は破壊しない）。
  const nextCells = pattern.cells.slice();
  const sourceRow = Array.isArray(nextCells[row]) ? nextCells[row] : [];
  const nextRow = sourceRow.slice();
  nextRow[col] = nextValue;
  nextCells[row] = nextRow;

  return { ...pattern, cells: nextCells };
}

/**
 * 有効パレット（無効化色を除いた色配列）を解決する。
 *
 * getActivePalette が渡されていればそれを優先する（main.js が paletteSelector と
 * 同一のパレットインスタンスを共有させるための注入口）。未指定の場合は、選択中
 * ビーズタイプの全パレットから state.disabledColorIds を除外して算出する。
 *
 * @param {object} state - アプリケーション状態ストア
 * @param {(function(): BeadColor[])|undefined} getActivePalette - 有効パレット取得関数（任意）
 * @returns {BeadColor[]} 有効パレット（lab付与済み）
 */
function resolveActivePalette(state, getActivePalette) {
  if (typeof getActivePalette === 'function') {
    const provided = getActivePalette();
    if (Array.isArray(provided)) {
      return provided;
    }
  }
  const raw = RAW_PALETTES[state.beadType] || PARLER_PALETTE;
  const full = initializePalette(raw);
  const disabled = new Set(Array.isArray(state.disabledColorIds) ? state.disabledColorIds : []);
  return full.filter((color) => !disabled.has(color.id));
}

/**
 * 現在の編集ツールが、指定した色の「描画」ツールとして選択中かどうかを判定する。
 * @param {object} editTool - state.editTool
 * @param {BeadColor} color - 判定対象の色
 * @returns {boolean} 当該色の描画ツールが選択中なら true
 */
function isPaintColorSelected(editTool, color) {
  return Boolean(
    editTool &&
      editTool.type === 'paint' &&
      editTool.color &&
      ((color.id !== undefined && editTool.color.id === color.id) ||
        (editTool.color.r === color.r &&
          editTool.color.g === color.g &&
          editTool.color.b === color.b)),
  );
}

/**
 * 図案手動編集UIを初期化する（ツール選択UIの描画＋Canvasのドラッグ/クリックハンドラの結線）。
 *
 * ツールセレクタ（toolContainer）には有効パレットの色スウォッチと「消しゴム（未配置）」
 * ボタンを並べ、クリックで state.editTool を切り替える（要件12.1）。
 *
 * Canvas のポインタ操作は mousedown → mousemove → mouseup（＋ Canvas の mouseleave、
 * window の mouseup）ベースのイベントモデルで扱う:
 *   - mousedown: 押下セルを canvasPointToCell で特定して編集し、ドラッグ開始
 *     （isDragging=true・lastCell 記録）。移動を伴わない単一クリックも、この1セル
 *     編集で従来どおり機能する（要件12.2, 12.3, 12.11）。
 *   - mousemove: ドラッグ中のみ、現在セルが lastCell と異なる新規セルであれば編集を
 *     適用し lastCell を更新する。これにより通過セルへ連続適用しつつ、同一セルへの
 *     重複適用・無駄な再描画を避ける（要件12.6, 12.7）。
 *   - mouseup（window）/ mouseleave（Canvas）: ドラッグ編集を終了する（要件12.8, 12.9）。
 *
 * 各セル編集では applyCellEdit で新しい PatternGrid を得て state.pattern を更新し、
 * onPatternEdit を発火して使用色一覧・合計の即時再計算と再描画を促す（要件12.4, 12.5,
 * 12.10, 6.5）。ドラッグ状態（isDragging / lastCell）は本関数のクロージャ内ローカル状態
 * として保持し、AppState には持たせない（一時的なUI操作状態のため）。
 *
 * @param {HTMLCanvasElement|null} canvas - 図案描画Canvas
 * @param {HTMLElement|null} toolContainer - ツール選択UIのコンテナ要素
 * @param {object} state - アプリケーション状態ストア（state.js の createAppState の戻り値）
 * @param {object|function} [optionsOrOnPatternEdit] - オプション、または onPatternEdit 関数
 * @param {function(object): void} [optionsOrOnPatternEdit.onPatternEdit] - セル編集後コールバック
 * @param {function(): BeadColor[]} [optionsOrOnPatternEdit.getActivePalette] - 有効パレット取得関数
 * @param {number} [optionsOrOnPatternEdit.cellSize] - 描画時の基本セルサイズ（既定: 10）
 * @returns {{refresh: function(): void, destroy: function(): void}}
 *          ツールセレクタの再同期（refresh）・破棄（destroy）ハンドル
 */
export function initPatternEditorUI(canvas, toolContainer, state, optionsOrOnPatternEdit = {}) {
  // 第4引数は「関数（= onPatternEdit）」または「オプションオブジェクト」の両形式を許容する。
  // design.md は位置引数 onPatternEdit、タスク補足は { onPatternEdit } 形式を例示しているため。
  const options =
    typeof optionsOrOnPatternEdit === 'function'
      ? { onPatternEdit: optionsOrOnPatternEdit }
      : optionsOrOnPatternEdit || {};

  const { onPatternEdit, getActivePalette } = options;
  const cellSize =
    Number.isFinite(options.cellSize) && options.cellSize > 0
      ? options.cellSize
      : DEFAULT_CELL_SIZE;

  /**
   * 描画ツール（色塗り）を選択する（要件12.1）。
   * @param {BeadColor} color - 塗る色
   */
  function selectPaintTool(color) {
    state.setEditTool({ type: 'paint', color });
    renderTools();
  }

  /**
   * 消しゴム（未配置）ツールを選択する（要件12.1）。
   */
  function selectEraseTool() {
    state.setEditTool({ type: 'erase', color: null });
    renderTools();
  }

  /**
   * ツール選択UI（色スウォッチ＋消しゴムボタン）を描画する。
   * 現在の state.editTool に応じて選択中ツールを視覚的に強調する。
   */
  function renderTools() {
    if (!toolContainer) {
      return;
    }
    toolContainer.innerHTML = '';

    const root = document.createElement('div');
    root.className = 'pattern-editor';

    const heading = document.createElement('div');
    heading.className = 'pattern-editor__heading';
    heading.textContent = t('patternEditor.heading');
    root.appendChild(heading);

    const tools = document.createElement('div');
    tools.className = 'pattern-editor__tools';

    const palette = resolveActivePalette(state, getActivePalette);
    const editTool = state.editTool;

    // --- 有効パレットの色スウォッチ（描画ツール、要件12.1, 12.2） -------------
    for (const color of palette) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pattern-editor__tool pattern-editor__tool--color';
      // 色見本はボタン背景で表現する。CSS未整備でも視認できるよう最小限の寸法を付与。
      btn.style.backgroundColor = `rgb(${color.r}, ${color.g}, ${color.b})`;
      btn.style.display = 'inline-block';
      btn.style.width = '24px';
      btn.style.height = '24px';
      // 色名はテキスト併記しないため、アクセシブルネームを付与する。
      const colorName = getColorName(color);
      const accessibleName = color.id !== undefined ? `${color.id} ${colorName}` : colorName;
      btn.title = accessibleName;
      btn.setAttribute('aria-label', accessibleName);

      const selected = isPaintColorSelected(editTool, color);
      btn.setAttribute('aria-pressed', String(selected));
      if (selected) {
        btn.classList.add('is-selected');
      }

      btn.addEventListener('click', () => selectPaintTool(color));
      tools.appendChild(btn);
    }

    // --- 消しゴム（未配置）ボタン（要件12.1, 12.3） ---------------------------
    const eraser = document.createElement('button');
    eraser.type = 'button';
    eraser.className = 'pattern-editor__tool pattern-editor__tool--eraser';
    eraser.textContent = t('patternEditor.eraser');
    const eraserSelected = Boolean(editTool && editTool.type === 'erase');
    eraser.setAttribute('aria-pressed', String(eraserSelected));
    if (eraserSelected) {
      eraser.classList.add('is-selected');
    }
    eraser.addEventListener('click', () => selectEraseTool());
    tools.appendChild(eraser);

    root.appendChild(tools);
    toolContainer.appendChild(root);
  }

  // --- ドラッグ連続編集のローカル状態（要件12.6〜12.9） ----------------------
  // isDragging / lastCell は本コンポーネントのクロージャ内に閉じた一時的なUI状態。
  // 図案データや変換結果には属さないため AppState には持たせない（設計の方針）。
  //   isDragging: マウスボタン押下中（ドラッグ中）か
  //   lastCell  : 直近で編集したセル { row, col }（重複適用回避の比較に使う）/ 未ドラッグ時は null
  let isDragging = false;
  /** @type {{row: number, col: number} | null} */
  let lastCell = null;

  /**
   * 指定セルに現在の編集ツールを適用し、変更があれば state.pattern を更新して
   * onPatternEdit を発火する（要件12.4, 12.5, 12.10, 6.5）。
   *
   * applyCellEdit は「描画で色未選択」「範囲外」などの no-op 時に元の pattern を
   * そのまま返す。その場合は参照が変わらないため、setPattern も onPatternEdit も
   * 呼ばず、無駄な通知・再描画を発生させない。
   *
   * @param {{row: number, col: number}} cell - 編集対象セル
   * @returns {boolean} 実際に編集が反映された（pattern 参照が変わった）場合 true
   */
  function applyEditToCell(cell) {
    const pattern = state.pattern;
    // 図案が未生成なら編集対象が無いので何もしない（要件5.5 の未生成状態）。
    if (!pattern) {
      return false;
    }

    const nextPattern = applyCellEdit(pattern, cell.row, cell.col, state.editTool);
    if (nextPattern === pattern) {
      return false;
    }

    // state.pattern を更新（要件12.5）。新しい参照なので変更通知が発火する。
    state.setPattern(nextPattern);

    // 使用色一覧・合計の即時再計算と図案の再描画を呼び出し側に促す（要件12.4, 12.10, 6.5）。
    if (typeof onPatternEdit === 'function') {
      onPatternEdit({ row: cell.row, col: cell.col, pattern: nextPattern });
    }
    return true;
  }

  /**
   * mousedown ハンドラ。ドラッグを開始し、押下セルを編集する（要件12.6, 12.11）。
   *
   * 移動を伴わない単一クリック（mousedown → 同一セルで mouseup）は、この時点の
   * 1セル編集だけで完結するため、従来どおり「1セルのみ編集」として機能する
   * （要件12.11・後方互換）。
   *
   * @param {MouseEvent} event - mousedown イベント
   */
  function handleCanvasMouseDown(event) {
    // 主ボタン（左クリック）以外ではドラッグ編集を開始しない。
    // button が未定義のイベント（合成イベント等）は主ボタン扱いとする。
    if (typeof event.button === 'number' && event.button !== 0) {
      return;
    }

    const pattern = state.pattern;
    if (!pattern) {
      return;
    }

    // 押下位置 → セル座標。グリッド外は null なので編集もドラッグ開始もしない。
    const cell = canvasPointToCell(canvas, event, cellSize, state.zoom);
    if (!cell) {
      return;
    }

    // ドラッグ開始。押下セルを編集対象として記録してから編集を適用する。
    // （編集が no-op でも、後続 mousemove の重複判定のため lastCell は記録する。）
    isDragging = true;
    lastCell = { row: cell.row, col: cell.col };
    applyEditToCell(cell);
  }

  /**
   * mousemove ハンドラ。ドラッグ中のみ、新たに通過したセルへ編集を適用する
   * （要件12.6, 12.7）。
   *
   * lastCell と同一セルでは編集をスキップするため、同一セル上での微小移動による
   * 重複適用・無駄な再描画は発生しない（要件12.7）。
   *
   * @param {MouseEvent} event - mousemove イベント
   */
  function handleCanvasMouseMove(event) {
    if (!isDragging) {
      return;
    }

    const cell = canvasPointToCell(canvas, event, cellSize, state.zoom);
    // グリッド外ではこの移動では編集しない（ドラッグ自体は mouseleave で終了する）。
    if (!cell) {
      return;
    }

    // 直前に編集したセルと同一なら重複適用を避ける（要件12.7）。
    if (lastCell && lastCell.row === cell.row && lastCell.col === cell.col) {
      return;
    }

    lastCell = { row: cell.row, col: cell.col };
    applyEditToCell(cell);
  }

  /**
   * ドラッグ編集を終了する（要件12.8: mouseup / 要件12.9: mouseleave 共通）。
   * window の mouseup（Canvas 外でボタンを離した場合も確実に終了させる）と、
   * Canvas の mouseleave（ポインタが図案表示領域の外へ出た場合）の双方で呼ぶ。
   */
  function endDrag() {
    isDragging = false;
    lastCell = null;
  }

  // --- 結線（mousedown 起点のドラッグ/クリック編集・要件12.6〜12.11） --------
  // window が利用可能なら、Canvas 外でボタンを離してもドラッグを確実に終了できるよう
  // mouseup をウィンドウレベルで捕捉する（要件12.8）。SSR等で window が無い環境では
  // Canvas の mouseleave のみでドラッグ終了を担保する。
  const mouseUpTarget = typeof window !== 'undefined' ? window : null;

  if (canvas && typeof canvas.addEventListener === 'function') {
    canvas.addEventListener('mousedown', handleCanvasMouseDown);
    canvas.addEventListener('mousemove', handleCanvasMouseMove);
    // ポインタが図案表示領域の外へ出たらドラッグ編集を終了する（要件12.9）。
    canvas.addEventListener('mouseleave', endDrag);
    // ドラッグ/クリックで編集可能であることを示すカーソル。
    if (canvas.style) {
      canvas.style.cursor = 'crosshair';
    }
  }
  if (mouseUpTarget) {
    mouseUpTarget.addEventListener('mouseup', endDrag);
  }

  // ツール選択UIの初期描画。
  renderTools();

  return {
    /**
     * 外部からの state 変更（ビーズタイプ切替・無効化色変更・ツール変更等）に
     * 合わせてツール選択UIを再描画する。
     */
    refresh() {
      renderTools();
    },

    /**
     * UIを破棄する（全イベントハンドラ解除・コンテナクリア・カーソル復帰）。
     * mousedown/mousemove/mouseleave（Canvas）と mouseup（window）を確実に解除し、
     * ドラッグ状態も初期化する（リスナーの取りこぼし・多重結線を防ぐ）。
     */
    destroy() {
      if (canvas && typeof canvas.removeEventListener === 'function') {
        canvas.removeEventListener('mousedown', handleCanvasMouseDown);
        canvas.removeEventListener('mousemove', handleCanvasMouseMove);
        canvas.removeEventListener('mouseleave', endDrag);
        if (canvas.style) {
          canvas.style.cursor = '';
        }
      }
      if (mouseUpTarget) {
        mouseUpTarget.removeEventListener('mouseup', endDrag);
      }
      // 念のためドラッグ状態を初期化する。
      isDragging = false;
      lastCell = null;
      if (toolContainer) {
        toolContainer.innerHTML = '';
      }
    },
  };
}
