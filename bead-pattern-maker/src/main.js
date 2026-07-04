// =============================================================================
// メインエントリポイント（main.js） — アプリ全体の結線（wiring）
// -----------------------------------------------------------------------------
// 各レイヤー（状態管理・変換エンジン・描画・エクスポート・UIコンポーネント）を
// 1つのアプリケーションとして結線する。state を中心に据えた一方向データフローで、
// 「状態変更 → 図案生成（LocalConversionStrategy）→ Canvas描画 → 使用色一覧更新」
// の一連を配線する。
//
// 【データフローの設計（無限ループの回避）】
//   - state.subscribe には「描画専用」のリスナー（renderView）のみを登録する。
//     renderView は state を一切変更しない（setter を呼ばない）ため、再帰的な
//     通知ループは発生しない。
//   - 図案の再生成（generatePattern）は各UIコンポーネントのコールバック
//     （onImageLoaded / onPlateConfigChange / onSelectionChange など）から明示的に
//     呼ぶ。generatePattern は state.setPattern を呼び、その通知で renderView が
//     走って Canvas と使用色一覧が更新される。
//
// 結線する要件:
//   - 4.4  : 図案生成完了時にグリッド表示
//   - 4.8  : 生成失敗時にエラー表示＋前回図案を保持（try-catch）
//   - 5.3  : ズーム（50%〜400%）＋表示領域超過時のスクロール
//   - 5.4  : 図案セルのホバーで色名ツールチップ表示／離脱で非表示
//   - 5.5  : 図案未生成時のメッセージ表示
//   - 7.1  : PNGエクスポート
//   - 10.1 : リサイズ方式の選択UI（なめらか／くっきり）
//   - 10.4 : フィットモードの選択UI（伸縮／フィット／クロップ）
//   - 10.8 : リサイズ方式・フィットモード変更時に図案を再生成
//   - 11.6 : 使用パレット・最大色数の変更時に図案を再生成
// =============================================================================

import './style.css';

import { createAppState } from './state.js';
import { localConversionStrategy } from './engine/LocalConversionStrategy.js';
import { aiConversionStrategy } from './engine/AIConversionStrategy.js';
import { renderPattern } from './renderer/canvasRenderer.js';
import { exportAsPng } from './renderer/exporter.js';
import { renderColorList, calculateUsedColors } from './ui/colorList.js';

import { initImageUploadUI } from './ui/imageUpload.js';
import { initBeadTypeSelectorUI } from './ui/beadTypeSelector.js';
import { initPlateConfigUI } from './ui/plateConfig.js';
import { initRecommendedSizesUI } from './ui/recommendedSizes.js';
import { initPaletteSelectorUI } from './ui/paletteSelector.js';
import { initBackgroundExclusionUI } from './ui/backgroundExclusion.js';
import { initPatternEditorUI, canvasPointToCell } from './ui/patternEditor.js';
import { initInputModeToggleUI } from './ui/inputModeToggle.js';
import { initApiKeyManagerUI } from './ui/apiKeyManager.js';
import { initModelSelectorUI } from './ui/modelSelector.js';
import { initAiPromptInputUI } from './ui/aiPromptInput.js';

import { BEAD_CONFIG } from './data/beadConfig.js';
import { getAiErrorKey } from './utils/messageForAiError.js';
import { t, getColorName, getLocale } from './i18n.js';

// --- ロケール反映（<html lang> とタイトルをロケールに合わせる） -------------
document.documentElement.lang = getLocale();
document.title = t('app.docTitle');

/**
 * index.html に静的に書かれた（ビルド時点では日本語固定の）見出し・ラベル・
 * aria 属性を、現在ロケールの翻訳文字列に差し替える。
 * 各要素は id で一意に取得できるよう index.html 側にあらかじめ付与している。
 * 要素が存在しない（テスト環境等でDOM構造が異なる）場合は安全に無視する。
 */
function applyStaticTranslations() {
  const setText = (id, key) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = t(key);
    }
  };
  const setAriaLabel = (id, key) => {
    const el = document.getElementById(id);
    if (el) {
      el.setAttribute('aria-label', t(key));
    }
  };

  setText('app-title', 'app.title');
  setText('app-subtitle', 'app.subtitle');
  setText('panel-title-input-mode', 'panel.inputMode');
  setText('panel-title-bead-type', 'panel.beadType');
  setText('panel-title-plate-config', 'panel.plateConfig');
  setText('panel-title-preprocess', 'panel.preprocess');
  setText('panel-title-palette-selector', 'panel.paletteSelector');
  setText('panel-title-background-exclusion', 'panel.backgroundExclusion');
  setText('panel-title-pattern-editor', 'panel.patternEditor');
  setText('panel-title-color-list', 'panel.colorList');
  setText('export-btn', 'export.button');
  setText('pattern-empty-message', 'pattern.emptyMessage');
  setText('footer-text', 'app.footer');
  setText('ai-text-convert-btn', 'ai.convertButton');
  setText('ai-processing-text', 'ai.processingText');
  setAriaLabel('zoom-group', 'zoom.group');
  setAriaLabel('zoom-out-btn', 'zoom.out');
  setAriaLabel('zoom-in-btn', 'zoom.in');
}

applyStaticTranslations();

// --- 定数 --------------------------------------------------------------------

/**
 * 1セルの基本ピクセルサイズ（ズーム1.0時）。
 * canvasRenderer.js の DEFAULT_CELL_SIZE および patternEditor の cellSize と揃える。
 * 座標変換（canvasPointToCell）と描画（renderPattern）で同じ値を使う必要がある。
 * @type {number}
 */
const BASE_CELL_SIZE = 10;

/** ズームボタン・ホイール1操作あたりの増減量。 */
const ZOOM_STEP = 0.25;

/** エクスポート時の1セルサイズ（要件7.1: 最低20px）。 */
const EXPORT_CELL_SIZE = 20;

/** メッセージの自動消去時間（ミリ秒）。 */
const MESSAGE_TIMEOUT_MS = 4000;

/** お題テキスト生成のタイムアウト（ミリ秒）。thinking 有効で大きいグリッドは時間がかかるため長め（5分）に設定する。 */
const AI_TEXT_TIMEOUT_MS = 300000;

// --- DOM要素の取得 -----------------------------------------------------------

const imageUploadContainer = document.querySelector('#image-upload-container');
const beadTypeContainer = document.querySelector('#bead-type-container');
const plateConfigContainer = document.querySelector('#plate-config-container');
const recommendedSizesContainer = document.querySelector('#recommended-sizes-container');
const preprocessContainer = document.querySelector('#preprocess-container');
const paletteSelectorContainer = document.querySelector('#palette-selector-container');
const backgroundExclusionContainer = document.querySelector('#background-exclusion-container');
const patternEditorToolsContainer = document.querySelector('#pattern-editor-tools-container');
const colorListContainer = document.querySelector('#color-list-container');

// --- 入力方法・AI生成関連の DOM 要素 -----------------------------------------
const inputModeToggleContainer = document.querySelector('#input-mode-toggle-container');
const imageInputGroup = document.querySelector('#image-input-group');
const aiInputGroup = document.querySelector('#ai-input-group');
const apiKeyContainer = document.querySelector('#api-key-container');
const aiModelContainer = document.querySelector('#ai-model-container');
const aiPromptContainer = document.querySelector('#ai-prompt-container');
const aiTextConvertBtn = document.querySelector('#ai-text-convert-btn');
const aiProcessingIndicator = document.querySelector('#ai-processing-indicator');

const previewCanvas = document.querySelector('#preview-canvas');
const patternCanvas = document.querySelector('#pattern-canvas');
const patternViewport = document.querySelector('#pattern-viewport');
const emptyMessageEl = document.querySelector('#pattern-empty-message');
const messageEl = document.querySelector('#pattern-message');

const zoomInBtn = document.querySelector('#zoom-in-btn');
const zoomOutBtn = document.querySelector('#zoom-out-btn');
const zoomLevelEl = document.querySelector('#zoom-level');
const exportBtn = document.querySelector('#export-btn');

// --- アプリケーション状態 -----------------------------------------------------

const state = createAppState();

// UIコンポーネントのハンドル。コールバック内で相互参照するため、初期化前に
// 宣言だけしておき（前方参照）、全初期化の完了後にユーザー操作で発火させる。
let beadTypeHandle;
let plateConfigHandle;
let recommendedSizesHandle;
let paletteSelectorHandle;
let backgroundExclusionHandle;
let patternEditorHandle;
// eslint-disable-next-line no-unused-vars
let imageUploadHandle;
// eslint-disable-next-line no-unused-vars
let inputModeToggleHandle;
// eslint-disable-next-line no-unused-vars
let apiKeyManagerHandle;
// eslint-disable-next-line no-unused-vars
let modelSelectorHandle;
// eslint-disable-next-line no-unused-vars
let aiPromptInputHandle;

// =============================================================================
// メッセージ表示（情報／エラー）
// -----------------------------------------------------------------------------
// 図案表示領域の上部に、エクスポート結果や生成失敗（要件4.8）などのメッセージを
// 表示する。エラーは赤テキスト（CSS）で示し、一定時間後に自動消去する。
// =============================================================================

let messageTimerId = null;

/**
 * メッセージを表示する。
 * @param {string} text - 表示文言
 * @param {'info' | 'error'} [type] - 種別（'error' は赤テキスト）
 */
function showMessage(text, type = 'info') {
  if (!messageEl) {
    return;
  }
  messageEl.textContent = text;
  messageEl.className = text
    ? `pattern-message pattern-message--${type} is-visible`
    : 'pattern-message';

  if (messageTimerId !== null) {
    clearTimeout(messageTimerId);
    messageTimerId = null;
  }
  if (text) {
    messageTimerId = setTimeout(clearMessage, MESSAGE_TIMEOUT_MS);
  }
}

/**
 * 表示中のメッセージを消去する。
 */
function clearMessage() {
  if (messageTimerId !== null) {
    clearTimeout(messageTimerId);
    messageTimerId = null;
  }
  if (messageEl) {
    messageEl.textContent = '';
    messageEl.className = 'pattern-message';
  }
}

// =============================================================================
// 図案生成（状態 → LocalConversionStrategy → state.setPattern）
// =============================================================================

/**
 * 現在の状態から図案を生成し、state.pattern を更新する。
 *
 * フロー（要件4.4 / 11.6 / 10.8 / 9.9）:
 *   1. 画像が無ければ何もしない（未生成メッセージは renderView が表示）。
 *   2. 有効パレットが0色なら生成をブロックする（要件11.5）。
 *   3. width = cols×pegCount, height = rows×pegCount を算出する。
 *   4. localConversionStrategy.convert を呼び、生成した図案を state.setPattern する。
 *      setPattern の通知で renderView が走り、Canvas描画と使用色一覧更新が行われる。
 *   5. 生成に失敗（例外）した場合はエラーメッセージを表示し、前回図案を保持する
 *      （state.pattern を変更しない・要件4.8）。
 */
function generatePattern() {
  const image = state.uploadedImage;
  if (!image) {
    // 画像未アップロード。未生成メッセージの表示は renderView が担う（要件5.5）。
    return;
  }

  // 要件11.5: 有効な色が1色も無い場合は生成しない（paletteSelector がメッセージ表示）。
  if (!paletteSelectorHandle || !paletteSelectorHandle.canGenerate()) {
    showMessage(t('main.noActiveColor'), 'error');
    return;
  }

  const activePalette = paletteSelectorHandle.getActivePalette();
  const { cols, rows } = state.plateConfig;
  const pegCount = (BEAD_CONFIG[state.beadType] || BEAD_CONFIG.perler).pegCount;
  const width = cols * pegCount;
  const height = rows * pegCount;

  try {
    const pattern = localConversionStrategy.convert(image, {
      width,
      height,
      activePalette,
      resizeMethod: state.resizeMethod,
      fitMode: state.fitMode,
      maxColors: state.maxColors,
      beadType: state.beadType,
      plateConfig: { cols, rows },
      backgroundExclusion: state.backgroundExclusion,
    });

    // 生成成功。以前のエラーメッセージがあれば消し、図案を反映する（要件4.4）。
    clearMessage();
    state.setPattern(pattern);
  } catch (error) {
    // 要件4.8: 生成失敗時はエラーメッセージを表示し、前回図案（state.pattern）を保持する。
    // state.pattern を変更しないため、直前の図案は画面に残る。
    console.error('図案の生成に失敗しました:', error);
    showMessage(t('main.generateError'), 'error');
  }
}

// =============================================================================
// AI生成の実行（applyInputModeVisibility / updateAiButtonState / showLocalFallbackAffordance）
// -----------------------------------------------------------------------------
// 入力方法（inputMode）に応じた入力グループの表示切替と、お題から生成ボタンの
// 有効/無効制御を担う。
// =============================================================================

/**
 * 入力方法（state.inputMode）に応じて入力グループの表示/非表示を切り替える。
 *   - 'image'  : 画像入力グループ（#image-input-group）を表示し、AI入力グループを隠す
 *   - 'prompt' : AIお題入力グループ（#ai-input-group）を表示し、画像入力グループを隠す
 */
function applyInputModeVisibility() {
  const promptMode = state.inputMode === 'prompt';
  if (imageInputGroup) imageInputGroup.hidden = promptMode;
  if (aiInputGroup) aiInputGroup.hidden = !promptMode;
}

/**
 * お題から生成ボタンの有効/無効状態を更新する。
 *
 * お題から生成ボタン（#ai-text-convert-btn）の有効条件（すべて満たす場合のみ有効・画像は不要）:
 *   - 入力方法が 'prompt'（AIお題から）
 *   - APIキーが設定済み（null でない）
 *   - お題（state.aiPrompt）が trim 後1文字以上
 *   - 有効パレットが1色以上（paletteSelectorHandle.canGenerate()）
 *   - AI処理中でない
 *
 * @returns {void}
 */
function updateAiButtonState() {
  const promptMode = state.inputMode === 'prompt';
  const hasKey = state.geminiApiKey !== null;
  const canUsePalette = Boolean(paletteSelectorHandle && paletteSelectorHandle.canGenerate());
  const notProcessing = !state.aiProcessing;

  // お題から生成ボタン: 画像は不要。お題が trim 後1文字以上であること。
  if (aiTextConvertBtn) {
    const hasPrompt =
      typeof state.aiPrompt === 'string' && state.aiPrompt.trim().length > 0;
    const canExecuteText =
      promptMode &&
      hasKey &&
      hasPrompt &&
      canUsePalette &&
      notProcessing;
    aiTextConvertBtn.disabled = !canExecuteText;
  }

  // 処理中インジケータの表示制御
  if (aiProcessingIndicator) {
    aiProcessingIndicator.hidden = !state.aiProcessing;
  }
}

/**
 * 画像アップロードへの切り替え導線を表示する。
 *
 * AIお題生成が失敗した際に、「画像アップロードに切り替える」ボタンを含むメッセージを
 * 表示し、押下で入力方法を画像に切り替えて（画像があれば）ローカル変換で生成する。
 */
function showLocalFallbackAffordance() {
  if (!messageEl) return;

  // 既存のタイムアウトを消す
  if (messageTimerId !== null) {
    clearTimeout(messageTimerId);
    messageTimerId = null;
  }

  messageEl.textContent = '';
  messageEl.className = 'pattern-message pattern-message--error is-visible';

  const textSpan = document.createElement('span');
  textSpan.textContent = t('ai.error.generic');

  const fallbackBtn = document.createElement('button');
  fallbackBtn.type = 'button';
  fallbackBtn.className = 'btn btn--link';
  fallbackBtn.textContent = t('ai.fallbackToImage');
  fallbackBtn.addEventListener('click', () => {
    // 画像入力モードに切り替えてUIを同期し、画像があればローカル変換で生成する。
    state.setInputMode('image');
    if (inputModeToggleHandle) inputModeToggleHandle.refresh();
    applyInputModeVisibility();
    updateAiButtonState();
    generatePattern();
  });

  messageEl.appendChild(textSpan);
  messageEl.appendChild(document.createTextNode(' '));
  messageEl.appendChild(fallbackBtn);
}

/**
 * お題テキストから図案ドット絵を生成する非同期関数。
 *
 * 画像アップロード不要で、ユーザーが入力したお題（state.aiPrompt）から AIが
 * ドット絵を生成する。AIの得意分野（テキストからの創造的生成）を活かす機能。
 *
 * フロー:
 *   1. ガード条件（キー設定済 / お題が trim 後1文字以上 / 有効色>0 / 処理中でない）。画像は不要。
 *   2. setAiProcessing(true) → UI更新
 *   3. aiConversionStrategy.generateFromText(state.aiPrompt, aiOptions) を実行
 *   4. 成功で state.setPattern / setLastAiPattern（描画は購読リスナーが実行）
 *   5. 失敗時は直近図案を保持し、フォールバック導線を提示
 *   6. finally で setAiProcessing(false) → UI更新
 *
 * お題生成では画像を送らないため、画像送信に関する同意ステップは不要。
 */
async function runAiTextConversion() {
  // --- ガード条件（画像は不要） ---
  if (state.geminiApiKey === null) return;
  const subject = typeof state.aiPrompt === 'string' ? state.aiPrompt.trim() : '';
  if (subject.length === 0) return;
  if (!paletteSelectorHandle || !paletteSelectorHandle.canGenerate()) return;
  if (state.aiProcessing) return;

  // お題生成では画像を送らないため、画像送信に関する同意ステップは介在させない。

  // --- 処理中状態の設定（要件8.3） ---
  state.setAiProcessing(true);
  updateAiButtonState();

  // --- オプション構築 ---
  const activePalette = paletteSelectorHandle.getActivePalette();
  const { cols, rows } = state.plateConfig;
  const pegCount = (BEAD_CONFIG[state.beadType] || BEAD_CONFIG.perler).pegCount;
  const width = cols * pegCount;
  const height = rows * pegCount;

  const aiOptions = {
    width,
    height,
    activePalette,
    maxColors: state.maxColors,
    beadType: state.beadType,
    plateConfig: { cols, rows },
    apiKey: state.geminiApiKey,
    model: state.geminiModel,
    // お題生成は thinking 有効（精度重視）で大きいグリッドは時間がかかるため、
    // タイムアウトを長め（5分）に設定する（geminiClient の既定60秒より延長する）。
    timeoutMs: AI_TEXT_TIMEOUT_MS,
    // ローカル開発時（vite dev）のみ AI応答グリッドの統計デバッグログを出す。
    // 本番ビルドでは import.meta.env.DEV が false のため何も出力されない（要件5.8維持）。
    debug: import.meta.env?.DEV,
  };

  try {
    // お題（state.aiPrompt）を渡す。検証（trim 後1文字以上）は generateFromText 側でも行う。
    const result = await aiConversionStrategy.generateFromText(state.aiPrompt, aiOptions);
    // 成功: 図案を反映（描画は state.subscribe の renderView が担う）。
    clearMessage();
    state.setPattern(result);
    state.setLastAiPattern(result);
  } catch (error) {
    // 失敗: 直近図案を保持し、フォールバック導線を表示する。
    // セキュリティ: 生レスポンス・API キーをログ出力しない（要件5.8 / Property 8）。
    if (import.meta.env?.DEV) {
      // ローカル開発時のみ: 原因特定用の詳細ログを出力する（API キーは含めない）。
      console.error('[AIお題生成 失敗・詳細]', {
        name: error?.name,
        type: error?.type,
        status: error?.status,
        message: error?.message,
        detail: error?.detail,
      });
    } else {
      // 本番ビルド: エラー種別のみ（生レスポンス・API キーを出さない）。
      console.error('AIお題生成に失敗しました:', error?.type || 'unknown');
    }
    showMessage(t(getAiErrorKey(error)), 'error');
    showLocalFallbackAffordance();
  } finally {
    // 処理中状態を解除（要件8.4）
    state.setAiProcessing(false);
    updateAiButtonState();
  }
}

// =============================================================================
// 描画（renderView） — state.subscribe に登録する唯一のリスナー
// -----------------------------------------------------------------------------
// state が変化するたびに呼ばれ、現在の state.pattern を Canvas に描画し、
// 使用色一覧を更新する。state を変更しないので通知の再帰は起きない。
// =============================================================================

/**
 * 現在の状態に基づいて図案 Canvas・使用色一覧・ズーム表示・未生成メッセージを更新する。
 */
function renderView() {
  // ズーム率表示を更新する（要件5.3）。
  if (zoomLevelEl) {
    zoomLevelEl.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  const pattern = state.pattern;

  if (pattern) {
    // 図案あり: Canvas を表示して描画し、使用色一覧を更新する（要件4.4, 6.1）。
    if (emptyMessageEl) emptyMessageEl.hidden = true;
    if (patternCanvas) patternCanvas.hidden = false;

    renderPattern(patternCanvas, pattern, {
      cellSize: BASE_CELL_SIZE,
      zoom: state.zoom,
      showGrid: true,
      showPlateBorders: true,
    });
    renderColorList(colorListContainer, pattern);

    if (exportBtn) exportBtn.disabled = false;
  } else {
    // 図案なし: 未生成メッセージを表示する（要件5.5）。
    if (patternCanvas) patternCanvas.hidden = true;
    if (emptyMessageEl) emptyMessageEl.hidden = false;
    renderColorList(colorListContainer, null);

    if (exportBtn) exportBtn.disabled = true;
  }

  // お題から生成ボタンの有効/無効を同期する。
  updateAiButtonState();
}

// =============================================================================
// ツールチップ（要件5.4） — 図案セルのホバーで色名を表示
// =============================================================================

// body 直下に配置するツールチップ要素（position: fixed でカーソル付近に表示）。
const tooltipEl = document.createElement('div');
tooltipEl.className = 'cell-tooltip';
tooltipEl.setAttribute('role', 'tooltip');
tooltipEl.hidden = true;
document.body.appendChild(tooltipEl);

/**
 * ツールチップを指定位置（カーソル付近）に表示する。
 * @param {number} clientX - カーソルのX座標（ビューポート基準）
 * @param {number} clientY - カーソルのY座標（ビューポート基準）
 * @param {string} text - 表示する色名
 */
function showTooltip(clientX, clientY, text) {
  tooltipEl.textContent = text;
  tooltipEl.style.left = `${clientX + 14}px`;
  tooltipEl.style.top = `${clientY + 14}px`;
  tooltipEl.hidden = false;
}

/** ツールチップを非表示にする（カーソルがセル・Canvasから離れたとき）。 */
function hideTooltip() {
  tooltipEl.hidden = true;
}

/**
 * 図案 Canvas 上のマウス移動を処理し、カーソル下セルのビーズ色名を表示する（要件5.4）。
 * 図案未生成・グリッド外・未配置セルではツールチップを非表示にする。
 * @param {MouseEvent} event - mousemove イベント
 */
function handleCanvasMouseMove(event) {
  // ドラッグ手動編集中（マウスボタン押下中）はツールチップを隠し、編集操作を優先する
  // （要件12.6・patternEditor のドラッグ編集と協調）。event.buttons は押下中ボタンの
  // ビットマスクで、ホバー時は 0、左ドラッグ中は 1（非0）になる。
  if (event.buttons) {
    hideTooltip();
    return;
  }

  const pattern = state.pattern;
  if (!pattern) {
    hideTooltip();
    return;
  }

  const cell = canvasPointToCell(patternCanvas, event, BASE_CELL_SIZE, state.zoom);
  if (!cell) {
    hideTooltip();
    return;
  }

  const row = Array.isArray(pattern.cells) ? pattern.cells[cell.row] : null;
  const bead = row ? row[cell.col] : null;
  // 未配置（null）セルは色名が無いのでツールチップを出さない。
  if (!bead) {
    hideTooltip();
    return;
  }

  showTooltip(event.clientX, event.clientY, getColorName(bead));
}

// =============================================================================
// リサイズ方式・フィットモードの選択UI（要件10.1, 10.4, 10.8）
// =============================================================================

/**
 * ラベル付きの <select> フィールドを生成する。
 * @param {string} id - select の id（label の for と関連付ける）
 * @param {string} labelText - ラベル文言
 * @param {Array<{value: string, label: string}>} optionList - 選択肢
 * @param {string} currentValue - 現在値（選択済みにする）
 * @param {function(string): void} onChange - 変更時ハンドラ
 * @returns {HTMLDivElement}
 */
function buildSelectField(id, labelText, optionList, currentValue, onChange) {
  const field = document.createElement('div');
  field.className = 'preprocess__field';

  const label = document.createElement('label');
  label.className = 'preprocess__label';
  label.setAttribute('for', id);
  label.textContent = labelText;

  const select = document.createElement('select');
  select.className = 'preprocess__select';
  select.id = id;

  for (const opt of optionList) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    option.selected = opt.value === currentValue;
    select.appendChild(option);
  }

  select.addEventListener('change', () => onChange(select.value));

  field.appendChild(label);
  field.appendChild(select);
  return field;
}

/**
 * リサイズ方式・フィットモードの選択UIを構築して結線する（要件10.1, 10.4, 10.8）。
 * @param {HTMLElement} container - 描画先コンテナ
 */
function initPreprocessUI(container) {
  if (!container) {
    return;
  }
  container.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'preprocess';

  // リサイズ方式（要件10.1: 初期は smooth=なめらか）。
  root.appendChild(
    buildSelectField(
      'resize-method-select',
      t('main.resizeMethodLabel'),
      [
        { value: 'smooth', label: t('main.resizeSmooth') },
        { value: 'sharp', label: t('main.resizeSharp') },
      ],
      state.resizeMethod,
      (value) => {
        state.setResizeMethod(value);
        // 要件10.8: 変更時に図案を再生成する。
        // AIお題生成中は自動再実行しない。画像入力モード時のみ再生成する。
        if (state.uploadedImage && state.inputMode === 'image') {
          generatePattern();
        }
      },
    ),
  );

  // フィットモード（要件10.4: 初期は contain=フィット）。
  root.appendChild(
    buildSelectField(
      'fit-mode-select',
      t('main.fitModeLabel'),
      [
        { value: 'stretch', label: t('main.fitStretch') },
        { value: 'contain', label: t('main.fitContain') },
        { value: 'cover', label: t('main.fitCover') },
      ],
      state.fitMode,
      (value) => {
        state.setFitMode(value);
        // 要件10.8: 変更時に図案を再生成する。
        // AIお題生成中は自動再実行しない。画像入力モード時のみ再生成する。
        if (state.uploadedImage && state.inputMode === 'image') {
          generatePattern();
        }
      },
    ),
  );

  container.appendChild(root);
}

// =============================================================================
// 背景色ピック用プレビューCanvasの描画（要件9.2 の手動選択を結線するため）
// =============================================================================

/**
 * アップロード画像を背景色ピック用プレビュー Canvas に等倍で描画する。
 * 等倍（naturalWidth/Height）で描画し CSS で縮小表示することで、
 * pickColorFromPreview が生ピクセル色を正確に取得できるようにする。
 * @param {HTMLImageElement} image - アップロード画像
 */
function drawPreviewCanvas(image) {
  if (!previewCanvas || !image) {
    return;
  }
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) {
    return;
  }

  previewCanvas.width = width;
  previewCanvas.height = height;
  const ctx = previewCanvas.getContext('2d');
  if (!ctx) {
    return;
  }
  ctx.drawImage(image, 0, 0, width, height);
  previewCanvas.hidden = false;
}

// =============================================================================
// UIコンポーネントの初期化と結線
// =============================================================================

// --- 2. ビーズタイプ選択（getPalette を他UIへ共有する起点） -------------------
beadTypeHandle = initBeadTypeSelectorUI(beadTypeContainer, state, {
  onBeadTypeChange: () => {
    // beadTypeSelector は図案があれば remapPattern 済み。ペグ数が変わるため、
    // 画像がある場合は新しいペグ数で図案を再生成する（色も新パレットに揃う）。
    // 画像が無ければ remap 済みの図案（または未生成）をそのまま再描画する（要件2.4, 2.5）。
    if (paletteSelectorHandle) paletteSelectorHandle.refresh();
    if (patternEditorHandle) patternEditorHandle.refresh();
    if (recommendedSizesHandle) recommendedSizesHandle.refresh();
    if (plateConfigHandle) plateConfigHandle.syncFromState();

    if (state.uploadedImage) {
      // AIお題生成中は自動再実行しない。画像入力モード時のみ再生成する。
      if (state.inputMode === 'image') {
        generatePattern();
      }
    } else {
      renderView();
    }
  },
});

// --- 3. プレート構成設定 ------------------------------------------------------
plateConfigHandle = initPlateConfigUI(plateConfigContainer, state, {
  onPlateConfigChange: () => {
    // plateConfig は図案がある場合に空グリッドへ差し替え済み。画像があれば
    // 新サイズで再生成して上書きする。無ければ空グリッド/未生成を再描画する。
    if (recommendedSizesHandle) recommendedSizesHandle.refresh();
    if (state.uploadedImage) {
      // AIお題生成中は自動再実行しない。画像入力モード時のみ再生成する。
      if (state.inputMode === 'image') {
        generatePattern();
      }
    } else {
      renderView();
    }
  },
});

// --- 8/3. おすすめサイズ表示・選択 --------------------------------------------
recommendedSizesHandle = initRecommendedSizesUI(recommendedSizesContainer, state, {
  onSizeSelected: () => {
    // 選択された構成を入力欄に同期し、画像があれば図案を再生成する（要件8.3）。
    if (plateConfigHandle) plateConfigHandle.syncFromState();
    if (state.uploadedImage) {
      // AIお題生成中は自動再実行しない。画像入力モード時のみ再生成する。
      if (state.inputMode === 'image') {
        generatePattern();
      }
    }
  },
});

// --- 5/11. 使用パレット選択（有効/無効・最大色数） ----------------------------
paletteSelectorHandle = initPaletteSelectorUI(paletteSelectorContainer, state, {
  // beadTypeSelector と同一のパレット（lab付き）を共有する。
  getPalette: () => beadTypeHandle.getPalette(),
  onSelectionChange: () => {
    // 要件11.6: 使用パレット・最大色数の変更時に図案を再生成する。
    // 編集ツールの色候補も変わるため patternEditor を再同期する。
    if (patternEditorHandle) patternEditorHandle.refresh();
    if (state.uploadedImage) {
      // AIお題生成中は自動再実行しない。画像入力モード時のみ再生成する。
      if (state.inputMode === 'image') {
        generatePattern();
      }
    }
  },
});

// --- 6/9. 背景除外 ------------------------------------------------------------
backgroundExclusionHandle = initBackgroundExclusionUI(backgroundExclusionContainer, state, {
  onSettingsChange: () => {
    // 要件9.9: 背景除外のON/OFF・閾値・手動色選択の変更時に図案を再生成する。
    if (state.uploadedImage) {
      // AIお題生成中は自動再実行しない。画像入力モード時のみ再生成する。
      if (state.inputMode === 'image') {
        generatePattern();
      }
    }
  },
});

// --- 12. 図案手動編集（ツール選択＋Canvasドラッグ/クリック編集） --------------
patternEditorHandle = initPatternEditorUI(
  patternCanvas,
  patternEditorToolsContainer,
  state,
  {
    // paletteSelector と同一の有効パレットを共有する。
    getActivePalette: () => paletteSelectorHandle.getActivePalette(),
    cellSize: BASE_CELL_SIZE,
    onPatternEdit: () => {
      // patternEditor が state.setPattern 済み（通知で renderView も走る）。
      // 念のため明示的に再描画して使用色一覧・合計を即時更新する（要件12.4, 12.10, 6.5）。
      // ドラッグ中は通過セルごとに呼ばれるため、逐次的に最新化される。
      renderView();
    },
  },
);

// --- 1. 画像アップロード（最後に結線し、ロード時に各UIを更新） -----------------
imageUploadHandle = initImageUploadUI(imageUploadContainer, {
  onImageLoaded: (image) => {
    // 画像を状態に保持し、背景ピック用プレビューへ描画する。
    state.setUploadedImage(image);
    drawPreviewCanvas(image);
    // 画像解像度に基づくおすすめサイズを更新する（要件8.1）。
    if (recommendedSizesHandle) recommendedSizesHandle.refresh();
    // AIお題生成中は自動再実行しない。画像入力モード時のみ再生成する。
    if (state.inputMode === 'image') {
      generatePattern();
    }
    // お題から生成ボタンの状態を同期する（画像有無では変化しないが念のため）。
    updateAiButtonState();
  },
});

// --- 4. リサイズ方式・フィットモードの選択UI ----------------------------------
initPreprocessUI(preprocessContainer);

// --- 入力方法・AI生成関連UIの初期化と結線 -------------------------------------
// 入力方法トグル（📷 画像から / ✨ AIお題から）
inputModeToggleHandle = initInputModeToggleUI(inputModeToggleContainer, state, {
  onModeChange: () => {
    // 入力グループの表示切替と実行ボタンの有効/無効を更新する（図案生成は自動実行しない）。
    applyInputModeVisibility();
    updateAiButtonState();
  },
});

// APIキー設定UI（要件3.1〜3.9）
apiKeyManagerHandle = initApiKeyManagerUI(apiKeyContainer, state, {
  onKeyChange: () => {
    updateAiButtonState();
  },
});

// Gemini モデルセレクタ（タイムアウト対策・モデル切り替え）
modelSelectorHandle = initModelSelectorUI(aiModelContainer, state, {
  onModelChange: () => {
    updateAiButtonState();
  },
});

// お題入力UI（画像不要のAIお題生成・onPromptChange で実行ボタンの有効/無効を更新）
aiPromptInputHandle = initAiPromptInputUI(aiPromptContainer, state, {
  onPromptChange: () => {
    updateAiButtonState();
  },
});

// お題から生成ボタンのクリック結線
if (aiTextConvertBtn) {
  aiTextConvertBtn.addEventListener('click', runAiTextConversion);
}

// =============================================================================
// グローバルなイベント結線（ズーム・エクスポート・ツールチップ・背景色ピック）
// =============================================================================

// --- ズーム操作（要件5.3） ----------------------------------------------------
if (zoomInBtn) {
  zoomInBtn.addEventListener('click', () => {
    state.setZoom(state.zoom + ZOOM_STEP);
  });
}
if (zoomOutBtn) {
  zoomOutBtn.addEventListener('click', () => {
    state.setZoom(state.zoom - ZOOM_STEP);
  });
}

// Ctrl+ホイールでズーム（通常のホイールはビューポートのスクロールに使う）。
if (patternViewport) {
  patternViewport.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey) {
        // 通常スクロール（overflow:auto）はブラウザに任せる。
        return;
      }
      // ズーム操作としてスクロールを消費する。
      event.preventDefault();
      const delta = event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      state.setZoom(state.zoom + delta);
    },
    { passive: false },
  );
}

// --- 図案セルのホバーで色名ツールチップ（要件5.4） ----------------------------
if (patternCanvas) {
  patternCanvas.addEventListener('mousemove', handleCanvasMouseMove);
  patternCanvas.addEventListener('mouseleave', hideTooltip);
}

// --- 背景色の手動選択: プレビューCanvasのクリックを pickFromPreview に結線（要件9.2）
if (previewCanvas) {
  previewCanvas.addEventListener('click', (event) => {
    if (backgroundExclusionHandle && typeof backgroundExclusionHandle.pickFromPreview === 'function') {
      backgroundExclusionHandle.pickFromPreview(previewCanvas, event);
    }
  });
}

// --- エクスポート（要件7.1） --------------------------------------------------
if (exportBtn) {
  exportBtn.addEventListener('click', async () => {
    const pattern = state.pattern;
    if (!pattern) {
      showMessage(t('main.noPatternError'), 'error');
      return;
    }

    exportBtn.disabled = true;
    try {
      // 使用色一覧（個数付き）を渡してエクスポート画像に含める（要件7.3）。
      const usedColors = calculateUsedColors(pattern).colors;
      const result = await exportAsPng(pattern, usedColors, { cellSize: EXPORT_CELL_SIZE });
      // ビーズ0個（要件7.4）や失敗（要件7.5）は exporter の戻り値メッセージに従う。
      showMessage(result.message, result.success ? 'info' : 'error');
    } catch (error) {
      console.error('エクスポート中にエラーが発生しました:', error);
      showMessage(t('main.exportError'), 'error');
    } finally {
      // 図案がある限り再度エクスポート可能にする。
      exportBtn.disabled = state.pattern == null;
    }
  });
}

// =============================================================================
// 初期描画と購読開始
// =============================================================================

// state の変更を購読し、描画専用リスナー（renderView）で Canvas・使用色一覧を更新する。
// renderView は state を変更しないため、通知の再帰ループは発生しない。
state.subscribe(renderView);

// 初期表示: 入力方法（inputMode）に応じた入力グループの表示を同期する。
applyInputModeVisibility();

// 初期表示（図案未生成メッセージ・ズーム率など）。
renderView();

// =============================================================================
// フッター著作権年の自動更新
// =============================================================================
const copyrightYearEl = document.querySelector('#copyright-year');
if (copyrightYearEl) {
  copyrightYearEl.textContent = new Date().getFullYear().toString();
}
