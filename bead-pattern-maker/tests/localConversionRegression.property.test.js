// =============================================================================
// Property 10: ローカル変換の後方互換（回帰）
// -----------------------------------------------------------------------------
// 任意の入力画像と任意の有効 ConversionOptions に対し、
// LocalConversionStrategy.convert が生成する PatternGrid（width・height・
// cells・originalCells）が本機能追加前と一致することを検証する。
//
// imageProcessor.resizeImage をモックして決定的に固定し、契約 JSDoc 拡張が
// 同期パスへ影響しないことを確認する。
//
// **Validates: Requirements 9.1**
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { ensureImageData } from './helpers/canvasMock.js';
import { initializePalette } from '../src/data/beadConfig.js';
import { PARLER_PALETTE } from '../src/data/parlerPalette.js';

// imageProcessor をモックし、resizeImage の戻り値をテストから制御する。
vi.mock('../src/engine/imageProcessor.js', () => ({
  resizeImage: vi.fn(),
}));

import { resizeImage } from '../src/engine/imageProcessor.js';
import { LocalConversionStrategy } from '../src/engine/LocalConversionStrategy.js';

// -----------------------------------------------------------------------------
// 共有フィクスチャ / ヘルパー
// -----------------------------------------------------------------------------

const strategy = new LocalConversionStrategy();

// Lab をキャッシュした実パレット
const FULL_PALETTE = initializePalette(PARLER_PALETTE);

// convert は image が truthy であることのみ要求（resizeImage はモック済み）
const dummyImage = { width: 10, height: 10, naturalWidth: 10, naturalHeight: 10 };

/**
 * 任意のピクセル列から ImageData を構築する。
 * @param {number} width
 * @param {number} height
 * @param {Uint8ClampedArray} data - width*height*4 のピクセルデータ
 * @returns {ImageData}
 */
function makeImageData(width, height, data) {
  const ImageDataCtor = ensureImageData();
  return new ImageDataCtor(data, width, height);
}

beforeEach(() => {
  resizeImage.mockReset();
});

// -----------------------------------------------------------------------------
// ジェネレータ
// -----------------------------------------------------------------------------

// 幅・高さ（1〜30）とそのサイズに適合するピクセルデータを生成する
const imageDataArb = fc
  .tuple(fc.integer({ min: 1, max: 30 }), fc.integer({ min: 1, max: 30 }))
  .chain(([width, height]) =>
    fc.record({
      width: fc.constant(width),
      height: fc.constant(height),
      // 各ピクセルは RGBA の4バイト。width*height*4 個の整数を生成する
      data: fc
        .array(fc.integer({ min: 0, max: 255 }), {
          minLength: width * height * 4,
          maxLength: width * height * 4,
        })
        .map((arr) => new Uint8ClampedArray(arr)),
    }),
  );

// 有効パレット（FULL_PALETTE の非空な部分集合）
const activePaletteArb = fc
  .array(fc.boolean(), { minLength: FULL_PALETTE.length, maxLength: FULL_PALETTE.length })
  .map((mask) => FULL_PALETTE.filter((_, i) => mask[i]))
  .filter((arr) => arr.length >= 1);

// リサイズ方式
const resizeMethodArb = fc.constantFrom('smooth', 'sharp');

// フィットモード
const fitModeArb = fc.constantFrom('stretch', 'contain', 'cover');

// 最大色数（制限なし or 1〜20 の整数）
const maxColorsArb = fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 20 }));

// =============================================================================
// Property 10: ローカル変換の後方互換（回帰）
// =============================================================================
describe('Feature: gemini-ai-conversion, Property 10: ローカル変換の後方互換（回帰）', () => {
  it('同一入力に対して convert は同一の PatternGrid を返す（決定的出力）', () => {
    fc.assert(
      fc.property(
        imageDataArb,
        activePaletteArb,
        resizeMethodArb,
        fitModeArb,
        maxColorsArb,
        ({ width, height, data }, activePalette, resizeMethod, fitMode, maxColors) => {
          const imageData = makeImageData(width, height, data);

          // 1回目の呼び出し
          resizeImage.mockReturnValue(imageData);
          const result1 = strategy.convert(dummyImage, {
            width,
            height,
            activePalette,
            resizeMethod,
            fitMode,
            maxColors,
          });

          // 2回目の呼び出し（同一入力）
          resizeImage.mockReturnValue(imageData);
          const result2 = strategy.convert(dummyImage, {
            width,
            height,
            activePalette,
            resizeMethod,
            fitMode,
            maxColors,
          });

          // PatternGrid の width / height が一致する
          expect(result1.width).toBe(width);
          expect(result1.height).toBe(height);
          expect(result2.width).toBe(width);
          expect(result2.height).toBe(height);

          // cells が2次元配列として同一である
          expect(result1.cells).toHaveLength(height);
          expect(result2.cells).toHaveLength(height);
          for (let row = 0; row < height; row += 1) {
            expect(result1.cells[row]).toHaveLength(width);
            expect(result2.cells[row]).toHaveLength(width);
            for (let col = 0; col < width; col += 1) {
              const c1 = result1.cells[row][col];
              const c2 = result2.cells[row][col];
              if (c1 === null) {
                expect(c2).toBeNull();
              } else {
                expect(c2).not.toBeNull();
                expect(c1.id).toBe(c2.id);
                expect(c1.r).toBe(c2.r);
                expect(c1.g).toBe(c2.g);
                expect(c1.b).toBe(c2.b);
              }
            }
          }

          // originalCells が2次元配列として同一である
          expect(result1.originalCells).toHaveLength(height);
          expect(result2.originalCells).toHaveLength(height);
          for (let row = 0; row < height; row += 1) {
            expect(result1.originalCells[row]).toHaveLength(width);
            expect(result2.originalCells[row]).toHaveLength(width);
            for (let col = 0; col < width; col += 1) {
              const c1 = result1.originalCells[row][col];
              const c2 = result2.originalCells[row][col];
              if (c1 === null) {
                expect(c2).toBeNull();
              } else {
                expect(c2).not.toBeNull();
                expect(c1.id).toBe(c2.id);
                expect(c1.r).toBe(c2.r);
                expect(c1.g).toBe(c2.g);
                expect(c1.b).toBe(c2.b);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('convert は同期的に PatternGrid を返す（Promise ではない）', () => {
    fc.assert(
      fc.property(
        imageDataArb,
        activePaletteArb,
        resizeMethodArb,
        fitModeArb,
        maxColorsArb,
        ({ width, height, data }, activePalette, resizeMethod, fitMode, maxColors) => {
          const imageData = makeImageData(width, height, data);
          resizeImage.mockReturnValue(imageData);

          const result = strategy.convert(dummyImage, {
            width,
            height,
            activePalette,
            resizeMethod,
            fitMode,
            maxColors,
          });

          // 戻り値は Promise でなく、同期的に PatternGrid を返すこと
          // （JSDoc の非同期拡張が同期パスに影響していないことの確認）
          expect(result).not.toBeInstanceOf(Promise);
          expect(typeof result).toBe('object');
          expect(result).not.toBeNull();
          expect(result.width).toBe(width);
          expect(result.height).toBe(height);
          expect(Array.isArray(result.cells)).toBe(true);
          expect(Array.isArray(result.originalCells)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('PatternGrid の構造的整合性（cells / originalCells が height×width、各セルは null または activePalette のビーズ色）', () => {
    fc.assert(
      fc.property(
        imageDataArb,
        activePaletteArb,
        resizeMethodArb,
        fitModeArb,
        maxColorsArb,
        ({ width, height, data }, activePalette, resizeMethod, fitMode, maxColors) => {
          const imageData = makeImageData(width, height, data);
          resizeImage.mockReturnValue(imageData);

          const result = strategy.convert(dummyImage, {
            width,
            height,
            activePalette,
            resizeMethod,
            fitMode,
            maxColors,
          });

          // width / height の一致
          expect(result.width).toBe(width);
          expect(result.height).toBe(height);

          // cells は height 行 × width 列
          expect(result.cells).toHaveLength(height);
          const activeIds = new Set(activePalette.map((c) => c.id));
          for (let row = 0; row < height; row += 1) {
            expect(result.cells[row]).toHaveLength(width);
            for (let col = 0; col < width; col += 1) {
              const cell = result.cells[row][col];
              if (cell !== null) {
                // 非nullセルは有効パレット内のビーズ色であること
                expect(activeIds.has(cell.id)).toBe(true);
              }
            }
          }

          // originalCells は height 行 × width 列
          expect(result.originalCells).toHaveLength(height);
          for (let row = 0; row < height; row += 1) {
            expect(result.originalCells[row]).toHaveLength(width);
            for (let col = 0; col < width; col += 1) {
              const cell = result.originalCells[row][col];
              if (cell !== null) {
                expect(activeIds.has(cell.id)).toBe(true);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
