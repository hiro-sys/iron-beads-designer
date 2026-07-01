import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { createAppState } from '../src/state.js';

// =============================================================================
// タスク1.3 / Property 7: APIキーは永続ストレージに書き込まれない
// -----------------------------------------------------------------------------
// 対象: src/state.js — setGeminiApiKey / clearGeminiApiKey
//
// localStorage / sessionStorage をクリア状態から開始し、任意の「設定・消去の
// 操作列」を適用後、各ストレージおよび document.cookie にAPIキー値が書き込まれて
// いないことを検証する。消去操作後はセッションメモリ上のキーが null へ戻ることも
// 検証する。
//
// 注: Node.js v25 の実験的グローバル localStorage は Web Storage API を持たないため、
// ストレージ操作の監視にはグローバルプロパティのプロキシとスパイを用いて検証する。
//
// **Validates: Requirements 5.1, 5.2, 5.6**
// =============================================================================

describe('Feature: gemini-ai-conversion, Property 7: APIキーは永続ストレージに書き込まれない', () => {
  // ストレージ書き込みを検知するためのスパイ群
  let localStorageSetItemSpy;
  let sessionStorageSetItemSpy;
  let cookieSetSpy;

  // Web Storage API モック（setItem / getItem / removeItem / clear / key / length）
  // state.js がこれらを呼んだら検知する
  const mockLocalStorage = {
    _store: new Map(),
    getItem(key) { return this._store.get(key) ?? null; },
    setItem(key, value) { this._store.set(key, String(value)); },
    removeItem(key) { this._store.delete(key); },
    clear() { this._store.clear(); },
    key(index) { return [...this._store.keys()][index] ?? null; },
    get length() { return this._store.size; },
  };

  const mockSessionStorage = {
    _store: new Map(),
    getItem(key) { return this._store.get(key) ?? null; },
    setItem(key, value) { this._store.set(key, String(value)); },
    removeItem(key) { this._store.delete(key); },
    clear() { this._store.clear(); },
    key(index) { return [...this._store.keys()][index] ?? null; },
    get length() { return this._store.size; },
  };

  beforeEach(() => {
    // globalThis (=window) の localStorage / sessionStorage をモックに差し替える
    mockLocalStorage._store.clear();
    mockSessionStorage._store.clear();

    Object.defineProperty(globalThis, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: mockSessionStorage,
      writable: true,
      configurable: true,
    });

    // setItem をスパイして書き込みを検知する
    localStorageSetItemSpy = vi.spyOn(mockLocalStorage, 'setItem');
    sessionStorageSetItemSpy = vi.spyOn(mockSessionStorage, 'setItem');

    // document.cookie のsetterをスパイする
    cookieSetSpy = vi.fn();
    Object.defineProperty(document, 'cookie', {
      get() { return ''; },
      set: cookieSetSpy,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * 任意のAPIキー文字列のジェネレーター。
   * trim後に1文字以上の文字列を生成し、永続化されないことを確認する対象とする。
   */
  const nonEmptyKeyArb = fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0);

  /**
   * 任意のAPIキー文字列のジェネレーター（空白含む）。
   */
  const apiKeyArb = fc.string({ minLength: 0, maxLength: 100 });

  /**
   * 操作列のジェネレーター。setKey（任意文字列）と clearKey を混在させる。
   */
  const operationArb = fc.oneof(
    apiKeyArb.map((key) => ({ type: 'setKey', key })),
    fc.constant({ type: 'clearKey' }),
  );

  const operationSequenceArb = fc.array(operationArb, { minLength: 1, maxLength: 20 });

  it('Feature: gemini-ai-conversion, Property 7: APIキーは永続ストレージに書き込まれない', () => {
    fc.assert(
      fc.property(operationSequenceArb, (operations) => {
        // スパイの呼び出し記録をリセット
        localStorageSetItemSpy.mockClear();
        sessionStorageSetItemSpy.mockClear();
        cookieSetSpy.mockClear();
        mockLocalStorage._store.clear();
        mockSessionStorage._store.clear();

        const store = createAppState();

        // 操作列で使われた全てのAPIキー値を記録する（検証対象）
        const usedKeys = new Set();
        let lastClearWasFinal = false;

        for (const op of operations) {
          if (op.type === 'setKey') {
            const trimmed = op.key.trim();
            if (trimmed.length > 0) {
              usedKeys.add(trimmed);
            }
            store.setGeminiApiKey(op.key);
            lastClearWasFinal = false;
          } else {
            store.clearGeminiApiKey();
            lastClearWasFinal = true;
          }
        }

        // 検証1: localStorage.setItem が呼ばれていない
        // （APIキー値がストレージに書き込まれていないことの十分条件）
        for (const call of localStorageSetItemSpy.mock.calls) {
          const [, value] = call;
          for (const key of usedKeys) {
            expect(String(value)).not.toContain(key);
          }
        }

        // 検証2: sessionStorage.setItem が呼ばれていない
        for (const call of sessionStorageSetItemSpy.mock.calls) {
          const [, value] = call;
          for (const key of usedKeys) {
            expect(String(value)).not.toContain(key);
          }
        }

        // 検証3: document.cookie にAPIキー値が書き込まれていない
        for (const call of cookieSetSpy.mock.calls) {
          const cookieValue = call[0];
          for (const key of usedKeys) {
            expect(String(cookieValue)).not.toContain(key);
          }
        }

        // 検証4: mockLocalStorage 内部ストアにもAPIキー値が含まれていない
        for (const [, val] of mockLocalStorage._store) {
          for (const key of usedKeys) {
            expect(val).not.toContain(key);
          }
        }

        // 検証5: mockSessionStorage 内部ストアにもAPIキー値が含まれていない
        for (const [, val] of mockSessionStorage._store) {
          for (const key of usedKeys) {
            expect(val).not.toContain(key);
          }
        }

        // 検証6: 消去操作後はセッションメモリ上のキーが null へ戻る
        if (lastClearWasFinal) {
          expect(store.geminiApiKey).toBe(null);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('Feature: gemini-ai-conversion, Property 7: clearGeminiApiKey 後は必ず null に戻る（補強）', () => {
    fc.assert(
      fc.property(nonEmptyKeyArb, (rawKey) => {
        // スパイの呼び出し記録をリセット
        localStorageSetItemSpy.mockClear();
        sessionStorageSetItemSpy.mockClear();
        cookieSetSpy.mockClear();
        mockLocalStorage._store.clear();
        mockSessionStorage._store.clear();

        const store = createAppState();

        // キーを設定
        store.setGeminiApiKey(rawKey);
        // セッションメモリにはキーが保持されている
        expect(store.geminiApiKey).toBe(rawKey.trim());

        // 消去
        store.clearGeminiApiKey();

        // 消去後は必ず null
        expect(store.geminiApiKey).toBe(null);

        // ストレージに何も書き込まれていない
        expect(localStorageSetItemSpy).not.toHaveBeenCalled();
        expect(sessionStorageSetItemSpy).not.toHaveBeenCalled();
        expect(cookieSetSpy).not.toHaveBeenCalled();
        expect(mockLocalStorage._store.size).toBe(0);
        expect(mockSessionStorage._store.size).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
