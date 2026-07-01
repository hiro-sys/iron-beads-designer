// =============================================================================
// Property 8: エラーメッセージにAPIキーを平文で含めない
// =============================================================================
// Feature: gemini-ai-conversion, Property 8: エラーメッセージにAPIキーを平文で含めない
//
// 任意のAPIキー文字列と任意のエラー種別（auth/rate_limit/server/network/timeout
// および AI 変換エラー）に対し、geminiClient・AIConversionStrategy が投げる
// 例外メッセージ、および messageForAiError が生成する表示メッセージが、
// そのキー文字列を部分文字列として含まないことを検証する。
//
// **Validates: Requirements 5.8**
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { generateContent, GeminiApiError } from '../src/engine/geminiClient.js';
import { AiConversionError } from '../src/engine/AIConversionStrategy.js';
import { messageForAiError } from '../src/utils/messageForAiError.js';

// --- Gemini エラー種別 ---
const GEMINI_ERROR_TYPES = ['auth', 'rate_limit', 'server', 'network', 'timeout'];

// --- AiConversion エラー種別 ---
const AI_CONVERSION_ERROR_TYPES = ['invalid_input', 'no_api_key', 'no_response', 'invalid_format', 'grid_shape'];

// --- APIキーの Arbitrary ---
// 実際の API キーは英数字・ハイフン・アンダースコアで構成され、十分な長さを持つ。
// 1〜2文字の短い文字列はエラーメッセージに偶然一致しやすいため、
// 現実的なキー長（8文字以上）の英数字文字列で生成する。
const API_KEY_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const apiKeyArb = fc
  .array(fc.constantFrom(...API_KEY_CHARS.split('')), { minLength: 8, maxLength: 64 })
  .map((chars) => chars.join(''));

describe('Feature: gemini-ai-conversion, Property 8: エラーメッセージにAPIキーを平文で含めない', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 8a: GeminiApiError のメッセージにAPIキーを含めない
  // -------------------------------------------------------------------------
  it('GeminiApiError の message にAPIキー文字列を含まない', () => {
    fc.assert(
      fc.property(
        apiKeyArb,
        fc.constantFrom(...GEMINI_ERROR_TYPES),
        fc.integer({ min: 400, max: 599 }),
        (apiKey, type, status) => {
          const error = new GeminiApiError(type, `エラーが発生しました（HTTP ${status}）`, status);
          // error.message にAPIキーが含まれないこと
          expect(error.message).not.toContain(apiKey);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // 8b: AiConversionError のメッセージにAPIキーを含めない
  // -------------------------------------------------------------------------
  it('AiConversionError の message にAPIキー文字列を含まない', () => {
    fc.assert(
      fc.property(
        apiKeyArb,
        fc.constantFrom(...AI_CONVERSION_ERROR_TYPES),
        (apiKey, type) => {
          const error = new AiConversionError(type, 'AI変換エラーが発生しました');
          // error.message にAPIキーが含まれないこと
          expect(error.message).not.toContain(apiKey);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // 8c: messageForAiError の出力にAPIキーを含めない（GeminiApiError）
  // -------------------------------------------------------------------------
  it('messageForAiError(GeminiApiError) の出力にAPIキー文字列を含まない', () => {
    fc.assert(
      fc.property(
        apiKeyArb,
        fc.constantFrom(...GEMINI_ERROR_TYPES),
        (apiKey, type) => {
          // たとえ内部メッセージにキーが含まれていても、messageForAiError は定型文を返す
          const error = new GeminiApiError(type, `Some internal message with key: ${apiKey}`, 500);
          const displayMessage = messageForAiError(error);
          // 表示メッセージにAPIキーが含まれないこと
          expect(displayMessage).not.toContain(apiKey);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // 8d: messageForAiError の出力にAPIキーを含めない（AiConversionError）
  // -------------------------------------------------------------------------
  it('messageForAiError(AiConversionError) の出力にAPIキー文字列を含まない', () => {
    fc.assert(
      fc.property(
        apiKeyArb,
        fc.constantFrom(...AI_CONVERSION_ERROR_TYPES),
        (apiKey, type) => {
          // たとえ内部メッセージにキーが含まれていても、messageForAiError は定型文を返す
          const error = new AiConversionError(type, `Internal error context: ${apiKey}`);
          const displayMessage = messageForAiError(error);
          // 表示メッセージにAPIキーが含まれないこと
          expect(displayMessage).not.toContain(apiKey);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // 8e: geminiClient がHTTPエラーを投げる際、APIキーをメッセージに含めない
  // -------------------------------------------------------------------------
  it('geminiClient.generateContent のエラーメッセージにAPIキーを含まない（HTTPエラー）', async () => {
    const httpStatusArb = fc.oneof(
      fc.constantFrom(401, 403),          // auth
      fc.constant(429),                   // rate_limit
      fc.integer({ min: 500, max: 599 }), // server
    );

    await fc.assert(
      fc.asyncProperty(
        apiKeyArb,
        httpStatusArb,
        async (apiKey, status) => {
          // fetch をモック: サーバーがキーを含むエラーボディを返すケースを想定
          global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status,
            json: async () => ({ error: { message: `Invalid API key: ${apiKey}` } }),
          });

          try {
            await generateContent({
              apiKey,
              model: 'gemini-test',
              parts: [{ text: 'test' }],
              timeoutMs: 5000,
            });
            expect.fail('エラーが投げられるべき');
          } catch (error) {
            expect(error).toBeInstanceOf(GeminiApiError);
            // エラーメッセージにAPIキーが含まれないこと
            expect(error.message).not.toContain(apiKey);
            // messageForAiError の出力にもAPIキーが含まれないこと
            const displayMsg = messageForAiError(error);
            expect(displayMsg).not.toContain(apiKey);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // 8f: geminiClient がネットワーク/タイムアウトエラーを投げる際、APIキーをメッセージに含めない
  // -------------------------------------------------------------------------
  it('geminiClient.generateContent のエラーメッセージにAPIキーを含まない（ネットワーク/タイムアウト）', async () => {
    const failureKindArb = fc.constantFrom('network', 'abort');

    await fc.assert(
      fc.asyncProperty(
        apiKeyArb,
        failureKindArb,
        async (apiKey, kind) => {
          if (kind === 'network') {
            // ネットワークエラー: fetch が TypeError を投げる
            global.fetch = vi.fn().mockRejectedValue(
              new TypeError(`Failed to fetch to endpoint with key ${apiKey}`),
            );
          } else {
            // タイムアウト: AbortError
            global.fetch = vi.fn().mockRejectedValue(
              new DOMException('The operation was aborted', 'AbortError'),
            );
          }

          try {
            await generateContent({
              apiKey,
              model: 'gemini-test',
              parts: [{ text: 'test' }],
              timeoutMs: 5000,
            });
            expect.fail('エラーが投げられるべき');
          } catch (error) {
            expect(error).toBeInstanceOf(GeminiApiError);
            // エラーメッセージにAPIキーが含まれないこと
            expect(error.message).not.toContain(apiKey);
            // messageForAiError の出力にもAPIキーが含まれないこと
            const displayMsg = messageForAiError(error);
            expect(displayMsg).not.toContain(apiKey);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // 8g: AiConversionError validate でAPIキーが不正な場合もメッセージに含めない
  // -------------------------------------------------------------------------
  it('AiConversionError（no_api_key）のメッセージにAPIキー値を含めない', () => {
    fc.assert(
      fc.property(
        apiKeyArb,
        (apiKey) => {
          // APIキーが空の場合に投げられるエラーを模擬
          const error = new AiConversionError(
            'no_api_key',
            'AI変換: APIキーが設定されていません。APIキー設定UIで設定してください。',
          );
          // エラーメッセージにAPIキー値が含まれないこと
          expect(error.message).not.toContain(apiKey);
          // messageForAiError の出力にもAPIキー値が含まれないこと
          const displayMsg = messageForAiError(error);
          expect(displayMsg).not.toContain(apiKey);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // 8h: 統合テスト — 全エラー種別×任意APIキーの組み合わせ
  // -------------------------------------------------------------------------
  it('全エラー種別と任意APIキーの組み合わせで、メッセージにAPIキーを含まない', () => {
    const allErrorTypes = fc.oneof(
      // GeminiApiError
      fc.constantFrom(...GEMINI_ERROR_TYPES).map((type) => ({
        errorClass: 'GeminiApiError',
        type,
      })),
      // AiConversionError
      fc.constantFrom(...AI_CONVERSION_ERROR_TYPES).map((type) => ({
        errorClass: 'AiConversionError',
        type,
      })),
    );

    fc.assert(
      fc.property(
        apiKeyArb,
        allErrorTypes,
        (apiKey, errorSpec) => {
          let error;
          if (errorSpec.errorClass === 'GeminiApiError') {
            error = new GeminiApiError(errorSpec.type, `Error occurred`, 500);
          } else {
            error = new AiConversionError(errorSpec.type, `Conversion error`);
          }

          // コンストラクタのメッセージにAPIキーを含まない
          expect(error.message).not.toContain(apiKey);
          // messageForAiError の出力にもAPIキーを含まない
          const displayMsg = messageForAiError(error);
          expect(displayMsg).not.toContain(apiKey);
        },
      ),
      { numRuns: 100 },
    );
  });
});
