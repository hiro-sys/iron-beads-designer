import { describe, it, expect } from 'vitest';
import { getActivePalette } from '../src/ui/paletteSelector.js';

// =============================================================================
// 使用パレット選択UI（paletteSelector.js）の純関数ユニットテスト
// -----------------------------------------------------------------------------
// 対象: src/ui/paletteSelector.js
//   - getActivePalette(fullPalette, disabledColorIds)
//       … 全パレットから無効化色IDを除外した「有効パレット」を返す純関数
//
// 本ファイルはタスク16.2「getActivePalette のユニットテストを書く」に対応する。
//   - 全有効（disabledColorIds が空配列）→ 全色が返る（入力を破壊しない）
//   - 一部無効 → 無効化色を除いた色のみ返る
//   - 全無効（全色のIDを指定）→ 空配列（要件11.5 の「有効色0」状態）
//   - disabledColorIds が null/undefined → 全色が返る（防御的動作）
//   - fullPalette が非配列 → 空配列（防御的動作）
//
// 検証対象: Requirements 11.1, 11.2
//
// UI自体（DOM操作・トグル・最大色数入力）は手動テスト対象（design.md「テスト
// 戦略」）のため、本タスクでは副作用のない純関数 getActivePalette のみを検証する。
//
// 【独立オラクル方針】
//   期待値は実装に依存せず、テスト側で明示したモックパレットと「無効化IDに含まれ
//   ない色だけが残る」という定義から導く。BeadColor は設計の構造 { id, name, r,
//   g, b } に従う。
// =============================================================================

/**
 * テスト用モックパレット（設計の BeadColor 構造 { id, name, r, g, b }）。
 * 実パレットには依存せず、ID と並び順を明示して期待値を独立に検証できるようにする。
 * @type {Array<{id: string, name: string, r: number, g: number, b: number}>}
 */
const MOCK_PALETTE = [
  { id: 'P01', name: 'しろ', r: 241, g: 241, b: 241 },
  { id: 'P02', name: 'くろ', r: 38, g: 38, b: 38 },
  { id: 'P03', name: 'あか', r: 222, g: 0, b: 50 },
  { id: 'P04', name: 'あお', r: 0, g: 90, b: 170 },
];

/**
 * パレットから ID 配列を取り出すヘルパー（期待値比較を読みやすくする）。
 * @param {Array<{id: string}>} palette
 * @returns {string[]}
 */
function idsOf(palette) {
  return palette.map((color) => color.id);
}

describe('getActivePalette / ユニットテスト（タスク16.2）', () => {
  // ---------------------------------------------------------------------------
  // 全有効: disabledColorIds が空配列 → 全色が返り、入力を破壊しない（要件11.1）
  // ---------------------------------------------------------------------------
  describe('全有効（disabledColorIds が空配列）', () => {
    it('全色をそのままの並びで返す', () => {
      const result = getActivePalette(MOCK_PALETTE, []);

      expect(idsOf(result)).toEqual(['P01', 'P02', 'P03', 'P04']);
      // 内容（オブジェクトの値）も全色一致することを確認する。
      expect(result).toEqual(MOCK_PALETTE);
    });

    it('入力を破壊しない（元配列とは別インスタンスの新しい配列を返す）', () => {
      const input = [...MOCK_PALETTE];
      const result = getActivePalette(input, []);

      // 戻り値は引数とは別の配列インスタンスである（破壊的でない）。
      expect(result).not.toBe(input);

      // 戻り値を変更しても元の入力配列は影響を受けない。
      result.pop();
      expect(input).toHaveLength(MOCK_PALETTE.length);
      expect(idsOf(input)).toEqual(['P01', 'P02', 'P03', 'P04']);
    });
  });

  // ---------------------------------------------------------------------------
  // 一部無効: disabledColorIds に一部ID → 無効化色を除いた色のみ返る（要件11.2）
  // ---------------------------------------------------------------------------
  describe('一部無効（disabledColorIds に一部のIDを指定）', () => {
    it('無効化されたIDの色を除外し、有効色のみを並び順を保って返す', () => {
      const result = getActivePalette(MOCK_PALETTE, ['P02', 'P04']);

      // 無効化した P02 / P04 を除いた P01 / P03 のみが残る。
      expect(idsOf(result)).toEqual(['P01', 'P03']);
    });

    it('1色だけ無効化した場合は残りの色がすべて返る', () => {
      const result = getActivePalette(MOCK_PALETTE, ['P01']);

      expect(idsOf(result)).toEqual(['P02', 'P03', 'P04']);
    });

    it('パレットに存在しないIDが含まれていても全有効色がそのまま返る（防御的）', () => {
      const result = getActivePalette(MOCK_PALETTE, ['ZZZ', 'P02']);

      // 存在しない 'ZZZ' は無視され、実在する P02 のみが除外される。
      expect(idsOf(result)).toEqual(['P01', 'P03', 'P04']);
    });
  });

  // ---------------------------------------------------------------------------
  // 全無効: 全色のIDを指定 → 空配列（要件11.5 の「有効色0」状態）
  // ---------------------------------------------------------------------------
  describe('全無効（全色のIDを disabledColorIds に指定）', () => {
    it('空配列を返す（有効色0の状態）', () => {
      const allIds = idsOf(MOCK_PALETTE); // ['P01','P02','P03','P04']
      const result = getActivePalette(MOCK_PALETTE, allIds);

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 防御的動作: disabledColorIds が null / undefined → 全色が返る
  // ---------------------------------------------------------------------------
  describe('disabledColorIds が null / undefined（防御的動作）', () => {
    it('null の場合は全色を返す', () => {
      const result = getActivePalette(MOCK_PALETTE, null);
      expect(idsOf(result)).toEqual(['P01', 'P02', 'P03', 'P04']);
    });

    it('undefined（第2引数省略）の場合は全色を返す', () => {
      const result = getActivePalette(MOCK_PALETTE);
      expect(idsOf(result)).toEqual(['P01', 'P02', 'P03', 'P04']);
    });

    it('全色を返すが入力とは別インスタンスである', () => {
      const result = getActivePalette(MOCK_PALETTE, null);
      expect(result).not.toBe(MOCK_PALETTE);
    });
  });

  // ---------------------------------------------------------------------------
  // 防御的動作: fullPalette が非配列 → 空配列
  // ---------------------------------------------------------------------------
  describe('fullPalette が非配列（防御的動作）', () => {
    it('null / undefined の場合は空配列を返す', () => {
      expect(getActivePalette(null, [])).toEqual([]);
      expect(getActivePalette(undefined, [])).toEqual([]);
    });

    it('オブジェクト / 文字列 / 数値など配列でない値は空配列を返す', () => {
      expect(getActivePalette({}, [])).toEqual([]);
      expect(getActivePalette('P01,P02', [])).toEqual([]);
      expect(getActivePalette(42, [])).toEqual([]);
    });

    it('disabledColorIds が指定されていても fullPalette が非配列なら空配列を返す', () => {
      expect(getActivePalette(null, ['P01'])).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // 補足: 空パレット入力（境界）
  // ---------------------------------------------------------------------------
  describe('空パレット（境界）', () => {
    it('空配列のパレットは無効化IDの有無に関わらず空配列を返す', () => {
      expect(getActivePalette([], [])).toEqual([]);
      expect(getActivePalette([], ['P01'])).toEqual([]);
    });
  });
});
