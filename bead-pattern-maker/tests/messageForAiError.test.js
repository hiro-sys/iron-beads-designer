import { describe, it, expect } from 'vitest';
import { messageForAiError } from '../src/utils/messageForAiError.js';

describe('messageForAiError', () => {
  describe('GeminiApiError の種別マッピング', () => {
    it('auth → APIキーの認証に失敗しました', () => {
      const error = new Error('auth error');
      error.name = 'GeminiApiError';
      error.type = 'auth';
      expect(messageForAiError(error)).toBe(
        'APIキーの認証に失敗しました。キーを再確認してください。',
      );
    });

    it('rate_limit → APIのレート制限に達しました', () => {
      const error = new Error('rate limit');
      error.name = 'GeminiApiError';
      error.type = 'rate_limit';
      expect(messageForAiError(error)).toBe(
        'APIのレート制限に達しました。時間をおいて再試行してください。',
      );
    });

    it('server → AIサーバーでエラーが発生しました', () => {
      const error = new Error('server error');
      error.name = 'GeminiApiError';
      error.type = 'server';
      expect(messageForAiError(error)).toBe(
        'AIサーバーでエラーが発生しました。時間をおいて再試行してください。',
      );
    });

    it('network → ネットワーク接続に失敗しました', () => {
      const error = new Error('network error');
      error.name = 'GeminiApiError';
      error.type = 'network';
      expect(messageForAiError(error)).toBe(
        'ネットワーク接続に失敗しました。接続を確認してください。',
      );
    });

    it('timeout → AI変換がタイムアウトしました', () => {
      const error = new Error('timeout');
      error.name = 'GeminiApiError';
      error.type = 'timeout';
      expect(messageForAiError(error)).toBe(
        'AI変換がタイムアウトしました。時間をおいて再試行してください。',
      );
    });

    it('未知の GeminiApiError type → デフォルトメッセージ', () => {
      const error = new Error('unknown');
      error.name = 'GeminiApiError';
      error.type = 'unknown_type';
      expect(messageForAiError(error)).toBe('AI変換中にエラーが発生しました。');
    });
  });

  describe('AiConversionError の種別マッピング', () => {
    it('invalid_input → AI変換の入力が不正です', () => {
      const error = new Error('invalid input');
      error.name = 'AiConversionError';
      error.type = 'invalid_input';
      expect(messageForAiError(error)).toBe(
        'AI変換の入力が不正です。設定を確認してください。',
      );
    });

    it('no_api_key → APIキーが設定されていません', () => {
      const error = new Error('no key');
      error.name = 'AiConversionError';
      error.type = 'no_api_key';
      expect(messageForAiError(error)).toBe(
        'APIキーが設定されていません。APIキー設定UIで設定してください。',
      );
    });

    it('no_response → AIからの応答を取得できませんでした', () => {
      const error = new Error('no response');
      error.name = 'AiConversionError';
      error.type = 'no_response';
      expect(messageForAiError(error)).toBe(
        'AIからの応答を取得できませんでした。時間をおいて再試行してください。',
      );
    });

    it('invalid_format → AIの応答形式が不正です', () => {
      const error = new Error('invalid format');
      error.name = 'AiConversionError';
      error.type = 'invalid_format';
      expect(messageForAiError(error)).toBe(
        'AIの応答形式が不正です。時間をおいて再試行してください。',
      );
    });

    it('grid_shape → AIの応答が図案の制約に適合しませんでした', () => {
      const error = new Error('grid shape');
      error.name = 'AiConversionError';
      error.type = 'grid_shape';
      expect(messageForAiError(error)).toBe(
        'AIの応答が図案の制約に適合しませんでした。時間をおいて再試行してください。',
      );
    });

    it('未知の AiConversionError type → デフォルトメッセージ', () => {
      const error = new Error('unknown');
      error.name = 'AiConversionError';
      error.type = 'something_else';
      expect(messageForAiError(error)).toBe('AI変換中にエラーが発生しました。');
    });
  });

  describe('エッジケース', () => {
    it('通常の Error（name/type なし）→ デフォルトメッセージ', () => {
      const error = new Error('something went wrong');
      expect(messageForAiError(error)).toBe('AI変換中にエラーが発生しました。');
    });

    it('null → デフォルトメッセージ', () => {
      expect(messageForAiError(null)).toBe('AI変換中にエラーが発生しました。');
    });

    it('undefined → デフォルトメッセージ', () => {
      expect(messageForAiError(undefined)).toBe('AI変換中にエラーが発生しました。');
    });

    it('メッセージに API キー値を含まない', () => {
      const apiKey = 'AIzaSyD-FAKE-KEY-1234567890abcdef';
      const error = new Error(`Auth failed for key: ${apiKey}`);
      error.name = 'GeminiApiError';
      error.type = 'auth';
      const msg = messageForAiError(error);
      expect(msg).not.toContain(apiKey);
      expect(msg).toBe('APIキーの認証に失敗しました。キーを再確認してください。');
    });

    it('メッセージに生のAPIレスポンスボディを含まない', () => {
      const rawBody = '{"error":{"code":429,"message":"Resource exhausted"}}';
      const error = new Error(rawBody);
      error.name = 'GeminiApiError';
      error.type = 'rate_limit';
      const msg = messageForAiError(error);
      expect(msg).not.toContain(rawBody);
      expect(msg).not.toContain('Resource exhausted');
      expect(msg).toBe('APIのレート制限に達しました。時間をおいて再試行してください。');
    });
  });
});
