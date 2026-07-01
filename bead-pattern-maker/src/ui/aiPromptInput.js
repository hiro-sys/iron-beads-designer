// =============================================================================
// お題入力UI（aiPromptInput.js）
// -----------------------------------------------------------------------------
// 画像アップロード不要で、ユーザーが入力したお題（例「ねこ」「ハート」）から
// AIがビーズ図案ドット絵を生成するための、お題テキスト入力欄を提供する。
//
// 入力時の挙動:
//   - state.setAiPrompt(value) でお題を記録する（メモリのみ・永続化しない）
//   - options.onPromptChange?.(value) を呼び、関連UI（お題から生成ボタンの有効/無効
//     など）を更新する
//   - 図案生成は自動実行しない（記録のみ。生成は実行ボタン押下でのみ開始する）
//
// お題生成では画像を送らない。代わりに「入力したお題は Google（Gemini API）へ送信される」旨の
// 注意書きをこの入力欄に常時表示する。
//
// 設計方針: modelSelector.js の初期化規約に準拠し、{ refresh, destroy } を返す。
// テキストは textContent で設定し innerHTML に外部データを入れない（セキュリティ）。
// =============================================================================

/**
 * お題入力UIを初期化してコンテナに描画する。
 *
 * ラベル付きテキスト入力でお題（モチーフ名）を受け取り、入力のたびに
 * state.setAiPrompt で記録する。お題が Gemini API へ送信される旨の注意書きを
 * 常時表示する。図案生成は自動実行しない（実行ボタン押下でのみ開始する）。
 *
 * @param {HTMLElement|null} container - UIの描画先コンテナ要素
 * @param {object} state - アプリケーション状態ストア（state.js の createAppState の戻り値）
 * @param {object} [options] - オプション
 * @param {function(string): void} [options.onPromptChange] - お題変更時に呼ばれる
 *        コールバック。「お題から生成」ボタンの有効/無効更新などに使う。
 * @returns {{ refresh: function(): void, destroy: function(): void }}
 *          外部から再同期（refresh）・破棄（destroy）できるハンドル
 */
export function initAiPromptInputUI(container, state, options = {}) {
  // コンテナが無い場合は no-op ハンドルを返し、呼び出し側がクラッシュしないようにする。
  if (!container) {
    return {
      refresh() {},
      destroy() {},
    };
  }

  const { onPromptChange } = options;

  /**
   * テキスト入力要素への参照（render 後に更新）。
   * @type {HTMLInputElement|null}
   */
  let inputEl = null;

  /**
   * お題入力変更時のハンドラ。
   * @param {string} value - 入力されたお題テキスト
   */
  function handlePromptChange(value) {
    // 1) お題を記録する。図案生成は実行しない（記録のみ）。
    state.setAiPrompt(value);

    // 2) コールバックで関連UI（生成ボタンの有効/無効など）を更新する。
    if (typeof onPromptChange === 'function') {
      onPromptChange(value);
    }
  }

  /**
   * 現在の state.aiPrompt に基づいてUI全体を描画する。
   */
  function render() {
    container.innerHTML = '';

    const root = document.createElement('div');
    root.className = 'ai-prompt-input';

    // --- ラベル ---
    const label = document.createElement('label');
    label.className = 'ai-prompt-input__label';
    label.setAttribute('for', 'ai-prompt-field');
    label.textContent = 'お題（AIが描くモチーフ）';

    // --- テキスト入力 ---
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'ai-prompt-field';
    input.className = 'ai-prompt-input__field';
    input.placeholder = '例: ねこ / ハート / 星';
    input.value = state.aiPrompt || '';
    input.autocomplete = 'off';
    input.addEventListener('input', () => {
      handlePromptChange(input.value);
    });

    inputEl = input;

    // --- 注意書き（お題が Gemini API へ送信される旨を常時表示） ---
    const notice = document.createElement('p');
    notice.className = 'ai-prompt-input__notice';
    // セキュリティのため textContent を使用（innerHTML 不使用）。
    notice.textContent = '入力したお題はGoogle（Gemini API）へ送信されます';

    root.appendChild(label);
    root.appendChild(input);
    root.appendChild(notice);
    container.appendChild(root);
  }

  // 初期描画。
  render();

  return {
    /**
     * 外部からの state 変更にUIを同期させる。
     * 現在の state.aiPrompt に基づいて入力欄の値を更新する。
     */
    refresh() {
      if (inputEl) {
        inputEl.value = state.aiPrompt || '';
      }
    },

    /**
     * UIを破棄する（コンテナを空にする）。
     */
    destroy() {
      container.innerHTML = '';
      inputEl = null;
    },
  };
}
