// =============================================================================
// APIキー設定UI（apiKeyManager.js）
// -----------------------------------------------------------------------------
// Gemini API キーの入力・表示切替・設定・消去・注意書き表示を提供するUIコンポーネント。
//
// 利用者が Google AI Studio で取得した API キーをセッションメモリに保持し、
// AI変換を実行可能な状態にする。キーは永続ストレージへ一切書き込まない。
//
// 設計書「コンポーネントとインターフェース > 4.2 APIキー設定UI」に対応。
//
// Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 3.8, 3.9, 4.1, 4.2, 5.5, 5.6, 5.7, 8.6
// =============================================================================

/**
 * APIキー設定UIを初期化してコンテナに描画する。
 *
 * 入力欄（初期マスク=パスワード形式・要件3.2）、表示/非表示トグル（要件3.3/3.8/3.9）、
 * Google AI Studio でのキー取得手順リンク（要件3.4）、設定ボタン（trim後1文字以上で保持・要件3.5）、
 * 消去ボタン（要件5.5/5.6）、注意書き（リロードで消える・第三者共有禁止・無料枠/レート制限・要件5.7/8.6）を提供する。
 * 空白のみのキー設定は拒否しメッセージを表示する（要件3.6）。
 *
 * @param {HTMLElement|null} container - UIの描画先コンテナ要素
 * @param {object} state - アプリケーション状態ストア（createAppState の戻り値）
 * @param {object} [options] - オプション
 * @param {function(boolean): void} [options.onKeyChange] - キー設定状態が変化した際のコールバック（引数: キー設定済みか）
 * @returns {{ refresh: function(): void, destroy: function(): void }}
 *          外部から再同期（refresh）・破棄（destroy）できるハンドル
 */
export function initApiKeyManagerUI(container, state, options = {}) {
  // コンテナが無い場合は no-op ハンドルを返す
  if (!container) {
    return {
      refresh() {},
      destroy() {},
    };
  }

  const { onKeyChange } = options;

  // --- DOM要素の参照（render 内で設定される） ---
  let inputEl = null;
  let toggleBtnEl = null;
  let feedbackEl = null;
  let statusEl = null;

  /**
   * APIキー入力欄を構築する（要件3.1/3.2）。
   * 初期状態は type="password"（マスク表示）。
   * @returns {HTMLInputElement}
   */
  function buildInput() {
    const input = document.createElement('input');
    input.type = 'password'; // 初期マスク（要件3.2）
    input.className = 'api-key-manager__input';
    input.placeholder = 'APIキーを入力';
    input.autocomplete = 'off';
    // 現在キーが設定済みならプレースホルダー的に表示（実際のキー値は入れない）
    if (state.geminiApiKey) {
      input.value = state.geminiApiKey;
    }
    return input;
  }

  /**
   * 表示/非表示トグルボタンを構築する（要件3.3/3.8/3.9）。
   * password ⇔ text を切り替える。
   * @returns {HTMLButtonElement}
   */
  function buildToggleButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'api-key-manager__toggle-btn';
    btn.textContent = '表示';
    btn.title = 'APIキーの表示/非表示を切り替え';
    btn.addEventListener('click', () => {
      if (inputEl.type === 'password') {
        // マスク → 判読可能（要件3.8）
        inputEl.type = 'text';
        btn.textContent = '非表示';
      } else {
        // 判読可能 → マスク（要件3.9）
        inputEl.type = 'password';
        btn.textContent = '表示';
      }
    });
    return btn;
  }

  /**
   * 「設定」ボタンを構築する（要件3.5/3.6）。
   * @returns {HTMLButtonElement}
   */
  function buildSetButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'api-key-manager__set-btn';
    btn.textContent = '設定';
    btn.addEventListener('click', () => {
      const rawValue = inputEl.value;
      const success = state.setGeminiApiKey(rawValue);
      if (success) {
        // trim後1文字以上 → 保持してAI実行可能状態にする（要件3.5/3.7）
        showFeedback('APIキーを設定しました。', 'success');
        updateStatus();
        if (typeof onKeyChange === 'function') {
          onKeyChange(true);
        }
      } else {
        // 空白のみ → 変更せずメッセージ表示（要件3.6）
        showFeedback('APIキーを入力してください。', 'error');
      }
    });
    return btn;
  }

  /**
   * 「消去」ボタンを構築する（要件5.5/5.6）。
   * @returns {HTMLButtonElement}
   */
  function buildClearButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'api-key-manager__clear-btn';
    btn.textContent = '消去';
    btn.addEventListener('click', () => {
      state.clearGeminiApiKey();
      // 入力欄を空に戻す（要件5.6）
      inputEl.value = '';
      showFeedback('APIキーを消去しました。', 'info');
      updateStatus();
      if (typeof onKeyChange === 'function') {
        onKeyChange(false);
      }
    });
    return btn;
  }

  /**
   * Google AI Studio へのリンクを構築する（要件3.4）。
   * @returns {HTMLElement}
   */
  function buildStudioLink() {
    const wrapper = document.createElement('div');
    wrapper.className = 'api-key-manager__link-wrapper';

    const text = document.createElement('span');
    text.textContent = 'APIキーの取得 → ';

    const link = document.createElement('a');
    link.href = 'https://aistudio.google.com/apikey';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Google AI Studio';
    link.className = 'api-key-manager__studio-link';

    wrapper.appendChild(text);
    wrapper.appendChild(link);
    return wrapper;
  }

  /**
   * 注意書きを構築する（要件5.7/8.6）。
   * textContent を使用しセキュリティを担保する。
   * @returns {HTMLElement}
   */
  function buildNotices() {
    const wrapper = document.createElement('div');
    wrapper.className = 'api-key-manager__notices';

    const notices = [
      'APIキーはブラウザのメモリにのみ保持され、ページをリロードすると消去されます',
      'APIキーを第三者と共有しないでください',
      'Google AI Studio の無料枠・レート制限の範囲でご利用ください',
    ];

    for (const notice of notices) {
      const item = document.createElement('p');
      item.className = 'api-key-manager__notice';
      // textContent を使用（innerHTML を使わない・セキュリティ要件）
      item.textContent = `⚠ ${notice}`;
      wrapper.appendChild(item);
    }

    return wrapper;
  }

  /**
   * APIキー設定状態に応じたステータス表示を構築する（要件4.1/4.2）。
   * @returns {HTMLElement}
   */
  function buildStatus() {
    const el = document.createElement('div');
    el.className = 'api-key-manager__status';
    return el;
  }

  /**
   * ステータス表示を現在のstate に基づいて更新する。
   * 未設定時は設定が必要な旨と導線を表示する（要件4.2）。
   */
  function updateStatus() {
    if (!statusEl) return;
    // textContent でセキュリティを担保
    if (state.geminiApiKey) {
      statusEl.textContent = '✓ APIキー設定済み — AI変換を利用できます';
      statusEl.className = 'api-key-manager__status api-key-manager__status--set';
    } else {
      statusEl.textContent = '✗ APIキーが未設定です — AI変換を利用するにはAPIキーの設定が必要です';
      statusEl.className = 'api-key-manager__status api-key-manager__status--unset';
    }
  }

  /**
   * フィードバックメッセージを表示する。
   * @param {string} message - メッセージテキスト
   * @param {'success'|'error'|'info'} type - メッセージの種別
   */
  function showFeedback(message, type) {
    if (!feedbackEl) return;
    feedbackEl.textContent = message;
    feedbackEl.className = `api-key-manager__feedback api-key-manager__feedback--${type}`;
  }

  /**
   * フィードバックメッセージをクリアする。
   */
  function clearFeedback() {
    if (!feedbackEl) return;
    feedbackEl.textContent = '';
    feedbackEl.className = 'api-key-manager__feedback';
  }

  /**
   * UIを描画する。
   */
  function render() {
    container.innerHTML = '';

    const root = document.createElement('div');
    root.className = 'api-key-manager';

    // セクション見出し
    const heading = document.createElement('h3');
    heading.className = 'api-key-manager__heading';
    heading.textContent = 'Gemini APIキー';
    root.appendChild(heading);

    // ステータス表示（要件4.1/4.2）
    statusEl = buildStatus();
    root.appendChild(statusEl);
    updateStatus();

    // 入力行（入力欄 + トグル + 設定 + 消去）
    const inputRow = document.createElement('div');
    inputRow.className = 'api-key-manager__input-row';

    inputEl = buildInput();
    toggleBtnEl = buildToggleButton();
    const setBtn = buildSetButton();
    const clearBtn = buildClearButton();

    inputRow.appendChild(inputEl);
    inputRow.appendChild(toggleBtnEl);
    inputRow.appendChild(setBtn);
    inputRow.appendChild(clearBtn);
    root.appendChild(inputRow);

    // フィードバックメッセージ領域
    feedbackEl = document.createElement('div');
    feedbackEl.className = 'api-key-manager__feedback';
    root.appendChild(feedbackEl);

    // Google AI Studio リンク（要件3.4）
    root.appendChild(buildStudioLink());

    // 注意書き（要件5.7/8.6）
    root.appendChild(buildNotices());

    container.appendChild(root);
  }

  // 初期描画
  render();

  return {
    /**
     * 外部からの state 変更にUIを同期させる。
     * 現在の state.geminiApiKey に基づいてステータスとフィードバックを更新する。
     */
    refresh() {
      updateStatus();
      clearFeedback();
      // 入力欄の値を state と同期（キー消去された場合など）
      if (inputEl) {
        if (state.geminiApiKey) {
          inputEl.value = state.geminiApiKey;
        } else {
          inputEl.value = '';
        }
      }
    },

    /**
     * UIを破棄する（コンテナを空にする）。
     */
    destroy() {
      container.innerHTML = '';
      inputEl = null;
      toggleBtnEl = null;
      feedbackEl = null;
      statusEl = null;
    },
  };
}
