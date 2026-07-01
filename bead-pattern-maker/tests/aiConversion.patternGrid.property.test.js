// =============================================================================
// Property 1: AI変換出力は options 寸法に一致する整形済み PatternGrid
// =============================================================================
// Feature: gemini-ai-conversion, Property 1: AI変換出力は options 寸法に一致する整形済み PatternGrid
//
// 任意の有効 options と任意の AI 応答グリッドに対し、
// AIConversionStrategy.convert の戻り値が PatternGrid 形式であり、
// width === options.width、height === options.height を満たし、
// cells と originalCells がともに height 行 × width 列の2次元配列であることを検証する。
//
// Validates: Requirements 1.7, 2.1, 2.2, 2.8
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { AIConversionStrategy } from '../src/engine/AIConversionStrategy.js';
import { installCanvasMock, uninstallCanvasMock } from './helpers/canvasMock.js';

// --- ジェネレータ -----------------------------------------------------------

/**
 * 有効な BeadColor オブジェクトを生成する Arbitrary。
 */
const beadColorArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 5 }),
  name: fc.string({ minLength: 1, maxLength: 10 }),
  r: fc.integer({ min: 0, max: 255 }),
  g: fc.integer({ min: 0, max: 255 }),
  b: fc.integer({ min: 0, max: 255 }),
});

/**
 * 有効な activePalette（最低1色）を生成する Arbitrary。
 */
const activePaletteArb = fc.array(beadColorArb, { minLength: 1, maxLength: 10 });

/**
 * グリッドセル値を生成する Arbitrary。
 * 有効 index（0..paletteSize-1）、-1（未配置）、範囲外 index をランダムに混在させる。
 */
function gridCellArb(paletteSize) {
  return fc.oneof(
    // 有効 index（0..paletteSize-1）
    fc.integer({ min: 0, max: Math.max(0, paletteSize - 1) }),
    // 未配置（-1）
    fc.constant(-1),
    // 範囲外 index（パレットサイズ以上）
    fc.integer({ min: paletteSize, max: paletteSize + 50 }),
  );
}

/**
 * テスト入力全体を生成する Arbitrary。
 * width, height, activePalette, そしてその寸法に一致するグリッドをまとめて生成する。
 */
const testInputArb = fc.integer({ min: 1, max: 30 }).chain((width) =>
  fc.integer({ min: 1, max: 30 }).chain((height) =>
    activePaletteArb.chain((activePalette) => {
      const paletteSize = activePalette.length;
      // グリッド: height 行 × width 列
      const gridArb = fc.array(
        fc.array(gridCellArb(paletteSize), { minLength: width, maxLength: width }),
        { minLength: height, maxLength: height },
      );
      return gridArb.map((grid) => ({ width, height, activePalette, grid }));
    }),
  ),
);

// --- テスト本体 --------------------------------------------------------------

describe('Feature: gemini-ai-conversion, Property 1: AI変換出力は options 寸法に一致する整形済み PatternGrid', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    installCanvasMock();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    uninstallCanvasMock();
    vi.restoreAllMocks();
  });

  it('任意の有効 options と AI 応答グリッドに対し、戻り値が PatternGrid 形式で寸法が一致する', async () => {
    await fc.assert(
      fc.asyncProperty(
        testInputArb,
        async ({ width, height, activePalette, grid }) => {
          // fetch モック: Gemini API の正常レスポンスを返す
          const mockResponse = {
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({ width, height, grid }),
                }],
              },
            }],
          };

          global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => mockResponse,
          });

          // テスト用のオプション
          const options = {
            width,
            height,
            activePalette,
            resizeMethod: 'smooth',
            fitMode: 'contain',
            maxColors: null,
            apiKey: 'test-key',
            model: 'gemini-test',
            timeoutMs: 5000,
          };

          // AI生成を実行
          const strategy = new AIConversionStrategy();
          const result = await strategy.generateFromText('ねこ', options);

          // --- PatternGrid 形式の検証 ---

          // width と height が options と一致すること
          expect(result.width).toBe(width);
          expect(result.height).toBe(height);

          // cells が存在し、height 行の2次元配列であること
          expect(Array.isArray(result.cells)).toBe(true);
          expect(result.cells.length).toBe(height);

          // cells の各行が width 列であること
          for (let row = 0; row < height; row++) {
            expect(Array.isArray(result.cells[row])).toBe(true);
            expect(result.cells[row].length).toBe(width);
          }

          // originalCells が存在し、height 行の2次元配列であること
          expect(Array.isArray(result.originalCells)).toBe(true);
          expect(result.originalCells.length).toBe(height);

          // originalCells の各行が width 列であること
          for (let row = 0; row < height; row++) {
            expect(Array.isArray(result.originalCells[row])).toBe(true);
            expect(result.originalCells[row].length).toBe(width);
          }

          // beadType が存在すること
          expect(result.beadType).toBeDefined();
          expect(typeof result.beadType).toBe('string');

          // plateConfig が cols / rows を持つこと
          expect(result.plateConfig).toBeDefined();
          expect(typeof result.plateConfig.cols).toBe('number');
          expect(typeof result.plateConfig.rows).toBe('number');
        },
      ),
      { numRuns: 100 },
    );
  });
});
