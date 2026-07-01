// =============================================================================
// Property 2: 非nullセルは必ず有効パレットの最近色
// =============================================================================
// Feature: gemini-ai-conversion, Property 2: 非nullセルは必ず有効パレットの最近色
//
// 任意の AI 応答グリッドと任意の有効パレットに対し、正規化後の各非null セルが
// activePalette に含まれ、由来色に対する ΔE 最小色（同値時はパレット並び順で
// 先頭側の1色）であることを検証する。
//
// Validates: Requirements 2.3, 2.4
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { AIConversionStrategy } from '../src/engine/AIConversionStrategy.js';
import { findClosestColor } from '../src/engine/colorMatcher.js';
import { rgbToLab } from '../src/utils/colorUtils.js';
import { installCanvasMock, uninstallCanvasMock } from './helpers/canvasMock.js';

// --- ヘルパー: パレット色の Arbitrary ---

/**
 * 有効なパレット色（BeadColor）を生成する Arbitrary。
 * id は一意になるよう index ベースで生成する。
 */
function beadColorArb(index) {
  return fc.record({
    r: fc.integer({ min: 0, max: 255 }),
    g: fc.integer({ min: 0, max: 255 }),
    b: fc.integer({ min: 0, max: 255 }),
  }).map(({ r, g, b }) => {
    const lab = rgbToLab(r, g, b);
    return {
      id: `T${String(index).padStart(3, '0')}`,
      name: `color-${index}`,
      r,
      g,
      b,
      lab,
    };
  });
}

/**
 * 有効なパレット（1〜8色）を生成する Arbitrary。
 * 各色に lab 値がキャッシュされている。
 */
const paletteArb = fc.integer({ min: 1, max: 8 }).chain((size) => {
  const arbs = [];
  for (let i = 0; i < size; i++) {
    arbs.push(beadColorArb(i));
  }
  return fc.tuple(...arbs).map((colors) => colors);
});

// --- テスト本体 ---

describe('Feature: gemini-ai-conversion, Property 2: 非nullセルは必ず有効パレットの最近色', () => {
  let strategy;
  let originalFetch;

  beforeEach(() => {
    installCanvasMock();
    strategy = new AIConversionStrategy();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    uninstallCanvasMock();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('正規化後の各非null セルは activePalette に含まれ、由来色に対する ΔE 最小色である', async () => {
    // パレットサイズと寸法をまとめて生成し、グリッドも fast-check で生成する
    const testArb = paletteArb.chain((palette) => {
      const paletteSize = palette.length;
      return fc.tuple(
        fc.constant(palette),
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 10 }),
      ).chain(([pal, w, h]) => {
        // 各セルは -1（未配置）または有効 index（0..paletteSize-1）
        const cellArb = fc.integer({ min: -1, max: paletteSize - 1 });
        const rowArb = fc.array(cellArb, { minLength: w, maxLength: w });
        const gridArb = fc.array(rowArb, { minLength: h, maxLength: h });
        return fc.tuple(fc.constant(pal), fc.constant(w), fc.constant(h), gridArb);
      });
    });

    await fc.assert(
      fc.asyncProperty(testArb, async ([activePalette, width, height, grid]) => {
        const paletteSize = activePalette.length;

        // fetch をモック: 有効なグリッドを返す
        const geminiResponse = { width, height, grid };
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{ text: JSON.stringify(geminiResponse) }],
              },
            }],
          }),
        });

        // generateFromText を実行（maxColors=null で reduceColors をパススルー）
        const result = await strategy.generateFromText('ねこ', {
          width,
          height,
          activePalette,
          maxColors: null,
          apiKey: 'test-key',
          model: 'gemini-test',
          timeoutMs: 5000,
        });

        // 検証: 各非null セルが activePalette に含まれる
        const paletteIds = new Set(activePalette.map((c) => c.id));

        for (let row = 0; row < height; row++) {
          for (let col = 0; col < width; col++) {
            const cell = result.cells[row][col];
            if (cell === null) continue;

            // セルの id がパレットに含まれる
            expect(paletteIds.has(cell.id)).toBe(true);

            // 由来色（AI が指定した index に対応するパレット色の RGB）から
            // findClosestColor を適用した結果と一致するかを検証する
            const originalIndex = grid[row][col];
            if (originalIndex < 0 || originalIndex >= paletteSize) {
              // 不正 index は null になるはず（ここに到達するのは有効 index のケースのみ）
              continue;
            }
            const originalColor = activePalette[originalIndex];
            const expectedClosest = findClosestColor(
              { r: originalColor.r, g: originalColor.g, b: originalColor.b },
              activePalette,
            );
            expect(cell.id).toBe(expectedClosest.id);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('ΔE 最小が複数存在するときはパレット並び順で先頭側の1色が選ばれる', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        async (width, height, r, g, b) => {
          // 同じ RGB 色を複数持つパレットを構築（ΔE が同値になる）
          const lab = rgbToLab(r, g, b);
          const activePalette = [
            { id: 'FIRST', name: 'first', r, g, b, lab },
            { id: 'SECOND', name: 'second', r, g, b, lab },
            { id: 'THIRD', name: 'third', r, g, b, lab },
          ];

          // すべてのセルが index 1（SECOND）を指すグリッド
          const grid = Array.from({ length: height }, () =>
            Array.from({ length: width }, () => 1),
          );

          const geminiResponse = { width, height, grid };
          global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
              candidates: [{
                content: {
                  parts: [{ text: JSON.stringify(geminiResponse) }],
                },
              }],
            }),
          });

          const result = await strategy.generateFromText('ねこ', {
            width,
            height,
            activePalette,
            maxColors: null,
            apiKey: 'test-key',
            model: 'gemini-test',
            timeoutMs: 5000,
          });

          // ΔE 同値時は先頭側（FIRST）が選ばれるべき
          for (let row = 0; row < height; row++) {
            for (let col = 0; col < width; col++) {
              const cell = result.cells[row][col];
              expect(cell).not.toBeNull();
              expect(cell.id).toBe('FIRST');
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
