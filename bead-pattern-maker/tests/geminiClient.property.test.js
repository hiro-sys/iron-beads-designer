// =============================================================================
// Property 9: Gemini エラーの決定的分類
// =============================================================================
// Feature: gemini-ai-conversion, Property 9: Gemini エラーの決定的分類
//
// 任意の HTTP ステータスコードまたは失敗種別に対して、
// geminiClient.generateContent が投げる GeminiApiError.type が
// 次の決定的写像に従うことを検証する:
//   400     → invalid_request
//   401/403 → auth
//   429     → rate_limit
//   5xx     → server
//   fetch 失敗（TypeError）→ network
//   AbortError → timeout
//
// Validates: Requirements 7.1, 7.2, 8.5
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { generateContent, GeminiApiError } from '../src/engine/geminiClient.js';

// --- テスト用のデフォルトパラメータ ---
const defaultParams = {
  apiKey: 'test-key-for-property-test',
  model: 'gemini-test',
  parts: [{ text: 'test' }],
  timeoutMs: 5000, // テスト高速化のため短めに設定
};

describe('Feature: gemini-ai-conversion, Property 9: Gemini エラーの決定的分類', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // --- Property 9a: 401/403 → type === 'auth' ---
  it('HTTP 401 または 403 は type="auth" に分類される', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(401, 403),
        async (status) => {
          // fetch をモック: 非 OK レスポンスを返す
          global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status,
            json: async () => ({ error: { message: 'Unauthorized' } }),
          });

          try {
            await generateContent(defaultParams);
            // ここに到達してはいけない
            return false;
          } catch (error) {
            expect(error).toBeInstanceOf(GeminiApiError);
            expect(error.type).toBe('auth');
            expect(error.status).toBe(status);
            return true;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // --- Property 9b: 429 → type === 'rate_limit' ---
  it('HTTP 429 は type="rate_limit" に分類される', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant(429),
        async (status) => {
          global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status,
            json: async () => ({ error: { message: 'Rate limited' } }),
          });

          try {
            await generateContent(defaultParams);
            return false;
          } catch (error) {
            expect(error).toBeInstanceOf(GeminiApiError);
            expect(error.type).toBe('rate_limit');
            expect(error.status).toBe(status);
            return true;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // --- Property 9c: 5xx → type === 'server' ---
  it('HTTP 500-599 は type="server" に分類される', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 500, max: 599 }),
        async (status) => {
          global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status,
            json: async () => ({ error: { message: 'Server error' } }),
          });

          try {
            await generateContent(defaultParams);
            return false;
          } catch (error) {
            expect(error).toBeInstanceOf(GeminiApiError);
            expect(error.type).toBe('server');
            expect(error.status).toBe(status);
            return true;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // --- Property 9d: fetch 失敗（TypeError）→ type === 'network' ---
  it('fetch が TypeError を投げた場合は type="network" に分類される', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        async (errorMessage) => {
          // ネットワークエラー: fetch が TypeError を投げる
          const networkError = new TypeError(errorMessage);
          global.fetch = vi.fn().mockRejectedValue(networkError);

          try {
            await generateContent(defaultParams);
            return false;
          } catch (error) {
            expect(error).toBeInstanceOf(GeminiApiError);
            expect(error.type).toBe('network');
            return true;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // --- Property 9e: AbortError → type === 'timeout' ---
  it('fetch が AbortError を投げた場合は type="timeout" に分類される', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 50 }),
        async (errorMessage) => {
          // AbortError: fetch が name='AbortError' のエラーを投げる
          const abortError = new DOMException(
            errorMessage || 'The operation was aborted',
            'AbortError',
          );
          global.fetch = vi.fn().mockRejectedValue(abortError);

          try {
            await generateContent(defaultParams);
            return false;
          } catch (error) {
            expect(error).toBeInstanceOf(GeminiApiError);
            expect(error.type).toBe('timeout');
            return true;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // --- Property 9f: 全分類の統合（任意の失敗種別を網羅） ---
  it('任意の HTTP ステータスまたは失敗種別に対して決定的写像に従う', async () => {
    // カスタム Arbitrary: 失敗種別を生成する
    const failureArbitrary = fc.oneof(
      // HTTP エラーレスポンス（400以上の非OK ステータス）
      fc.integer({ min: 400, max: 599 }).map((status) => ({
        kind: 'http',
        status,
      })),
      // ネットワークエラー（TypeError）
      fc.string({ minLength: 1, maxLength: 30 }).map((msg) => ({
        kind: 'network',
        message: msg,
      })),
      // AbortError（タイムアウト）
      fc.string({ minLength: 0, maxLength: 30 }).map((msg) => ({
        kind: 'abort',
        message: msg,
      })),
    );

    await fc.assert(
      fc.asyncProperty(failureArbitrary, async (failure) => {
        if (failure.kind === 'http') {
          global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: failure.status,
            json: async () => ({ error: { message: 'error' } }),
          });
        } else if (failure.kind === 'network') {
          global.fetch = vi.fn().mockRejectedValue(
            new TypeError(failure.message),
          );
        } else {
          // abort
          global.fetch = vi.fn().mockRejectedValue(
            new DOMException(failure.message || 'Aborted', 'AbortError'),
          );
        }

        try {
          await generateContent(defaultParams);
          return false;
        } catch (error) {
          expect(error).toBeInstanceOf(GeminiApiError);

          // 期待される type を決定的写像で計算
          let expectedType;
          if (failure.kind === 'network') {
            expectedType = 'network';
          } else if (failure.kind === 'abort') {
            expectedType = 'timeout';
          } else {
            // HTTP エラー
            const s = failure.status;
            if (s === 400) {
              expectedType = 'invalid_request';
            } else if (s === 401 || s === 403) {
              expectedType = 'auth';
            } else if (s === 429) {
              expectedType = 'rate_limit';
            } else {
              // 400/401/403/429 以外（402, 404-599 等）はすべて server
              expectedType = 'server';
            }
          }

          expect(error.type).toBe(expectedType);
          return true;
        }
      }),
      { numRuns: 100 },
    );
  });
});
