// =============================================================================
// 国際化（i18n）モジュール（i18n.js）
// -----------------------------------------------------------------------------
// 【役割】
//   ブラウザのロケール設定（navigator.language）に基づき、UI表示言語を
//   日本語（ja）または英語（en, フォールバック既定）から選択する。
//
//   - 日本語ロケール（"ja", "ja-JP" 等、"ja" で始まる値）→ 日本語（ja）
//   - それ以外（未設定・取得不能・他言語）           → 英語（en）
//
//   本アプリはビルド時ではなく実行時（モジュール読み込み時）にロケールを判定する。
//   SSR等 window/navigator が存在しない環境では安全側に倒して 'en' を返す。
//
// 【使い方】
//   import { t, getLocale } from './i18n.js';
//   label.textContent = t('beadType.legend'); // => 'ビーズタイプ' or 'Bead type'
//   label.textContent = t('colorList.count', { count: 5 }); // => プレースホルダ差し替え
//
// 【辞書の方針】
//   - キーは「コンポーネント名.項目名」のドット区切りとする（衝突を避けるため）。
//   - プレースホルダは `{name}` 形式。t() の第2引数（object）で値を差し込む。
//   - 辞書に無いキーが指定された場合はキー文字列自体を返す（開発時に気づきやすくする）。
// =============================================================================

/** @typedef {'ja' | 'en'} Locale */

/** 既定ロケール（日本語以外はすべてこれにフォールバック）。 */
const DEFAULT_LOCALE = 'en';

/**
 * ブラウザのロケール設定から表示言語を判定する。
 *
 * navigator.language / navigator.languages の先頭が "ja" で始まる場合のみ
 * 日本語（'ja'）とし、それ以外はすべて英語（'en'）にフォールバックする。
 * navigator が利用できない環境（SSR等）では 'en' を返す。
 *
 * @returns {Locale} 判定されたロケール
 */
export function detectLocale() {
  if (typeof navigator === 'undefined') {
    return DEFAULT_LOCALE;
  }
  const raw =
    (Array.isArray(navigator.languages) && navigator.languages[0]) ||
    navigator.language ||
    '';
  return String(raw).toLowerCase().startsWith('ja') ? 'ja' : DEFAULT_LOCALE;
}

// モジュール読み込み時に一度だけ判定する（ページ内で言語設定が変わることは想定しない）。
let currentLocale = detectLocale();

/**
 * 現在の表示ロケールを返す。
 * @returns {Locale}
 */
export function getLocale() {
  return currentLocale;
}

/**
 * 表示ロケールを明示的に上書きする（テスト・デバッグ用）。
 * @param {Locale} locale
 */
export function setLocale(locale) {
  currentLocale = locale === 'ja' ? 'ja' : 'en';
}

// =============================================================================
// 辞書
// =============================================================================

/** @type {Record<string, Record<Locale, string>>} */
const DICTIONARY = {
  // --- ページ全体 -----------------------------------------------------------
  'app.title': { ja: 'Bead Pattern Maker', en: 'Bead Pattern Maker' },
  'app.subtitle': {
    ja: '画像をアップロードすると、パーラービーズ／ナノビーズの図案を自動生成します。',
    en: 'Upload an image to automatically generate a Perler Beads / Nano Beads pattern.',
  },
  'app.docTitle': {
    ja: 'Bead Pattern Maker - アイロンビーズ図案メーカー',
    en: 'Bead Pattern Maker - Fuse Bead Pattern Generator',
  },
  'app.footer': {
    ja: 'hirosys All rights reserved.',
    en: 'hirosys All rights reserved.',
  },

  // --- サイドバーの各パネル見出し ---------------------------------------------
  'panel.inputMode': { ja: '1. 入力方法', en: '1. Input Method' },
  'panel.upload': { ja: '1. 画像をアップロード', en: '1. Upload Image' },
  'panel.beadType': { ja: '2. ビーズタイプ', en: '2. Bead Type' },
  'panel.plateConfig': { ja: '3. プレート構成', en: '3. Plate Layout' },
  'panel.preprocess': { ja: '4. 画像の前処理', en: '4. Image Preprocessing' },
  'panel.paletteSelector': { ja: '5. 使用する色', en: '5. Colors to Use' },
  'panel.backgroundExclusion': { ja: '6. 背景除外', en: '6. Background Removal' },
  'panel.patternEditor': { ja: '7. 手動編集', en: '7. Manual Edit' },
  'panel.colorList': { ja: '使用色一覧', en: 'Used Colors' },

  // --- ズームボタン aria-label（index.html の静的属性、main.js から差し込む） ---
  'aria.zoomOut': { ja: '縮小', en: 'Zoom out' },
  'aria.zoomIn': { ja: '拡大', en: 'Zoom in' },

  // --- AI お題生成関連（inputModeToggle / apiKeyManager / modelSelector / aiPromptInput） --
  'ai.convertButton': { ja: 'お題から生成', en: 'Generate from prompt' },
  'ai.processingText': { ja: 'AI生成中...', en: 'Generating with AI...' },
  'ai.mode.image': { ja: '📷 画像から', en: '📷 From image' },
  'ai.mode.prompt': { ja: '✨ AIお題から', en: '✨ From AI prompt' },
  'ai.error.generic': { ja: 'AI生成に失敗しました。', en: 'AI generation failed.' },
  'ai.fallbackToImage': {
    ja: '画像アップロードに切り替える',
    en: 'Switch to image upload',
  },

  // --- apiKeyManager.js -----------------------------------------------------
  'apiKeyManager.heading': { ja: 'Gemini APIキー', en: 'Gemini API Key' },
  'apiKeyManager.placeholder': { ja: 'APIキーを入力', en: 'Enter API key' },
  'apiKeyManager.toggleTitle': {
    ja: 'APIキーの表示/非表示を切り替え',
    en: 'Toggle API key visibility',
  },
  'apiKeyManager.show': { ja: '表示', en: 'Show' },
  'apiKeyManager.hide': { ja: '非表示', en: 'Hide' },
  'apiKeyManager.setButton': { ja: '設定', en: 'Set' },
  'apiKeyManager.clearButton': { ja: '消去', en: 'Clear' },
  'apiKeyManager.setSuccess': { ja: 'APIキーを設定しました。', en: 'API key has been set.' },
  'apiKeyManager.setEmptyError': {
    ja: 'APIキーを入力してください。',
    en: 'Please enter an API key.',
  },
  'apiKeyManager.cleared': { ja: 'APIキーを消去しました。', en: 'API key has been cleared.' },
  'apiKeyManager.linkPrefix': { ja: 'APIキーの取得 → ', en: 'Get an API key → ' },
  'apiKeyManager.statusSet': {
    ja: '✓ APIキー設定済み — AI変換を利用できます',
    en: '✓ API key set — AI conversion is available',
  },
  'apiKeyManager.statusUnset': {
    ja: '✗ APIキーが未設定です — AI変換を利用するにはAPIキーの設定が必要です',
    en: '✗ No API key set — an API key is required to use AI conversion',
  },
  'apiKeyManager.notice1': {
    ja: 'APIキーはブラウザのメモリにのみ保持され、ページをリロードすると消去されます',
    en: 'The API key is kept only in browser memory and is cleared when the page reloads',
  },
  'apiKeyManager.notice2': {
    ja: 'APIキーを第三者と共有しないでください',
    en: 'Do not share your API key with third parties',
  },
  'apiKeyManager.notice3': {
    ja: 'Google AI Studio の無料枠・レート制限の範囲でご利用ください',
    en: 'Please stay within the free tier and rate limits of Google AI Studio',
  },

  // --- modelSelector.js -------------------------------------------------------
  'modelSelector.label': { ja: '使用するAIモデル', en: 'AI model to use' },
  'modelSelector.note': {
    ja: '※TTS・音声・Live系モデルは図案生成に使えないため掲載していません',
    en: 'Note: TTS, audio, and Live models are not listed as they cannot be used for pattern generation',
  },
  'modelSelector.groupFree': { ja: '無料枠で使える', en: 'Available on free tier' },
  'modelSelector.groupPaid': { ja: '無料枠では使えない', en: 'Not available on free tier' },
  'modelSelector.paidSuffix': { ja: '（無料枠不可）', en: ' (paid tier only)' },

  // --- aiPromptInput.js --------------------------------------------------------
  'aiPromptInput.label': { ja: 'お題（AIが描くモチーフ）', en: 'Prompt (motif for AI to draw)' },
  'aiPromptInput.placeholder': {
    ja: '例: ねこ / ハート / 星',
    en: 'e.g. cat / heart / star',
  },
  'aiPromptInput.notice': {
    ja: '入力したお題はGoogle（Gemini API）へ送信されます',
    en: 'The prompt you enter will be sent to Google (Gemini API)',
  },

  // --- messageForAiError.js ---------------------------------------------------
  'aiError.invalid_request': {
    ja: 'AIへのリクエスト内容が不正です。プレート構成やお題を変えて再試行してください。',
    en: 'The AI request was invalid. Try changing the plate layout or prompt and try again.',
  },
  'aiError.auth': {
    ja: 'APIキーの認証に失敗しました。キーを再確認してください。',
    en: 'API key authentication failed. Please check your key.',
  },
  'aiError.rate_limit': {
    ja: 'APIのレート制限に達しました。時間をおいて再試行してください。',
    en: 'The API rate limit has been reached. Please try again later.',
  },
  'aiError.server': {
    ja: 'AIサーバーでエラーが発生しました。時間をおいて再試行してください。',
    en: 'An error occurred on the AI server. Please try again later.',
  },
  'aiError.network': {
    ja: 'ネットワーク接続に失敗しました。接続を確認してください。',
    en: 'Network connection failed. Please check your connection.',
  },
  'aiError.timeout': {
    ja: 'AI変換がタイムアウトしました。時間をおいて再試行してください。',
    en: 'AI conversion timed out. Please try again later.',
  },
  'aiError.invalid_input': {
    ja: 'AI変換の入力が不正です。設定を確認してください。',
    en: 'The AI conversion input was invalid. Please check your settings.',
  },
  'aiError.no_api_key': {
    ja: 'APIキーが設定されていません。APIキー設定UIで設定してください。',
    en: 'No API key is set. Please set one in the API key settings.',
  },
  'aiError.no_response': {
    ja: 'AIからの応答を取得できませんでした。時間をおいて再試行してください。',
    en: 'Could not get a response from the AI. Please try again later.',
  },
  'aiError.invalid_format': {
    ja: 'AIの応答形式が不正です。時間をおいて再試行してください。',
    en: 'The AI response format was invalid. Please try again later.',
  },
  'aiError.grid_shape': {
    ja: 'AIの応答が図案の制約に適合しませんでした。時間をおいて再試行してください。',
    en: 'The AI response did not fit the pattern constraints. Please try again later.',
  },
  'aiError.default': {
    ja: 'AI変換中にエラーが発生しました。',
    en: 'An error occurred during AI conversion.',
  },

  // --- メイン表示エリア -------------------------------------------------------
  'zoom.group': { ja: 'ズーム操作', en: 'Zoom controls' },
  'zoom.out': { ja: '縮小', en: 'Zoom out' },
  'zoom.in': { ja: '拡大', en: 'Zoom in' },
  'export.button': { ja: 'PNGエクスポート', en: 'Export PNG' },
  'pattern.emptyMessage': {
    ja: '画像をアップロードして図案を生成してください。',
    en: 'Upload an image to generate a pattern.',
  },

  // --- imageUpload.js ---------------------------------------------------------
  'imageUpload.label': {
    ja: '画像ファイルを選択、またはここにドラッグ&ドロップ',
    en: 'Choose an image file, or drag and drop it here',
  },
  'imageUpload.previewAlt': {
    ja: 'アップロードした画像のプレビュー',
    en: 'Preview of the uploaded image',
  },
  'imageUpload.readError': {
    ja: '画像の読み込みに失敗しました。別のファイルを選択してください。',
    en: 'Failed to load the image. Please choose a different file.',
  },

  // --- utils/validation.js -----------------------------------------------------
  'validation.unsupportedFormat': {
    ja: '対応形式: JPEG、PNG、GIF、WebP',
    en: 'Supported formats: JPEG, PNG, GIF, WebP',
  },
  'validation.fileTooLarge': {
    ja: 'ファイルサイズは10MB以下にしてください',
    en: 'File size must be 10MB or less',
  },

  // --- beadConfig.js（ビーズタイプのラベル） -----------------------------------
  'beadConfig.perler': { ja: 'パーラービーズ', en: 'Perler Beads' },
  'beadConfig.nano': { ja: 'ナノビーズ', en: 'Nano Beads' },

  // --- beadTypeSelector.js -----------------------------------------------------
  'beadType.legend': { ja: 'ビーズタイプ', en: 'Bead type' },
  'beadType.paletteHeading': {
    ja: 'カラーパレット（{count}色）',
    en: 'Color palette ({count} colors)',
  },

  // --- plateConfig.js ----------------------------------------------------------
  'plateConfig.cols': { ja: '横（列）', en: 'Columns' },
  'plateConfig.rows': { ja: '縦（行）', en: 'Rows' },
  'plateConfig.confirmClear': {
    ja: 'プレート構成を変更すると、現在の図案データはクリアされます。変更しますか？',
    en: 'Changing the plate layout will clear the current pattern. Continue?',
  },

  // --- recommendedSizes.js ------------------------------------------------------
  'recommendedSizes.heading': { ja: 'おすすめサイズ', en: 'Recommended sizes' },
  'recommendedSizes.noImage': {
    ja: '画像をアップロードすると、おすすめのプレート構成が表示されます。',
    en: 'Upload an image to see recommended plate layouts.',
  },
  'recommendedSizes.noResult': {
    ja: 'おすすめサイズを計算できませんでした。',
    en: 'Could not calculate recommended sizes.',
  },
  'recommendedSizes.totalBeads': {
    ja: '総ビーズ数: {count}個',
    en: 'Total beads: {count}',
  },
  'recommendedSizes.scale': { ja: '縮小率: {percent}', en: 'Scale: {percent}' },

  // --- paletteSelector.js --------------------------------------------------------
  'paletteSelector.heading': {
    ja: '使用する色（有効 {active} / 全 {total} 色）',
    en: 'Colors to use ({active} / {total} enabled)',
  },
  'paletteSelector.maxColorsLabel': { ja: '最大色数', en: 'Max colors' },
  'paletteSelector.maxColorsPlaceholder': { ja: '制限なし', en: 'No limit' },
  'paletteSelector.maxColorsHintUnlimited': { ja: '（制限なし）', en: '(No limit)' },
  'paletteSelector.maxColorsHintLimited': {
    ja: '（最大 {count} 色）',
    en: '(Up to {count} colors)',
  },
  'paletteSelector.enabled': { ja: '有効', en: 'enabled' },
  'paletteSelector.disabled': { ja: '無効', en: 'disabled' },
  'paletteSelector.emptyError': {
    ja: '最低1色を有効にしてください',
    en: 'Please enable at least one color',
  },

  // --- backgroundExclusion.js -----------------------------------------------------
  'backgroundExclusion.toggleLabel': { ja: '背景除外', en: 'Remove background' },
  'backgroundExclusion.colorLabel': { ja: '背景色:', en: 'Background color:' },
  'backgroundExclusion.hint': {
    ja: '画像プレビューをクリックすると、その位置の色で背景色を変更できます。',
    en: 'Click the image preview to set the background color from that spot.',
  },
  'backgroundExclusion.thresholdLabel': { ja: 'ΔE閾値:', en: 'ΔE threshold:' },
  'backgroundExclusion.excludedCount': {
    ja: '除外セル: {excluded}個 ({percent}%)',
    en: 'Excluded cells: {excluded} ({percent}%)',
  },
  'backgroundExclusion.excludedCountEmpty': { ja: '除外セル: -', en: 'Excluded cells: -' },
  'backgroundExclusion.autoDetected': { ja: '自動検出', en: 'Auto-detected' },
  'backgroundExclusion.manual': { ja: '手動選択', en: 'Manual' },
  'backgroundExclusion.swatchSource': {
    ja: '{source}: rgb({r}, {g}, {b})',
    en: '{source}: rgb({r}, {g}, {b})',
  },
  'backgroundExclusion.noColor': {
    ja: '背景色が未検出です。画像をクリックして選択してください。',
    en: 'No background color detected. Click the image to select one.',
  },

  // --- patternEditor.js --------------------------------------------------------
  'patternEditor.heading': { ja: '編集ツール', en: 'Edit tools' },
  'patternEditor.eraser': { ja: '消しゴム（未配置）', en: 'Eraser (clear)' },

  // --- colorList.js -------------------------------------------------------------
  'colorList.summary': { ja: '合計: {count}個', en: 'Total: {count}' },
  'colorList.count': { ja: '{count}個', en: '{count}' },
  'colorList.unplaced': {
    ja: '未配置: {excluded}個 ({percent}%)',
    en: 'Unplaced: {excluded} ({percent}%)',
  },

  // --- exporter.js ---------------------------------------------------------------
  'exporter.listTitle': {
    ja: '使用色一覧（合計: {count}個）',
    en: 'Used Colors (Total: {count})',
  },
  'exporter.entry': { ja: '{name}  {count}個', en: '{name}  {count}' },
  'exporter.noBeadsMessage': {
    ja: 'ビーズが1つも配置されていないため、エクスポートできません。',
    en: 'No beads have been placed, so the pattern cannot be exported.',
  },
  'exporter.success': { ja: 'PNG画像をエクスポートしました。', en: 'PNG image exported.' },
  'exporter.failGeneric': { ja: 'エクスポートに失敗しました。', en: 'Export failed.' },
  'exporter.failImage': {
    ja: 'エクスポートに失敗しました。画像の生成に失敗しました。',
    en: 'Export failed. Could not generate the image.',
  },
  'exporter.failSave': {
    ja: 'エクスポートに失敗しました。ファイルの保存に失敗しました。',
    en: 'Export failed. Could not save the file.',
  },

  // --- main.js（結線・メッセージ） ------------------------------------------------
  'main.noActiveColor': {
    ja: '最低1色を有効にしてください。',
    en: 'Please enable at least one color.',
  },
  'main.generateError': {
    ja: '図案の生成に失敗しました。設定を確認してください。',
    en: 'Failed to generate the pattern. Please check your settings.',
  },
  'main.noPatternError': {
    ja: '図案がまだ生成されていません。',
    en: 'No pattern has been generated yet.',
  },
  'main.exportError': { ja: 'エクスポートに失敗しました。', en: 'Export failed.' },
  'main.resizeSmooth': { ja: 'なめらか（平均化）', en: 'Smooth (averaged)' },
  'main.resizeSharp': { ja: 'くっきり（最近傍）', en: 'Sharp (nearest neighbor)' },
  'main.resizeMethodLabel': { ja: 'リサイズ方式', en: 'Resize method' },
  'main.fitStretch': { ja: '伸縮', en: 'Stretch' },
  'main.fitContain': { ja: 'フィット（余白を未配置）', en: 'Fit (empty margins unplaced)' },
  'main.fitCover': { ja: 'クロップ', en: 'Cover (crop)' },
  'main.fitModeLabel': { ja: 'フィットモード', en: 'Fit mode' },
};

/**
 * プレースホルダ（`{name}`）を values の値で置き換える。
 * @param {string} template - `{name}` を含む文字列
 * @param {Record<string, string|number>} [values] - 差し込む値
 * @returns {string} 置き換え後の文字列
 */
function interpolate(template, values) {
  if (!values) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in values ? String(values[key]) : match,
  );
}

/**
 * 指定キーの表示文字列を、現在のロケールに従って返す。
 *
 * 辞書に該当キーが存在しない場合はキー文字列自体を返す（未翻訳箇所を
 * 開発時に発見しやすくするためのフォールバック）。
 *
 * @param {string} key - 辞書キー（例: 'beadType.legend'）
 * @param {Record<string, string|number>} [values] - プレースホルダに差し込む値
 * @returns {string} 翻訳済み文字列
 */
export function t(key, values) {
  const entry = DICTIONARY[key];
  if (!entry) {
    return key;
  }
  const template = entry[currentLocale] ?? entry.en ?? entry.ja ?? key;
  return interpolate(template, values);
}

/**
 * ビーズ色レコード（{ name, nameEn }）から、現在ロケールに応じた表示名を返す。
 *
 * 日本語ロケールでは `name`（公式カラーリスト準拠の日本語名）を、それ以外では
 * `nameEn`（英語参考訳）を優先して返す。`nameEn` が未定義の場合は `name` に
 * フォールバックする（データ未整備でも表示が欠落しないようにする）。
 *
 * @param {{name?: string, nameEn?: string}|null|undefined} color - ビーズ色レコード
 * @returns {string} 表示用の色名（該当が無ければ空文字列）
 */
export function getColorName(color) {
  if (!color) {
    return '';
  }
  if (currentLocale === 'ja') {
    return color.name ?? color.nameEn ?? '';
  }
  return color.nameEn ?? color.name ?? '';
}
