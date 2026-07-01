import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateContent, GeminiApiError } from '../src/engine/geminiClient.js';

// =============================================================================
// geminiClient.js のユニットテスト（タスク3.3）
// -----------------------------------------------------------------------------
// 対象: src/engine/geminiClient.js
//   - generateContent({ apiKey, model, parts, responseSchema, ... })
//   - GeminiApiError
//
// fetch をモックし、以下を検証する:
//   1. 正常 JSON 応答のパース
//   2. 不正 JSON 応答の扱い（SyntaxError → そのまま throw）
//   3. AbortController によるタイムアウト（timeout 分類）
//   4. ヘッダに x-goog-api-key が設定され URL にキーが載らないこと
//   5. HTTP 401 → GeminiApiError type='auth'
//   6. HTTP 429 → GeminiApiError type='rate_limit'
//   7. HTTP 500 → GeminiApiError type='server'
//   8. ネットワークエラー: fetch throws TypeError → GeminiApiError type='network'
//   9. 応答に candidates がない場合 → GeminiApiError type='server'
//
// 検証対象: Requirements 5.3, 7.2
// =============================================================================

// --- ヘルパー ----------------------------------------------------------------

/**
 * Gemini API の正常応答（candidates[0].content.parts[0].text）を組み立てる。
 * @param {object} data - レスポンスとして返す JSON オブジェクト
 * @returns {object} fetch の Response.json() が返す構造
 */
function makeGeminiResponse(data) {
  return {
    candidates: [
      {
        content: {
          parts: [{ text: JSON.stringify(data) }],
        },
      },
    ],
  };
}

/**
 * テスト用の基本パラメータ。
 */
function baseParams(overrides = {}) {
  return {
    apiKey: 'test-api-key-12345',
    model: 'gemini-2.5-flash',
    parts: [{ text: 'hello' }],
    responseSchema: { type: 'OBJECT', properties: {} },
    timeoutMs: 5000,
    ...overrides,
  };
}

// =============================================================================
// テスト
// =============================================================================

describe('geminiClient ユニットテスト（タスク3.3）', () => {
  let originalFetch;

  beforeEach(() => {
    // global.fetch をモックに差し替え
    originalFetch = global.fetch;
    global.fetch = vi.fn();
  });

  afterEach(() => {
    // fetch モックを復元
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // --- 1. 正常系: 正常 JSON のパース -----------------------------------------
  describe('正常系', () => {
    it('正常な JSON 応答をパースしてオブジェクトを返す', async () => {
      const expectedData = { grid: [[0, 1], [1, 0]], width: 2, height: 2 };
      const responseBody = makeGeminiResponse(expectedData);

      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(responseBody),
      });

      const result = await generateContent(baseParams());

      expect(result).toEqual(expectedData);
    });

    it('ネストされた複雑な JSON も正しくパースする', async () => {
      const complexData = {
        grid: [[0, -1, 2], [1, 0, -1]],
        metadata: { source: 'test' },
      };
      const responseBody = makeGeminiResponse(complexData);

      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(responseBody),
      });

      const result = await generateContent(baseParams());

      expect(result).toEqual(complexData);
    });
  });

  // --- 2. 不正 JSON 応答 ----------------------------------------------------
  describe('不正 JSON 応答', () => {
    it('text フィールドが不正 JSON の場合 GeminiApiError を投げる（生レスポンス漏洩防止）', async () => {
      const responseBody = {
        candidates: [
          {
            content: {
              parts: [{ text: 'this is not valid json{{{' }],
            },
          },
        ],
      };

      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(responseBody),
      });

      await expect(generateContent(baseParams())).rejects.toThrow(GeminiApiError);
    });
  });

  // --- 3. タイムアウト -------------------------------------------------------
  describe('タイムアウト', () => {
    it('タイムアウト時に GeminiApiError type="timeout" を投げる', async () => {
      // fetch が応答を返す前にタイムアウトするよう、
      // 非常に短い timeoutMs を設定し、fetch は遅延するモックにする
      global.fetch.mockImplementation((_url, options) => {
        return new Promise((resolve, reject) => {
          // signal の abort イベントを監視して AbortError を投げる
          const onAbort = () => {
            const abortError = new DOMException('The operation was aborted.', 'AbortError');
            reject(abortError);
          };
          if (options?.signal?.aborted) {
            onAbort();
            return;
          }
          options?.signal?.addEventListener('abort', onAbort);
        });
      });

      const error = await generateContent(baseParams({ timeoutMs: 1 }))
        .then(() => null)
        .catch((e) => e);

      expect(error).toBeInstanceOf(GeminiApiError);
      expect(error.type).toBe('timeout');
    });
  });

  // --- 4. ヘッダ検証 ---------------------------------------------------------
  describe('ヘッダとURL', () => {
    it('x-goog-api-key ヘッダに API キーが設定される', async () => {
      const apiKey = 'my-secret-key-xyz';
      const responseBody = makeGeminiResponse({ ok: true });

      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(responseBody),
      });

      await generateContent(baseParams({ apiKey }));

      // fetch が呼ばれたときの引数を検査
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];

      // ヘッダに x-goog-api-key が設定されている
      expect(options.headers['x-goog-api-key']).toBe(apiKey);

      // URL に API キーが含まれていない
      expect(url).not.toContain(apiKey);
      expect(url).not.toContain('key=');
    });

    it('URL にモデル名が含まれる', async () => {
      const responseBody = makeGeminiResponse({ ok: true });

      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(responseBody),
      });

      await generateContent(baseParams({ model: 'gemini-2.5-flash' }));

      const [url] = global.fetch.mock.calls[0];
      expect(url).toContain('gemini-2.5-flash');
      expect(url).toContain('generateContent');
    });
  });

  // --- 5. HTTP 401 → auth ---------------------------------------------------
  describe('HTTP エラーの分類', () => {
    it('HTTP 400 → GeminiApiError type="invalid_request"', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 400,
      });

      const error = await generateContent(baseParams()).catch((e) => e);

      expect(error).toBeInstanceOf(GeminiApiError);
      expect(error.type).toBe('invalid_request');
      expect(error.status).toBe(400);
    });

    it('HTTP 401 → GeminiApiError type="auth"', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 401,
      });

      const error = await generateContent(baseParams()).catch((e) => e);

      expect(error).toBeInstanceOf(GeminiApiError);
      expect(error.type).toBe('auth');
      expect(error.status).toBe(401);
    });

    // --- 6. HTTP 429 → rate_limit -------------------------------------------
    it('HTTP 429 → GeminiApiError type="rate_limit"', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 429,
      });

      const error = await generateContent(baseParams()).catch((e) => e);

      expect(error).toBeInstanceOf(GeminiApiError);
      expect(error.type).toBe('rate_limit');
      expect(error.status).toBe(429);
    });

    // --- 7. HTTP 500 → server -----------------------------------------------
    it('HTTP 500 → GeminiApiError type="server"', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const error = await generateContent(baseParams()).catch((e) => e);

      expect(error).toBeInstanceOf(GeminiApiError);
      expect(error.type).toBe('server');
      expect(error.status).toBe(500);
    });

    it('HTTP 403 → GeminiApiError type="auth"', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 403,
      });

      const error = await generateContent(baseParams()).catch((e) => e);

      expect(error).toBeInstanceOf(GeminiApiError);
      expect(error.type).toBe('auth');
      expect(error.status).toBe(403);
    });

    it('HTTP 503 → GeminiApiError type="server"', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 503,
      });

      const error = await generateContent(baseParams()).catch((e) => e);

      expect(error).toBeInstanceOf(GeminiApiError);
      expect(error.type).toBe('server');
      expect(error.status).toBe(503);
    });
  });

  // --- 8. ネットワークエラー ------------------------------------------------
  describe('ネットワークエラー', () => {
    it('fetch が TypeError を投げた場合 → GeminiApiError type="network"', async () => {
      global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

      const error = await generateContent(baseParams()).catch((e) => e);

      expect(error).toBeInstanceOf(GeminiApiError);
      expect(error.type).toBe('network');
    });
  });

  // --- 9. 応答に candidates がない場合 --------------------------------------
  describe('応答形式不正', () => {
    it('candidates がない応答 → GeminiApiError type="server"', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}), // candidates なし
      });

      const error = await generateContent(baseParams()).catch((e) => e);

      expect(error).toBeInstanceOf(GeminiApiError);
      expect(error.type).toBe('server');
    });

    it('candidates[0].content.parts[0].text が存在しない → GeminiApiError type="server"', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ candidates: [{ content: { parts: [] } }] }),
      });

      const error = await generateContent(baseParams()).catch((e) => e);

      expect(error).toBeInstanceOf(GeminiApiError);
      expect(error.type).toBe('server');
    });

    it('candidates が空配列 → GeminiApiError type="server"', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ candidates: [] }),
      });

      const error = await generateContent(baseParams()).catch((e) => e);

      expect(error).toBeInstanceOf(GeminiApiError);
      expect(error.type).toBe('server');
    });

    it('text が数値（非文字列）の場合 → GeminiApiError type="server"', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: 12345 }] } }],
        }),
      });

      const error = await generateContent(baseParams()).catch((e) => e);

      expect(error).toBeInstanceOf(GeminiApiError);
      expect(error.type).toBe('server');
    });
  });
});
