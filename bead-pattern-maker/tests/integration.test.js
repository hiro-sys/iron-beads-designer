import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureImageData } from './helpers/canvasMock.js';
import { initializePalette } from '../src/data/beadConfig.js';
import { PARLER_PALETTE } from '../src/data/parlerPalette.js';

// =============================================================================
// 変換パイプライン統合テスト（tests/integration.test.js / タスク17.2）
// -----------------------------------------------------------------------------
// 目的:
//   「アップロード → 生成 → 色一覧 → 背景除外 → 手動編集」の一連のフローを、
//   エンジン層（LocalConversionStrategy）を中心に、各モジュールの実装をそのまま
//   結合して検証する統合テスト。ユニットテスト（各モジュール単体）に対して、
//   本テストは「モジュール間の連携（受け渡すデータ構造の整合）」を主眼に置く。
//
//   結合対象（いずれも実装をそのまま使用。モックは imageProcessor のみ）:
//     - LocalConversionStrategy.convert ... 画像→図案生成（要件4.4）
//     - colorList.calculateUsedColors    ... 使用色集計（要件6.5）
//     - colorMatcher.findClosestColor    ... 生背景色→背景ビーズ色変換（要件9.2/9.9）
//     - backgroundDetector.applyBackgroundExclusion ... 背景除外（要件9.9）
//     - patternEditor.applyCellEdit      ... 手動編集（要件12.5）
//
// 検証する受け入れ基準:
//   - 要件4.4 : 図案生成が完了し、グリッド形式（正しい寸法・構造）で表現される
//   - 要件6.5 : 図案編集時に使用色一覧・合計個数が即時更新される
//   - 要件9.9 : 背景除外のON/OFF切替が図案へ反映され、OFFで元へ復元される
//   - 要件12.5: セル手動編集の結果が図案へ反映される
//
// 【Canvas/ImageData の制御方針（LocalConversionStrategy.test.js と同手法）】
//   convert は内部で imageProcessor.resizeImage を呼び Canvas 経由で ImageData を
//   得る。テストでは特定の色・alpha を持つピクセル列を流し込みたいので、
//   imageProcessor を vi.mock で差し替え、resizeImage が任意に構築した ImageData を
//   返すようにする。これにより「背景色・前景色・透明ピクセル」を厳密に配置できる。
//   その他のモジュール（findClosestColor / applyBackgroundExclusion /
//   calculateUsedColors / applyCellEdit）は実装をそのまま結合して用いる。
// =============================================================================

// imageProcessor をモックし、resizeImage の戻り ImageData をテストから制御する。
// （vi.mock はファイル先頭へ巻き上げられ、LocalConversionStrategy 内の resizeImage も
//   同じモックを参照する。）
vi.mock('../src/engine/imageProcessor.js', () => ({
  resizeImage: vi.fn(),
}));

import { resizeImage } from '../src/engine/imageProcessor.js';
import { LocalConversionStrategy } from '../src/engine/LocalConversionStrategy.js';
import { calculateUsedColors } from '../src/ui/colorList.js';
import { findClosestColor } from '../src/engine/colorMatcher.js';
import { applyBackgroundExclusion } from '../src/engine/backgroundDetector.js';
import { applyCellEdit } from '../src/ui/patternEditor.js';

// -----------------------------------------------------------------------------
// 共有フィクスチャ / ヘルパー
// -----------------------------------------------------------------------------

const strategy = new LocalConversionStrategy();

// 有効パレットは初期化（lab キャッシュ付与）済みのパーラービーズ全色を用いる。
const ACTIVE_PALETTE = initializePalette(PARLER_PALETTE);

// convert は image が truthy であることのみ要求する（resizeImage はモック済みで
// 実画像を参照しない）。寸法は ImageData 側で制御するためダミーで十分。
const dummyImage = { width: 8, height: 8, naturalWidth: 8, naturalHeight: 8 };

// --- 制御された 4×4 のピクセルレイアウト -------------------------------------
// PARLER_PALETTE に「完全一致」する RGB を選び、最近色マッチングが ΔE=0 で
// 決定的になるようにする（生成結果が一意に定まり、統合検証が安定する）。
//   BG    : (39,90,170)  = P11 あお（背景色として除外対象にする）
//   RED   : (219,46,52)  = P06 あか（前景・除外されない）
//   BLACK : (42,42,44)   = P25 くろ（前景・除外されない）
//   TRANS : alpha=0      → 透明（要件4.6: 色変換せず未配置 null）
const BG = { r: 39, g: 90, b: 170, a: 255 };
const RED = { r: 219, g: 46, b: 52, a: 255 };
const BLACK = { r: 42, g: 42, b: 44, a: 255 };
const TRANS = { r: 0, g: 0, b: 0, a: 0 };

const WIDTH = 4;
const HEIGHT = 4;

// 行優先 [row][col] の 16 ピクセル。
//   Row0: BG    BG    BG    BG      （背景4）
//   Row1: BG    RED   RED   BG      （背景2・前景あか2）
//   Row2: BG    BLACK BLACK BG      （背景2・前景くろ2）
//   Row3: TRANS BG    BG    BG      （透明1・背景3）
// 合計: 背景(あお)=11, あか=2, くろ=2, 透明=1 → 非null=15, null(透明)=1
const PIXELS = [
  BG, BG, BG, BG,
  BG, RED, RED, BG,
  BG, BLACK, BLACK, BG,
  TRANS, BG, BG, BG,
];

// 期待されるマッチング結果（テスト時に同じ colorMatcher で導出し、ハードコードを避ける）。
// 生成パイプラインで使われるのと同一の findClosestColor を用いることで、
// 「変換エンジンの出力」と「テストの期待値」が同じ実装に基づく真の統合になる。
const expectedBg = findClosestColor({ r: BG.r, g: BG.g, b: BG.b }, ACTIVE_PALETTE);
const expectedRed = findClosestColor({ r: RED.r, g: RED.g, b: RED.b }, ACTIVE_PALETTE);
const expectedBlack = findClosestColor({ r: BLACK.r, g: BLACK.g, b: BLACK.b }, ACTIVE_PALETTE);

/**
 * 任意のピクセル列（{r,g,b,a}[]、行優先）から ImageData を構築する。
 * resizeImage のモック戻り値として用い、convert に特定のピクセルデータを流す。
 *
 * @param {number} width - 幅（ビーズ数）
 * @param {number} height - 高さ（ビーズ数）
 * @param {{r:number,g:number,b:number,a:number}[]} pixels - width*height 個（行優先）
 * @returns {ImageData} 構築した ImageData（data 長は width*height*4）
 */
function makeImageData(width, height, pixels) {
  const ImageDataCtor = ensureImageData();
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 1) {
    const p = pixels[i];
    data[i * 4] = p.r;
    data[i * 4 + 1] = p.g;
    data[i * 4 + 2] = p.b;
    data[i * 4 + 3] = p.a;
  }
  return new ImageDataCtor(data, width, height);
}

/**
 * 固定レイアウト（PIXELS）の ImageData を resizeImage に仕込み、convert を実行する。
 * options で convert オプションを上書きできる。
 *
 * @param {object} [options] - convert オプションの上書き
 * @returns {import('../src/engine/ConversionStrategy.js').PatternGrid} 生成された図案
 */
function runConvert(options = {}) {
  resizeImage.mockReturnValue(makeImageData(WIDTH, HEIGHT, PIXELS));
  return strategy.convert(dummyImage, {
    width: WIDTH,
    height: HEIGHT,
    activePalette: ACTIVE_PALETTE,
    resizeMethod: 'sharp',
    fitMode: 'stretch',
    maxColors: null,
    beadType: 'perler',
    plateConfig: { cols: 1, rows: 1 },
    ...options,
  });
}

/**
 * calculateUsedColors の結果を「色id → 個数」のプレーンオブジェクトへ変換する。
 * 集計結果の同値比較（背景除外の復元検証など）に用いる。
 *
 * @param {{colors: Array<{id: string, count: number}>}} result - calculateUsedColors の戻り値
 * @returns {Record<string, number>} 色id → 使用個数
 */
function colorCountMap(result) {
  const map = {};
  for (const entry of result.colors) {
    map[entry.id] = entry.count;
  }
  return map;
}

beforeEach(() => {
  // 各テストごとにモックを初期化する（呼び出し履歴・戻り値設定をリセット）。
  resizeImage.mockReset();
});

// =============================================================================
// 前提の健全性チェック
// =============================================================================
describe('統合テストのフィクスチャ前提', () => {
  it('背景・あか・くろは互いに異なるビーズ色へマッチングされる（テスト設計の妥当性）', () => {
    // 3色が区別可能であることを保証する。これが崩れると以降の個数検証が成立しない。
    expect(expectedBg).not.toBeNull();
    expect(expectedRed).not.toBeNull();
    expect(expectedBlack).not.toBeNull();
    const ids = new Set([expectedBg.id, expectedRed.id, expectedBlack.id]);
    expect(ids.size).toBe(3);
  });
});

// =============================================================================
// (1) 生成（要件4.4）
// =============================================================================
describe('統合: 画像→図案生成（要件4.4）', () => {
  it('制御された ImageData から、正しい寸法・構造の PatternGrid を生成する', () => {
    const pattern = runConvert();

    // グリッド形式（height 行 × width 列）の2次元配列であること（要件4.4）。
    expect(pattern.width).toBe(WIDTH);
    expect(pattern.height).toBe(HEIGHT);
    expect(pattern.cells).toHaveLength(HEIGHT);
    for (const row of pattern.cells) {
      expect(row).toHaveLength(WIDTH);
    }
    // 背景除外前の復元用グリッドも同形で保持される。
    expect(pattern.originalCells).toHaveLength(HEIGHT);
    expect(pattern.originalCells[0]).toHaveLength(WIDTH);
    // メタ情報（ビーズタイプ・プレート構成）が引き継がれる。
    expect(pattern.beadType).toBe('perler');
    expect(pattern.plateConfig).toEqual({ cols: 1, rows: 1 });
  });

  it('各セルが期待どおりのパレット色／未配置に変換される（透明→null・前景/背景→最近色）', () => {
    const pattern = runConvert();

    // 透明ピクセル（row3,col0）は色変換されず未配置 null（要件4.6）。
    expect(pattern.cells[3][0]).toBeNull();

    // 前景セル（あか/くろ）と背景セル（あお）が、それぞれ期待色へマッチングされる。
    expect(pattern.cells[1][1].id).toBe(expectedRed.id);
    expect(pattern.cells[1][2].id).toBe(expectedRed.id);
    expect(pattern.cells[2][1].id).toBe(expectedBlack.id);
    expect(pattern.cells[2][2].id).toBe(expectedBlack.id);
    expect(pattern.cells[0][0].id).toBe(expectedBg.id);
    expect(pattern.cells[3][3].id).toBe(expectedBg.id);
  });
});

// =============================================================================
// (2) 色一覧（要件6.5）
// =============================================================================
describe('統合: 生成図案の使用色集計（要件6.5）', () => {
  it('calculateUsedColors の集計が生成図案と整合する（色集合・合計・未配置）', () => {
    const pattern = runConvert();
    const used = calculateUsedColors(pattern);

    // 非nullセル数 = 15（あお11 + あか2 + くろ2）、未配置 = 1（透明）。
    expect(used.totalBeads).toBe(15);
    expect(used.excludedCount).toBe(1);
    // 合計 + 未配置 = 全セル数（width × height）。
    expect(used.totalBeads + used.excludedCount).toBe(WIDTH * HEIGHT);

    // 色集合・個数が図案の実セルと一致する。
    expect(colorCountMap(used)).toEqual({
      [expectedBg.id]: 11,
      [expectedRed.id]: 2,
      [expectedBlack.id]: 2,
    });
  });
});

// =============================================================================
// (3) 背景除外（要件9.9）
// =============================================================================
describe('統合: 背景除外の適用と再集計（要件9.9）', () => {
  it('生背景色を最近色へ変換して適用すると、背景セルが null になり再集計へ反映される', () => {
    const pattern = runConvert();

    // 背景除外の手順（UI/エンジンと同じ）:
    //   生背景色（プレビューの生ピクセル色）を findClosestColor で有効パレットの
    //   最近色＝背景ビーズ色へ変換してから applyBackgroundExclusion に渡す（要件9.2）。
    const backgroundBead = findClosestColor({ r: BG.r, g: BG.g, b: BG.b }, ACTIVE_PALETTE);
    expect(backgroundBead.id).toBe(expectedBg.id);

    const excluded = applyBackgroundExclusion(pattern, backgroundBead, 10);

    // 背景（あお）に該当するセルは全て未配置 null になる。
    expect(excluded.cells[0][0]).toBeNull();
    expect(excluded.cells[3][3]).toBeNull();
    // 前景（あか/くろ）は保持される。
    expect(excluded.cells[1][1].id).toBe(expectedRed.id);
    expect(excluded.cells[2][1].id).toBe(expectedBlack.id);

    // 再集計が背景除外を反映する: 合計が 15→4 に減り、背景色は色一覧から消える。
    const usedAfter = calculateUsedColors(excluded);
    expect(usedAfter.totalBeads).toBe(4);
    expect(colorCountMap(usedAfter)).toEqual({
      [expectedRed.id]: 2,
      [expectedBlack.id]: 2,
    });
    // 整合性: 合計 + 未配置 = 全セル数。
    expect(usedAfter.totalBeads + usedAfter.excludedCount).toBe(WIDTH * HEIGHT);
  });

  it('ON→OFF（originalCells からの復元）で元の集計に戻り、データ欠損が無い', () => {
    const pattern = runConvert();
    const before = calculateUsedColors(pattern);

    const backgroundBead = findClosestColor({ r: BG.r, g: BG.g, b: BG.b }, ACTIVE_PALETTE);
    const excluded = applyBackgroundExclusion(pattern, backgroundBead, 10);

    // 背景除外をOFFに戻す操作 = originalCells（除外前スナップショット）から cells を復元する。
    const restored = {
      ...excluded,
      cells: excluded.originalCells.map((row) => row.slice()),
    };
    const after = calculateUsedColors(restored);

    // 復元後の集計が、背景除外前と完全に一致する（色集合・個数・合計とも）。
    expect(after.totalBeads).toBe(before.totalBeads);
    expect(after.excludedCount).toBe(before.excludedCount);
    expect(colorCountMap(after)).toEqual(colorCountMap(before));
  });
});

// =============================================================================
// (4) 手動編集（要件12.5）
// =============================================================================
describe('統合: セル手動編集と再集計（要件12.5）', () => {
  it('消しゴム編集でセルが未配置になり、合計が即時に1減る', () => {
    const pattern = runConvert();
    const before = calculateUsedColors(pattern);

    // 前景の あか セル（row1,col1）を消しゴムで未配置にする。
    const edited = applyCellEdit(pattern, 1, 1, { type: 'erase', color: null });

    expect(edited.cells[1][1]).toBeNull();
    const after = calculateUsedColors(edited);
    // 再集計が編集を即時反映: 合計が 1 減り、非nullセル数と一致する。
    expect(after.totalBeads).toBe(before.totalBeads - 1);
    expect(after.totalBeads).toBe(15 - 1);
  });

  it('描画編集で未配置セルが選択色になり、合計が即時に1増える', () => {
    const pattern = runConvert();
    const before = calculateUsedColors(pattern);

    // 透明由来の未配置セル（row3,col0）を あか で塗る。
    const edited = applyCellEdit(pattern, 3, 0, { type: 'paint', color: expectedRed });

    expect(edited.cells[3][0].id).toBe(expectedRed.id);
    const after = calculateUsedColors(edited);
    // 再集計が編集を即時反映: 合計が 1 増える。
    expect(after.totalBeads).toBe(before.totalBeads + 1);
    expect(after.totalBeads).toBe(15 + 1);
  });
});

// =============================================================================
// (5) 一連フロー通し（生成→色一覧→背景除外→再集計→手動編集→再集計）
// =============================================================================
describe('統合: 変換パイプライン一連フロー（要件4.4 / 6.5 / 9.9 / 12.5）', () => {
  it('アップロード→生成→色一覧→背景除外→再集計→手動編集→再集計が連携して動作する', () => {
    // --- 生成（要件4.4） ---------------------------------------------------
    const pattern = runConvert();
    expect(pattern.width).toBe(WIDTH);
    expect(pattern.height).toBe(HEIGHT);
    expect(pattern.cells).toHaveLength(HEIGHT);

    // --- 色一覧（要件6.5: 生成直後の集計） ---------------------------------
    const initial = calculateUsedColors(pattern);
    expect(initial.totalBeads).toBe(15);
    expect(initial.excludedCount).toBe(1);
    expect(colorCountMap(initial)).toEqual({
      [expectedBg.id]: 11,
      [expectedRed.id]: 2,
      [expectedBlack.id]: 2,
    });

    // --- 背景除外 ON（要件9.9） --------------------------------------------
    const backgroundBead = findClosestColor({ r: BG.r, g: BG.g, b: BG.b }, ACTIVE_PALETTE);
    const excluded = applyBackgroundExclusion(pattern, backgroundBead, 10);
    const afterExclusion = calculateUsedColors(excluded);
    // 背景色が一覧から消え、合計が前景のみ（4）に減る。
    expect(afterExclusion.totalBeads).toBe(4);
    expect(colorCountMap(afterExclusion)).toEqual({
      [expectedRed.id]: 2,
      [expectedBlack.id]: 2,
    });

    // --- 背景除外 OFF（要件9.9: originalCells から復元） -------------------
    const restored = {
      ...excluded,
      cells: excluded.originalCells.map((row) => row.slice()),
    };
    const afterRestore = calculateUsedColors(restored);
    expect(colorCountMap(afterRestore)).toEqual(colorCountMap(initial));
    expect(afterRestore.totalBeads).toBe(initial.totalBeads);

    // --- 手動編集（要件12.5）: 復元後の図案に対して編集する -----------------
    // あか セル（row1,col1）を消しゴムで未配置にする。
    const erased = applyCellEdit(restored, 1, 1, { type: 'erase', color: null });
    expect(erased.cells[1][1]).toBeNull();
    const afterErase = calculateUsedColors(erased);
    // 再集計が即時反映: 合計が 1 減る（15→14）。
    expect(afterErase.totalBeads).toBe(afterRestore.totalBeads - 1);

    // さらに、透明由来の未配置セル（row3,col0）を あか で描画する。
    const painted = applyCellEdit(erased, 3, 0, { type: 'paint', color: expectedRed });
    expect(painted.cells[3][0].id).toBe(expectedRed.id);
    const afterPaint = calculateUsedColors(painted);
    // 1減・1増の通算で、復元直後の合計（15）と同じ（14→15）に戻る。
    expect(afterPaint.totalBeads).toBe(afterRestore.totalBeads);
    // 連携の最終整合性: 合計 + 未配置 = 全セル数。
    expect(afterPaint.totalBeads + afterPaint.excludedCount).toBe(WIDTH * HEIGHT);
  });
});
