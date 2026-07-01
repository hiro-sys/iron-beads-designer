// =============================================================================
// Property 6: APIキー設定のtrim保持と空白拒否
// -----------------------------------------------------------------------------
// 任意の文字列に対し、trim 後1文字以上なら trim 済み値をセッションメモリに保持して
// true を返し、空文字・空白のみなら現在のキーを変更せず false を返すことを検証する。
//
// **Validates: Requirements 3.5, 3.6**
// =============================================================================

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createAppState } from '../src/state.js';

describe('Feature: gemini-ai-conversion, Property 6: APIキー設定のtrim保持と空白拒否', () => {
  it('trim後1文字以上の文字列はtrim済み値を保持してtrueを返す', () => {
    fc.assert(
      fc.property(
        // trim後に1文字以上になる任意の文字列を生成する
        fc.string().filter((s) => s.trim().length >= 1),
        (rawKey) => {
          const state = createAppState();
          const result = state.setGeminiApiKey(rawKey);

          // trueを返すこと
          expect(result).toBe(true);
          // 保持された値はtrim済みであること
          expect(state.geminiApiKey).toBe(rawKey.trim());
        },
      ),
      { numRuns: 100 },
    );
  });

  it('空文字・空白のみの文字列は現在のキーを変更せずfalseを返す', () => {
    fc.assert(
      fc.property(
        // trim後に空になる文字列（空白文字のみで構成）を生成する
        fc.array(fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v'), { minLength: 1, maxLength: 20 })
          .map((chars) => chars.join('')),
        // 既に設定済みのキー値（任意のtrim後1文字以上の文字列）
        fc.string().filter((s) => s.trim().length >= 1),
        (whitespaceOnly, existingKey) => {
          const state = createAppState();
          // 事前にキーを設定しておく
          state.setGeminiApiKey(existingKey);
          const expectedKey = existingKey.trim();

          // 空白のみの文字列で設定を試みる
          const result = state.setGeminiApiKey(whitespaceOnly);

          // falseを返すこと
          expect(result).toBe(false);
          // キーが変更されていないこと
          expect(state.geminiApiKey).toBe(expectedKey);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('空文字はfalseを返しキーを変更しない', () => {
    fc.assert(
      fc.property(
        // 既に設定済みのキー値（任意のtrim後1文字以上の文字列）
        fc.string().filter((s) => s.trim().length >= 1),
        (existingKey) => {
          const state = createAppState();
          // 事前にキーを設定しておく
          state.setGeminiApiKey(existingKey);
          const expectedKey = existingKey.trim();

          // 空文字で設定を試みる
          const result = state.setGeminiApiKey('');

          // falseを返すこと
          expect(result).toBe(false);
          // キーが変更されていないこと
          expect(state.geminiApiKey).toBe(expectedKey);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('キー未設定（null）の状態で空白のみを渡してもnullのまま', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v'), { minLength: 0, maxLength: 20 })
          .map((chars) => chars.join('')),
        (whitespaceOnly) => {
          const state = createAppState();
          // 初期状態はnull
          expect(state.geminiApiKey).toBe(null);

          const result = state.setGeminiApiKey(whitespaceOnly);

          // falseを返すこと
          expect(result).toBe(false);
          // キーはnullのまま変更されないこと
          expect(state.geminiApiKey).toBe(null);
        },
      ),
      { numRuns: 100 },
    );
  });
});
