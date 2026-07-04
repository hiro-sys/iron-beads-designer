// =============================================================================
// messageForAiError — AI変換エラーからユーザー向け定型メッセージを生成する
// -----------------------------------------------------------------------------
// GeminiApiError.type / AiConversionError.type を判定し、要件7.1/7.2/7.5/8.5
// に対応する定型文言へマップする。
// メッセージには API キー値や API の生レスポンス／生エラーボディを一切含めない
// （要件5.8）。
// =============================================================================

/**
 * GeminiApiError.type に対応するユーザー向けメッセージ。
 * @type {Record<string, string>}
 */
const GEMINI_ERROR_MESSAGES = {
  invalid_request: 'AIへのリクエスト内容が不正です。プレート構成やお題を変えて再試行してください。',
  auth: 'APIキーの認証に失敗しました。キーを再確認してください。',
  rate_limit: 'APIのレート制限に達しました。時間をおいて再試行してください。',
  server: 'AIサーバーでエラーが発生しました。時間をおいて再試行してください。',
  network: 'ネットワーク接続に失敗しました。接続を確認してください。',
  timeout: 'AI変換がタイムアウトしました。時間をおいて再試行してください。',
};

/**
 * AiConversionError.type に対応するユーザー向けメッセージ。
 * @type {Record<string, string>}
 */
const AI_CONVERSION_ERROR_MESSAGES = {
  invalid_input: 'AI変換の入力が不正です。設定を確認してください。',
  no_api_key: 'APIキーが設定されていません。APIキー設定UIで設定してください。',
  no_response: 'AIからの応答を取得できませんでした。時間をおいて再試行してください。',
  invalid_format: 'AIの応答形式が不正です。時間をおいて再試行してください。',
  grid_shape: 'AIの応答が図案の制約に適合しませんでした。時間をおいて再試行してください。',
};

/** 未知のエラーに対するデフォルトメッセージ。 */
const DEFAULT_ERROR_MESSAGE = 'AI変換中にエラーが発生しました。';

/**
 * AI変換エラーからユーザー向け定型メッセージを生成する。
 *
 * GeminiApiError または AiConversionError の `type` プロパティに基づき、
 * 要件対応の定型文言を返す。APIキー値や生レスポンスは一切含めない（要件5.8）。
 *
 * 注意: この関数は常に日本語の定型文を返す（既存テスト互換のため）。
 * ロケールに応じた表示が必要な場合は getAiErrorKey() + i18n.js の t() を使うこと。
 *
 * @param {Error} error - GeminiApiError / AiConversionError / その他の Error
 * @returns {string} ユーザー向けエラーメッセージ（日本語固定）
 */
export function messageForAiError(error) {
  if (!error || typeof error !== 'object') {
    return DEFAULT_ERROR_MESSAGE;
  }

  const { name, type } = error;

  // GeminiApiError の判定
  if (name === 'GeminiApiError' && typeof type === 'string') {
    return GEMINI_ERROR_MESSAGES[type] || DEFAULT_ERROR_MESSAGE;
  }

  // AiConversionError の判定
  if (name === 'AiConversionError' && typeof type === 'string') {
    return AI_CONVERSION_ERROR_MESSAGES[type] || DEFAULT_ERROR_MESSAGE;
  }

  // 未知のエラー
  return DEFAULT_ERROR_MESSAGE;
}

/**
 * AI変換エラーから、i18n.js の辞書キー（'aiError.xxx'）を返す。
 *
 * messageForAiError と同じ判定ロジックだが、日本語文字列ではなく i18n 辞書の
 * キーを返す。呼び出し側で `t(getAiErrorKey(error))` としてロケールに応じた
 * 表示文字列を取得する（main.js の runAiTextConversion から使用）。
 *
 * @param {Error} error - GeminiApiError / AiConversionError / その他の Error
 * @returns {string} i18n.js の辞書キー（例: 'aiError.auth'）
 */
export function getAiErrorKey(error) {
  if (!error || typeof error !== 'object') {
    return 'aiError.default';
  }

  const { name, type } = error;

  if (name === 'GeminiApiError' && typeof type === 'string' && type in GEMINI_ERROR_MESSAGES) {
    return `aiError.${type}`;
  }

  if (
    name === 'AiConversionError' &&
    typeof type === 'string' &&
    type in AI_CONVERSION_ERROR_MESSAGES
  ) {
    return `aiError.${type}`;
  }

  return 'aiError.default';
}
