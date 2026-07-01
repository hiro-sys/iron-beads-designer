// =============================================================================
// Property 3: 相異なる色数は maxColors 以下
// =============================================================================
// Feature: gemini-ai-conversion, Property 3: 相異なる色数は maxColors 以下
//
// 任意の AI 応答グリッドと、null 以外かつ1以上の整数 maxColors に対し、
// 正規化後の cells の相異なる非null 色の種類数が maxColors 以下
// （null のときは有効パレットサイズ以下）であることを検証する。
//
// Validates: Requirements 2.5
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { AIConversionStrategy } from '../src/engine/AIConversionStrategy.js';
import { installCanvasMock, uninstallCanvasMock } from './helpers/canvasMock.js';

// --- ヘルパー ----------------------------------------------------------------

/**
 * テスト用の BeadColor を生成する。
 * @param {number} index - パレットインデックス
 * @param {number} r - 赤成分
 * @param {number} g - 緑成分
 * @param {number} b - 青成分
 * @returns {import('../src/engine/ConversionStrategy.js').BeadColor}
 */
function makeBeadColor(index, r, g, b) {
  return {
    id: `C${String(index).padStart(2, '0')}`,
    name: `color-${index}`,
    r,
    g,
    b,
  };
}

/**
 * 十分な種類の色を持つテスト用パレットを生成する。
 * @param {number} size - パレットサイズ
 * @returns {import('../src/engine/ConversionStrategy.js').BeadColor[]}
 */
function generatePalette(size) {
  const palette = [];
  for (let i = 0; i < size; i++) {
    // R/G/B を適度に散らして異なる色を保証する
    const r = Math.round((i * 37) % 256);
    const g = Math.round((i * 73 + 50) % 256);
    const b = Math.round((i * 131 + 100) % 256);
    palette.push(makeBeadColor(i, r, g, b));
  }
  return palette;
}

/**
 * cells 内の相異なる非null 色の種類数をカウントする（id ベース）。
 * @param {(import('../src/engine/ConversionStrategy.js').BeadColor|null)[][]} cells
 * @returns {number}
 */
function countDistinctColors(cells) {
  const ids = new Set();
  for (const row of cells) {
    for (const cell of row) {
      if (cell !== null && cell !== undefined) {
        ids.add(cell.id);
      }
    }
  }
  return ids.size;
}

/**
 * Gemini API のモックレスポンスを設定する。
 * @param {number[][]} grid - AIが返すグリッド（色index or -1）
 * @param {number} width
 * @param {number} height
 */
function mockFetchWithGrid(grid, width, height) {
  const responseBody = {
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
    json: async () => responseBody,
  });
}

// =============================================================================
// テスト
// =============================================================================

describe('Feature: gemini-ai-conversion, Property 3: 相異なる色数は maxColors 以下', () => {
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

  // --- Property 3a: maxColors が指定された場合、相異なる色数 <= maxColors ---
  it('maxColors が非nullの正の整数のとき、相異なる非null色の種類数は maxColors 以下', async () => {
    const strategy = new AIConversionStrategy();

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 15 }),    // width
        fc.integer({ min: 2, max: 15 }),    // height
        fc.integer({ min: 1, max: 10 }),    // maxColors
        fc.integer({ min: 10, max: 15 }),   // paletteSize（maxColors 以上を保証）
        fc.context(),
        async (width, height, maxColors, paletteSize, ctx) => {
          // パレットサイズが maxColors 以上になるよう保証
          const actualPaletteSize = Math.max(paletteSize, maxColors);
          const activePalette = generatePalette(actualPaletteSize);

          // AI応答グリッドを生成: 各セルに0からpaletteSizeまでのインデックスを散らばせる
          // 多様な色を使うグリッドを生成し、maxColors の制約テストを意味あるものにする
          const grid = [];
          for (let row = 0; row < height; row++) {
            const rowData = [];
            for (let col = 0; col < width; col++) {
              // 全有効インデックスを巡回して割り当て（色の多様性を高める）
              rowData.push((row * width + col) % actualPaletteSize);
            }
            grid.push(rowData);
          }

          mockFetchWithGrid(grid, width, height);

          const result = await strategy.generateFromText('ねこ', {
            width,
            height,
            activePalette,
            resizeMethod: 'smooth',
            fitMode: 'contain',
            maxColors,
            apiKey: 'test-key-prop3',
            model: 'gemini-test',
            timeoutMs: 5000,
          });

          const distinctCount = countDistinctColors(result.cells);
          ctx.log(`width=${width}, height=${height}, maxColors=${maxColors}, paletteSize=${actualPaletteSize}, distinctColors=${distinctCount}`);

          // 相異なる色数は maxColors 以下であること
          expect(distinctCount).toBeLessThanOrEqual(maxColors);
        },
      ),
      { numRuns: 100 },
    );
  });

  // --- Property 3b: maxColors が null のとき、相異なる色数 <= activePalette.length ---
  it('maxColors が null のとき、相異なる非null色の種類数は有効パレットサイズ以下', async () => {
    const strategy = new AIConversionStrategy();

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 15 }),    // width
        fc.integer({ min: 2, max: 15 }),    // height
        fc.integer({ min: 2, max: 12 }),    // paletteSize
        fc.context(),
        async (width, height, paletteSize, ctx) => {
          const activePalette = generatePalette(paletteSize);

          // 全有効インデックスを使用するグリッドを生成
          const grid = [];
          for (let row = 0; row < height; row++) {
            const rowData = [];
            for (let col = 0; col < width; col++) {
              rowData.push((row * width + col) % paletteSize);
            }
            grid.push(rowData);
          }

          mockFetchWithGrid(grid, width, height);

          const result = await strategy.generateFromText('ねこ', {
            width,
            height,
            activePalette,
            resizeMethod: 'smooth',
            fitMode: 'contain',
            maxColors: null,
            apiKey: 'test-key-prop3-null',
            model: 'gemini-test',
            timeoutMs: 5000,
          });

          const distinctCount = countDistinctColors(result.cells);
          ctx.log(`width=${width}, height=${height}, paletteSize=${paletteSize}, distinctColors=${distinctCount}`);

          // 相異なる色数は有効パレットサイズ以下であること
          expect(distinctCount).toBeLessThanOrEqual(paletteSize);
        },
      ),
      { numRuns: 100 },
    );
  });

  // --- Property 3c: ランダムなグリッド（-1・範囲外含む）でも maxColors 制約を満たす ---
  it('ランダムなAI応答グリッド（不正値含む）でも相異なる非null色の種類数は maxColors 以下', async () => {
    const strategy = new AIConversionStrategy();

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 10 }),    // width
        fc.integer({ min: 2, max: 10 }),    // height
        fc.integer({ min: 1, max: 8 }),     // maxColors
        fc.integer({ min: 8, max: 12 }),    // paletteSize（maxColors 以上を保証）
        fc.context(),
        async (width, height, maxColors, paletteSize, ctx) => {
          const actualPaletteSize = Math.max(paletteSize, maxColors);
          const activePalette = generatePalette(actualPaletteSize);

          // ランダムなグリッドを生成（-1、範囲外の値も含む）
          // fc を使ってランダムなセル値を生成
          const cellArb = fc.integer({ min: -5, max: actualPaletteSize + 5 });
          const rowArb = fc.array(cellArb, { minLength: width, maxLength: width });
          const gridArb = fc.array(rowArb, { minLength: height, maxLength: height });

          // gridArb から1つ値を取得
          const gridSample = fc.sample(gridArb, 1)[0];

          mockFetchWithGrid(gridSample, width, height);

          const result = await strategy.generateFromText('ねこ', {
            width,
            height,
            activePalette,
            resizeMethod: 'smooth',
            fitMode: 'contain',
            maxColors,
            apiKey: 'test-key-prop3-random',
            model: 'gemini-test',
            timeoutMs: 5000,
          });

          const distinctCount = countDistinctColors(result.cells);
          ctx.log(`width=${width}, height=${height}, maxColors=${maxColors}, distinctColors=${distinctCount}`);

          // 相異なる色数は maxColors 以下であること
          expect(distinctCount).toBeLessThanOrEqual(maxColors);
        },
      ),
      { numRuns: 100 },
    );
  });
});
