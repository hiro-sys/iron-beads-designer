// =============================================================================
// Property 6: APIキー設定のtrim保持と空白拒否
// =============================================================================
// Feature: gemini-ai-conversion, Property 6: APIキー設定のtrim保持と空白拒否
//
// 任意の文字列に対し、trim 後1文字以上なら trim 済み値をセッションメモリに保持して
// `true` を返し、空文字・空白のみなら現在のキーを変更せず `false` を返すことを検証する。
//
// **Validates: Requirements 3.5, 3.6**
// =============================================================================

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { createAppState } from '../src/state.js';

describe('Feature: gemini-ai-conversion, Property 6: APIキー設定のtrim保持と空白拒否', () => {
  // ---------------------------------------------------------------------------
  // 6a: trim 後1文字以上の文字列は trim 済み値を保持し true を返す
  // ---------------------------------------------------------------------------
  it('trim 後1文字以上の文字列に対し、trim 済み値をセッションメモリに保持して true を返す', () => {
    // 非空白文字を少なくとも1つ含む任意の文字列を生成する
    const nonBlankStringArb = fc
      .tuple(
        fc.string({ minLength: 0, maxLength: 10 }), // 前置パディング（空白含む）
        fc.string({ minLength: 1, maxLength: 32 }).filter((s) => s.trim().length > 0), // 非空白を含む核
        fc.string({ minLength: 0, maxLength: 10 }), // 後置パディング（空白含む）
      )
      .map(([prefix, core, suffix]) => prefix + core + suffix)
      .filter((s) => s.trim().length > 0);

    fc.assert(
      fc.property(nonBlankStringArb, (rawKey) => {
        const state = createAppState();
        const result = state.setGeminiApiKey(rawKey);

        // true を返すこと
        expect(result).toBe(true);
        // trim 済み値がセッションメモリに保持されること
        expect(state.geminiApiKey).toBe(rawKey.trim());
      }),
      { numRuns: 100 },
    );
  });

  // ---------------------------------------------------------------------------
  // 6b: 空文字・空白のみの文字列は現在のキーを変更せず false を返す
  // ---------------------------------------------------------------------------
  it('空文字・空白のみの文字列に対し、現在のキーを変更せず false を返す', () => {
    // 空白文字のみ（スペース・タブ・改行等）の文字列を生成する
    const whitespaceChars = [' ', '\t', '\n', '\r', '\f', '\v', '\u00A0', '\u2000', '\u2001', '\u2002', '\u3000'];
    const blankStringArb = fc
      .array(fc.constantFrom(...whitespaceChars), { minLength: 0, maxLength: 20 })
      .map((chars) => chars.join(''));

    fc.assert(
      fc.property(
        blankStringArb,
        fc.option(fc.string({ minLength: 1, maxLength: 32 }).filter((s) => s.trim().length > 0), { nil: undefined }),
        (blankInput, existingKey) => {
          // 既存キーが設定されている場合とされていない場合の両方をテスト
          const state = createAppState();
          if (existingKey !== undefined) {
            state.setGeminiApiKey(existingKey);
          }
          const keyBefore = state.geminiApiKey;

          const result = state.setGeminiApiKey(blankInput);

          // false を返すこと
          expect(result).toBe(false);
          // キーが変更されていないこと
          expect(state.geminiApiKey).toBe(keyBefore);
        },
      ),
      { numRuns: 100 },
    );
  });

  // ---------------------------------------------------------------------------
  // 6c: 非文字列入力（数値・null・undefined 等）に対しても安全に動作する
  // ---------------------------------------------------------------------------
  it('非文字列入力に対し、現在のキーを変更せず false を返す', () => {
    const nonStringArb = fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.integer(),
      fc.double(),
      fc.boolean(),
      fc.constant([]),
      fc.constant({}),
    );

    fc.assert(
      fc.property(nonStringArb, (invalidInput) => {
        const state = createAppState();
        const existingKey = 'previous-key-abc123';
        state.setGeminiApiKey(existingKey);

        const result = state.setGeminiApiKey(invalidInput);

        // false を返すこと
        expect(result).toBe(false);
        // 既存キーが変更されていないこと
        expect(state.geminiApiKey).toBe(existingKey);
      }),
      { numRuns: 100 },
    );
  });

  // ---------------------------------------------------------------------------
  // 6d: 連続した設定操作で最新の trim 済み値が保持される
  // ---------------------------------------------------------------------------
  it('連続した設定操作で最新の trim 済み値が保持される', () => {
    const validKeyArb = fc
      .string({ minLength: 1, maxLength: 32 })
      .filter((s) => s.trim().length > 0);

    fc.assert(
      fc.property(
        fc.array(validKeyArb, { minLength: 1, maxLength: 5 }),
        (keys) => {
          const state = createAppState();

          for (const key of keys) {
            const result = state.setGeminiApiKey(key);
            expect(result).toBe(true);
          }

          // 最後に設定したキーの trim 済み値が保持されること
          const lastKey = keys[keys.length - 1];
          expect(state.geminiApiKey).toBe(lastKey.trim());
        },
      ),
      { numRuns: 100 },
    );
  });
});
