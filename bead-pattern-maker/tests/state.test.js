import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import {
  clampZoom,
  createInitialState,
  createAppState,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_DEFAULT,
  VALID_INPUT_MODES,
  VALID_GEMINI_MODELS,
  GEMINI_MODELS,
} from '../src/state.js';

// =============================================================================
// アプリケーション状態管理（state.js）のテスト
// -----------------------------------------------------------------------------
// 対象: src/state.js
//   - clampZoom(value)        … 任意の数値を [0.5, 4.0] にクランプする純関数
//   - createInitialState()    … AppState の初期値オブジェクトを生成
//   - createAppState(over?)   … getter / setter / subscribe を備えた状態ストア
//
// 本ファイルは以下の2タスク分のテストをまとめて収める。
//   - タスク10.2: ズーム値クランプのプロパティテスト（Property 9）
//   - タスク10.3: state のユニットテスト（初期値 / 各setter反映 / ズーム境界 / 通知）
//
// 検証対象: Requirements 2.1, 3.5, 5.3
//
// プロパティテストは fast-check で最低100回反復実行し、it 名にタグ
// `Feature: bead-pattern-maker, Property 9: ズーム値のクランプ` を付与する。
// =============================================================================

// =============================================================================
// タスク10.2 / Property 9: ズーム値のクランプ
//   任意の数値に対して、clampZoom（および setZoom 経由）の結果は
//   必ず ZOOM_MIN(0.5) 以上 ZOOM_MAX(4.0) 以下に収まる。
// **Validates: Requirements 5.3**
// =============================================================================
describe('state ズーム値クランプ / プロパティテスト（タスク10.2）', () => {
  /**
   * 「任意の数値」のジェネレーター。
   * 範囲境界（0.5 / 4.0）付近を密にカバーしつつ、極端に大きい/小さい有限値や
   * 整数値も含めることで「範囲未満 / 範囲内 / 範囲超過」の3ケースを自然に網羅する。
   * （NaN・±Infinity は数値ではないため、clampZoom 単体ユニットテストで個別に検証する）
   * @type {fc.Arbitrary<number>}
   */
  const zoomInputArb = fc.oneof(
    // 下限・上限付近を密にカバー（-2.0 〜 6.0）
    fc.double({ min: -2, max: 6, noNaN: true }),
    // 極端な大小の有限値
    fc.double({ min: -1e9, max: 1e9, noNaN: true }),
    // 整数値
    fc.integer({ min: -1000, max: 1000 }),
  );

  it('Feature: bead-pattern-maker, Property 9: ズーム値のクランプ（任意の数値が 0.5〜4.0 にクランプされる）', () => {
    fc.assert(
      fc.property(zoomInputArb, (value) => {
        // (1) clampZoom 直接: 戻り値は必ず [ZOOM_MIN, ZOOM_MAX] に収まる。
        const clamped = clampZoom(value);
        expect(clamped).toBeGreaterThanOrEqual(ZOOM_MIN);
        expect(clamped).toBeLessThanOrEqual(ZOOM_MAX);

        // (2) setZoom 経由: ストアに反映されたズーム値も同じ範囲に収まる。
        const store = createAppState();
        store.setZoom(value);
        expect(store.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
        expect(store.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// タスク10.3: state のユニットテスト
// **検証対象: Requirements 2.1, 3.5, 5.3**
// =============================================================================
describe('state ユニットテスト（タスク10.3）', () => {
  // ---------------------------------------------------------------------------
  // clampZoom 単体（特殊値・境界）
  // ---------------------------------------------------------------------------
  describe('clampZoom（特殊値・境界）', () => {
    it('範囲内の値はそのまま返す', () => {
      expect(clampZoom(1.0)).toBe(1.0);
      expect(clampZoom(2.5)).toBe(2.5);
    });

    it('下限未満は ZOOM_MIN(0.5) にクランプする', () => {
      expect(clampZoom(0.4)).toBe(ZOOM_MIN);
      expect(clampZoom(0)).toBe(ZOOM_MIN);
      expect(clampZoom(-100)).toBe(ZOOM_MIN);
      expect(clampZoom(-Infinity)).toBe(ZOOM_MIN);
    });

    it('上限超過は ZOOM_MAX(4.0) にクランプする', () => {
      expect(clampZoom(5.0)).toBe(ZOOM_MAX);
      expect(clampZoom(1000)).toBe(ZOOM_MAX);
      expect(clampZoom(Infinity)).toBe(ZOOM_MAX);
    });

    it('境界値（0.5 / 4.0）はそのまま返す', () => {
      expect(clampZoom(ZOOM_MIN)).toBe(0.5);
      expect(clampZoom(ZOOM_MAX)).toBe(4.0);
    });

    it('NaN・数値化できない値は ZOOM_DEFAULT(1.0) にフォールバックする', () => {
      expect(clampZoom(NaN)).toBe(ZOOM_DEFAULT);
      expect(clampZoom('abc')).toBe(ZOOM_DEFAULT);
      expect(clampZoom(undefined)).toBe(ZOOM_DEFAULT);
    });

    it('数値文字列は数値として解釈してクランプする', () => {
      expect(clampZoom('2.5')).toBe(2.5);
      expect(clampZoom('10')).toBe(ZOOM_MAX);
    });
  });

  // ---------------------------------------------------------------------------
  // createInitialState（初期値）
  // ---------------------------------------------------------------------------
  describe('createInitialState（初期値）', () => {
    it('設計どおりの初期値を持つ（要件 2.1 / 3.5 / 5.3 / 10.1 / 10.4 / 11.3）', () => {
      expect(createInitialState()).toEqual({
        beadType: 'perler', // 要件2.1: 初期はパーラービーズ
        plateConfig: { cols: 1, rows: 1 }, // 要件3.5: 初期は1x1
        uploadedImage: null,
        pattern: null,
        zoom: 1.0, // 要件5.3: 初期ズーム100%
        recommendedSizes: [],
        backgroundExclusion: {
          enabled: false,
          color: null,
          threshold: 10,
          autoDetected: false,
        },
        resizeMethod: 'smooth', // 要件10.1
        fitMode: 'contain', // 要件10.4
        disabledColorIds: [],
        maxColors: null, // 要件11.3: 初期は制限なし
        editTool: { type: 'paint', color: null },
        // 入力方法・AI生成関連（メモリのみ）
        inputMode: 'image',
        geminiApiKey: null,
        geminiModel: 'gemini-2.5-flash',
        aiProcessing: false,
        lastAiPattern: null,
        aiPrompt: '',
      });
    });

    it('呼び出しごとに独立したオブジェクトを返す（ネストも共有しない）', () => {
      const a = createInitialState();
      const b = createInitialState();

      // 別インスタンスであること
      expect(a).not.toBe(b);
      expect(a.plateConfig).not.toBe(b.plateConfig);
      expect(a.backgroundExclusion).not.toBe(b.backgroundExclusion);
      expect(a.editTool).not.toBe(b.editTool);
      expect(a.disabledColorIds).not.toBe(b.disabledColorIds);

      // 一方を変更しても他方に影響しない
      a.plateConfig.cols = 5;
      a.disabledColorIds.push('P01');
      expect(b.plateConfig.cols).toBe(1);
      expect(b.disabledColorIds).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // createAppState（getter / getState の初期反映）
  // ---------------------------------------------------------------------------
  describe('createAppState（初期 getter / getState）', () => {
    it('getter が初期値を返す', () => {
      const store = createAppState();
      expect(store.beadType).toBe('perler');
      expect(store.plateConfig).toEqual({ cols: 1, rows: 1 });
      expect(store.uploadedImage).toBeNull();
      expect(store.pattern).toBeNull();
      expect(store.zoom).toBe(1.0);
      expect(store.recommendedSizes).toEqual([]);
      expect(store.resizeMethod).toBe('smooth');
      expect(store.fitMode).toBe('contain');
      expect(store.disabledColorIds).toEqual([]);
      expect(store.maxColors).toBeNull();
      expect(store.editTool).toEqual({ type: 'paint', color: null });
      expect(store.backgroundExclusion).toEqual({
        enabled: false,
        color: null,
        threshold: 10,
        autoDetected: false,
      });
    });

    it('overrides で初期値を上書きできる（主にテスト用）', () => {
      const store = createAppState({ beadType: 'nano', zoom: 2.0 });
      expect(store.beadType).toBe('nano');
      expect(store.zoom).toBe(2.0);
      // 指定しなかったフィールドは初期値のまま
      expect(store.fitMode).toBe('contain');
    });

    it('getState は現在状態のスナップショット（複製）を返す', () => {
      const store = createAppState();
      const snap = store.getState();

      expect(snap.beadType).toBe('perler');
      expect(snap.plateConfig).toEqual({ cols: 1, rows: 1 });

      // スナップショットのネストを変更しても内部状態は壊れない
      snap.plateConfig.cols = 9;
      snap.disabledColorIds.push('X');
      expect(store.plateConfig.cols).toBe(1);
      expect(store.disabledColorIds).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // 各 setter の反映
  // ---------------------------------------------------------------------------
  describe('setter の反映', () => {
    it('setBeadType: 有効値を反映し、無効値は無視する（要件2.1）', () => {
      const store = createAppState();
      store.setBeadType('nano');
      expect(store.beadType).toBe('nano');

      // 'perler' / 'nano' 以外は無視（直前値を維持）
      store.setBeadType('invalid');
      expect(store.beadType).toBe('nano');
    });

    it('setPlateConfig: オブジェクト形式・個別引数の両方を受け付ける（要件3.5）', () => {
      const store = createAppState();

      store.setPlateConfig({ cols: 2, rows: 3 });
      expect(store.plateConfig).toEqual({ cols: 2, rows: 3 });

      store.setPlateConfig(4, 5);
      expect(store.plateConfig).toEqual({ cols: 4, rows: 5 });
    });

    it('setPlateConfig: 1〜10 の整数にクランプ・丸めする', () => {
      const store = createAppState();

      // 範囲外はクランプ（0→1, 11→10）
      store.setPlateConfig(0, 11);
      expect(store.plateConfig).toEqual({ cols: 1, rows: 10 });

      // 小数は四捨五入
      store.setPlateConfig(2.4, 3.6);
      expect(store.plateConfig).toEqual({ cols: 2, rows: 4 });
    });

    it('setPlateConfig: 非数値は直前の有効値を維持する（要件3.6）', () => {
      const store = createAppState();
      store.setPlateConfig(3, 4);
      expect(store.plateConfig).toEqual({ cols: 3, rows: 4 });

      // NaN / 非数値は直前値を維持
      store.setPlateConfig(NaN, NaN);
      expect(store.plateConfig).toEqual({ cols: 3, rows: 4 });
    });

    it('setZoom: 値を反映し、範囲外はクランプする（要件5.3）', () => {
      const store = createAppState();
      store.setZoom(2.0);
      expect(store.zoom).toBe(2.0);
    });

    it('setResizeMethod: 有効値を反映し、無効値は無視する（要件10.1）', () => {
      const store = createAppState();
      store.setResizeMethod('sharp');
      expect(store.resizeMethod).toBe('sharp');

      store.setResizeMethod('invalid');
      expect(store.resizeMethod).toBe('sharp');
    });

    it('setFitMode: 有効値を反映し、無効値は無視する（要件10.4）', () => {
      const store = createAppState();
      store.setFitMode('cover');
      expect(store.fitMode).toBe('cover');

      store.setFitMode('stretch');
      expect(store.fitMode).toBe('stretch');

      store.setFitMode('invalid');
      expect(store.fitMode).toBe('stretch');
    });

    it('setMaxColors: 整数を反映し、null/"unlimited"/""/0以下は制限なし(null)に正規化する（要件11.3）', () => {
      const store = createAppState();

      store.setMaxColors(16);
      expect(store.maxColors).toBe(16);

      store.setMaxColors(null);
      expect(store.maxColors).toBeNull();

      store.setMaxColors(8);
      expect(store.maxColors).toBe(8);
      store.setMaxColors('unlimited');
      expect(store.maxColors).toBeNull();

      store.setMaxColors(5);
      store.setMaxColors('');
      expect(store.maxColors).toBeNull();

      store.setMaxColors(0); // 0以下は制限なし扱い
      expect(store.maxColors).toBeNull();

      store.setMaxColors('12'); // 数値文字列は整数化
      expect(store.maxColors).toBe(12);
    });

    it('setBackgroundExclusion: 部分更新し、threshold を 0〜50 にクランプする（要件9）', () => {
      const store = createAppState();

      // enabled のみ更新（他は維持）
      store.setBackgroundExclusion({ enabled: true });
      expect(store.backgroundExclusion).toEqual({
        enabled: true,
        color: null,
        threshold: 10,
        autoDetected: false,
      });

      // color と autoDetected を更新
      store.setBackgroundExclusion({
        color: { r: 1, g: 2, b: 3 },
        autoDetected: true,
      });
      expect(store.backgroundExclusion.color).toEqual({ r: 1, g: 2, b: 3 });
      expect(store.backgroundExclusion.autoDetected).toBe(true);

      // threshold の上限クランプ（100→50）
      store.setBackgroundExclusion({ threshold: 100 });
      expect(store.backgroundExclusion.threshold).toBe(50);

      // threshold の下限クランプ（-5→0）
      store.setBackgroundExclusion({ threshold: -5 });
      expect(store.backgroundExclusion.threshold).toBe(0);

      // null/非オブジェクトは無視
      store.setBackgroundExclusion(null);
      expect(store.backgroundExclusion.threshold).toBe(0);
    });

    it('setEditTool: paint は色を保持し、erase は color を強制的に null にする（要件12.1）', () => {
      const store = createAppState();

      const red = { id: 'R', name: 'red', r: 255, g: 0, b: 0 };
      store.setEditTool({ type: 'paint', color: red });
      expect(store.editTool).toEqual({ type: 'paint', color: red });

      // erase のときは color が指定されても null に矯正される
      store.setEditTool({ type: 'erase', color: red });
      expect(store.editTool).toEqual({ type: 'erase', color: null });

      // 無効な type / null は無視（直前値を維持）
      store.setEditTool({ type: 'invalid', color: red });
      expect(store.editTool).toEqual({ type: 'erase', color: null });
      store.setEditTool(null);
      expect(store.editTool).toEqual({ type: 'erase', color: null });
    });

    it('setUploadedImage / setPattern / setRecommendedSizes / setDisabledColorIds を反映する', () => {
      const store = createAppState();

      const image = { width: 10, height: 10 };
      store.setUploadedImage(image);
      expect(store.uploadedImage).toBe(image);

      const pattern = { width: 1, height: 1, cells: [[null]] };
      store.setPattern(pattern);
      expect(store.pattern).toBe(pattern);

      const sizes = [{ cols: 1, rows: 1, totalBeads: 841 }];
      store.setRecommendedSizes(sizes);
      expect(store.recommendedSizes).toEqual(sizes);

      store.setDisabledColorIds(['P01', 'P02']);
      expect(store.disabledColorIds).toEqual(['P01', 'P02']);

      // 配列以外を渡すと空配列にフォールバック
      store.setRecommendedSizes(null);
      expect(store.recommendedSizes).toEqual([]);
      store.setDisabledColorIds(undefined);
      expect(store.disabledColorIds).toEqual([]);
    });

    it('setDisabledColorIds は内部配列を複製して保持する（外部変更の影響を受けない）', () => {
      const store = createAppState();
      const ids = ['P01'];
      store.setDisabledColorIds(ids);

      // 渡した配列を後から変更しても内部状態は不変
      ids.push('P99');
      expect(store.disabledColorIds).toEqual(['P01']);
    });
  });

  // ---------------------------------------------------------------------------
  // ズーム境界（タスク10.3 で明示指定: 0.4→0.5, 5.0→4.0）
  // ---------------------------------------------------------------------------
  describe('ズーム境界（要件5.3）', () => {
    it('setZoom(0.4) は 0.5 にクランプされる', () => {
      const store = createAppState();
      store.setZoom(0.4);
      expect(store.zoom).toBe(0.5);
    });

    it('setZoom(5.0) は 4.0 にクランプされる', () => {
      const store = createAppState();
      store.setZoom(5.0);
      expect(store.zoom).toBe(4.0);
    });

    it('境界値ちょうど（0.5 / 4.0）はそのまま反映される', () => {
      const store = createAppState();
      store.setZoom(0.5);
      expect(store.zoom).toBe(0.5);
      store.setZoom(4.0);
      expect(store.zoom).toBe(4.0);
    });
  });

  // ---------------------------------------------------------------------------
  // subscribe / notify（変更通知）
  // ---------------------------------------------------------------------------
  describe('subscribe / notify（変更通知）', () => {
    it('値が変化した setter 呼び出しでリスナーが最新スナップショット付きで呼ばれる', () => {
      const store = createAppState();
      const listener = vi.fn();
      store.subscribe(listener);

      store.setBeadType('nano');

      expect(listener).toHaveBeenCalledTimes(1);
      // 通知されるのは最新状態のスナップショット
      expect(listener.mock.calls[0][0].beadType).toBe('nano');
    });

    it('値が変化しない setter 呼び出しでは通知しない', () => {
      const store = createAppState();
      const listener = vi.fn();
      store.subscribe(listener);

      // 初期値と同じ値を設定（perler / zoom=1.0 / 1x1）→ 通知なし
      store.setBeadType('perler');
      store.setZoom(1.0);
      store.setPlateConfig(1, 1);

      expect(listener).not.toHaveBeenCalled();
    });

    it('subscribe の戻り値（解除関数）で以降の通知を停止できる', () => {
      const store = createAppState();
      const listener = vi.fn();
      const unsubscribe = store.subscribe(listener);

      store.setZoom(2.0);
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      store.setZoom(3.0);
      // 解除後は呼ばれない
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('複数リスナーへ通知し、1つの例外が他へ波及しない', () => {
      const store = createAppState();
      const throwing = vi.fn(() => {
        throw new Error('listener error');
      });
      const normal = vi.fn();
      store.subscribe(throwing);
      store.subscribe(normal);

      // throwing が例外を投げても normal は呼ばれる（内部で握りつぶす）
      store.setZoom(2.5);

      expect(throwing).toHaveBeenCalledTimes(1);
      expect(normal).toHaveBeenCalledTimes(1);
    });

    it('setDisabledColorIds は配列を置き換え、毎回通知する', () => {
      const store = createAppState();
      const listener = vi.fn();
      store.subscribe(listener);

      store.setDisabledColorIds(['P01']);
      store.setDisabledColorIds(['P01']); // 同内容でも置き換え＝通知する

      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('subscribe に関数以外を渡すと TypeError を投げる', () => {
      const store = createAppState();
      expect(() => store.subscribe(null)).toThrow(TypeError);
      expect(() => store.subscribe(123)).toThrow(TypeError);
    });
  });
});

// =============================================================================
// タスク1.1: AI関連フィールド・setterのユニットテスト
// **検証対象: Requirements 1.2, 1.3, 3.5, 3.6, 5.1, 5.2, 5.4, 5.5, 5.6, 6.5, 6.6, 8.3, 8.4**
// =============================================================================
describe('state AI関連フィールドのユニットテスト（タスク1.1）', () => {
  // ---------------------------------------------------------------------------
  // createInitialState のAI関連初期値
  // ---------------------------------------------------------------------------
  describe('createInitialState AI関連初期値', () => {
    it('入力方法・AI関連フィールドの初期値が正しい', () => {
      const initial = createInitialState();
      expect(initial.inputMode).toBe('image');
      expect(initial.geminiApiKey).toBeNull();
      expect(initial.geminiModel).toBe('gemini-2.5-flash');
      expect(initial.aiProcessing).toBe(false);
      expect(initial.lastAiPattern).toBeNull();
      expect(initial.aiPrompt).toBe('');
    });
  });

  // ---------------------------------------------------------------------------
  // VALID_INPUT_MODES 定数
  // ---------------------------------------------------------------------------
  describe('VALID_INPUT_MODES', () => {
    it("'image' と 'prompt' のみを含む", () => {
      expect(VALID_INPUT_MODES).toEqual(['image', 'prompt']);
    });
  });

  // ---------------------------------------------------------------------------
  // setInputMode（入力方法）
  // ---------------------------------------------------------------------------
  describe('setInputMode（入力方法）', () => {
    it("'prompt' を設定できる", () => {
      const store = createAppState();
      store.setInputMode('prompt');
      expect(store.inputMode).toBe('prompt');
    });

    it("'image' を設定できる", () => {
      const store = createAppState();
      store.setInputMode('prompt');
      store.setInputMode('image');
      expect(store.inputMode).toBe('image');
    });

    it("不正な値は無視する（旧変換方式の値 'local'/'ai' も無効）", () => {
      const store = createAppState();
      store.setInputMode('invalid');
      expect(store.inputMode).toBe('image');
      store.setInputMode('');
      expect(store.inputMode).toBe('image');
      store.setInputMode(null);
      expect(store.inputMode).toBe('image');
      store.setInputMode(undefined);
      expect(store.inputMode).toBe('image');
      store.setInputMode('local');
      expect(store.inputMode).toBe('image');
      store.setInputMode('ai');
      expect(store.inputMode).toBe('image');
    });

    it("変化時にリスナーへ通知する", () => {
      const store = createAppState();
      const listener = vi.fn();
      store.subscribe(listener);
      store.setInputMode('prompt');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].inputMode).toBe('prompt');
    });

    it("同じ値を設定しても通知しない", () => {
      const store = createAppState();
      const listener = vi.fn();
      store.subscribe(listener);
      store.setInputMode('image'); // 初期値と同じ
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // VALID_GEMINI_MODELS 定数
  // ---------------------------------------------------------------------------
  describe('VALID_GEMINI_MODELS', () => {
    it('テキスト→JSON生成対応の汎用モデルID一覧を含む', () => {
      expect(VALID_GEMINI_MODELS).toEqual([
        'gemini-2.5-flash',
        'gemini-3.1-flash-lite',
        'gemini-2.5-flash-lite',
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
        'gemini-2.5-pro',
        'gemini-3.1-pro',
      ]);
    });

    it('既定値（gemini-2.5-flash）が許可リストに含まれる', () => {
      expect(VALID_GEMINI_MODELS).toContain('gemini-2.5-flash');
    });

    it('GEMINI_MODELS.map((m) => m.id) から導出される', () => {
      expect(VALID_GEMINI_MODELS).toEqual(GEMINI_MODELS.map((m) => m.id));
    });
  });

  // ---------------------------------------------------------------------------
  // GEMINI_MODELS 構造化データ
  // ---------------------------------------------------------------------------
  describe('GEMINI_MODELS', () => {
    it('配列であり、各要素が id/label/freeTier を持つ', () => {
      expect(Array.isArray(GEMINI_MODELS)).toBe(true);
      expect(GEMINI_MODELS.length).toBeGreaterThan(0);
      for (const model of GEMINI_MODELS) {
        expect(typeof model.id).toBe('string');
        expect(model.id.length).toBeGreaterThan(0);
        expect(typeof model.label).toBe('string');
        expect(model.label.length).toBeGreaterThan(0);
        expect(typeof model.freeTier).toBe('boolean');
      }
    });

    it('無料枠（freeTier=true）に gemini-2.5-flash と gemini-2.5-flash-lite を含む', () => {
      const freeTierIds = GEMINI_MODELS.filter((m) => m.freeTier).map((m) => m.id);
      expect(freeTierIds).toContain('gemini-2.5-flash');
      expect(freeTierIds).toContain('gemini-2.5-flash-lite');
    });

    it('id 一覧が VALID_GEMINI_MODELS と一致する', () => {
      expect(GEMINI_MODELS.map((m) => m.id)).toEqual(VALID_GEMINI_MODELS);
    });
  });

  // ---------------------------------------------------------------------------
  // setGeminiModel（モデル切り替え）
  // ---------------------------------------------------------------------------
  describe('setGeminiModel（モデル切り替え）', () => {
    it('許可リストの有効なモデルを反映する', () => {
      const store = createAppState();
      store.setGeminiModel('gemini-2.5-flash-lite');
      expect(store.geminiModel).toBe('gemini-2.5-flash-lite');

      store.setGeminiModel('gemini-2.0-flash');
      expect(store.geminiModel).toBe('gemini-2.0-flash');

      store.setGeminiModel('gemini-2.0-flash-lite');
      expect(store.geminiModel).toBe('gemini-2.0-flash-lite');

      store.setGeminiModel('gemini-2.5-pro');
      expect(store.geminiModel).toBe('gemini-2.5-pro');

      store.setGeminiModel('gemini-2.5-flash');
      expect(store.geminiModel).toBe('gemini-2.5-flash');
    });

    it('gemini-3.1-pro を有効値として設定できる', () => {
      const store = createAppState();
      store.setGeminiModel('gemini-3.1-pro');
      expect(store.geminiModel).toBe('gemini-3.1-pro');
    });

    it('許可リスト以外の値は無視する（直前値を維持）', () => {
      const store = createAppState();
      // 初期値は gemini-2.5-flash
      store.setGeminiModel('gemini-1.5-pro'); // 許可外
      expect(store.geminiModel).toBe('gemini-2.5-flash');

      store.setGeminiModel('invalid-model');
      expect(store.geminiModel).toBe('gemini-2.5-flash');

      store.setGeminiModel('');
      expect(store.geminiModel).toBe('gemini-2.5-flash');

      store.setGeminiModel(null);
      expect(store.geminiModel).toBe('gemini-2.5-flash');

      store.setGeminiModel(undefined);
      expect(store.geminiModel).toBe('gemini-2.5-flash');
    });

    it('変化時にリスナーへ通知する', () => {
      const store = createAppState();
      const listener = vi.fn();
      store.subscribe(listener);
      store.setGeminiModel('gemini-2.0-flash');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].geminiModel).toBe('gemini-2.0-flash');
    });

    it('同じ値を設定しても通知しない', () => {
      const store = createAppState();
      const listener = vi.fn();
      store.subscribe(listener);
      store.setGeminiModel('gemini-2.5-flash'); // 初期値と同じ
      expect(listener).not.toHaveBeenCalled();
    });

    it('許可外の値で拒否されたとき通知しない', () => {
      const store = createAppState();
      const listener = vi.fn();
      store.subscribe(listener);
      store.setGeminiModel('not-a-real-model');
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // setGeminiApiKey（要件3.5/3.6）
  // ---------------------------------------------------------------------------
  describe('setGeminiApiKey（要件3.5/3.6）', () => {
    it("trim後1文字以上ならキーを保持して true を返す", () => {
      const store = createAppState();
      const result = store.setGeminiApiKey('  my-key-123  ');
      expect(result).toBe(true);
      expect(store.geminiApiKey).toBe('my-key-123');
    });

    it("空文字は false を返し、キーを変更しない", () => {
      const store = createAppState();
      store.setGeminiApiKey('existing-key');
      const result = store.setGeminiApiKey('');
      expect(result).toBe(false);
      expect(store.geminiApiKey).toBe('existing-key');
    });

    it("空白のみは false を返し、キーを変更しない", () => {
      const store = createAppState();
      store.setGeminiApiKey('existing-key');
      const result = store.setGeminiApiKey('   ');
      expect(result).toBe(false);
      expect(store.geminiApiKey).toBe('existing-key');
    });

    it("非文字列を渡すと false を返し、キーを変更しない", () => {
      const store = createAppState();
      store.setGeminiApiKey('existing-key');
      expect(store.setGeminiApiKey(null)).toBe(false);
      expect(store.setGeminiApiKey(undefined)).toBe(false);
      expect(store.setGeminiApiKey(123)).toBe(false);
      expect(store.geminiApiKey).toBe('existing-key');
    });

    it("キー設定時にリスナーへ通知する", () => {
      const store = createAppState();
      const listener = vi.fn();
      store.subscribe(listener);
      store.setGeminiApiKey('key-abc');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].geminiApiKey).toBe('key-abc');
    });

    it("空白のみで拒否されたとき通知しない", () => {
      const store = createAppState();
      const listener = vi.fn();
      store.subscribe(listener);
      store.setGeminiApiKey('  ');
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // clearGeminiApiKey（要件5.5/5.6）
  // ---------------------------------------------------------------------------
  describe('clearGeminiApiKey（要件5.5/5.6）', () => {
    it("キーを null に破棄する", () => {
      const store = createAppState();
      store.setGeminiApiKey('my-key');
      store.clearGeminiApiKey();
      expect(store.geminiApiKey).toBeNull();
    });

    it("破棄時にリスナーへ通知する", () => {
      const store = createAppState();
      store.setGeminiApiKey('key-xyz');
      const listener = vi.fn();
      store.subscribe(listener);
      store.clearGeminiApiKey();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].geminiApiKey).toBeNull();
    });

    it("既に null のときは通知しない", () => {
      const store = createAppState();
      const listener = vi.fn();
      store.subscribe(listener);
      store.clearGeminiApiKey(); // 初期値 null → null
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // setAiProcessing（要件8.3/8.4）
  // ---------------------------------------------------------------------------
  describe('setAiProcessing（要件8.3/8.4）', () => {
    it("true を設定できる", () => {
      const store = createAppState();
      store.setAiProcessing(true);
      expect(store.aiProcessing).toBe(true);
    });

    it("false を設定できる", () => {
      const store = createAppState();
      store.setAiProcessing(true);
      store.setAiProcessing(false);
      expect(store.aiProcessing).toBe(false);
    });

    it("truthy/falsy 値は Boolean に変換される", () => {
      const store = createAppState();
      store.setAiProcessing('yes');
      expect(store.aiProcessing).toBe(true);
      store.setAiProcessing('');
      expect(store.aiProcessing).toBe(false);
    });

    it("変化時にリスナーへ通知する", () => {
      const store = createAppState();
      const listener = vi.fn();
      store.subscribe(listener);
      store.setAiProcessing(true);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("同じ値を設定しても通知しない", () => {
      const store = createAppState();
      const listener = vi.fn();
      store.subscribe(listener);
      store.setAiProcessing(false); // 初期値と同じ
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // setLastAiPattern
  // ---------------------------------------------------------------------------
  describe('setLastAiPattern', () => {
    it("PatternGrid を設定・取得できる", () => {
      const store = createAppState();
      const mockPattern = { width: 29, height: 29, cells: [] };
      store.setLastAiPattern(mockPattern);
      expect(store.lastAiPattern).toBe(mockPattern);
    });

    it("null を設定して消去できる", () => {
      const store = createAppState();
      store.setLastAiPattern({ width: 29, height: 29, cells: [] });
      store.setLastAiPattern(null);
      expect(store.lastAiPattern).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // setAiPrompt（お題テキスト）
  // ---------------------------------------------------------------------------
  describe('setAiPrompt（お題テキスト）', () => {
    it("文字列をそのまま反映する", () => {
      const store = createAppState();
      store.setAiPrompt('ねこ');
      expect(store.aiPrompt).toBe('ねこ');

      store.setAiPrompt('ハート');
      expect(store.aiPrompt).toBe('ハート');
    });

    it("空文字を設定できる", () => {
      const store = createAppState();
      store.setAiPrompt('ねこ');
      store.setAiPrompt('');
      expect(store.aiPrompt).toBe('');
    });

    it("非文字列は '' に正規化する", () => {
      const store = createAppState();
      store.setAiPrompt('ねこ');
      store.setAiPrompt(null);
      expect(store.aiPrompt).toBe('');

      store.setAiPrompt('ねこ');
      store.setAiPrompt(undefined);
      expect(store.aiPrompt).toBe('');

      store.setAiPrompt('ねこ');
      store.setAiPrompt(123);
      expect(store.aiPrompt).toBe('');
    });

    it("変化時にリスナーへ通知する", () => {
      const store = createAppState();
      const listener = vi.fn();
      store.subscribe(listener);
      store.setAiPrompt('ねこ');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].aiPrompt).toBe('ねこ');
    });

    it("同じ値を設定しても通知しない", () => {
      const store = createAppState();
      const listener = vi.fn();
      store.subscribe(listener);
      store.setAiPrompt(''); // 初期値と同じ
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // getState スナップショットへの反映
  // ---------------------------------------------------------------------------
  describe('getState スナップショットへの反映', () => {
    it("入力方法・AI関連フィールドがスナップショットに含まれる", () => {
      const store = createAppState();
      store.setInputMode('prompt');
      store.setGeminiApiKey('test-key');
      store.setGeminiModel('gemini-2.5-flash');
      store.setAiProcessing(true);
      store.setLastAiPattern({ width: 10, height: 10, cells: [] });
      store.setAiPrompt('ねこ');

      const snapshot = store.getState();
      expect(snapshot.inputMode).toBe('prompt');
      expect(snapshot.geminiApiKey).toBe('test-key');
      expect(snapshot.geminiModel).toBe('gemini-2.5-flash');
      expect(snapshot.aiProcessing).toBe(true);
      expect(snapshot.lastAiPattern).toEqual({ width: 10, height: 10, cells: [] });
      expect(snapshot.aiPrompt).toBe('ねこ');
    });

    it("スナップショットは内部状態のコピーであり直接変更に影響されない", () => {
      const store = createAppState();
      store.setGeminiApiKey('original-key');
      const snapshot = store.getState();
      // スナップショットの値を変更しても内部状態は変わらない
      snapshot.geminiApiKey = 'tampered';
      expect(store.geminiApiKey).toBe('original-key');
    });
  });

  // ---------------------------------------------------------------------------
  // 非永続化の確認（メモリのみ・要件5.1/5.2）
  // ---------------------------------------------------------------------------
  describe('非永続化（要件5.1/5.2）', () => {
    it("APIキー設定後も localStorage / sessionStorage に書き込まない", () => {
      // テスト環境で storage の setItem を監視
      const localSpy = vi.spyOn(Storage.prototype, 'setItem');

      const store = createAppState();
      store.setGeminiApiKey('secret-key-123');
      store.setInputMode('prompt');

      // setItem が一度も呼ばれていないことを確認
      expect(localSpy).not.toHaveBeenCalled();
      localSpy.mockRestore();
    });
  });
});

// =============================================================================
// タスク1.4: createInitialState() リロード相当リセットの検証
// AI関連状態を変更した後、createInitialState() が初期値に戻ることを確認する。
// **検証対象: Requirements 1.2, 5.1, 6.6, 8.3**
// =============================================================================
describe('createInitialState() リロード相当リセットの検証（タスク1.4）', () => {
  it('AI関連フィールドを変更後、createInitialState() は初期値（geminiApiKey=null, inputMode=image）を返す', () => {
    // ストアを作成して 入力方法・AI 関連の状態をすべて変更する
    const store = createAppState();
    store.setInputMode('prompt');
    store.setGeminiApiKey('my-secret-key');
    store.setAiProcessing(true);
    store.setLastAiPattern({ width: 29, height: 29, cells: [[]] });

    // 変更が反映されていることを確認
    expect(store.inputMode).toBe('prompt');
    expect(store.geminiApiKey).toBe('my-secret-key');
    expect(store.aiProcessing).toBe(true);
    expect(store.lastAiPattern).not.toBeNull();

    // createInitialState() はリロード相当: すべて初期値に戻る
    const fresh = createInitialState();
    expect(fresh.inputMode).toBe('image');
    expect(fresh.geminiApiKey).toBeNull();
    expect(fresh.aiProcessing).toBe(false);
    expect(fresh.lastAiPattern).toBeNull();
  });

  it('createInitialState() で新しいストアを生成すると以前のストアの状態に影響されない', () => {
    // 1つ目のストアで状態を変更
    const store1 = createAppState();
    store1.setInputMode('prompt');
    store1.setGeminiApiKey('key-store1');

    // 2つ目のストアを生成（リロード相当）
    const store2 = createAppState();

    // 2つ目は初期値であること
    expect(store2.inputMode).toBe('image');
    expect(store2.geminiApiKey).toBeNull();
    expect(store2.aiProcessing).toBe(false);
    expect(store2.lastAiPattern).toBeNull();

    // 1つ目は変更が維持されていること
    expect(store1.inputMode).toBe('prompt');
    expect(store1.geminiApiKey).toBe('key-store1');
  });
});
