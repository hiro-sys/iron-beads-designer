// =============================================================================
// アプリケーション状態管理（state.js）
// -----------------------------------------------------------------------------
// アプリケーション全体の状態（AppState）を一元管理するストアを提供する。
// 各種 setter で状態を更新し、変更があったときに購読中のリスナーへ通知する
// （subscribe / notify の簡易な仕組み）。main.js（タスク17.1）がこのストアを
// 購読し、状態変更に応じて図案の再生成・再描画・使用色一覧の更新をトリガーする。
//
// 設計書「アーキテクチャ > レイヤー構成（状態管理 = state.js）」および
// 「データモデル > AppState / BackgroundExclusionState / EditTool」に対応。
//
// Requirements:
//   - 2.1  : beadType の初期値はパーラービーズ（'perler'）
//   - 3.5  : plateConfig の初期値は 1x1（{ cols: 1, rows: 1 }）
//   - 5.3  : zoom は 50%（0.5）〜400%（4.0）の範囲にクランプする（Property 9）
//   - 10.1 : resizeMethod の初期値は「なめらか」（'smooth'）
//   - 10.4 : fitMode の初期値は「フィット」（'contain'）
//   - 11.3 : maxColors の初期値は「制限なし」（null）
// =============================================================================

/**
 * @typedef {'perler' | 'nano'} BeadType
 */

/**
 * @typedef {'image' | 'prompt'} InputMode
 */

/**
 * @typedef {Object} BackgroundExclusionState
 * @property {boolean} enabled - 背景除外の有効/無効（初期値: false、要件9.8）
 * @property {{r: number, g: number, b: number}|null} color - 検出/選択された背景色（生ピクセル色）
 * @property {number} threshold - ΔE閾値（初期値: 10、範囲: 0-50、要件9.3/9.4）
 * @property {boolean} autoDetected - 自動検出か手動選択か
 */

/**
 * @typedef {Object} EditTool
 * @property {'paint' | 'erase'} type - 'paint'=色を塗る / 'erase'=未配置にする（要件12.1）
 * @property {object|null} color - 'paint'時に塗る色（BeadColor）。'erase'時はnull
 */

/**
 * @typedef {Object} AppState
 * @property {BeadType} beadType - 選択中のビーズタイプ
 * @property {{cols: number, rows: number}} plateConfig - プレート構成
 * @property {HTMLImageElement|null} uploadedImage - アップロード画像
 * @property {object|null} pattern - 生成済み図案（PatternGrid）
 * @property {number} zoom - ズーム倍率 (0.5-4.0)
 * @property {object[]} recommendedSizes - 推奨サイズ一覧（RecommendedSize[]）
 * @property {BackgroundExclusionState} backgroundExclusion - 背景除外設定
 * @property {'smooth' | 'sharp'} resizeMethod - リサイズ方式
 * @property {'stretch' | 'contain' | 'cover'} fitMode - フィットモード
 * @property {string[]} disabledColorIds - 無効化された色ID
 * @property {number|null} maxColors - 最大色数（null = 制限なし）
 * @property {EditTool} editTool - 手動編集の現在のツール
 * @property {InputMode} inputMode - 入力方法（'image'=画像から / 'prompt'=AIお題から・初期値: 'image'）
 * @property {string|null} geminiApiKey - APIキー（セッションメモリのみ・初期値: null・要件5.1/5.4）
 * @property {string} geminiModel - 使用する Gemini モデル（セッションメモリのみ・初期値: 'gemini-2.5-flash'）
 * @property {boolean} aiProcessing - AI処理中フラグ（初期値: false・要件8.3/8.4）
 * @property {object|null} lastAiPattern - 直近のAI変換結果（初期値: null・要件8.2）
 * @property {string} aiPrompt - お題テキスト（AIお題生成のモチーフ・初期値: ''・メモリのみ）
 */

// --- ズーム範囲の定数（要件5.3 / Property 9） -------------------------------
/** ズーム下限（50%）。 */
export const ZOOM_MIN = 0.5;
/** ズーム上限（400%）。 */
export const ZOOM_MAX = 4.0;
/** ズーム初期値（100%）。 */
export const ZOOM_DEFAULT = 1.0;

// --- 列挙値の許可リスト（不正値ガード用） -----------------------------------
const VALID_BEAD_TYPES = ['perler', 'nano'];
const VALID_RESIZE_METHODS = ['smooth', 'sharp'];
const VALID_FIT_MODES = ['stretch', 'contain', 'cover'];
const VALID_EDIT_TOOL_TYPES = ['paint', 'erase'];
/** 入力方法の許可リスト（'image'=画像から / 'prompt'=AIお題から）。 */
export const VALID_INPUT_MODES = ['image', 'prompt'];

/**
 * @typedef {Object} GeminiModelOption
 * @property {string} id - APIモデルID（`models/` に続く識別子。generateContent に渡す）
 * @property {string} label - UI表示用のモデル名
 * @property {boolean} freeTier - 無料枠で利用できるか
 */

/**
 * 選択可能な Gemini モデル定義（お題テキスト生成 generateFromText 用）。
 *
 * 掲載するのは「テキスト入力 → 構造化JSON出力ができる汎用モデル」のみ。
 *
 * 新しいモデル（例: Gemini 3.x 系）を追加する場合は、Google AI Studio / 公式
 * ドキュメントで正確なAPIモデルID（`models/` に続く識別子）を確認し、id・label・
 * freeTier をここに1行追記してください。TTS・音声・Live・Robotics・Embedding など、
 * テキスト→JSON生成に使えないモデルは掲載しないこと。
 * @type {GeminiModelOption[]}
 */
export const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', freeTier: true },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', freeTier: true },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', freeTier: true },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', freeTier: false },
  { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash-Lite', freeTier: false },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', freeTier: false },
  { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', freeTier: false },
];

/**
 * 選択可能な Gemini モデルIDの許可リスト（不正値ガード用）。
 * GEMINI_MODELS の id から導出する。
 * @type {string[]}
 */
export const VALID_GEMINI_MODELS = GEMINI_MODELS.map((m) => m.id);

/** 背景除外のΔE閾値の範囲（要件9.4）。 */
const THRESHOLD_MIN = 0;
const THRESHOLD_MAX = 50;

/** プレート枚数の範囲（要件3.1/3.2）。 */
const PLATE_COUNT_MIN = 1;
const PLATE_COUNT_MAX = 10;

/**
 * 任意の数値をズーム範囲（ZOOM_MIN 〜 ZOOM_MAX）にクランプする純関数。
 *
 * Property 9（ズーム値のクランプ）の対象。あらゆる入力に対して、戻り値は必ず
 * [ZOOM_MIN, ZOOM_MAX] の範囲に収まる。
 *   - 範囲未満の値 → ZOOM_MIN（0.5）
 *   - 範囲超過の値 → ZOOM_MAX（4.0）
 *   - +Infinity   → ZOOM_MAX、-Infinity → ZOOM_MIN
 *   - NaN や数値化できない値 → ZOOM_DEFAULT（1.0、範囲内の安全な既定値）
 *
 * @param {number} value - クランプ対象の値
 * @returns {number} [ZOOM_MIN, ZOOM_MAX] に収めた値
 */
export function clampZoom(value) {
  const num = Number(value);
  // NaN（数値化できない入力を含む）は範囲内の既定値にフォールバックする。
  // これにより戻り値が NaN になって範囲外になることを防ぐ。
  if (Number.isNaN(num)) {
    return ZOOM_DEFAULT;
  }
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, num));
}

/**
 * 値を [min, max] の整数にクランプする内部ヘルパー（プレート枚数の正規化用）。
 * 非数値・小数は四捨五入し、範囲外はクランプする。
 *
 * @param {number} value - 対象値
 * @param {number} min - 下限
 * @param {number} max - 上限
 * @param {number} fallback - 数値化できない場合の既定値
 * @returns {number} 範囲内の整数
 */
function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(num)));
}

/**
 * 最大色数（maxColors）を正規化する。
 *   - null / undefined / '' / 'unlimited' → null（制限なし、要件11.3）
 *   - 1以上の整数として解釈できる値 → その整数
 *   - 0以下・非数値 → null（制限なし扱い）
 *
 * @param {number|string|null|undefined} value - 入力値
 * @returns {number|null} 正規化された最大色数
 */
function normalizeMaxColors(value) {
  if (value === null || value === undefined || value === '' || value === 'unlimited') {
    return null;
  }
  const num = Math.floor(Number(value));
  if (!Number.isFinite(num) || num < 1) {
    return null;
  }
  return num;
}

/**
 * AppState の初期値を持つ新しいオブジェクトを生成して返す。
 *
 * 呼び出しごとに独立したオブジェクト（plateConfig / backgroundExclusion /
 * editTool / 配列もそれぞれ新規生成）を返すため、テストや複数インスタンス間で
 * 状態が共有されることはない。
 *
 * 初期値（要件 2.1 / 3.5 / 10.1 / 10.4 / 11.3）:
 *   beadType='perler', plateConfig={cols:1,rows:1}, uploadedImage=null,
 *   pattern=null, zoom=1.0, recommendedSizes=[],
 *   backgroundExclusion={enabled:false,color:null,threshold:10,autoDetected:false},
 *   resizeMethod='smooth', fitMode='contain', disabledColorIds=[], maxColors=null,
 *   editTool={type:'paint',color:null}
 *
 * @returns {AppState} 初期状態
 */
export function createInitialState() {
  return {
    beadType: 'perler',
    plateConfig: { cols: 1, rows: 1 },
    uploadedImage: null,
    pattern: null,
    zoom: ZOOM_DEFAULT,
    recommendedSizes: [],
    backgroundExclusion: {
      enabled: false,
      color: null,
      threshold: 10,
      autoDetected: false,
    },
    resizeMethod: 'smooth',
    fitMode: 'contain',
    disabledColorIds: [],
    maxColors: null,
    editTool: { type: 'paint', color: null },
    // --- 入力方法・AI生成関連フィールド（メモリのみ保持・永続化しない） ---
    inputMode: 'image',
    geminiApiKey: null,
    geminiModel: 'gemini-2.5-flash',
    aiProcessing: false,
    lastAiPattern: null,
    // お題テキスト（AIお題生成のモチーフ）。メモリのみ・永続化しない。
    aiPrompt: '',
  };
}

/**
 * アプリケーション状態ストアを生成する。
 *
 * 返り値は以下を備える:
 *   - 各フィールドの getter（例: `store.beadType`、`store.disabledColorIds`）。
 *     UIコンポーネントは `state` 引数としてこのストアを受け取り、`state.xxx` で
 *     現在値を読み取る（design.md の各UI初期化関数の使い方に対応）。
 *   - 各種 setter。値を更新し、変化があればリスナーへ通知する。
 *   - `subscribe(listener)`: 変更通知の購読。解除用の関数を返す。
 *   - `getState()`: 現在状態の浅いスナップショット（外部からの破壊を防ぐ複製）。
 *
 * 変更通知の方針: setter は「値が実際に変化したとき」のみ通知する。これにより、
 * 同一値の再設定による無駄な再生成・再描画を避ける。リスナーには最新状態の
 * スナップショットを渡す。
 *
 * @param {Partial<AppState>} [overrides] - 初期値の上書き（主にテスト用）
 * @returns {object} 状態ストア
 */
export function createAppState(overrides = {}) {
  /** @type {AppState} */
  const state = { ...createInitialState(), ...overrides };

  /** @type {Set<function(AppState): void>} */
  const listeners = new Set();

  /**
   * 現在状態の浅いスナップショットを返す。
   * ネストしたオブジェクト・配列は複製し、外部からの直接変更で内部状態が
   * 壊れないようにする（pattern / uploadedImage は大きいため参照を共有する）。
   * @returns {AppState}
   */
  function getState() {
    return {
      beadType: state.beadType,
      plateConfig: { ...state.plateConfig },
      uploadedImage: state.uploadedImage,
      pattern: state.pattern,
      zoom: state.zoom,
      recommendedSizes: state.recommendedSizes,
      backgroundExclusion: { ...state.backgroundExclusion },
      resizeMethod: state.resizeMethod,
      fitMode: state.fitMode,
      disabledColorIds: [...state.disabledColorIds],
      maxColors: state.maxColors,
      editTool: { ...state.editTool },
      inputMode: state.inputMode,
      geminiApiKey: state.geminiApiKey,
      geminiModel: state.geminiModel,
      aiProcessing: state.aiProcessing,
      lastAiPattern: state.lastAiPattern,
      aiPrompt: state.aiPrompt,
    };
  }

  /**
   * 変更通知を購読する。
   * @param {function(AppState): void} listener - 状態変更時に呼ばれるコールバック
   * @returns {function(): void} 購読解除関数
   */
  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('subscribe には関数を渡してください');
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  /**
   * 全リスナーへ現在状態のスナップショットを通知する。
   * 通知中のリスナー追加・削除に備えてコピーしてからイテレートし、
   * 1つのリスナーの例外が他へ波及しないよう個別に握って継続する。
   */
  function notify() {
    const snapshot = getState();
    for (const listener of [...listeners]) {
      try {
        listener(snapshot);
      } catch (error) {
        // 1つのリスナーの失敗で全体の通知が止まらないようにする
        console.error('state リスナーの実行中にエラーが発生しました:', error);
      }
    }
  }

  /**
   * プリミティブ値フィールドを更新する共通ヘルパー。
   * 厳密等価で変化判定し、変化がある場合のみ更新＋通知する。
   * @param {keyof AppState} key - 更新対象のキー
   * @param {*} value - 新しい値
   * @returns {boolean} 変化して通知したら true
   */
  function setField(key, value) {
    if (state[key] === value) {
      return false;
    }
    state[key] = value;
    notify();
    return true;
  }

  // --- setter 群 -----------------------------------------------------------

  /**
   * ビーズタイプを設定する（要件2.1）。'perler' / 'nano' 以外は無視する。
   * @param {BeadType} beadType
   */
  function setBeadType(beadType) {
    if (!VALID_BEAD_TYPES.includes(beadType)) {
      return;
    }
    setField('beadType', beadType);
  }

  /**
   * プレート構成を設定する（要件3.5）。cols/rows は 1〜10 の整数に正規化する。
   * cols と rows の両方が現在値と同じ場合は通知しない。
   * オブジェクト（{cols, rows}）または個別引数のどちらでも受け付ける。
   * @param {number|{cols: number, rows: number}} colsOrConfig - 横枚数、または構成オブジェクト
   * @param {number} [rows] - 縦枚数（第1引数が数値のとき）
   */
  function setPlateConfig(colsOrConfig, rows) {
    let rawCols;
    let rawRows;
    if (colsOrConfig !== null && typeof colsOrConfig === 'object') {
      rawCols = colsOrConfig.cols;
      rawRows = colsOrConfig.rows;
    } else {
      rawCols = colsOrConfig;
      rawRows = rows;
    }

    const cols = clampInt(rawCols, PLATE_COUNT_MIN, PLATE_COUNT_MAX, state.plateConfig.cols);
    const nextRows = clampInt(rawRows, PLATE_COUNT_MIN, PLATE_COUNT_MAX, state.plateConfig.rows);

    if (state.plateConfig.cols === cols && state.plateConfig.rows === nextRows) {
      return;
    }
    state.plateConfig = { cols, rows: nextRows };
    notify();
  }

  /**
   * アップロード画像を設定する。
   * @param {HTMLImageElement|null} image
   */
  function setUploadedImage(image) {
    setField('uploadedImage', image ?? null);
  }

  /**
   * 生成済み図案（PatternGrid）を設定する。
   * @param {object|null} pattern
   */
  function setPattern(pattern) {
    setField('pattern', pattern ?? null);
  }

  /**
   * ズーム倍率を設定する（要件5.3 / Property 9）。値は 0.5〜4.0 にクランプする。
   * @param {number} zoom
   */
  function setZoom(zoom) {
    setField('zoom', clampZoom(zoom));
  }

  /**
   * 推奨サイズ一覧を設定する。
   * @param {object[]} sizes - RecommendedSize[]
   */
  function setRecommendedSizes(sizes) {
    setField('recommendedSizes', Array.isArray(sizes) ? sizes : []);
  }

  /**
   * 背景除外設定を部分的に更新する（要件9）。
   * 渡されたフィールドのみマージし、threshold は 0〜50 にクランプする。
   * いずれかのフィールドが実際に変化した場合のみ通知する。
   * @param {Partial<BackgroundExclusionState>} partial - 更新したいフィールド
   */
  function setBackgroundExclusion(partial) {
    if (partial === null || typeof partial !== 'object') {
      return;
    }

    const current = state.backgroundExclusion;
    const next = { ...current };

    if ('enabled' in partial) {
      next.enabled = Boolean(partial.enabled);
    }
    if ('color' in partial) {
      next.color = partial.color ?? null;
    }
    if ('threshold' in partial) {
      next.threshold = clampInt(
        partial.threshold,
        THRESHOLD_MIN,
        THRESHOLD_MAX,
        current.threshold,
      );
    }
    if ('autoDetected' in partial) {
      next.autoDetected = Boolean(partial.autoDetected);
    }

    const changed =
      next.enabled !== current.enabled ||
      next.color !== current.color ||
      next.threshold !== current.threshold ||
      next.autoDetected !== current.autoDetected;

    if (!changed) {
      return;
    }
    state.backgroundExclusion = next;
    notify();
  }

  /**
   * リサイズ方式を設定する（要件10.1）。'smooth' / 'sharp' 以外は無視する。
   * @param {'smooth' | 'sharp'} method
   */
  function setResizeMethod(method) {
    if (!VALID_RESIZE_METHODS.includes(method)) {
      return;
    }
    setField('resizeMethod', method);
  }

  /**
   * フィットモードを設定する（要件10.4）。'stretch'/'contain'/'cover' 以外は無視する。
   * @param {'stretch' | 'contain' | 'cover'} mode
   */
  function setFitMode(mode) {
    if (!VALID_FIT_MODES.includes(mode)) {
      return;
    }
    setField('fitMode', mode);
  }

  /**
   * 無効化色IDの一覧を設定する（要件11.2）。新しい配列で置き換え、必ず通知する。
   * @param {string[]} ids - 無効化する色IDの配列
   */
  function setDisabledColorIds(ids) {
    state.disabledColorIds = Array.isArray(ids) ? [...ids] : [];
    notify();
  }

  /**
   * 最大色数を設定する（要件11.3）。null/'unlimited'/空文字は制限なし（null）に正規化する。
   * @param {number|string|null} maxColors
   */
  function setMaxColors(maxColors) {
    setField('maxColors', normalizeMaxColors(maxColors));
  }

  /**
   * 手動編集ツールを設定する（要件12.1）。
   * type は 'paint' / 'erase' のみ許可し、'erase' のときは color を強制的に null にする。
   * @param {EditTool} tool - { type, color }
   */
  function setEditTool(tool) {
    if (tool === null || typeof tool !== 'object') {
      return;
    }
    if (!VALID_EDIT_TOOL_TYPES.includes(tool.type)) {
      return;
    }
    const next = {
      type: tool.type,
      color: tool.type === 'erase' ? null : (tool.color ?? null),
    };
    const current = state.editTool;
    if (current.type === next.type && current.color === next.color) {
      return;
    }
    state.editTool = next;
    notify();
  }

  // --- 入力方法・AI生成関連の setter（メモリのみ・永続化しない） -----------------------

  /**
   * 入力方法を設定する。'image'（画像から）/ 'prompt'（AIお題から）以外は無視する。
   * @param {InputMode} mode - 入力方法
   */
  function setInputMode(mode) {
    if (!VALID_INPUT_MODES.includes(mode)) {
      return;
    }
    setField('inputMode', mode);
  }

  /**
   * APIキーを設定する（要件3.5/3.6）。前後の空白を除去し、1文字以上なら保持する。
   * 空文字・空白のみの場合は現在のキーを変更せず false を返す。
   * いかなる永続ストレージにも書き込まない（メモリのみ・要件5.1/5.2）。
   * @param {string} rawKey - 入力された生のキー
   * @returns {boolean} 設定できたら true、空白のみで変更しなかったら false
   */
  function setGeminiApiKey(rawKey) {
    const trimmed = (typeof rawKey === 'string') ? rawKey.trim() : '';
    if (trimmed.length === 0) {
      return false;
    }
    setField('geminiApiKey', trimmed);
    return true;
  }

  /**
   * APIキーを破棄し、AI変換不可状態に戻す（要件5.5/5.6）。
   * いかなる永続ストレージにも書き込まない（メモリのみ）。
   */
  function clearGeminiApiKey() {
    setField('geminiApiKey', null);
  }

  /**
   * 使用する Gemini モデルを設定する。
   * 許可リスト（VALID_GEMINI_MODELS）以外の値は無視する。変化時のみ通知する。
   * いかなる永続ストレージにも書き込まない（メモリのみ）。
   * @param {string} model - モデル名（例: 'gemini-2.5-flash'）
   */
  function setGeminiModel(model) {
    if (!VALID_GEMINI_MODELS.includes(model)) {
      return;
    }
    setField('geminiModel', model);
  }

  /**
   * AI処理中フラグを設定する（要件8.3/8.4）。
   * 実行ボタンの有効/無効制御に用いる。
   * @param {boolean} processing - 処理中か
   */
  function setAiProcessing(processing) {
    setField('aiProcessing', Boolean(processing));
  }

  /**
   * 直近のAI変換結果を設定する（要件8.2の維持表示用）。
   * @param {object|null} pattern - AI変換の結果PatternGrid
   */
  function setLastAiPattern(pattern) {
    setField('lastAiPattern', pattern ?? null);
  }

  /**
   * お題テキスト（AIお題生成のモチーフ）を設定する。
   * 文字列ならそのまま保持し、非文字列は '' に正規化する。変化時のみ通知する。
   * いかなる永続ストレージにも書き込まない（メモリのみ）。
   * @param {string} text - お題テキスト（例「ねこ」「ハート」）
   */
  function setAiPrompt(text) {
    setField('aiPrompt', typeof text === 'string' ? text : '');
  }

  return {
    // --- getter（現在値の読み取り） ---
    get beadType() {
      return state.beadType;
    },
    get plateConfig() {
      return state.plateConfig;
    },
    get uploadedImage() {
      return state.uploadedImage;
    },
    get pattern() {
      return state.pattern;
    },
    get zoom() {
      return state.zoom;
    },
    get recommendedSizes() {
      return state.recommendedSizes;
    },
    get backgroundExclusion() {
      return state.backgroundExclusion;
    },
    get resizeMethod() {
      return state.resizeMethod;
    },
    get fitMode() {
      return state.fitMode;
    },
    get disabledColorIds() {
      return state.disabledColorIds;
    },
    get maxColors() {
      return state.maxColors;
    },
    get editTool() {
      return state.editTool;
    },
    get inputMode() {
      return state.inputMode;
    },
    get geminiApiKey() {
      return state.geminiApiKey;
    },
    get geminiModel() {
      return state.geminiModel;
    },
    get aiProcessing() {
      return state.aiProcessing;
    },
    get lastAiPattern() {
      return state.lastAiPattern;
    },
    get aiPrompt() {
      return state.aiPrompt;
    },

    // --- 状態スナップショット / 購読 ---
    getState,
    subscribe,

    // --- setter ---
    setBeadType,
    setPlateConfig,
    setUploadedImage,
    setPattern,
    setZoom,
    setRecommendedSizes,
    setBackgroundExclusion,
    setResizeMethod,
    setFitMode,
    setDisabledColorIds,
    setMaxColors,
    setEditTool,
    setInputMode,
    setGeminiApiKey,
    clearGeminiApiKey,
    setGeminiModel,
    setAiProcessing,
    setLastAiPattern,
    setAiPrompt,
  };
}
