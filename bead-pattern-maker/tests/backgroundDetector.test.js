import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  detectBackgroundColor,
  isBackgroundColor,
  applyBackgroundExclusion,
} from '../src/engine/backgroundDetector.js';
import { findClosestColor } from '../src/engine/colorMatcher.js';
import { initializePalette } from '../src/data/beadConfig.js';
import { PARLER_PALETTE } from '../src/data/parlerPalette.js';
import { NANO_PALETTE } from '../src/data/nanoPalette.js';
import { createImageData } from './helpers/canvasMock.js';

// =============================================================================
// 背景検出モジュール（backgroundDetector.js）のテスト
// -----------------------------------------------------------------------------
// 対象: src/engine/backgroundDetector.js
//   - detectBackgroundColor(imageData, width, height) … 四隅サンプリングによる背景色検出
//   - isBackgroundColor(pixelColor, backgroundColor, threshold) … ΔE閾値以内かの判定
//   - applyBackgroundExclusion(pattern, backgroundColor, threshold) … 図案への背景除外適用
//
// 本ファイルは以下のタスク分のテストをまとめて収める。
//   - タスク7.3: 背景自動検出の一貫性のプロパティテスト（Property 14） … Requirements 9.1
//   - タスク7.4: 背景除外閾値の単調性のプロパティテスト（Property 15） … Requirements 9.3, 9.4
//   - タスク7.5: 背景除外トグルの可逆性のプロパティテスト（Property 17） … Requirements 9.8, 9.9
//   - タスク7.6: 背景色の色空間整合性のプロパティテスト（Property 23） … Requirements 9.2
//   - タスク7.7: backgroundDetector のユニットテスト … Requirements 9.1, 9.3
//
// プロパティテストは fast-check で 200 回（最低100回以上）反復実行し、各 it 名に
// タグ `Feature: bead-pattern-maker, Property {番号}: {プロパティ文}` を付与する。
//
// 色空間の前提（重要・要件9.2）:
//   isBackgroundColor / applyBackgroundExclusion はいずれも「ビーズ色空間」での比較を
//   前提とする。背景色（生ピクセル色）は呼び出し側が findClosestColor で有効パレットの
//   最近色（背景ビーズ色）へ変換してから渡す。タスク7.6 はこの整合性を検証する。
// =============================================================================

// -----------------------------------------------------------------------------
// 共通アービトラリ（ジェネレータ）
// -----------------------------------------------------------------------------

/**
 * RGB色のジェネレーター（各チャネル 0-255 の整数）。
 * @type {fc.Arbitrary<{ r: number, g: number, b: number }>}
 */
const rgbColorArb = fc.record({
  r: fc.integer({ min: 0, max: 255 }),
  g: fc.integer({ min: 0, max: 255 }),
  b: fc.integer({ min: 0, max: 255 }),
});

/**
 * BeadColor 風のレコード（id/name + RGB）。図案グリッドのセル色生成に用いる。
 * 背景除外の判定は r/g/b のみを用いるため lab は付与しない。
 * @type {fc.Arbitrary<{ id: string, name: string, r: number, g: number, b: number }>}
 */
const beadColorArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 5 }),
  name: fc.string({ maxLength: 8 }),
  r: fc.integer({ min: 0, max: 255 }),
  g: fc.integer({ min: 0, max: 255 }),
  b: fc.integer({ min: 0, max: 255 }),
});

/**
 * ΔE閾値のジェネレーター（要件9.4: 0〜50）。
 * @type {fc.Arbitrary<number>}
 */
const thresholdArb = fc.integer({ min: 0, max: 50 });

/**
 * 図案グリッド（PatternGrid 風）のジェネレーター。
 * 各セルは「null（未配置）」または「ビーズ色（BeadColor 風）」を等確率で取る。
 * width=0 / height=0 の空グリッドも許容する。originalCells は付与しない（呼び出し側で設定）。
 * @type {fc.Arbitrary<{ width: number, height: number, cells: Array<Array<object|null>> }>}
 */
const gridArb = fc
  .record({
    width: fc.integer({ min: 0, max: 6 }),
    height: fc.integer({ min: 0, max: 6 }),
  })
  .chain(({ width, height }) => {
    const cellArb = fc.oneof(fc.constant(null), beadColorArb);
    return fc
      .array(fc.array(cellArb, { minLength: width, maxLength: width }), {
        minLength: height,
        maxLength: height,
      })
      .map((cells) => ({ width, height, cells }));
  });

// 実パレット（lab 付き）。findClosestColor の対象として「現実のパレット」もカバーする。
const REAL_PARLER = initializePalette(PARLER_PALETTE);
const REAL_NANO = initializePalette(NANO_PALETTE);

/**
 * lab 付きの非空パレットのジェネレーター（findClosestColor は非空前提）。
 * ランダムな 1〜8 色パレット、または実在のパーラー／ナノパレットから選ぶ。
 * @type {fc.Arbitrary<Array<{id:string,name:string,r:number,g:number,b:number,lab:object}>>}
 */
const paletteArb = fc.oneof(
  fc
    .uniqueArray(beadColorArb, {
      minLength: 1,
      maxLength: 8,
      selector: (c) => c.id,
    })
    .map((p) => initializePalette(p)),
  fc.constant(REAL_PARLER),
  fc.constant(REAL_NANO),
);

/**
 * 与えられたパレットの色（または null）のみで構成される図案グリッドのジェネレーター。
 * 非nullセルは必ず有効パレット内のビーズ色になる（＝ビーズ色空間のセル）。
 * @param {Array<object>} palette - セル色の供給元となる非空パレット
 * @returns {fc.Arbitrary<{ width: number, height: number, cells: Array<Array<object|null>> }>}
 */
function gridFromPaletteArb(palette) {
  return fc
    .record({
      width: fc.integer({ min: 0, max: 6 }),
      height: fc.integer({ min: 0, max: 6 }),
    })
    .chain(({ width, height }) => {
      const cellArb = fc.oneof(fc.constant(null), fc.constantFrom(...palette));
      return fc
        .array(fc.array(cellArb, { minLength: width, maxLength: width }), {
          minLength: height,
          maxLength: height,
        })
        .map((cells) => ({ width, height, cells }));
    });
}

// -----------------------------------------------------------------------------
// グリッド集計ヘルパー
// -----------------------------------------------------------------------------

/** 未配置（null）セルの数を数える。 */
function countNull(cells) {
  let n = 0;
  for (const row of cells) {
    for (const cell of row) {
      if (cell === null || cell === undefined) n += 1;
    }
  }
  return n;
}

/** ビーズ色（非null）セルの数を数える。 */
function countNonNull(cells) {
  let n = 0;
  for (const row of cells) {
    for (const cell of row) {
      if (cell !== null && cell !== undefined) n += 1;
    }
  }
  return n;
}

/** 各セルが未配置か否かの真偽値マスク（2次元配列）を返す。 */
function nullMask(cells) {
  return cells.map((row) => row.map((cell) => cell === null || cell === undefined));
}

// =============================================================================
// タスク7.3 / Property 14: 背景自動検出の一貫性
//   四隅のサンプリング領域すべてが同一色（=画像全体が単色）の場合、
//   detectBackgroundColor はその色を返す。
// **Validates: Requirements 9.1**
// =============================================================================
describe('backgroundDetector.detectBackgroundColor / プロパティテスト（タスク7.3）', () => {
  it('Feature: bead-pattern-maker, Property 14: 背景自動検出の一貫性（四隅が同一色＝単色画像ならその色を返す）', () => {
    fc.assert(
      fc.property(
        rgbColorArb,
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 1, max: 30 }),
        (color, width, height) => {
          // 単色 fill の画像 → 四隅のサンプリング領域はすべて同一色になる。
          const imageData = createImageData(width, height, { ...color, a: 255 });

          const result = detectBackgroundColor(imageData, width, height);

          // 全サンプルが同一色なので、最大グループの中心色＝その色（整数なので丸め誤差なし）。
          expect(result).toEqual({ r: color.r, g: color.g, b: color.b });
        },
      ),
      { numRuns: 200 },
    );
  });
});

// =============================================================================
// タスク7.4 / Property 15: 背景除外閾値の単調性
//   閾値 T1 < T2 のとき、applyBackgroundExclusion で未配置（null）になるセル数は
//   T1 ≤ T2（単調増加）。元グリッドは originalCells から一貫して判定される。
// **Validates: Requirements 9.3, 9.4**
// =============================================================================
describe('backgroundDetector.applyBackgroundExclusion / プロパティテスト（タスク7.4）', () => {
  it('Feature: bead-pattern-maker, Property 15: 背景除外閾値の単調性（T1≤T2 のとき未配置セル数は単調増加、判定は originalCells から一貫）', () => {
    fc.assert(
      fc.property(gridArb, rgbColorArb, thresholdArb, thresholdArb, (grid, bg, ta, tb) => {
        const lo = Math.min(ta, tb);
        const hi = Math.max(ta, tb);

        // 「背景除外前」のグリッドを originalCells として保持したパターン。
        const pattern = { ...grid, originalCells: grid.cells };

        const resLo = applyBackgroundExclusion(pattern, bg, lo);
        const resHi = applyBackgroundExclusion(pattern, bg, hi);

        // (1) 単調性: 低い閾値の未配置セル数 ≤ 高い閾値の未配置セル数。
        expect(countNull(resHi.cells)).toBeGreaterThanOrEqual(countNull(resLo.cells));

        // (2) originalCells から一貫判定: 低閾値で除外済みのグリッドへ高閾値を再適用しても、
        //     除外前グリッド（originalCells）から判定するため、最初から高閾値を適用した結果と一致する。
        const resLoThenHi = applyBackgroundExclusion(resLo, bg, hi);
        expect(nullMask(resLoThenHi.cells)).toEqual(nullMask(resHi.cells));
      }),
      { numRuns: 200 },
    );
  });
});

// =============================================================================
// タスク7.5 / Property 17: 背景除外トグルの可逆性
//   背景除外を適用（ON相当）した後、originalCells から復元（OFF相当）すると
//   全セルが元のビーズ色に復元され、データの欠損が発生しない。
// **Validates: Requirements 9.8, 9.9**
// =============================================================================
describe('backgroundDetector.applyBackgroundExclusion / プロパティテスト（タスク7.5）', () => {
  it('Feature: bead-pattern-maker, Property 17: 背景除外トグルの可逆性（ON→OFFで全セルが元のビーズ色に復元、欠損なし）', () => {
    fc.assert(
      fc.property(gridArb, rgbColorArb, thresholdArb, (grid, bg, threshold) => {
        // 生成直後（背景除外をまだ適用していない）パターン。originalCells は持たない。
        const pattern = { width: grid.width, height: grid.height, cells: grid.cells };

        // ON相当: 背景除外を適用する。
        const on = applyBackgroundExclusion(pattern, bg, threshold);

        // OFF相当: originalCells から cells を復元する（トグルをオフに戻す挙動）。
        const restoredCells = on.originalCells;

        // 行数・各行の列数が元グリッドと一致する（欠損なし）。
        expect(restoredCells).toHaveLength(grid.cells.length);
        for (let row = 0; row < grid.cells.length; row += 1) {
          expect(restoredCells[row]).toHaveLength(grid.cells[row].length);
          for (let col = 0; col < grid.cells[row].length; col += 1) {
            // 全セルが元の状態（ビーズ色 or null）に一致する。
            expect(restoredCells[row][col]).toEqual(grid.cells[row][col]);
          }
        }

        // 欠損なし: 復元後の非nullセル数は元グリッドの非nullセル数と一致する。
        expect(countNonNull(restoredCells)).toBe(countNonNull(grid.cells));
      }),
      { numRuns: 200 },
    );
  });
});

// =============================================================================
// タスク7.6 / Property 23: 背景色の色空間整合性
//   背景色（生ピクセル色）を findClosestColor で有効パレット最近色（背景ビーズ色）へ
//   変換した上で渡したとき、未配置判定がビーズ色空間で一貫する。
// **Validates: Requirements 9.2**
// =============================================================================
describe('backgroundDetector 背景色の色空間整合性 / プロパティテスト（タスク7.6）', () => {
  // パレット → そのパレット色のみで構成したグリッド・生背景色・閾値、を一括生成するシナリオ。
  const scenarioArb = paletteArb.chain((palette) =>
    fc.record({
      palette: fc.constant(palette),
      rawBg: rgbColorArb,
      threshold: thresholdArb,
      grid: gridFromPaletteArb(palette),
    }),
  );

  it('Feature: bead-pattern-maker, Property 23: 背景色の色空間整合性（背景色を有効パレット最近色へ変換した上でビーズ色空間で判定）', () => {
    fc.assert(
      fc.property(scenarioArb, ({ palette, rawBg, threshold, grid }) => {
        // 生ピクセル色 → 有効パレットの最近色（＝背景ビーズ色）へ変換する。
        const bgBead = findClosestColor(rawBg, palette);

        // 変換結果は必ず有効パレット内の色（＝ビーズ色空間の色）である。
        expect(palette).toContain(bgBead);

        const pattern = { width: grid.width, height: grid.height, cells: grid.cells };
        const result = applyBackgroundExclusion(pattern, bgBead, threshold);

        for (let row = 0; row < grid.cells.length; row += 1) {
          for (let col = 0; col < grid.cells[row].length; col += 1) {
            const cell = grid.cells[row][col];

            if (cell === null) {
              // 元が未配置のセルは未配置のまま維持される。
              expect(result.cells[row][col]).toBeNull();
              continue;
            }

            // 除外（null化）されるか否かは、ビーズ色空間（セルのビーズ色 vs 背景ビーズ色）の
            // ΔE 判定 isBackgroundColor と完全に一致する＝判定はビーズ色空間で一貫する。
            const judged = isBackgroundColor(cell, bgBead, threshold);
            expect(result.cells[row][col] === null).toBe(judged);

            // 背景ビーズ色と同一のビーズ色セルは、ΔE=0 なのでどの閾値(≥0)でも必ず除外される。
            if (cell.r === bgBead.r && cell.g === bgBead.g && cell.b === bgBead.b) {
              expect(result.cells[row][col]).toBeNull();
            }
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});

// =============================================================================
// タスク7.7: backgroundDetector のユニットテスト
//   - detectBackgroundColor: 四隅が異なる色のケース（最大グループ＝決定的な代表色）
//   - isBackgroundColor / applyBackgroundExclusion: 閾値0（完全一致のみ）/閾値50（広く除外）の境界
// **検証対象: Requirements 9.1, 9.3**
// =============================================================================

/**
 * ImageData の矩形領域 [x0, x0+blockW) × [y0, y0+blockH) を指定色（不透明）で塗る。
 * 四隅に異なる色のブロックを配置するためのテスト用ヘルパー。
 * @param {ImageData} imageData - 対象の画像データ
 * @param {number} imgWidth - 画像の幅（行ストライド計算に使用）
 * @param {number} x0 - 矩形左上のX座標
 * @param {number} y0 - 矩形左上のY座標
 * @param {number} blockW - 矩形の幅
 * @param {number} blockH - 矩形の高さ
 * @param {{r:number,g:number,b:number}} color - 塗る色
 */
function paintBlock(imageData, imgWidth, x0, y0, blockW, blockH, color) {
  const { data } = imageData;
  for (let y = y0; y < y0 + blockH; y += 1) {
    for (let x = x0; x < x0 + blockW; x += 1) {
      const off = (y * imgWidth + x) * 4;
      data[off] = color.r;
      data[off + 1] = color.g;
      data[off + 2] = color.b;
      data[off + 3] = 255;
    }
  }
}

describe('backgroundDetector.detectBackgroundColor ユニットテスト（タスク7.7）', () => {
  // detectBackgroundColor は四隅から内側2〜4pxの3x3を採取する。20x20 画像なら
  // 各コーナーの 8x8 ブロックでサンプリング座標（2〜4 / 15〜17）を確実に覆える。
  const W = 20;
  const H = 20;

  it('四隅が全て異なる色の場合、最大グループは同数のため決定的に左上の色を返す (Requirements 9.1)', () => {
    const topLeft = { r: 220, g: 30, b: 30 }; // 赤
    const topRight = { r: 30, g: 200, b: 30 }; // 緑
    const bottomLeft = { r: 40, g: 40, b: 210 }; // 青
    const bottomRight = { r: 230, g: 210, b: 40 }; // 黄

    const img = createImageData(W, H, { r: 0, g: 0, b: 0, a: 255 });
    paintBlock(img, W, 0, 0, 8, 8, topLeft); // 左上
    paintBlock(img, W, 12, 0, 8, 8, topRight); // 右上
    paintBlock(img, W, 0, 12, 8, 8, bottomLeft); // 左下
    paintBlock(img, W, 12, 12, 8, 8, bottomRight); // 右下

    // 4色が各9サンプルで同数 → 最初に出現する左上グループが選ばれる（決定的）。
    expect(detectBackgroundColor(img, W, H)).toEqual(topLeft);
  });

  it('四隅のうち3隅が同色なら、最大グループ（多数派）の色を背景色として返す (Requirements 9.1)', () => {
    const majority = { r: 240, g: 240, b: 240 }; // 3隅（左上・右上・左下）
    const minority = { r: 20, g: 20, b: 20 }; // 1隅（右下）

    const img = createImageData(W, H, { r: 0, g: 0, b: 0, a: 255 });
    paintBlock(img, W, 0, 0, 8, 8, majority); // 左上
    paintBlock(img, W, 12, 0, 8, 8, majority); // 右上
    paintBlock(img, W, 0, 12, 8, 8, majority); // 左下
    paintBlock(img, W, 12, 12, 8, 8, minority); // 右下

    // 多数派 27 サンプル vs 少数派 9 サンプル → 多数派の代表色を返す。
    expect(detectBackgroundColor(img, W, H)).toEqual(majority);
  });

  it('不正な入力（データなし・寸法0以下）の場合は null を返す', () => {
    expect(detectBackgroundColor(null, W, H)).toBeNull();
    const img = createImageData(W, H, { r: 1, g: 2, b: 3, a: 255 });
    expect(detectBackgroundColor(img, 0, H)).toBeNull();
    expect(detectBackgroundColor(img, W, 0)).toBeNull();
  });
});

describe('backgroundDetector.isBackgroundColor 閾値境界のユニットテスト（タスク7.7）', () => {
  it('閾値0: 完全一致する色のみ背景色と判定する（true） (Requirements 9.3)', () => {
    expect(isBackgroundColor({ r: 100, g: 100, b: 100 }, { r: 100, g: 100, b: 100 }, 0)).toBe(true);
  });

  it('閾値0: わずかでも異なる色は背景色と判定しない（false / ΔE>0）', () => {
    expect(isBackgroundColor({ r: 101, g: 100, b: 100 }, { r: 100, g: 100, b: 100 }, 0)).toBe(false);
  });

  it('白と黒は最も遠い色（ΔE≈100）→ 十分大きい閾値(101)では背景色と判定する（境界は「以下」で含む）', () => {
    // 白 Lab≈{L:100,a:0,b:0}, 黒 Lab={L:0,a:0,b:0} → ΔE≈100。閾値101なら ΔE<=101 で true。
    expect(isBackgroundColor({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }, 101)).toBe(true);
  });

  it('閾値50（広め）でも、遠い色（白と黒, ΔE≈100）は背景色と判定しない（false）', () => {
    expect(isBackgroundColor({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }, 50)).toBe(false);
  });

  it('閾値50（広め）では、黒に近い暗いグレー(20,20,20)を背景色と判定する（true）', () => {
    // ΔE(黒, (20,20,20)) はおよそ6で、0<ΔE<50 の範囲に収まる。
    expect(isBackgroundColor({ r: 20, g: 20, b: 20 }, { r: 0, g: 0, b: 0 }, 50)).toBe(true);
  });

  it('閾値0では、黒に近い暗いグレー(20,20,20)は完全一致ではないため背景色と判定しない（false）', () => {
    expect(isBackgroundColor({ r: 20, g: 20, b: 20 }, { r: 0, g: 0, b: 0 }, 0)).toBe(false);
  });
});

describe('backgroundDetector.applyBackgroundExclusion 閾値境界のユニットテスト（タスク7.7）', () => {
  // 背景ビーズ色＝黒。セルは「完全一致(黒)」「近い暗グレー」「遠い白」「未配置」を用意する。
  const background = { r: 0, g: 0, b: 0 };
  const exact = { id: 'K', name: 'くろ', r: 0, g: 0, b: 0 }; // 背景と完全一致（ΔE=0）
  const near = { id: 'D', name: 'こげ', r: 20, g: 20, b: 20 }; // 背景に近い（ΔE≈6）
  const far = { id: 'W', name: 'しろ', r: 255, g: 255, b: 255 }; // 背景から遠い（ΔE=100）

  /** テスト用に毎回新しいグリッドを生成する（破壊的変更の影響を避ける）。 */
  function makeGrid() {
    return {
      width: 2,
      height: 2,
      cells: [
        [exact, near],
        [far, null],
      ],
    };
  }

  it('閾値0: 背景色と完全一致するセルのみ未配置にする（近い色・遠い色は保持） (Requirements 9.3)', () => {
    const result = applyBackgroundExclusion(makeGrid(), background, 0);

    expect(result.cells[0][0]).toBeNull(); // 完全一致(黒) → 除外
    expect(result.cells[0][1]).toBe(near); // 近い暗グレー(ΔE≈6) → 保持
    expect(result.cells[1][0]).toBe(far); // 遠い白(ΔE=100) → 保持
    expect(result.cells[1][1]).toBeNull(); // 元々未配置 → そのまま
  });

  it('閾値50: 近い色まで広く未配置にするが、遠い色（白）は保持する (Requirements 9.3)', () => {
    const result = applyBackgroundExclusion(makeGrid(), background, 50);

    expect(result.cells[0][0]).toBeNull(); // 完全一致(黒) → 除外
    expect(result.cells[0][1]).toBeNull(); // 近い暗グレー(ΔE≈6 ≤ 50) → 除外
    expect(result.cells[1][0]).toBe(far); // 遠い白(ΔE=100 > 50) → 保持
    expect(result.cells[1][1]).toBeNull(); // 元々未配置 → そのまま
  });

  it('元グリッド（cells）を破壊せず、originalCells に除外前スナップショットを保持する', () => {
    const grid = makeGrid();
    const result = applyBackgroundExclusion(grid, background, 50);

    // 入力 cells は不変。
    expect(grid.cells[0][0]).toBe(exact);
    expect(grid.cells[0][1]).toBe(near);
    // 除外前スナップショットは元の全セルを保持（可逆性の基盤）。
    expect(result.originalCells[0][0]).toBe(exact);
    expect(result.originalCells[0][1]).toBe(near);
    expect(result.originalCells[1][0]).toBe(far);
    expect(result.originalCells[1][1]).toBeNull();
  });
});
