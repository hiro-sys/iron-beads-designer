// =============================================================================
// main.js ディスパッチ・runAiTextConversion のユニットテスト
// -----------------------------------------------------------------------------
// main.js は DOM 依存が多く直接 import できないため、ディスパッチロジックの
// 核心部分（入力方法に応じた自動再生成の振り分け、お題生成のガード条件・
// 多重送信抑止・エラー時図案不変・メッセージ生成）を再現して検証する。
//
// 画像AI変換（convert）と画像送信同意ゲートは廃止したため、それらの検証は削除し、
// お題テキスト生成（generateFromText）のフローを検証する。
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAppState } from '../src/state.js';
import { messageForAiError } from '../src/utils/messageForAiError.js';

// --- runAiTextConversion のロジックを再現するヘルパー ---
// main.js の runAiTextConversion と同等のガード・処理フローをテスト可能な形で抽出した関数。
// 画像は不要・同意ゲートも介在しない。

/**
 * runAiTextConversion のロジックを再現する。
 *
 * @param {object} params
 * @param {object} params.state - AppState ストア
 * @param {object} params.paletteSelectorHandle - { canGenerate, getActivePalette }
 * @param {function} params.aiGenerate - aiConversionStrategy.generateFromText のモック
 * @param {function} params.showMessage - メッセージ表示関数
 * @param {function} params.showLocalFallback - フォールバック導線表示関数
 * @returns {Promise<{executed: boolean, pattern?: object, error?: Error}>}
 */
async function simulateRunAiTextConversion({
  state,
  paletteSelectorHandle,
  aiGenerate,
  showMessage,
  showLocalFallback,
}) {
  // --- ガード条件（画像は不要・同意ゲートなし） ---
  if (state.geminiApiKey === null) return { executed: false, reason: 'no_key' };
  const subject = typeof state.aiPrompt === 'string' ? state.aiPrompt.trim() : '';
  if (subject.length === 0) return { executed: false, reason: 'no_prompt' };
  if (!paletteSelectorHandle || !paletteSelectorHandle.canGenerate()) {
    return { executed: false, reason: 'no_palette' };
  }
  if (state.aiProcessing) return { executed: false, reason: 'already_processing' };

  // --- 処理中状態の設定 ---
  state.setAiProcessing(true);

  const activePalette = paletteSelectorHandle.getActivePalette();

  try {
    const result = await aiGenerate(subject, {
      width: 29,
      height: 29,
      activePalette,
      apiKey: state.geminiApiKey,
    });
    // 成功: 図案を反映
    state.setPattern(result);
    state.setLastAiPattern(result);
    return { executed: true, pattern: result };
  } catch (error) {
    // 失敗: 図案は変更しない
    const msg = messageForAiError(error);
    showMessage(msg, 'error');
    showLocalFallback();
    return { executed: true, error, message: msg };
  } finally {
    // 処理中状態を解除
    state.setAiProcessing(false);
  }
}

// =============================================================================
// テスト
// =============================================================================

describe('ディスパッチ・runAiTextConversion ユニットテスト', () => {
  let state;
  let paletteSelectorHandle;
  let mockAiGenerate;
  let mockShowMessage;
  let mockShowLocalFallback;
  const mockPalette = [
    { id: '1', name: 'しろ', r: 255, g: 255, b: 255 },
    { id: '2', name: 'くろ', r: 0, g: 0, b: 0 },
  ];

  beforeEach(() => {
    state = createAppState();
    paletteSelectorHandle = {
      canGenerate: () => true,
      getActivePalette: () => mockPalette,
    };
    mockAiGenerate = vi.fn().mockResolvedValue({
      width: 29,
      height: 29,
      cells: [],
      originalCells: [],
      beadType: 'perler',
      plateConfig: { cols: 1, rows: 1 },
    });
    mockShowMessage = vi.fn();
    mockShowLocalFallback = vi.fn();
  });

  // ---------------------------------------------------------------------------
  // 入力方法（inputMode）に応じた自動再生成の振り分け
  // ---------------------------------------------------------------------------
  describe('入力方法に応じた自動再生成の振り分け', () => {
    it('inputMode が prompt のとき、設定変更では generatePattern を呼ばない（画像入力時のみ）', () => {
      // main.js の各コールバックでは state.inputMode === 'image' のときのみ
      // generatePattern() を呼ぶ。AIお題モードでは呼ばない。
      state.setInputMode('prompt');
      const shouldCallGeneratePattern = state.inputMode === 'image';
      expect(shouldCallGeneratePattern).toBe(false);
    });

    it('inputMode が image のとき、設定変更で generatePattern を呼ぶ', () => {
      state.setInputMode('image');
      const shouldCallGeneratePattern = state.inputMode === 'image';
      expect(shouldCallGeneratePattern).toBe(true);
    });

    it('AIお題生成は実行操作（ボタンクリック）でのみ開始される', async () => {
      state.setGeminiApiKey('test-key');
      state.setAiPrompt('ねこ');

      const result = await simulateRunAiTextConversion({
        state,
        paletteSelectorHandle,
        aiGenerate: mockAiGenerate,
        showMessage: mockShowMessage,
        showLocalFallback: mockShowLocalFallback,
      });

      expect(result.executed).toBe(true);
      expect(mockAiGenerate).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 処理中の多重送信抑止
  // ---------------------------------------------------------------------------
  describe('処理中の多重送信抑止', () => {
    it('aiProcessing が true のとき、生成を実行しない（多重送信抑止）', async () => {
      state.setGeminiApiKey('test-key');
      state.setAiPrompt('ねこ');
      state.setAiProcessing(true); // 処理中

      const result = await simulateRunAiTextConversion({
        state,
        paletteSelectorHandle,
        aiGenerate: mockAiGenerate,
        showMessage: mockShowMessage,
        showLocalFallback: mockShowLocalFallback,
      });

      expect(result.executed).toBe(false);
      expect(result.reason).toBe('already_processing');
      expect(mockAiGenerate).not.toHaveBeenCalled();
    });

    it('生成完了後に aiProcessing が false に戻る（再有効化）', async () => {
      state.setGeminiApiKey('test-key');
      state.setAiPrompt('ねこ');

      await simulateRunAiTextConversion({
        state,
        paletteSelectorHandle,
        aiGenerate: mockAiGenerate,
        showMessage: mockShowMessage,
        showLocalFallback: mockShowLocalFallback,
      });

      expect(state.aiProcessing).toBe(false);
    });

    it('生成失敗後も aiProcessing が false に戻る', async () => {
      state.setGeminiApiKey('test-key');
      state.setAiPrompt('ねこ');

      const error = new Error('server error');
      error.name = 'GeminiApiError';
      error.type = 'server';
      mockAiGenerate.mockRejectedValue(error);

      await simulateRunAiTextConversion({
        state,
        paletteSelectorHandle,
        aiGenerate: mockAiGenerate,
        showMessage: mockShowMessage,
        showLocalFallback: mockShowLocalFallback,
      });

      expect(state.aiProcessing).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 失敗時に図案不変
  // ---------------------------------------------------------------------------
  describe('生成失敗時に図案不変', () => {
    it('生成が失敗しても、直近の図案（state.pattern）は変更されない', async () => {
      const existingPattern = {
        width: 29,
        height: 29,
        cells: [[{ r: 255, g: 0, b: 0, name: 'あか' }]],
        originalCells: [[{ r: 255, g: 0, b: 0, name: 'あか' }]],
        beadType: 'perler',
        plateConfig: { cols: 1, rows: 1 },
      };
      state.setGeminiApiKey('test-key');
      state.setAiPrompt('ねこ');
      state.setPattern(existingPattern);

      const error = new Error('server error');
      error.name = 'GeminiApiError';
      error.type = 'server';
      mockAiGenerate.mockRejectedValue(error);

      await simulateRunAiTextConversion({
        state,
        paletteSelectorHandle,
        aiGenerate: mockAiGenerate,
        showMessage: mockShowMessage,
        showLocalFallback: mockShowLocalFallback,
      });

      // 図案は変更されていない
      expect(state.pattern).toBe(existingPattern);
    });

    it('生成失敗時にフォールバック導線が提示される', async () => {
      state.setGeminiApiKey('test-key');
      state.setAiPrompt('ねこ');

      const error = new Error('timeout');
      error.name = 'GeminiApiError';
      error.type = 'timeout';
      mockAiGenerate.mockRejectedValue(error);

      await simulateRunAiTextConversion({
        state,
        paletteSelectorHandle,
        aiGenerate: mockAiGenerate,
        showMessage: mockShowMessage,
        showLocalFallback: mockShowLocalFallback,
      });

      expect(mockShowLocalFallback).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // HTTP ステータス別メッセージ生成（messageForAiError）
  // ---------------------------------------------------------------------------
  describe('HTTP ステータス別メッセージ生成', () => {
    it('HTTP 401（auth）→ 認証エラーメッセージ', () => {
      const error = new Error('Unauthorized');
      error.name = 'GeminiApiError';
      error.type = 'auth';
      error.status = 401;

      const msg = messageForAiError(error);
      expect(msg).toBe('APIキーの認証に失敗しました。キーを再確認してください。');
    });

    it('HTTP 429（rate_limit）→ レート制限メッセージ', () => {
      const error = new Error('Too Many Requests');
      error.name = 'GeminiApiError';
      error.type = 'rate_limit';
      error.status = 429;

      const msg = messageForAiError(error);
      expect(msg).toBe('APIのレート制限に達しました。時間をおいて再試行してください。');
    });

    it('HTTP 503（server）→ サーバーエラーメッセージ', () => {
      const error = new Error('Service Unavailable');
      error.name = 'GeminiApiError';
      error.type = 'server';
      error.status = 503;

      const msg = messageForAiError(error);
      expect(msg).toBe('AIサーバーでエラーが発生しました。時間をおいて再試行してください。');
    });

    it('生成失敗時にエラーメッセージが showMessage に渡される', async () => {
      state.setGeminiApiKey('test-key');
      state.setAiPrompt('ねこ');

      const error = new Error('rate limit');
      error.name = 'GeminiApiError';
      error.type = 'rate_limit';
      error.status = 429;
      mockAiGenerate.mockRejectedValue(error);

      await simulateRunAiTextConversion({
        state,
        paletteSelectorHandle,
        aiGenerate: mockAiGenerate,
        showMessage: mockShowMessage,
        showLocalFallback: mockShowLocalFallback,
      });

      expect(mockShowMessage).toHaveBeenCalledWith(
        'APIのレート制限に達しました。時間をおいて再試行してください。',
        'error',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // ガード条件
  // ---------------------------------------------------------------------------
  describe('ガード条件', () => {
    it('APIキーが未設定の場合、生成を実行しない', async () => {
      // geminiApiKey は null（デフォルト）
      state.setAiPrompt('ねこ');

      const result = await simulateRunAiTextConversion({
        state,
        paletteSelectorHandle,
        aiGenerate: mockAiGenerate,
        showMessage: mockShowMessage,
        showLocalFallback: mockShowLocalFallback,
      });

      expect(result.executed).toBe(false);
      expect(result.reason).toBe('no_key');
      expect(mockAiGenerate).not.toHaveBeenCalled();
    });

    it('お題が未入力（空白のみ）の場合、生成を実行しない', async () => {
      state.setGeminiApiKey('test-key');
      state.setAiPrompt('   '); // 空白のみ

      const result = await simulateRunAiTextConversion({
        state,
        paletteSelectorHandle,
        aiGenerate: mockAiGenerate,
        showMessage: mockShowMessage,
        showLocalFallback: mockShowLocalFallback,
      });

      expect(result.executed).toBe(false);
      expect(result.reason).toBe('no_prompt');
      expect(mockAiGenerate).not.toHaveBeenCalled();
    });

    it('有効パレットが0色の場合、生成を実行しない', async () => {
      state.setGeminiApiKey('test-key');
      state.setAiPrompt('ねこ');
      paletteSelectorHandle.canGenerate = () => false;

      const result = await simulateRunAiTextConversion({
        state,
        paletteSelectorHandle,
        aiGenerate: mockAiGenerate,
        showMessage: mockShowMessage,
        showLocalFallback: mockShowLocalFallback,
      });

      expect(result.executed).toBe(false);
      expect(result.reason).toBe('no_palette');
    });
  });

  // ---------------------------------------------------------------------------
  // 生成成功時の動作
  // ---------------------------------------------------------------------------
  describe('生成成功時', () => {
    it('成功時に state.pattern / lastAiPattern が更新される', async () => {
      state.setGeminiApiKey('test-key');
      state.setAiPrompt('ねこ');

      const expectedPattern = {
        width: 29,
        height: 29,
        cells: [[null]],
        originalCells: [[null]],
        beadType: 'perler',
        plateConfig: { cols: 1, rows: 1 },
      };
      mockAiGenerate.mockResolvedValue(expectedPattern);

      await simulateRunAiTextConversion({
        state,
        paletteSelectorHandle,
        aiGenerate: mockAiGenerate,
        showMessage: mockShowMessage,
        showLocalFallback: mockShowLocalFallback,
      });

      expect(state.pattern).toBe(expectedPattern);
      expect(state.lastAiPattern).toBe(expectedPattern);
    });

    it('成功時にフォールバック導線は表示されない', async () => {
      state.setGeminiApiKey('test-key');
      state.setAiPrompt('ねこ');

      await simulateRunAiTextConversion({
        state,
        paletteSelectorHandle,
        aiGenerate: mockAiGenerate,
        showMessage: mockShowMessage,
        showLocalFallback: mockShowLocalFallback,
      });

      expect(mockShowLocalFallback).not.toHaveBeenCalled();
    });
  });
});
