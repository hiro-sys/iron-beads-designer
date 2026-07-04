import { describe, it, expect, afterEach } from 'vitest';
import { messageForAiError, getAiErrorKey } from '../src/utils/messageForAiError.js';
import { t, setLocale } from '../src/i18n.js';

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

// =============================================================================
// getAiErrorKey — AI変換エラー → i18n 辞書キー（'aiError.xxx'）へのマッピング
// -----------------------------------------------------------------------------
// messageForAiError と同じ判定ロジックだが、日本語固定文ではなく i18n 辞書の
// キーを返す。呼び出し側は t(getAiErrorKey(error)) でロケール別文言を得る。
// =============================================================================
describe('getAiErrorKey', () => {
  // t() はモジュールグローバルな currentLocale を参照するため、
  // クロスチェックでロケールを切り替えた後は必ず既定（'en'）へ戻す。
  afterEach(() => {
    setLocale('en');
  });

  /** name / type を持つエラーオブジェクトを生成するヘルパ。 */
  const makeError = (name, type) => {
    const error = new Error(`${name}:${type}`);
    error.name = name;
    error.type = type;
    return error;
  };

  describe('GeminiApiError の種別 → 辞書キー', () => {
    const cases = [
      ['invalid_request', 'aiError.invalid_request'],
      ['auth', 'aiError.auth'],
      ['rate_limit', 'aiError.rate_limit'],
      ['server', 'aiError.server'],
      ['network', 'aiError.network'],
      ['timeout', 'aiError.timeout'],
    ];
    it.each(cases)('type=%s → %s', (type, expectedKey) => {
      expect(getAiErrorKey(makeError('GeminiApiError', type))).toBe(expectedKey);
    });
  });

  describe('AiConversionError の種別 → 辞書キー', () => {
    const cases = [
      ['invalid_input', 'aiError.invalid_input'],
      ['no_api_key', 'aiError.no_api_key'],
      ['no_response', 'aiError.no_response'],
      ['invalid_format', 'aiError.invalid_format'],
      ['grid_shape', 'aiError.grid_shape'],
    ];
    it.each(cases)('type=%s → %s', (type, expectedKey) => {
      expect(getAiErrorKey(makeError('AiConversionError', type))).toBe(expectedKey);
    });
  });

  describe('未知・非対象エラー → aiError.default', () => {
    it('未知の GeminiApiError type → aiError.default', () => {
      expect(getAiErrorKey(makeError('GeminiApiError', 'xxx'))).toBe('aiError.default');
    });
    it('未知の AiConversionError type → aiError.default', () => {
      expect(getAiErrorKey(makeError('AiConversionError', 'yyy'))).toBe('aiError.default');
    });
    it('通常の Error（name/type なし）→ aiError.default', () => {
      expect(getAiErrorKey(new Error('plain'))).toBe('aiError.default');
    });
    it('null → aiError.default', () => {
      expect(getAiErrorKey(null)).toBe('aiError.default');
    });
    it('undefined → aiError.default', () => {
      expect(getAiErrorKey(undefined)).toBe('aiError.default');
    });
  });

  // ---------------------------------------------------------------------------
  // クロスチェック（2ファイル間の整合性の要）
  // -----------------------------------------------------------------------------
  // 上記1〜3で登場する全エラーパターンを網羅的に列挙し、
  // returnedKey = getAiErrorKey(error) が ja / en 双方で
  //   (a) t(returnedKey) が returnedKey 文字列と等しくない（＝辞書に実在する）
  //   (b) t(returnedKey) が空文字でない
  // ことを検証する。これにより getAiErrorKey が返しうる全キーが
  // i18n.js の辞書に必ず存在することを保証する。
  // ---------------------------------------------------------------------------
  describe('クロスチェック: 返却キーが i18n 辞書に実在する', () => {
    const errorInputs = [
      makeError('GeminiApiError', 'invalid_request'),
      makeError('GeminiApiError', 'auth'),
      makeError('GeminiApiError', 'rate_limit'),
      makeError('GeminiApiError', 'server'),
      makeError('GeminiApiError', 'network'),
      makeError('GeminiApiError', 'timeout'),
      makeError('AiConversionError', 'invalid_input'),
      makeError('AiConversionError', 'no_api_key'),
      makeError('AiConversionError', 'no_response'),
      makeError('AiConversionError', 'invalid_format'),
      makeError('AiConversionError', 'grid_shape'),
      makeError('GeminiApiError', 'xxx'), // 未知 type → default
      makeError('AiConversionError', 'yyy'), // 未知 type → default
      new Error('plain'), // 通常 Error → default
      null, // → default
      undefined, // → default
    ];

    it('全パターンの返却キーが ja / en 双方で有効な訳（キー文字列と異なり空でない）を持つ', () => {
      for (const locale of ['ja', 'en']) {
        setLocale(locale);
        for (const input of errorInputs) {
          const returnedKey = getAiErrorKey(input);
          const translated = t(returnedKey);
          // (a) 辞書にキーが実在する（未知キーなら t はキー文字列をそのまま返す）
          expect(translated, `${locale}:${returnedKey} は辞書に実在すべき`).not.toBe(returnedKey);
          // (b) 空文字でない
          expect(translated, `${locale}:${returnedKey} は空でないべき`).not.toBe('');
        }
      }
    });
  });
});
