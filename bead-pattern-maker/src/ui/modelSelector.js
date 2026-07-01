// =============================================================================
// Gemini モデルセレクタUI（modelSelector.js）
// -----------------------------------------------------------------------------
// AI変換に使う Gemini モデルを選択・切り替えするラベル付き <select> UI を提供する。
//
// 【背景】
//   お題テキスト生成（generateFromText）に使える「テキスト入力→構造化JSON出力」対応の
//   汎用モデルのみを掲載し、無料枠で使えるか否かで <optgroup> を2グループに分けて提示する。
//   モデル定義（GEMINI_MODELS）は state.js に集約し、このUIは表示と選択の記録のみを担う。
//   初期選択は state.geminiModel（初期値 'gemini-2.5-flash'）。
//
// 選択時の挙動:
//   - state.setGeminiModel(value) でモデルを記録する（許可外の値は state 側で無視）
//   - options.onModelChange?.(value) を呼び、関連UI（実行ボタンの状態など）を更新する
//   - 図案生成は自動実行しない（記録のみ）
//
// 設計方針: { refresh, destroy } を返す初期化規約に準拠する。
// セキュリティ: テキストは textContent で設定し innerHTML に外部データを入れない。
// =============================================================================

import { GEMINI_MODELS, VALID_GEMINI_MODELS } from '../state.js';

/**
 * Gemini モデルセレクタUIを初期化してコンテナに描画する。
 *
 * ラベル付き <select> を無料枠の可否で2グループ（<optgroup>）に分けて提示し、
 * 初期選択は state.geminiModel（既定: 'gemini-2.5-flash'）。選択変更時は
 * state.setGeminiModel で記録するのみで、図案生成は自動実行しない。
 *
 * @param {HTMLElement|null} container - UIの描画先コンテナ要素
 * @param {object} state - アプリケーション状態ストア（state.js の createAppState の戻り値）
 * @param {object} [options] - オプション
 * @param {function(string): void} [options.onModelChange] - モデル変更時に呼ばれる
 *        コールバック。実行ボタンの状態更新などに使う。
 * @returns {{ refresh: function(): void, destroy: function(): void }}
 *          外部から再同期（refresh）・破棄（destroy）できるハンドル
 */
export function initModelSelectorUI(container, state, options = {}) {
  // コンテナが無い場合は no-op ハンドルを返し、呼び出し側がクラッシュしないようにする。
  if (!container) {
    return {
      refresh() {},
      destroy() {},
    };
  }

  const { onModelChange } = options;

  /**
   * <select> 要素への参照（render 後に更新）。
   * @type {HTMLSelectElement|null}
   */
  let selectEl = null;

  /**
   * モデル選択変更時のハンドラ。
   * @param {string} newModel - 選択されたモデル名
   */
  function handleModelChange(newModel) {
    // 無効な値は無視する（state 側でも許可リストガードされる）。
    if (!VALID_GEMINI_MODELS.includes(newModel)) return;

    // 同一モデルの再選択は何もしない。
    if (newModel === state.geminiModel) return;

    // 1) モデルを記録する。図案生成は実行しない。
    state.setGeminiModel(newModel);

    // 2) コールバックで関連UI（実行ボタン状態など）を更新する。
    if (typeof onModelChange === 'function') {
      onModelChange(newModel);
    }
  }

  /**
   * 現在の state.geminiModel に基づいてUI全体を描画する。
   */
  function render() {
    container.innerHTML = '';

    const root = document.createElement('div');
    root.className = 'model-selector';

    // --- ラベル ---
    const label = document.createElement('label');
    label.className = 'model-selector__label';
    label.setAttribute('for', 'gemini-model-select');
    label.textContent = '使用するAIモデル';

    // --- 補足の注意書き（掲載していないモデルの説明） ---
    const note = document.createElement('p');
    note.className = 'model-selector__note';
    // セキュリティのため textContent を使用（innerHTML 不使用）。
    note.textContent = '※TTS・音声・Live系モデルは図案生成に使えないため掲載していません';

    // --- <select> ---
    const select = document.createElement('select');
    select.className = 'model-selector__select';
    select.id = 'gemini-model-select';

    // 無料枠の可否で2グループ（<optgroup>）に分けて表示する。
    // 「無料枠で使える」グループを先に並べる。
    const groups = [
      {
        label: '無料枠で使える',
        models: GEMINI_MODELS.filter((m) => m.freeTier),
        suffix: '',
      },
      {
        label: '無料枠では使えない',
        models: GEMINI_MODELS.filter((m) => !m.freeTier),
        suffix: '（無料枠不可）',
      },
    ];

    for (const group of groups) {
      if (group.models.length === 0) continue;

      const optgroup = document.createElement('optgroup');
      optgroup.label = group.label;

      for (const { id, label: modelLabel } of group.models) {
        const option = document.createElement('option');
        option.value = id;
        // セキュリティのため textContent を使用（innerHTML 不使用）。
        option.textContent = `${modelLabel}${group.suffix}`;
        option.selected = id === state.geminiModel;
        optgroup.appendChild(option);
      }

      select.appendChild(optgroup);
    }

    select.addEventListener('change', () => {
      handleModelChange(select.value);
    });

    selectEl = select;

    root.appendChild(label);
    root.appendChild(note);
    root.appendChild(select);
    container.appendChild(root);
  }

  // 初期描画。
  render();

  return {
    /**
     * 外部からの state 変更にUIを同期させる。
     * 現在の state.geminiModel に基づいて <select> の選択状態を更新する。
     */
    refresh() {
      if (selectEl) {
        selectEl.value = state.geminiModel;
      }
    },

    /**
     * UIを破棄する（コンテナを空にする）。
     */
    destroy() {
      container.innerHTML = '';
      selectEl = null;
    },
  };
}
