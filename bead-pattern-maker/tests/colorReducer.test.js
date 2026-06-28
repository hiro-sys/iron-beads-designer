import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { reduceColors } from '../src/engine/colorReducer.js';

// =============================================================================
// 減色モジュール（colorReducer.js）のテスト
// -----------------------------------------------------------------------------
// 対象: src/engine/colorReducer.js の reduceColors(pixels, maxColors)
//
// 本ファイルは以下の2タスク分のテストをまとめて収める。
//   - タスク6.2: 減色の上限保証のプロパティテスト（Property 20）
//   - タスク6.3: colorReducer のユニットテスト（単色画像 / maxColors=1 / パススルー）
//
// 検証対象: Requirements 11.4
// =============================================================================

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
 * ピクセル集合のジェネレーター。
 * 空配列〜多数のピクセルまで広く生成し、相異なる色数が maxColors を
 * 上回るケース（=減色が実際に発生するケース）も自然に含まれるようにする。
 * @type {fc.Arbitrary<{ r: number, g: number, b: number }[]>}
 */
const pixelsArb = fc.array(rgbColorArb, { minLength: 0, maxLength: 200 });

/**
 * 最大色数（正の整数）のジェネレーター。
 * Property 20 は「正の整数 N」に対する上限保証なので 1 以上を生成する。
 * @type {fc.Arbitrary<number>}
 */
const maxColorsArb = fc.integer({ min: 1, max: 32 });

// =============================================================================
// タスク6.2: 減色の上限保証のプロパティテスト
// =============================================================================
describe('colorReducer プロパティテスト（タスク6.2）', () => {
  // Property 20: 任意のピクセル集合と最大色数N（正の整数）に対して、
  // reduceColors が返す representativeColors の数は必ず N 以下である。
  // **Validates: Requirements 11.4**
  it('Feature: bead-pattern-maker, Property 20: 減色の上限保証（代表色の数 ≤ maxColors）', () => {
    fc.assert(
      fc.property(pixelsArb, maxColorsArb, (pixels, maxColors) => {
        const { representativeColors } = reduceColors(pixels, maxColors);
        // 代表色の数は指定した最大色数を超えてはならない。
        expect(representativeColors.length).toBeLessThanOrEqual(maxColors);
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// タスク6.3: colorReducer のユニットテスト
// =============================================================================
describe('colorReducer ユニットテスト（タスク6.3）', () => {
  // --- 単色画像 -------------------------------------------------------------
  describe('単色画像（全ピクセルが同色）', () => {
    it('全ピクセルが同色なら代表色は1個になる', () => {
      // 全て同じ色のピクセル集合（10個）
      const pixels = Array.from({ length: 10 }, () => ({ r: 100, g: 150, b: 200 }));

      const { representativeColors } = reduceColors(pixels, 8);

      // 相異なる色が1種類しかないため、median cut は分割できず代表色は1個。
      expect(representativeColors).toHaveLength(1);
      expect(representativeColors[0]).toEqual({ r: 100, g: 150, b: 200 });
    });

    it('mapping は同色ピクセルを唯一の代表色へ写像する', () => {
      const pixels = Array.from({ length: 5 }, () => ({ r: 42, g: 42, b: 42 }));

      const { mapping } = reduceColors(pixels, 8);

      // 唯一の代表色 {42,42,42} に写像される。
      expect(mapping({ r: 42, g: 42, b: 42 })).toEqual({ r: 42, g: 42, b: 42 });
    });
  });

  // --- maxColors = 1 --------------------------------------------------------
  describe('maxColors = 1', () => {
    it('複数色を含んでも代表色は1個に制限される', () => {
      const pixels = [
        { r: 0, g: 0, b: 0 },
        { r: 255, g: 255, b: 255 },
        { r: 128, g: 64, b: 32 },
      ];

      const { representativeColors } = reduceColors(pixels, 1);

      // maxColors=1 のため分割は一切行われず、全色を含む1ボックスの平均色1個。
      expect(representativeColors).toHaveLength(1);
    });

    it('全ピクセルが唯一の代表色へ写像される', () => {
      const pixels = [
        { r: 10, g: 20, b: 30 },
        { r: 200, g: 210, b: 220 },
      ];

      const { representativeColors, mapping } = reduceColors(pixels, 1);

      const only = representativeColors[0];
      // どの入力色を写像しても、唯一の代表色に揃う。
      expect(mapping({ r: 10, g: 20, b: 30 })).toEqual(only);
      expect(mapping({ r: 200, g: 210, b: 220 })).toEqual(only);
    });
  });

  // --- パススルー（減色しない） ---------------------------------------------
  describe('パススルー（maxColors が null / "unlimited"）', () => {
    it('maxColors=null のとき減色せず、相異なる入力色をそのまま代表色とする', () => {
      const pixels = [
        { r: 10, g: 20, b: 30 },
        { r: 10, g: 20, b: 30 }, // 重複
        { r: 40, g: 50, b: 60 },
      ];

      const { representativeColors } = reduceColors(pixels, null);

      // 重複を除いた相異なる色（出現順）がそのまま代表色になる。
      expect(representativeColors).toEqual([
        { r: 10, g: 20, b: 30 },
        { r: 40, g: 50, b: 60 },
      ]);
    });

    it('maxColors=null のとき mapping は恒等写像（入力色をそのまま返す）', () => {
      const pixels = [{ r: 10, g: 20, b: 30 }];

      const { mapping } = reduceColors(pixels, null);

      // パススルー時は入力色がそのまま通る（代表色へ寄せない）。
      expect(mapping({ r: 10, g: 20, b: 30 })).toEqual({ r: 10, g: 20, b: 30 });
      expect(mapping({ r: 99, g: 88, b: 77 })).toEqual({ r: 99, g: 88, b: 77 });
    });

    it('maxColors="unlimited" でも null と同様にパススルーする', () => {
      const pixels = [
        { r: 1, g: 2, b: 3 },
        { r: 4, g: 5, b: 6 },
      ];

      const { representativeColors, mapping } = reduceColors(pixels, 'unlimited');

      expect(representativeColors).toEqual([
        { r: 1, g: 2, b: 3 },
        { r: 4, g: 5, b: 6 },
      ]);
      expect(mapping({ r: 4, g: 5, b: 6 })).toEqual({ r: 4, g: 5, b: 6 });
    });
  });
});
