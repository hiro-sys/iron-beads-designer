import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  computeExportCellSize,
  computeColorListHeight,
  computeExportDimensions,
} from '../src/renderer/exporter.js';

// =============================================================================
// PNG エクスポーター（exporter.js）の純ロジックのテスト
// -----------------------------------------------------------------------------
// 本ファイルは以下の2タスク分のテストをまとめて収める。
//   - タスク12.3: エクスポートセルサイズ保証のプロパティテスト（Property 12）
//   - タスク12.4（exporter分）: 純関数のユニットテスト
//       computeExportCellSize / computeColorListHeight / computeExportDimensions
//
// 対象の純関数は Canvas 描画に依存しないため、描画自体はブラウザ手動テストとし、
// ここでは寸法・セルサイズ計算のロジックのみを自動検証する。
//
// 検証対象: Requirements 7.1
//
// 設計参照:
//   - design.md「5. エクスポーター（exporter.js）」「Property 12」
//   - exporter.js のレイアウト定数（最低セルサイズ 20px / 一覧高さ計算）
// =============================================================================

// exporter.js 内部のレイアウト定数（テストの期待値計算に用いる。実装と一致させる）。
const MIN_CELL_SIZE = 20; // 要件7.1: 1セルあたり最低 20px
const LIST_PADDING = 24;
const LIST_TITLE_HEIGHT = 36;
const LIST_ENTRY_HEIGHT = 30;
const LIST_MIN_WIDTH = 360;
// 色数0のときの一覧高さ（上下パディング + 見出し）。
const LIST_BASE_HEIGHT = LIST_PADDING * 2 + LIST_TITLE_HEIGHT; // = 84

// -----------------------------------------------------------------------------
// プロパティテスト用ジェネレータ
// -----------------------------------------------------------------------------

// 図案サイズ（横・縦のビーズ数）。1×1〜10×10プレート（ペグ数28/29）相当の範囲を広くカバーする。
const dimArb = fc.integer({ min: 1, max: 300 });

// cellSize 指定のジェネレータ。
// 「未指定 / 20未満 / 20以上 / 非数値」を満遍なく含め、Property 12 の前提
// （任意の cellSize 指定）を網羅する。
const cellSizeOptionArb = fc.oneof(
  fc.constant(undefined), // 未指定 → 20 へフォールバック
  fc.constant(null), // 非数値 → 20
  fc.constant(NaN), // 非数値 → 20
  fc.constant(Infinity), // 非有限 → 20
  fc.constant(-Infinity), // 非有限 → 20
  fc.constant('30'), // 文字列（Number.isFinite=false）→ 20
  fc.integer({ min: -100, max: 19 }), // 20未満（0・負数を含む）→ 20
  fc.constant(19.999), // 20未満の小数 → 20
  fc.integer({ min: 20, max: 300 }), // 20以上 → その値
  fc.constant(20.5), // 20以上の小数 → floor(20)
  fc.constant(47.8), // 20以上の小数 → floor(47)
);

// includeColorList と colorCountOverride の組み合わせ。
// override 未指定時は図案から色数を集計する経路（calculateUsedColors）を通す。
const includeColorListArb = fc.boolean();
const overrideArb = fc.oneof(fc.constant(undefined), fc.integer({ min: 0, max: 60 }));

// =============================================================================
// タスク12.3: エクスポートセルサイズ保証のプロパティテスト（Property 12）
// =============================================================================
describe('exporter プロパティテスト（タスク12.3）', () => {
  // Property 12: 任意の図案サイズと任意の cellSize 指定（未指定/20未満/20以上を含む）に対して、
  //   (1) computeExportCellSize の戻り値は常に 20 以上であり、
  //   (2) computeExportDimensions の width/height は図案本体寸法
  //       （patternWidth=width×cellSize, patternHeight=height×cellSize）以上である。
  // **Validates: Requirements 7.1**
  it('Feature: bead-pattern-maker, Property 12: エクスポートセルサイズ保証（セルサイズ≥20px、画像全体≥(w×cellSize)×(h×cellSize)）', () => {
    fc.assert(
      fc.property(
        dimArb,
        dimArb,
        cellSizeOptionArb,
        includeColorListArb,
        overrideArb,
        (width, height, cellSizeOption, includeColorList, override) => {
          const options = { cellSize: cellSizeOption, includeColorList };
          // 図案は空セルでよい（寸法保証の検証が目的。色数集計経路も exercise する）。
          const pattern = { width, height, cells: [] };

          // (1) セルサイズは常に 20 以上、かつ整数（floor / MIN は整数）。
          const cellSize = computeExportCellSize(options);
          expect(cellSize).toBeGreaterThanOrEqual(MIN_CELL_SIZE);
          expect(Number.isInteger(cellSize)).toBe(true);

          const dims = computeExportDimensions(pattern, options, override);

          // computeExportDimensions も同一のセルサイズを用いる。
          expect(dims.cellSize).toBe(cellSize);

          // 図案本体寸法 = サイズ × セルサイズ。
          const patternWidth = width * cellSize;
          const patternHeight = height * cellSize;
          expect(dims.patternWidth).toBe(patternWidth);
          expect(dims.patternHeight).toBe(patternHeight);

          // (2) 画像全体は図案本体寸法以上（使用色一覧ぶんだけ下方向に拡張されうる）。
          expect(dims.width).toBeGreaterThanOrEqual(patternWidth);
          expect(dims.height).toBeGreaterThanOrEqual(patternHeight);

          // 図案が空でも 0px キャンバスにならない（最低 1px 保証）。
          expect(dims.width).toBeGreaterThanOrEqual(1);
          expect(dims.height).toBeGreaterThanOrEqual(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// タスク12.4（exporter 分）: 純関数のユニットテスト
// =============================================================================
describe('exporter ユニットテスト（タスク12.4）', () => {
  // --- computeExportCellSize: 20未満→20, 20以上→その値（要件7.1） -----------
  describe('computeExportCellSize（最低セルサイズ 20px の保証）', () => {
    it('オプション未指定（引数なし）のときは 20 を返す', () => {
      expect(computeExportCellSize()).toBe(20);
    });

    it('cellSize 未指定（空オブジェクト）のときは 20 を返す', () => {
      expect(computeExportCellSize({})).toBe(20);
    });

    it.each([
      ['0', 0],
      ['負数', -10],
      ['20未満の整数(10)', 10],
      ['20直前(19)', 19],
      ['20未満の小数(19.999)', 19.999],
    ])('cellSize=%s は 20 未満なので 20 に補正される', (_label, value) => {
      expect(computeExportCellSize({ cellSize: value })).toBe(20);
    });

    it.each([
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['-Infinity', -Infinity],
      ['null', null],
      ['文字列', '30'],
    ])('cellSize=%s は非有限値なので 20 にフォールバックする', (_label, value) => {
      expect(computeExportCellSize({ cellSize: value })).toBe(20);
    });

    it('cellSize=20（境界）はそのまま 20 を返す', () => {
      expect(computeExportCellSize({ cellSize: 20 })).toBe(20);
    });

    it.each([
      ['25', 25, 25],
      ['100', 100, 100],
    ])('cellSize=%s（20以上の整数）はその値を返す', (_label, value, expected) => {
      expect(computeExportCellSize({ cellSize: value })).toBe(expected);
    });

    it.each([
      ['20.5 → 20', 20.5, 20],
      ['25.7 → 25', 25.7, 25],
      ['47.8 → 47', 47.8, 47],
    ])('cellSize=%s（20以上の小数）は floor で整数化する', (_label, value, expected) => {
      expect(computeExportCellSize({ cellSize: value })).toBe(expected);
    });
  });

  // --- computeColorListHeight: 上下パディング + 見出し + 色数×行高 -----------
  describe('computeColorListHeight（使用色一覧領域の高さ）', () => {
    it('色数 0 のときは見出し＋パディングのみ（84px）', () => {
      expect(computeColorListHeight(0)).toBe(LIST_BASE_HEIGHT);
    });

    it('色数 1 のとき = 84 + 30 = 114px', () => {
      expect(computeColorListHeight(1)).toBe(LIST_BASE_HEIGHT + LIST_ENTRY_HEIGHT);
    });

    it('色数 3 のとき = 84 + 90 = 174px', () => {
      expect(computeColorListHeight(3)).toBe(LIST_BASE_HEIGHT + 3 * LIST_ENTRY_HEIGHT);
    });

    it.each([
      ['負数', -5],
      ['NaN', NaN],
      ['Infinity', Infinity],
    ])('色数=%s（不正値）は 0 として扱い 84px を返す', (_label, value) => {
      expect(computeColorListHeight(value)).toBe(LIST_BASE_HEIGHT);
    });

    it('色数が小数(5.9)のときは floor して計算する（84 + 5×30 = 234px）', () => {
      expect(computeColorListHeight(5.9)).toBe(LIST_BASE_HEIGHT + 5 * LIST_ENTRY_HEIGHT);
    });
  });

  // --- computeExportDimensions: 図案本体＋使用色一覧の寸法計算 ---------------
  describe('computeExportDimensions（エクスポート画像全体の寸法）', () => {
    it('使用色一覧なし: 図案本体の寸法のみを返す', () => {
      const pattern = { width: 2, height: 3, cells: [] };
      const dims = computeExportDimensions(pattern, { cellSize: 20, includeColorList: false });

      expect(dims.cellSize).toBe(20);
      expect(dims.patternWidth).toBe(40); // 2 × 20
      expect(dims.patternHeight).toBe(60); // 3 × 20
      expect(dims.listHeight).toBe(0);
      expect(dims.listWidth).toBe(0);
      expect(dims.colorCount).toBe(0);
      expect(dims.width).toBe(40);
      expect(dims.height).toBe(60);
    });

    it('cellSize<20 は 20 に補正されて図案本体寸法へ反映される', () => {
      const pattern = { width: 4, height: 5, cells: [] };
      const dims = computeExportDimensions(pattern, { cellSize: 5, includeColorList: false });

      expect(dims.cellSize).toBe(20);
      expect(dims.patternWidth).toBe(80); // 4 × 20
      expect(dims.patternHeight).toBe(100); // 5 × 20
      expect(dims.width).toBe(80);
      expect(dims.height).toBe(100);
    });

    it('colorCountOverride 指定時: 一覧高さを加算し、幅は一覧最小幅(360)以上になる', () => {
      const pattern = { width: 2, height: 2, cells: [] };
      const dims = computeExportDimensions(pattern, { cellSize: 20 }, 4);

      // 図案本体: 40 × 40
      expect(dims.patternWidth).toBe(40);
      expect(dims.patternHeight).toBe(40);
      // 色数 4 → 一覧高さ = 84 + 4×30 = 204
      expect(dims.colorCount).toBe(4);
      expect(dims.listHeight).toBe(LIST_BASE_HEIGHT + 4 * LIST_ENTRY_HEIGHT);
      expect(dims.listWidth).toBe(LIST_MIN_WIDTH);
      // 幅は max(40, 360) = 360、高さは 40 + 204 = 244
      expect(dims.width).toBe(LIST_MIN_WIDTH);
      expect(dims.height).toBe(40 + LIST_BASE_HEIGHT + 4 * LIST_ENTRY_HEIGHT);
    });

    it('colorCountOverride 未指定時: 図案から使用色数を集計する（未配置 null は除外）', () => {
      const red = { id: 'P1', name: 'あか', r: 255, g: 0, b: 0 };
      const blue = { id: 'P2', name: 'あお', r: 0, g: 0, b: 255 };
      // 2色 + null（未配置1セル）。色数は 2 と集計される。
      const pattern = { width: 3, height: 1, cells: [[red, blue, null]] };

      const dims = computeExportDimensions(pattern, { cellSize: 20 });

      expect(dims.colorCount).toBe(2);
      expect(dims.listWidth).toBe(LIST_MIN_WIDTH);
      expect(dims.listHeight).toBe(LIST_BASE_HEIGHT + 2 * LIST_ENTRY_HEIGHT);
    });

    it('図案が空（width/height=0 または null）でも最低 1px のキャンバスになる', () => {
      const dims = computeExportDimensions(null, { includeColorList: false });

      expect(dims.patternWidth).toBe(0);
      expect(dims.patternHeight).toBe(0);
      expect(dims.width).toBe(1);
      expect(dims.height).toBe(1);
    });
  });
});
