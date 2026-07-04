// =============================================================================
// APIキー設定UI（apiKeyManager.js）のユニットテスト
// -----------------------------------------------------------------------------
// 入力欄のマスク表示・表示切替、設定ボタンの動作、消去ボタンの動作、
// フィードバックメッセージ、ステータス表示、注意書きの表示を検証する。
//
// Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 3.8, 3.9, 4.1, 4.2, 5.5, 5.6, 5.7, 8.6
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initApiKeyManagerUI } from '../src/ui/apiKeyManager.js';
import { createAppState } from '../src/state.js';
import { setLocale } from '../src/i18n.js';

describe('apiKeyManager', () => {
  let container;
  let state;

  beforeEach(() => {
    // 本テストは日本語の文言を直接検証するため、実行環境（jsdom既定は en-US）に
    // 依存せずロケールを 'ja' に固定する。i18n.js 導入前からの既存テスト互換のため。
    setLocale('ja');
    container = document.createElement('div');
    document.body.appendChild(container);
    state = createAppState();
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('初期化', () => {
    it('コンテナが null の場合は no-op ハンドルを返す', () => {
      const handle = initApiKeyManagerUI(null, state);
      expect(handle.refresh).toBeTypeOf('function');
      expect(handle.destroy).toBeTypeOf('function');
    });

    it('入力欄が type="password" で描画される（要件3.2）', () => {
      initApiKeyManagerUI(container, state);
      const input = container.querySelector('.api-key-manager__input');
      expect(input).not.toBeNull();
      expect(input.type).toBe('password');
    });

    it('Google AI Studio へのリンクが表示される（要件3.4）', () => {
      initApiKeyManagerUI(container, state);
      const link = container.querySelector('.api-key-manager__studio-link');
      expect(link).not.toBeNull();
      expect(link.href).toBe('https://aistudio.google.com/apikey');
      expect(link.target).toBe('_blank');
      expect(link.rel).toBe('noopener noreferrer');
    });

    it('注意書きが表示される（要件5.7/8.6）', () => {
      initApiKeyManagerUI(container, state);
      const notices = container.querySelectorAll('.api-key-manager__notice');
      expect(notices.length).toBe(3);
      // textContent で注意書きの内容を確認
      const texts = Array.from(notices).map((n) => n.textContent);
      expect(texts.some((t) => t.includes('ページをリロードすると消去されます'))).toBe(true);
      expect(texts.some((t) => t.includes('第三者と共有しないでください'))).toBe(true);
      expect(texts.some((t) => t.includes('無料枠・レート制限の範囲'))).toBe(true);
    });

    it('未設定時にステータスが「APIキーが未設定」を表示する（要件4.2）', () => {
      initApiKeyManagerUI(container, state);
      const status = container.querySelector('.api-key-manager__status');
      expect(status.textContent).toContain('APIキーが未設定');
    });
  });

  describe('表示/非表示トグル', () => {
    it('トグルボタンでパスワード表示 → テキスト表示に切り替わる（要件3.3/3.8）', () => {
      initApiKeyManagerUI(container, state);
      const input = container.querySelector('.api-key-manager__input');
      const toggleBtn = container.querySelector('.api-key-manager__toggle-btn');

      expect(input.type).toBe('password');
      toggleBtn.click();
      expect(input.type).toBe('text');
    });

    it('トグルボタンでテキスト表示 → パスワード表示に戻る（要件3.9）', () => {
      initApiKeyManagerUI(container, state);
      const input = container.querySelector('.api-key-manager__input');
      const toggleBtn = container.querySelector('.api-key-manager__toggle-btn');

      toggleBtn.click(); // password → text
      toggleBtn.click(); // text → password
      expect(input.type).toBe('password');
    });
  });

  describe('設定ボタン', () => {
    it('trim後1文字以上のキーを設定できる（要件3.5）', () => {
      initApiKeyManagerUI(container, state);
      const input = container.querySelector('.api-key-manager__input');
      const setBtn = container.querySelector('.api-key-manager__set-btn');

      input.value = '  my-api-key-123  ';
      setBtn.click();

      expect(state.geminiApiKey).toBe('my-api-key-123');
    });

    it('設定成功時にフィードバックメッセージが表示される', () => {
      initApiKeyManagerUI(container, state);
      const input = container.querySelector('.api-key-manager__input');
      const setBtn = container.querySelector('.api-key-manager__set-btn');

      input.value = 'valid-key';
      setBtn.click();

      const feedback = container.querySelector('.api-key-manager__feedback');
      expect(feedback.textContent).toContain('APIキーを設定しました');
    });

    it('空白のみのキーは拒否される（要件3.6）', () => {
      initApiKeyManagerUI(container, state);
      const input = container.querySelector('.api-key-manager__input');
      const setBtn = container.querySelector('.api-key-manager__set-btn');

      input.value = '   ';
      setBtn.click();

      expect(state.geminiApiKey).toBeNull();
      const feedback = container.querySelector('.api-key-manager__feedback');
      expect(feedback.textContent).toContain('APIキーを入力してください');
    });

    it('空文字のキーは拒否される（要件3.6）', () => {
      initApiKeyManagerUI(container, state);
      const input = container.querySelector('.api-key-manager__input');
      const setBtn = container.querySelector('.api-key-manager__set-btn');

      input.value = '';
      setBtn.click();

      expect(state.geminiApiKey).toBeNull();
      const feedback = container.querySelector('.api-key-manager__feedback');
      expect(feedback.textContent).toContain('APIキーを入力してください');
    });

    it('設定成功時にステータスが「設定済み」に更新される', () => {
      initApiKeyManagerUI(container, state);
      const input = container.querySelector('.api-key-manager__input');
      const setBtn = container.querySelector('.api-key-manager__set-btn');

      input.value = 'valid-key';
      setBtn.click();

      const status = container.querySelector('.api-key-manager__status');
      expect(status.textContent).toContain('APIキー設定済み');
    });

    it('onKeyChange コールバックが呼ばれる（設定成功時）', () => {
      const onKeyChange = vi.fn();
      initApiKeyManagerUI(container, state, { onKeyChange });
      const input = container.querySelector('.api-key-manager__input');
      const setBtn = container.querySelector('.api-key-manager__set-btn');

      input.value = 'valid-key';
      setBtn.click();

      expect(onKeyChange).toHaveBeenCalledWith(true);
    });
  });

  describe('消去ボタン', () => {
    it('APIキーを消去して入力欄を空にする（要件5.5/5.6）', () => {
      // 事前にキーを設定
      state.setGeminiApiKey('existing-key');

      initApiKeyManagerUI(container, state);
      const input = container.querySelector('.api-key-manager__input');
      const clearBtn = container.querySelector('.api-key-manager__clear-btn');

      clearBtn.click();

      expect(state.geminiApiKey).toBeNull();
      expect(input.value).toBe('');
    });

    it('消去後にステータスが「未設定」に戻る', () => {
      state.setGeminiApiKey('existing-key');

      initApiKeyManagerUI(container, state);
      const clearBtn = container.querySelector('.api-key-manager__clear-btn');

      clearBtn.click();

      const status = container.querySelector('.api-key-manager__status');
      expect(status.textContent).toContain('APIキーが未設定');
    });

    it('onKeyChange コールバックが呼ばれる（消去時）', () => {
      state.setGeminiApiKey('existing-key');
      const onKeyChange = vi.fn();
      initApiKeyManagerUI(container, state, { onKeyChange });
      const clearBtn = container.querySelector('.api-key-manager__clear-btn');

      clearBtn.click();

      expect(onKeyChange).toHaveBeenCalledWith(false);
    });
  });

  describe('refresh', () => {
    it('state にキーが設定済みの場合、refresh でステータスが更新される', () => {
      const handle = initApiKeyManagerUI(container, state);

      // 外部から state を変更
      state.setGeminiApiKey('external-key');
      handle.refresh();

      const status = container.querySelector('.api-key-manager__status');
      expect(status.textContent).toContain('APIキー設定済み');
    });

    it('state のキーが消去された場合、refresh で入力欄が空になる', () => {
      state.setGeminiApiKey('some-key');
      const handle = initApiKeyManagerUI(container, state);

      state.clearGeminiApiKey();
      handle.refresh();

      const input = container.querySelector('.api-key-manager__input');
      expect(input.value).toBe('');
    });
  });

  describe('destroy', () => {
    it('コンテナが空になる', () => {
      const handle = initApiKeyManagerUI(container, state);
      handle.destroy();
      expect(container.innerHTML).toBe('');
    });
  });
});
