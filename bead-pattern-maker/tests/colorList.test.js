import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { calculateUsedColors } from '../src/ui/colorList.js';

// =============================================================================
// 使用色一覧（colorList.js）のプロパティベーステスト
// -----------------------------------------------------------------------------
// 対象: src/ui/colorList.js の calculateUsedColors(pattern)（純粋関数）
// 本ファイルは以下の3タスク分のプロパティテストをまとめて実装する。
//
//   タスク11.2 / Property 10: 使用色一覧の正確性
//       色集合の一致 + 使用個数合計 = 非nullセル数
//       **Validates: Requirements 6.1, 6.4**
//
//   タスク11.3 / Property 11: 使用色ソート順
//       個数の降順、同数なら色名の昇順（辞書順 / localeCompare）
//       **Validates: Requirements 6.3**
//
//   タスク11.4 / Property 16: 未配置セル除外の色カウント整合性
//       色の使用個数合計 + 未配置数 = 全セル数（width × height）
//       **Validates: Requirements 9.7**
//
// 各プロパティテストは fast-check で 200 回（最低100回以上）反復実行する。
// テスト名タグ形式: `Feature: bead-pattern-maker, Property {番号}: {プロパティ文}`
// =============================================================================

// -----------------------------------------------------------------------------
// 共通アービトラリ（ジェネレータ）
// -----------------------------------------------------------------------------

// 色名。辞書順比較（localeCompare）の挙動を検証できるよう、
// 同名・近似名が混ざる小さなプールから選ぶ（個数同数時の名前ソートを誘発する）。
const colorNameArb = fc.constantFrom(
  'しろ',
  'くろ',
  'あか',
  'あお',
  'きいろ',
  'みどり',
  'A',
  'B',
  'C',
);

// 単一の BeadColor を生成する（id はパレット生成時に一意化する）。
const beadColorArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 6 }),
  name: colorNameArb,
  r: fc.integer({ min: 0, max: 255 }),
  g: fc.integer({ min: 0, max: 255 }),
  b: fc.integer({ min: 0, max: 255 }),
});

// id が一意な 1〜6 色のパレットを生成する。
// calculateUsedColors は id をキーに色を集約するため、id を一意化することで
// 「色集合」の比較を id ベースで曖昧さなく行える。
const paletteArb = fc.uniqueArray(beadColorArb, {
  minLength: 1,
  maxLength: 6,
  selector: (c) => c.id,
});

/**
 * 与えられたパレットから、width × height の矩形グリッド（PatternGrid）を生成する。
 * 各セルは「null（未配置）」または「パレット内の色」を等確率で取る。
 * これにより、非null色のカウント・未配置セルの両方を十分にカバーする。
 *
 * @param {Array} palette - 1色以上の BeadColor 配列
 * @returns {import('fast-check').Arbitrary} PatternGrid のアービトラリ
 */
function gridArbFromPalette(palette) {
  // 1セル分のアービトラリ: null か、パレットからランダムに選んだ色
  const cellArb = fc.oneof(fc.constant(null), fc.constantFrom(...palette));

  return fc
    .record({
      width: fc.integer({ min: 0, max: 8 }),
      height: fc.integer({ min: 0, max: 8 }),
    })
    .chain(({ width, height }) =>
      // cells は height 行 × width 列の矩形（width=0 や height=0 の空グリッドも許容）
      fc
        .array(fc.array(cellArb, { minLength: width, maxLength: width }), {
          minLength: height,
          maxLength: height,
        })
        .map((cells) => ({ width, height, cells })),
    );
}

// ランダムな PatternGrid（パレット + 矩形グリッド）を生成するアービトラリ
const patternArb = paletteArb.chain((palette) => gridArbFromPalette(palette));

// -----------------------------------------------------------------------------
// プロパティテスト
// -----------------------------------------------------------------------------

describe('colorList.calculateUsedColors / プロパティテスト', () => {
  // ---------------------------------------------------------------------------
  // タスク11.2 / Property 10: 使用色一覧の正確性
  // **Validates: Requirements 6.1, 6.4**
  // ---------------------------------------------------------------------------
  it('Feature: bead-pattern-maker, Property 10: 使用色一覧の正確性', () => {
    fc.assert(
      fc.property(patternArb, (pattern) => {
        const { colors, totalBeads } = calculateUsedColors(pattern);

        // グリッド内の非nullセルから「実際に存在する色集合（id）」と「非nullセル数」を求める
        const expectedIds = new Set();
        let nonNullCount = 0;
        for (const row of pattern.cells) {
          for (const cell of row) {
            if (cell !== null && cell !== undefined) {
              expectedIds.add(cell.id);
              nonNullCount += 1;
            }
          }
        }

        // (1) 色集合の一致: 使用色一覧の色集合 === グリッド内の非null色集合（要件6.1）
        const actualIds = new Set(colors.map((c) => c.id));
        expect(actualIds).toEqual(expectedIds);

        // (2) 各色の使用個数の合計 === 非nullセル数（= totalBeads）（要件6.4）
        const sumCounts = colors.reduce((acc, c) => acc + c.count, 0);
        expect(totalBeads).toBe(nonNullCount);
        expect(sumCounts).toBe(nonNullCount);
      }),
      { numRuns: 200 },
    );
  });

  // ---------------------------------------------------------------------------
  // タスク11.3 / Property 11: 使用色ソート順
  // **Validates: Requirements 6.3**
  // ---------------------------------------------------------------------------
  it('Feature: bead-pattern-maker, Property 11: 使用色ソート順', () => {
    // 仕様順序: 個数の降順 → 同数なら色名の昇順（辞書順 / localeCompare）。
    // 実装と同一のロジックで「仕様上の順序」を定義し、結果がこれを満たすか検証する。
    const cmp = (a, b) =>
      b.count !== a.count
        ? b.count - a.count
        : String(a.name).localeCompare(String(b.name));

    fc.assert(
      fc.property(patternArb, (pattern) => {
        const { colors } = calculateUsedColors(pattern);

        for (let i = 0; i + 1 < colors.length; i += 1) {
          const current = colors[i];
          const next = colors[i + 1];

          // 隣接ペアが仕様順序を満たす（cmp(current, next) <= 0）
          expect(cmp(current, next)).toBeLessThanOrEqual(0);

          // 使用個数は降順
          expect(current.count).toBeGreaterThanOrEqual(next.count);

          // 個数が同数の場合は色名が昇順（辞書順）
          if (current.count === next.count) {
            expect(
              String(current.name).localeCompare(String(next.name)),
            ).toBeLessThanOrEqual(0);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  // ---------------------------------------------------------------------------
  // タスク11.4 / Property 16: 未配置セル除外の色カウント整合性
  // **Validates: Requirements 9.7**
  // ---------------------------------------------------------------------------
  it('Feature: bead-pattern-maker, Property 16: 未配置セル除外の色カウント整合性', () => {
    fc.assert(
      fc.property(patternArb, (pattern) => {
        const { totalBeads, excludedCount } = calculateUsedColors(pattern);

        // 色の使用個数合計（totalBeads）＋ 未配置数（excludedCount）＝ 全セル数（width × height）
        expect(totalBeads + excludedCount).toBe(pattern.width * pattern.height);
      }),
      { numRuns: 200 },
    );
  });
});

// -----------------------------------------------------------------------------
// ユニットテスト（具体例での正確性確認 / プロパティテストの補完）
// -----------------------------------------------------------------------------

describe('colorList.calculateUsedColors / ユニットテスト', () => {
  it('非nullセルを集計し、nullを除外して合計・未配置数を算出する', () => {
    const A = { id: 'P01', name: 'あか', r: 255, g: 0, b: 0 };
    const B = { id: 'P02', name: 'あお', r: 0, g: 0, b: 255 };
    const pattern = {
      width: 2,
      height: 2,
      cells: [
        [A, A],
        [B, null],
      ],
    };

    const { colors, totalBeads, excludedCount } = calculateUsedColors(pattern);

    expect(totalBeads).toBe(3); // 非nullセル数
    expect(excludedCount).toBe(1); // null（未配置）セル数
    // 個数降順: A(2) → B(1)
    expect(colors.map((c) => [c.id, c.count])).toEqual([
      ['P01', 2],
      ['P02', 1],
    ]);
  });

  it('使用個数が同数の場合は色名の昇順（辞書順）でソートする', () => {
    const X = { id: 'X', name: 'B', r: 1, g: 1, b: 1 };
    const Y = { id: 'Y', name: 'A', r: 2, g: 2, b: 2 };
    // X と Y はともに使用個数1（同数）。色名は 'A' < 'B' なので Y が先に来る。
    const pattern = { width: 2, height: 1, cells: [[X, Y]] };

    const { colors } = calculateUsedColors(pattern);

    expect(colors.map((c) => c.name)).toEqual(['A', 'B']);
  });

  it('全セルがnullのグリッドは色一覧が空・合計0・未配置=全セル数になる', () => {
    const pattern = {
      width: 2,
      height: 2,
      cells: [
        [null, null],
        [null, null],
      ],
    };

    const result = calculateUsedColors(pattern);

    expect(result.colors).toEqual([]);
    expect(result.totalBeads).toBe(0);
    expect(result.excludedCount).toBe(4);
  });

  it('pattern が null/undefined でも安全に空の結果を返す', () => {
    expect(calculateUsedColors(null)).toEqual({
      colors: [],
      totalBeads: 0,
      excludedCount: 0,
    });
    expect(calculateUsedColors(undefined)).toEqual({
      colors: [],
      totalBeads: 0,
      excludedCount: 0,
    });
  });
});
