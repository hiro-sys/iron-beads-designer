// =============================================================================
// Property 4: 未配置の表現（null 写像規則）
// =============================================================================
// Feature: gemini-ai-conversion, Property 4: 未配置の表現（null 写像規則）
//
// 任意の AI 応答グリッドに対し、`-1`・範囲外 index・非整数などの不正値に対応する
// セルが正規化後に `null` となり、`0..N-1` の有効 index は非null のビーズ色になる
// ことを検証する。
//
// Validates: Requirements 2.6
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { AIConversionStrategy } from '../src/engine/AIConversionStrategy.js';
import { installCanvasMock, uninstallCanvasMock } from './helpers/canvasMock.js';

// --- テスト用ヘルパー --------------------------------------------------------

/**
 * テスト用のカラーパレットの Arbitrary（最低2色、最大8色）。
 */
function paletteArbitrary() {
  return fc.array(
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 5 }),
      name: fc.string({ minLength: 1, maxLength: 10 }),
      r: fc.integer({ min: 0, max: 255 }),
      g: fc.integer({ min: 0, max: 255 }),
      b: fc.integer({ min: 0, max: 255 }),
    }),
    { minLength: 2, maxLength: 8 },
  );
}

/**
 * セル値の Arbitrary。有効 index と各種不正値を混在させる。
 * 返り値: { value: number, isValid: boolean }
 *
 * @param {number} paletteSize - 有効パレットのサイズ N
 */
function cellValueArbitrary(paletteSize) {
  return fc.oneof(
    // 有効 index: 0..N-1
    fc.integer({ min: 0, max: paletteSize - 1 }).map((v) => ({ value: v, isValid: true })),
    // 不正値: -1（未配置センチネル）
    fc.constant({ value: -1, isValid: false }),
    // 不正値: 負の数（-2以下）
    fc.integer({ min: -100, max: -2 }).map((v) => ({ value: v, isValid: false })),
    // 不正値: 範囲外（N以上の整数）
    fc.integer({ min: paletteSize, max: paletteSize + 50 }).map((v) => ({ value: v, isValid: false })),
    // 不正値: 非整数（小数）。整数部＋小数部で必ず非整数を保証
    fc.tuple(fc.integer({ min: 0, max: paletteSize + 10 }), fc.integer({ min: 1, max: 9 }))
      .map(([intPart, frac]) => ({ value: intPart + frac / 10, isValid: false })),
  );
}

/**
 * fetch モックを構築する。指定されたグリッドを Gemini API 応答として返す。
 */
function mockFetchWithGrid(grid, width, height) {
  const responseObj = { width, height, grid };
  const responseText = JSON.stringify(responseObj);
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [{ text: responseText }],
          },
        },
      ],
    }),
  });
}

// =============================================================================
// テストスイート
// =============================================================================

describe('Feature: gemini-ai-conversion, Property 4: 未配置の表現（null 写像規則）', () => {
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

  it('不正値（-1・範囲外・非整数）のセルは null に、有効 index（0..N-1）は非null のビーズ色になる', async () => {
    const strategy = new AIConversionStrategy();

    // パレットを先に生成し、そのサイズに応じたグリッドを生成する
    await fc.assert(
      fc.asyncProperty(
        paletteArbitrary().chain((palette) => {
          const paletteSize = palette.length;
          const width = fc.integer({ min: 2, max: 10 });
          const height = fc.integer({ min: 2, max: 10 });

          return fc.tuple(fc.constant(palette), width, height).chain(([pal, w, h]) => {
            // w列 × h行 のグリッドを生成（各セルにメタ情報付き）
            const gridArb = fc.array(
              fc.array(cellValueArbitrary(paletteSize), { minLength: w, maxLength: w }),
              { minLength: h, maxLength: h },
            );
            return fc.tuple(fc.constant(pal), fc.constant(w), fc.constant(h), gridArb);
          });
        }),
        async ([palette, width, height, cellMeta]) => {
          const paletteSize = palette.length;

          // グリッドの数値のみを抽出（Gemini 応答に送る生の値）
          const rawGrid = cellMeta.map((row) => row.map((cell) => cell.value));

          // fetch をモック
          mockFetchWithGrid(rawGrid, width, height);

          // generateFromText 実行
          const options = {
            width,
            height,
            activePalette: palette,
            maxColors: null,
            apiKey: 'test-key-property4',
            model: 'gemini-test',
            timeoutMs: 5000,
          };

          const result = await strategy.generateFromText('ねこ', options);

          // 各セルの写像規則を検証
          for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
              const meta = cellMeta[r][c];
              const resultCell = result.cells[r][c];

              if (meta.isValid) {
                // 有効 index（0..N-1）→ 非null のビーズ色
                expect(resultCell).not.toBeNull();
                expect(resultCell).toHaveProperty('r');
                expect(resultCell).toHaveProperty('g');
                expect(resultCell).toHaveProperty('b');
                // RGB 値が有効な範囲であること
                expect(resultCell.r).toBeGreaterThanOrEqual(0);
                expect(resultCell.r).toBeLessThanOrEqual(255);
                expect(resultCell.g).toBeGreaterThanOrEqual(0);
                expect(resultCell.g).toBeLessThanOrEqual(255);
                expect(resultCell.b).toBeGreaterThanOrEqual(0);
                expect(resultCell.b).toBeLessThanOrEqual(255);
              } else {
                // 不正値（-1・範囲外・非整数）→ null（未配置）
                expect(resultCell).toBeNull();
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
