// =============================================================================
// Gemini API クライアント（geminiClient.js）
// -----------------------------------------------------------------------------
// Gemini（Google AI Studio）の generateContent エンドポイントへの通信・
// タイムアウト制御・HTTP ステータス別エラー分類を担う通信層。
//
// AIConversionStrategy から利用し、UI・状態管理には依存しない。
// テスト時は fetch をモックすることで単体検証できる。
//
// 【主な責務】
//   - POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
//   - 認証: ヘッダ x-goog-api-key（URL にキーを載せない・要件5.3）
//   - タイムアウト: AbortController で既定60秒（timeoutMs で上書き可・要件7.2）
//   - 応答パース: candidates[0].content.parts[0].text を JSON.parse して返す
//   - エラー分類: HTTP ステータス / fetch 失敗 / Abort を GeminiApiError.type へ写像
//
// 【セキュリティ】
//   - API キーはリクエストヘッダにのみ設定し、URL・ログ・例外メッセージへ出力しない（要件5.8）
//
// Requirements: 5.3, 5.8, 7.1, 7.2, 8.5
// @module engine/geminiClient
// =============================================================================

// --- 定数 --------------------------------------------------------------------

/** Gemini generateContent エンドポイントのベース URL */
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/** 既定のタイムアウト（ミリ秒）。60秒（要件7.2） */
const DEFAULT_TIMEOUT_MS = 60000;

// =============================================================================
// GeminiApiError
// =============================================================================

/**
 * Gemini API 通信エラー。
 *
 * HTTP ステータス・例外種別から type を分類する（要件7.1/7.2/8.5）。
 * メッセージ・プロパティに API キーを平文で含めない（要件5.8）。
 *
 * @extends Error
 */
export class GeminiApiError extends Error {
  /**
   * @param {'auth'|'rate_limit'|'server'|'network'|'timeout'} type - エラー分類
   * @param {string} message - ユーザー向けメッセージ（API キーを含めないこと）
   * @param {number} [status] - HTTP ステータスコード（取得できた場合）
   * @param {object} [detail] - ローカル開発時のデバッグ用詳細情報（任意）。
   *   API キーを絶対に含めないこと（要件5.8）。指定時のみ this.detail に格納する。
   */
  constructor(type, message, status, detail) {
    super(message);
    this.name = 'GeminiApiError';
    /** @type {'auth'|'rate_limit'|'server'|'network'|'timeout'} */
    this.type = type;
    /** @type {number|undefined} */
    this.status = status;
    // detail が指定された場合のみ格納する（既存の3引数呼び出しと後方互換）。
    // detail には API キーを含めない（要件5.8 / Property 8）。
    if (detail !== undefined) {
      /** @type {object|undefined} */
      this.detail = detail;
    }
  }
}

// --- 内部ヘルパー ------------------------------------------------------------

/**
 * HTTP ステータスコードからエラー種別を決定する。
 *
 * 写像規則（要件7.1/7.2/8.5）:
 *   - 401 / 403 → 'auth'
 *   - 429       → 'rate_limit'
 *   - 500〜599  → 'server'
 *
 * @param {number} status - HTTP ステータスコード
 * @returns {'auth'|'rate_limit'|'server'} エラー種別
 */
function classifyHttpStatus(status) {
  if (status === 400) {
    return 'invalid_request';
  }
  if (status === 401 || status === 403) {
    return 'auth';
  }
  if (status === 429) {
    return 'rate_limit';
  }
  // 5xx はサーバーエラー
  return 'server';
}

/**
 * HTTP ステータスコードからエラーメッセージを生成する。
 * API キーを含めない（要件5.8）。
 *
 * @param {number} status - HTTP ステータスコード
 * @param {'invalid_request'|'auth'|'rate_limit'|'server'} type - 分類済み種別
 * @returns {string} エラーメッセージ
 */
function messageForStatus(status, type) {
  switch (type) {
    case 'invalid_request':
      return `Gemini API リクエストが不正です（HTTP ${status}）。`;
    case 'auth':
      return `Gemini API 認証エラー（HTTP ${status}）。APIキーを確認してください。`;
    case 'rate_limit':
      return `Gemini API レート制限超過（HTTP ${status}）。時間をおいて再試行してください。`;
    case 'server':
      return `Gemini API サーバーエラー（HTTP ${status}）。時間をおいて再試行してください。`;
    default:
      return `Gemini API エラー（HTTP ${status}）。`;
  }
}

// =============================================================================
// generateContent
// =============================================================================

/**
 * Gemini generateContent を呼び、構造化出力（JSON テキスト）をパースして返す。
 *
 * - エンドポイント: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 * - 認証: ヘッダ x-goog-api-key（URL にキーを載せない・要件5.3）
 * - タイムアウト: AbortController で既定60秒（要件7.2）。timeoutMs で上書き可
 * - 応答: candidates[0].content.parts[0].text（responseMimeType=application/json による JSON 文字列）を JSON.parse
 *
 * @param {Object} params
 * @param {string} params.apiKey - 利用者の API キー（ヘッダにのみ使用。ログ・例外に平文を含めない・要件5.8）
 * @param {string} params.model - モデル名（例: 'gemini-2.5-flash'）
 * @param {Array} params.parts - contents[0].parts（テキスト＋inlineData 画像）
 * @param {object} [params.responseSchema] - generationConfig.responseSchema
 * @param {number} [params.maxOutputTokens] - 出力上限トークン数
 * @param {number} [params.thinkingBudget] - 思考トークン上限（2.5系モデル向け）。
 *   数値で指定された場合のみ generationConfig.thinkingConfig.thinkingBudget に設定する。
 *   0 を指定すると思考を抑制して高速化できる。未指定なら何も足さない（後方互換）。
 * @param {number} [params.timeoutMs=60000] - タイムアウト（ミリ秒）
 * @param {AbortSignal} [params.signal] - 外部からの中断シグナル（任意）
 * @returns {Promise<object>} パース済みの構造化出力（JSON オブジェクト）
 * @throws {GeminiApiError} type: 'auth'(401/403) | 'rate_limit'(429) | 'server'(5xx) | 'network' | 'timeout'
 */
export async function generateContent({
  apiKey,
  model,
  parts,
  responseSchema,
  maxOutputTokens,
  thinkingBudget,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
}) {
  // --- URL 構築（キーを含めない・要件5.3） ---
  const url = `${BASE_URL}/${encodeURIComponent(model)}:generateContent`;

  // --- リクエストボディ構築 ---
  const requestBody = {
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: 'application/json',
    },
  };

  // responseSchema が指定されていれば追加
  if (responseSchema) {
    requestBody.generationConfig.responseSchema = responseSchema;
  }

  // maxOutputTokens が指定されていれば追加
  if (maxOutputTokens !== undefined && maxOutputTokens !== null) {
    requestBody.generationConfig.maxOutputTokens = maxOutputTokens;
  }

  // thinkingBudget が数値で指定された場合のみ thinkingConfig を追加する。
  // 0 を指定すると 2.5系モデルの思考を抑制して高速化できる。
  // 未指定（undefined/null）なら何も足さず従来どおりの挙動を保つ（後方互換）。
  if (typeof thinkingBudget === 'number' && Number.isFinite(thinkingBudget)) {
    requestBody.generationConfig.thinkingConfig = { thinkingBudget };
  }

  // --- AbortController（タイムアウト＋外部シグナル統合） ---
  const controller = new AbortController();
  let timeoutId = null;

  // タイムアウトタイマー設定
  timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  // 外部シグナルが既に abort 済みなら即座に abort
  if (signal && signal.aborted) {
    controller.abort();
  }

  // 外部シグナルの abort をこちらの controller に伝播
  const onExternalAbort = () => {
    controller.abort();
  };
  if (signal) {
    signal.addEventListener('abort', onExternalAbort);
  }

  try {
    // --- fetch 実行 ---
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (fetchError) {
      // fetch 自体の失敗を分類
      if (fetchError.name === 'AbortError') {
        // AbortError: タイムアウトまたは外部シグナル
        // 外部シグナルが abort されていた場合もタイムアウトと同じ扱い
        throw new GeminiApiError(
          'timeout',
          'Gemini API リクエストがタイムアウトしました。',
        );
      }
      // その他の fetch 失敗（ネットワーク不通等）
      throw new GeminiApiError(
        'network',
        'Gemini API へのネットワーク接続に失敗しました。',
      );
    }

    // --- HTTP ステータス検査 ---
    if (!response.ok) {
      const status = response.status;
      const type = classifyHttpStatus(status);
      const message = messageForStatus(status, type);

      // ローカル開発時の原因特定用に、レスポンスボディから構造化された
      // クォータ・リトライ情報のみを安全に抽出して detail に付与する。
      // 抽出するのは以下の限定フィールドのみ（要件5.8 / Property 8）:
      //   - apiErrorStatus : error.status（例 "RESOURCE_EXHAUSTED"）
      //   - retryDelay     : RetryInfo の retryDelay
      //   - quotaViolations: QuotaFailure の violations（メトリクス情報のみ）
      // error.message（全文）や errorBody 全体は、API キー混入リスクを避けるため
      // 一切 detail に含めない。JSON でない等の場合は握りつぶし undefined にする
      // （既存テストには json() を持たないモックがあるため例外を投げてはいけない）。
      let detail;
      try {
        const errorBody = await response.json();
        const apiError = errorBody?.error;
        const details = Array.isArray(apiError?.details) ? apiError.details : [];
        const retryInfo = details.find(
          (d) => typeof d?.['@type'] === 'string' && d['@type'].includes('RetryInfo'),
        );
        const quotaFailure = details.find(
          (d) => typeof d?.['@type'] === 'string' && d['@type'].includes('QuotaFailure'),
        );
        detail = {
          apiErrorStatus: apiError?.status,
          retryDelay: retryInfo?.retryDelay,
          quotaViolations: Array.isArray(quotaFailure?.violations)
            ? quotaFailure.violations.map((v) => ({
                quotaMetric: v?.quotaMetric,
                quotaId: v?.quotaId,
                quotaValue: v?.quotaValue,
              }))
            : undefined,
        };
      } catch {
        detail = undefined;
      }

      throw new GeminiApiError(type, message, status, detail);
    }

    // --- 応答パース ---
    const json = await response.json();

    // candidates[0].content.parts[0].text を取得
    const text =
      json?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (typeof text !== 'string') {
      // ローカル開発時の原因特定用に、finishReason（SAFETY ブロック等）・promptFeedback・
      // candidate 数を detail に付与する。これらは Gemini の応答メタ情報であり
      // API キーを含まない（要件5.8）。
      throw new GeminiApiError(
        'server',
        'Gemini API の応答形式が不正です（テキスト部分が取得できませんでした）。',
        undefined,
        {
          reason: 'no_text_part',
          finishReason: json?.candidates?.[0]?.finishReason,
          promptFeedback: json?.promptFeedback,
          candidateCount: json?.candidates?.length ?? 0,
        },
      );
    }

    // JSON 文字列をパース
    // セキュリティ: SyntaxError のメッセージに生レスポンス断片が含まれないよう、
    // パース失敗時は GeminiApiError に変換して生データを遮断する（要件5.8）
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_parseError) {
      // ローカル開発時の原因特定用に、応答本文の長さと先頭300文字を detail に付与する。
      // text は Gemini の応答本文（モデル出力）であり API キーを含まない（要件5.8）。
      throw new GeminiApiError(
        'server',
        'Gemini API の応答形式が不正です（JSON パースに失敗しました）。',
        undefined,
        {
          reason: 'json_parse_failed',
          textLength: text.length,
          textSnippet: text.slice(0, 300),
        },
      );
    }
    return parsed;
  } finally {
    // タイマーとイベントリスナーをクリーンアップ
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    if (signal) {
      signal.removeEventListener('abort', onExternalAbort);
    }
  }
}
