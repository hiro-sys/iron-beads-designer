// =============================================================================
// Property 5: 不正入力・不正応答は例外を投げる
// =============================================================================
// Feature: gemini-ai-conversion, Property 5: 不正入力・不正応答は例外を投げる
//
// 不正入力（お題が空、`width`/`height` が非正、`activePalette` 空、`apiKey` 空）、
// または不正応答（`grid` 欠落・非配列・空配列、空応答）に対し、`generateFromText` が
// `PatternGrid` を返さず `AiConversionError` を投げることを検証する。
//
// 注: グリッドの行数・列数の不一致はもはやエラーではない（期待サイズへ整形される）。
//     寸法不一致の整形は AIConversionStrategy.test.js で検証する。
//
// Validates: Requirements 2.7
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { AIConversionStrategy, AiConversionError } from '../src/engine/AIConversionStrategy.js';

// --- テスト用定数 ---

/** 有効なパレット色（最低1色） */
const VALID_PALETTE = [
  { id: 'P01', name: 'しろ', r: 255, g: 255, b: 255, lab: { L: 100, a: 0, b: 0 } },
  { id: 'P02', name: 'くろ', r: 0, g: 0, b: 0, lab: { L: 0, a: 0, b: 0 } },
  { id: 'P03', name: 'あか', r: 255, g: 0, b: 0, lab: { L: 53.23, a: 80.11, b: 67.22 } },
];

/** 有効なお題 */
const VALID_SUBJECT = 'ねこ';

/** 有効なベースオプション（画像は不要） */
function validOptions(overrides = {}) {
  return {
    width: 10,
    height: 10,
    activePalette: VALID_PALETTE,
    apiKey: 'valid-test-api-key-12345',
    beadType: 'perler',
    plateConfig: { cols: 1, rows: 1 },
    maxColors: null,
    ...overrides,
  };
}

// --- ヘルパー: fetch モック生成 ---

/**
 * 指定したデータで正常応答する fetch モックを返す。
 * @param {*} responseData - JSON レスポンスとして返すデータ
 */
function mockFetchWithResponse(responseData) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{
        content: {
          parts: [{ text: JSON.stringify(responseData) }],
        },
      }],
    }),
  });
}

/**
 * null を返すレスポンスの fetch モックを生成する（応答なし・パース不可）。
 */
function mockFetchWithNullResponse() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{
        content: {
          parts: [{ text: 'null' }],
        },
      }],
    }),
  });
}

/**
 * grid フィールドなしのレスポンスの fetch モック。
 */
function mockFetchNoGrid() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{
        content: {
          parts: [{ text: JSON.stringify({ width: 10, height: 10 }) }],
        },
      }],
    }),
  });
}

// =============================================================================
// テスト本体
// =============================================================================

describe('Feature: gemini-ai-conversion, Property 5: 不正入力・不正応答は例外を投げる', () => {
  let strategy;
  let originalFetch;

  beforeEach(() => {
    strategy = new AIConversionStrategy();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Category 1: 不正入力（同期的に検証、API呼び出し前に例外）
  // =========================================================================

  describe('不正入力は AiConversionError を投げる', () => {
    it('お題が空・空白のみ・非文字列のとき AiConversionError(invalid_input) を投げる', async () => {
      const whitespaceArb = fc.array(
        fc.constantFrom(' ', '\t', '\n', '\r'),
        { minLength: 1, maxLength: 20 },
      ).map((chars) => chars.join(''));
      const invalidSubjectArb = fc.oneof(
        fc.constant(''),
        whitespaceArb,
        fc.constant(null),
        fc.constant(undefined),
        fc.constant(123),
      );

      await fc.assert(
        fc.asyncProperty(invalidSubjectArb, async (invalidSubject) => {
          global.fetch = vi.fn();

          try {
            await strategy.generateFromText(invalidSubject, validOptions());
            expect.fail('Expected AiConversionError to be thrown');
          } catch (error) {
            expect(error).toBeInstanceOf(AiConversionError);
            expect(error.type).toBe('invalid_input');
          }

          // API は呼ばれていない
          expect(global.fetch).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });

    it('width が非正整数のとき AiConversionError(invalid_input) を投げる', async () => {
      const invalidWidthArb = fc.oneof(
        fc.constant(0),
        fc.integer({ min: -1000, max: -1 }),
        fc.double({ min: 0.1, max: 100, noNaN: true }).filter((v) => !Number.isInteger(v)),
        fc.constant(NaN),
        fc.constant(Infinity),
        fc.constant(-Infinity),
      );

      await fc.assert(
        fc.asyncProperty(invalidWidthArb, async (invalidWidth) => {
          global.fetch = vi.fn();

          try {
            await strategy.generateFromText(VALID_SUBJECT, validOptions({ width: invalidWidth }));
            expect.fail('Expected AiConversionError to be thrown');
          } catch (error) {
            expect(error).toBeInstanceOf(AiConversionError);
            expect(error.type).toBe('invalid_input');
          }

          expect(global.fetch).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });

    it('height が非正整数のとき AiConversionError(invalid_input) を投げる', async () => {
      const invalidHeightArb = fc.oneof(
        fc.constant(0),
        fc.integer({ min: -1000, max: -1 }),
        fc.double({ min: 0.1, max: 100, noNaN: true }).filter((v) => !Number.isInteger(v)),
        fc.constant(NaN),
        fc.constant(Infinity),
        fc.constant(-Infinity),
      );

      await fc.assert(
        fc.asyncProperty(invalidHeightArb, async (invalidHeight) => {
          global.fetch = vi.fn();

          try {
            await strategy.generateFromText(VALID_SUBJECT, validOptions({ height: invalidHeight }));
            expect.fail('Expected AiConversionError to be thrown');
          } catch (error) {
            expect(error).toBeInstanceOf(AiConversionError);
            expect(error.type).toBe('invalid_input');
          }

          expect(global.fetch).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });

    it('activePalette が空配列または null のとき AiConversionError(invalid_input) を投げる', async () => {
      const invalidPaletteArb = fc.constantFrom([], null);

      await fc.assert(
        fc.asyncProperty(invalidPaletteArb, async (invalidPalette) => {
          global.fetch = vi.fn();

          try {
            await strategy.generateFromText(VALID_SUBJECT, validOptions({ activePalette: invalidPalette }));
            expect.fail('Expected AiConversionError to be thrown');
          } catch (error) {
            expect(error).toBeInstanceOf(AiConversionError);
            expect(error.type).toBe('invalid_input');
          }

          expect(global.fetch).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });

    it('apiKey が空文字・空白のみ・null のとき AiConversionError(no_api_key) を投げる', async () => {
      const whitespaceArb = fc.array(
        fc.constantFrom(' ', '\t', '\n', '\r'),
        { minLength: 1, maxLength: 20 },
      ).map((chars) => chars.join(''));
      const invalidApiKeyArb = fc.oneof(
        fc.constant(''),
        fc.constant(null),
        whitespaceArb,
      );

      await fc.assert(
        fc.asyncProperty(invalidApiKeyArb, async (invalidApiKey) => {
          global.fetch = vi.fn();

          try {
            await strategy.generateFromText(VALID_SUBJECT, validOptions({ apiKey: invalidApiKey }));
            expect.fail('Expected AiConversionError to be thrown');
          } catch (error) {
            expect(error).toBeInstanceOf(AiConversionError);
            expect(error.type).toBe('no_api_key');
          }

          expect(global.fetch).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });
  });

  // =========================================================================
  // Category 2: 不正応答（fetch をモックして不正データを返す）
  // =========================================================================

  describe('不正応答は AiConversionError を投げる', () => {
    it('応答に grid フィールドがない・非配列・空配列の場合 AiConversionError(invalid_format) を投げる', async () => {
      const noGridResponseArb = fc.oneof(
        fc.constant({ width: 10, height: 10 }),
        fc.constant({ data: [[0, 1]] }),
        fc.constant({ grid: null }),
        fc.constant({ grid: 'not-an-array' }),
        fc.constant({ grid: 42 }),
        fc.constant({ grid: [] }),
        fc.constant({}),
      );

      await fc.assert(
        fc.asyncProperty(noGridResponseArb, async (responseData) => {
          global.fetch = mockFetchWithResponse(responseData);

          try {
            await strategy.generateFromText(VALID_SUBJECT, validOptions());
            expect.fail('Expected AiConversionError to be thrown');
          } catch (error) {
            expect(error).toBeInstanceOf(AiConversionError);
            expect(error.type).toBe('invalid_format');
          }
        }),
        { numRuns: 100 },
      );
    });

    it('応答が null/undefined の場合 AiConversionError(no_response) を投げる', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(null, undefined),
          async () => {
            // geminiClient.generateContent の応答パスでは、
            // candidates[0].content.parts[0].text を JSON.parse するため、
            // "null" をテキストとして返すと null 応答相当になる
            global.fetch = mockFetchWithNullResponse();

            try {
              await strategy.generateFromText(VALID_SUBJECT, validOptions());
              expect.fail('Expected AiConversionError to be thrown');
            } catch (error) {
              expect(error).toBeInstanceOf(AiConversionError);
              expect(error.type).toBe('no_response');
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // =========================================================================
  // Category 3: 統合（不正入力と不正応答の混合テスト）
  // =========================================================================

  describe('不正入力・不正応答の混合: 全ケースで AiConversionError を投げる', () => {
    it('任意の不正入力または不正応答に対し generateFromText は PatternGrid を返さず AiConversionError を投げる', async () => {
      // 不正入力の Arbitrary
      const invalidInputArb = fc.oneof(
        // お題なし
        fc.oneof(
          fc.constant(''),
          fc.constant('   '),
          fc.constant(null),
        ).map((subject) => ({
          type: 'no_subject',
          subject,
          options: validOptions(),
        })),
        // width 不正
        fc.oneof(
          fc.constant(0),
          fc.integer({ min: -100, max: -1 }),
          fc.double({ min: 0.1, max: 50, noNaN: true }).filter((v) => !Number.isInteger(v)),
        ).map((w) => ({
          type: 'invalid_width',
          subject: VALID_SUBJECT,
          options: validOptions({ width: w }),
        })),
        // height 不正
        fc.oneof(
          fc.constant(0),
          fc.integer({ min: -100, max: -1 }),
          fc.double({ min: 0.1, max: 50, noNaN: true }).filter((v) => !Number.isInteger(v)),
        ).map((h) => ({
          type: 'invalid_height',
          subject: VALID_SUBJECT,
          options: validOptions({ height: h }),
        })),
        // activePalette 空
        fc.constantFrom([], null).map((p) => ({
          type: 'empty_palette',
          subject: VALID_SUBJECT,
          options: validOptions({ activePalette: p }),
        })),
        // apiKey 空
        fc.oneof(
          fc.constant(''),
          fc.constant(null),
          fc.constant('   '),
          fc.constant('\t\n'),
        ).map((k) => ({
          type: 'no_api_key',
          subject: VALID_SUBJECT,
          options: validOptions({ apiKey: k }),
        })),
      );

      // 不正応答の Arbitrary（有効入力 + モック不正応答）
      const invalidResponseArb = fc.oneof(
        // grid 欠落
        fc.constant({ type: 'no_grid' }),
        // grid 空配列
        fc.constant({ type: 'empty_grid' }),
        // 空応答（null）
        fc.constant({ type: 'null_response' }),
      );

      const errorCaseArb = fc.oneof(
        invalidInputArb.map((c) => ({ ...c, category: 'input' })),
        invalidResponseArb.map((c) => ({ ...c, category: 'response' })),
      );

      await fc.assert(
        fc.asyncProperty(errorCaseArb, async (testCase) => {
          if (testCase.category === 'input') {
            // 不正入力ケース: fetch は呼ばれないはず
            global.fetch = vi.fn();

            try {
              await strategy.generateFromText(testCase.subject, testCase.options);
              expect.fail('Expected AiConversionError to be thrown');
            } catch (error) {
              expect(error).toBeInstanceOf(AiConversionError);
              // 型が正しい（'invalid_input' または 'no_api_key'）
              expect(['invalid_input', 'no_api_key']).toContain(error.type);
            }
          } else {
            // 不正応答ケース: 有効入力で、不正レスポンスをモック
            if (testCase.type === 'null_response') {
              global.fetch = mockFetchWithNullResponse();
            } else if (testCase.type === 'no_grid') {
              global.fetch = mockFetchNoGrid();
            } else {
              // empty_grid
              global.fetch = mockFetchWithResponse({ width: 10, height: 10, grid: [] });
            }

            try {
              await strategy.generateFromText(VALID_SUBJECT, validOptions());
              expect.fail('Expected AiConversionError to be thrown');
            } catch (error) {
              expect(error).toBeInstanceOf(AiConversionError);
              // 応答エラーの型は 'invalid_format', 'no_response' のいずれか
              expect(['invalid_format', 'no_response']).toContain(error.type);
            }
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
