import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  detectLocale,
  getLocale,
  setLocale,
  t,
  getColorName,
} from '../src/i18n.js';

// =============================================================================
// i18n モジュール（src/i18n.js）のユニットテスト
// -----------------------------------------------------------------------------
// currentLocale はモジュールグローバルな状態であるため、各テストで明示的に
// ロケールを設定し、afterEach で必ず既定（'en'）へ戻す。stubGlobal も解除して
// 他テストへ副作用が漏れないようにする（テスト間の順序非依存を担保）。
// =============================================================================

afterEach(() => {
  setLocale('en');
  vi.unstubAllGlobals();
});

describe('i18n', () => {
  // ---------------------------------------------------------------------------
  // detectLocale()
  // ---------------------------------------------------------------------------
  describe('detectLocale()', () => {
    it("navigator.language が 'ja-JP' なら 'ja'", () => {
      vi.stubGlobal('navigator', { language: 'ja-JP' });
      expect(detectLocale()).toBe('ja');
    });

    it("navigator.language が 'ja' なら 'ja'", () => {
      vi.stubGlobal('navigator', { language: 'ja' });
      expect(detectLocale()).toBe('ja');
    });

    it("navigator.language が 'en-US' なら 'en'", () => {
      vi.stubGlobal('navigator', { language: 'en-US' });
      expect(detectLocale()).toBe('en');
    });

    it("navigator.language が 'fr' なら 'en'", () => {
      vi.stubGlobal('navigator', { language: 'fr' });
      expect(detectLocale()).toBe('en');
    });

    it("navigator.language が '' なら 'en'", () => {
      vi.stubGlobal('navigator', { language: '' });
      expect(detectLocale()).toBe('en');
    });

    it("navigator.languages が navigator.language より優先される（['ja'] + 'en-US' → 'ja'）", () => {
      vi.stubGlobal('navigator', { languages: ['ja'], language: 'en-US' });
      expect(detectLocale()).toBe('ja');
    });

    it("navigator が undefined なら 'en'（typeof navigator === 'undefined' 経路）", () => {
      vi.stubGlobal('navigator', undefined);
      expect(detectLocale()).toBe('en');
    });
  });

  // ---------------------------------------------------------------------------
  // getLocale() / setLocale()
  // ---------------------------------------------------------------------------
  describe('getLocale() / setLocale()', () => {
    it("setLocale('ja') 後は getLocale() が 'ja'", () => {
      setLocale('ja');
      expect(getLocale()).toBe('ja');
    });

    it("setLocale('en') 後は getLocale() が 'en'", () => {
      setLocale('ja');
      setLocale('en');
      expect(getLocale()).toBe('en');
    });

    it("不正値 'fr' は 'en' に正規化される", () => {
      setLocale('ja');
      setLocale('fr');
      expect(getLocale()).toBe('en');
    });

    it("不正値 null は 'en' に正規化される", () => {
      setLocale('ja');
      setLocale(null);
      expect(getLocale()).toBe('en');
    });

    it("引数なし（undefined）は 'en' に正規化される", () => {
      setLocale('ja');
      setLocale();
      expect(getLocale()).toBe('en');
    });
  });

  // ---------------------------------------------------------------------------
  // t(key, values)
  // ---------------------------------------------------------------------------
  describe('t(key, values)', () => {
    it('既知キーをロケール別に返す（beadType.legend）', () => {
      setLocale('ja');
      expect(t('beadType.legend')).toBe('ビーズタイプ');
      setLocale('en');
      expect(t('beadType.legend')).toBe('Bead type');
    });

    it('単一プレースホルダを補間する（colorList.count）', () => {
      setLocale('en');
      expect(t('colorList.count', { count: 5 })).toBe('5');
      setLocale('ja');
      expect(t('colorList.count', { count: 5 })).toBe('5個');
    });

    it('複数プレースホルダを両ロケールで補間する（backgroundExclusion.excludedCount）', () => {
      setLocale('en');
      expect(t('backgroundExclusion.excludedCount', { excluded: 3, percent: 12.5 })).toBe(
        'Excluded cells: 3 (12.5%)',
      );
      setLocale('ja');
      expect(t('backgroundExclusion.excludedCount', { excluded: 3, percent: 12.5 })).toBe(
        '除外セル: 3個 (12.5%)',
      );
    });

    it('未知キーはキー文字列自体を返す', () => {
      setLocale('en');
      expect(t('this.key.does.not.exist')).toBe('this.key.does.not.exist');
      setLocale('ja');
      expect(t('this.key.does.not.exist')).toBe('this.key.does.not.exist');
    });

    it('values を渡さない場合はテンプレートの {..} がそのまま残る', () => {
      setLocale('en');
      expect(t('colorList.count')).toBe('{count}');
      expect(t('colorList.count')).toContain('{count}');
      setLocale('ja');
      expect(t('colorList.count')).toBe('{count}個');
      expect(t('colorList.count')).toContain('{count}');
    });
  });

  // ---------------------------------------------------------------------------
  // getColorName(color)
  // ---------------------------------------------------------------------------
  describe('getColorName(color)', () => {
    const color = { name: 'しろ', nameEn: 'White' };

    it("ja ロケールでは name を返す", () => {
      setLocale('ja');
      expect(getColorName(color)).toBe('しろ');
    });

    it('en ロケールでは nameEn を返す', () => {
      setLocale('en');
      expect(getColorName(color)).toBe('White');
    });

    it('nameEn 欠落時は en ロケールでも name にフォールバックする', () => {
      setLocale('en');
      expect(getColorName({ name: 'しろ' })).toBe('しろ');
    });

    it('name 欠落時は ja ロケールでも nameEn にフォールバックする', () => {
      setLocale('ja');
      expect(getColorName({ nameEn: 'White' })).toBe('White');
    });

    it('null / undefined は空文字を返す', () => {
      setLocale('ja');
      expect(getColorName(null)).toBe('');
      expect(getColorName(undefined)).toBe('');
      setLocale('en');
      expect(getColorName(null)).toBe('');
      expect(getColorName(undefined)).toBe('');
    });
  });

  // ---------------------------------------------------------------------------
  // 辞書の整合性（既知キーの網羅チェック）
  // -----------------------------------------------------------------------------
  // DICTIONARY は非 export のため直接参照できない。代表的な既知キーを列挙し、
  // ja / en 双方で t(key) が「キー文字列と異なる（＝辞書に実在する）」かつ
  // 「空文字でない」ことを検証する。タスクB で getAiErrorKey が返しうる
  // 'aiError.*' 全キーも含めて網羅する。
  // ---------------------------------------------------------------------------
  describe('辞書の整合性（既知キーの網羅チェック）', () => {
    const KNOWN_KEYS = [
      'app.subtitle',
      'ai.convertButton',
      'apiKeyManager.heading',
      'modelSelector.label',
      'aiPromptInput.label',
      'pattern.emptyMessage',
      'export.button',
      // getAiErrorKey が返しうる全キー
      'aiError.invalid_request',
      'aiError.auth',
      'aiError.rate_limit',
      'aiError.server',
      'aiError.network',
      'aiError.timeout',
      'aiError.invalid_input',
      'aiError.no_api_key',
      'aiError.no_response',
      'aiError.invalid_format',
      'aiError.grid_shape',
      'aiError.default',
    ];

    it('全既知キーが ja / en 双方で「キー文字列と異なる」かつ「空でない」訳を持つ', () => {
      for (const locale of ['ja', 'en']) {
        setLocale(locale);
        for (const key of KNOWN_KEYS) {
          const translated = t(key);
          expect(translated, `${locale}:${key} は辞書に実在すべき`).not.toBe(key);
          expect(translated, `${locale}:${key} は空でないべき`).not.toBe('');
        }
      }
    });
  });
});
