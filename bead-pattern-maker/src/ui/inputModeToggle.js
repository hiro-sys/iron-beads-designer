// =============================================================================
// 入力方法トグルUI（inputModeToggle.js）
// -----------------------------------------------------------------------------
// 図案の入力方法を「📷 画像から（ローカル変換）」「✨ AIお題から（Gemini生成）」の
// 2つから選択するトグル（ラジオボタン）UIを提供する。初期値は state.inputMode
// （既定: 'image'）。
//
// 選択時の挙動:
//   - state.setInputMode(value) で入力方法を記録する（許可外の値は state 側で無視）
//   - options.onModeChange?.(value) を呼び、関連UI（入力グループの表示切替・実行ボタンの
//     有効/無効など）を更新する
//   - 図案生成は自動実行しない（記録のみ。生成は実行操作でのみ開始する）
//
// 設計方針: modelSelector.js の初期化規約に準拠し、{ refresh, destroy } を返す。
// テキストは textContent で設定し innerHTML に外部データを入れない（セキュリティ）。
// =============================================================================

import { VALID_INPUT_MODES } from '../state.js';

/**
 * 入力方法の選択肢定義（value: 表示ラベル）。
 * @type {Array<{value: string, label: string}>}
 */
const MODE_OPTIONS = [
  { value: 'image', label: '📷 画像から' },
  { value: 'prompt', label: '✨ AIお題から' },
];

/**
 * 入力方法トグルUIを初期化してコンテナに描画する。
 *
 * 「📷 画像から」（value 'image'）「✨ AIお題から」（value 'prompt'）をラジオボタンで
 * 提供し、初期選択は state.inputMode（既定: 'image'）。選択変更時は state.setInputMode
 * で記録するのみで、図案生成は自動実行しない。
 *
 * @param {HTMLElement|null} container - UIの描画先コンテナ要素
 * @param {object} state - アプリケーション状態ストア（state.js の createAppState の戻り値）
 * @param {object} [options] - オプション
 * @param {function(('image'|'prompt')): void} [options.onModeChange] - 入力方法変更時に
 *        呼ばれるコールバック。入力グループの表示切替・実行ボタンの有効/無効更新に使う。
 * @returns {{ refresh: function(): void, destroy: function(): void }}
 *          外部から再同期（refresh）・破棄（destroy）できるハンドル
 */
export function initInputModeToggleUI(container, state, options = {}) {
  // コンテナが無い場合は no-op ハンドルを返し、呼び出し側がクラッシュしないようにする。
  if (!container) {
    return {
      refresh() {},
      destroy() {},
    };
  }

  const { onModeChange } = options;

  /**
   * ラジオボタン選択変更時のハンドラ。
   * @param {string} newMode - 選択された入力方法
   */
  function handleModeChange(newMode) {
    // 無効な値は無視する（state 側でも許可リストガードされる）。
    if (!VALID_INPUT_MODES.includes(newMode)) return;

    // 同一モードの再選択は何もしない。
    if (newMode === state.inputMode) return;

    // 1) 入力方法を記録する。図案生成は実行しない（記録のみ）。
    state.setInputMode(newMode);

    // 2) コールバックで関連UIの表示・実行ボタンの有効/無効を更新する。
    if (typeof onModeChange === 'function') {
      onModeChange(newMode);
    }
  }

  /**
   * 現在の state.inputMode に基づいてUI全体を描画する。
   */
  function render() {
    container.innerHTML = '';

    const root = document.createElement('div');
    root.className = 'input-mode-toggle';

    const groupName = 'input-mode';

    for (const { value, label } of MODE_OPTIONS) {
      const labelEl = document.createElement('label');
      labelEl.className = 'input-mode-toggle__option';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = groupName;
      radio.value = value;
      radio.className = 'input-mode-toggle__radio';
      radio.checked = value === state.inputMode;
      // チェックされた（＝選択された）ときのみ変更を伝播する。
      radio.addEventListener('change', () => {
        if (radio.checked) {
          handleModeChange(value);
        }
      });

      const text = document.createElement('span');
      text.className = 'input-mode-toggle__option-label';
      // セキュリティのため textContent を使用（innerHTML 不使用）。
      text.textContent = label;

      labelEl.appendChild(radio);
      labelEl.appendChild(text);
      root.appendChild(labelEl);
    }

    container.appendChild(root);
  }

  // 初期描画。
  render();

  return {
    /**
     * 外部からの state 変更にUIを同期させる。
     * 現在の state.inputMode に基づいてラジオの選択状態を更新する。
     */
    refresh() {
      const radios = container.querySelectorAll('input[name="input-mode"]');
      for (const radio of radios) {
        radio.checked = radio.value === state.inputMode;
      }
    },

    /**
     * UIを破棄する（コンテナを空にする）。
     */
    destroy() {
      container.innerHTML = '';
    },
  };
}
