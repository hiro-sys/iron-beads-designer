import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { calculateRecommendedSizes } from '../src/ui/recommendedSizes.js';

// =============================================================================
// おすすめサイズ計算（recommendedSizes.js）のテスト
// -----------------------------------------------------------------------------
// 対象: src/ui/recommendedSizes.js の
//       calculateRecommendedSizes(imageWidth, imageHeight, pegCount)（純関数）
//
// 本ファイルは以下の2タスク分のテストをまとめて収める。
//   - タスク13.2: 推奨サイズのアスペクト比順序と件数制限のプロパティテスト（Property 13）
//   - タスク13.3: recommendedSizes 計算のユニットテスト
//                 （正方形 / 横長 / 縦長 / 極小画像のケース）
//
// 検証対象: Requirements 8.1, 8.2, 8.4, 8.5
// =============================================================================

/**
 * ペグ数のジェネレーター。
 * パーラービーズ=29 / ナノビーズ=28 の2値のみが有効なペグ数。
 * @type {fc.Arbitrary<number>}
 */
const pegCountArb = fc.constantFrom(28, 29);

/**
 * 画像の寸法（幅・高さ）のジェネレーター。
 * 「正の整数」を生成し、ペグ数以下の極小画像（1x1のみ返る）と
 * ペグ数より十分大きい通常画像（最大3件返る）の両方を自然に含める。
 * @type {fc.Arbitrary<number>}
 */
const dimensionArb = fc.integer({ min: 1, max: 4000 });

// =============================================================================
// タスク13.2: 推奨サイズのアスペクト比順序と件数制限のプロパティテスト
// =============================================================================
describe('recommendedSizes プロパティテスト（タスク13.2）', () => {
  // Property 13: 任意の画像サイズ（正の整数）とペグ数（28/29）に対して、
  // calculateRecommendedSizes の結果は
  //   (1) 最大3件であり（length <= 3）、
  //   (2) aspectDiff の昇順でソートされている。
  // **Validates: Requirements 8.1, 8.4**
  it('Feature: bead-pattern-maker, Property 13: 推奨サイズのアスペクト比順序と件数制限', () => {
    fc.assert(
      fc.property(dimensionArb, dimensionArb, pegCountArb, (width, height, pegCount) => {
        const result = calculateRecommendedSizes(width, height, pegCount);

        // (1) 件数制限: 結果は最大3件（要件8.1）。
        expect(result.length).toBeLessThanOrEqual(3);

        // (2) アスペクト差分の昇順（要件8.4）:
        //     連続する要素の aspectDiff は単調非減少でなければならない。
        for (let i = 1; i < result.length; i += 1) {
          expect(result[i].aspectDiff).toBeGreaterThanOrEqual(result[i - 1].aspectDiff);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// タスク13.3: recommendedSizes 計算のユニットテスト
// =============================================================================
describe('recommendedSizes ユニットテスト（タスク13.3）', () => {
  /**
   * 1件の推奨サイズが必須フィールドと整合する値を持つことを検証するヘルパー。
   * 「各候補が cols/rows/totalBeads/scaleRatio/aspectDiff を持つ」ことを確認する。
   *
   * @param {object} size - calculateRecommendedSizes が返す1件
   * @param {number} pegCount - ペグ数（totalBeads の検算に使用）
   */
  function expectValidRecommendedSize(size, pegCount) {
    // 5つのフィールドが存在し、すべて数値である。
    expect(size).toHaveProperty('cols');
    expect(size).toHaveProperty('rows');
    expect(size).toHaveProperty('totalBeads');
    expect(size).toHaveProperty('scaleRatio');
    expect(size).toHaveProperty('aspectDiff');
    expect(typeof size.cols).toBe('number');
    expect(typeof size.rows).toBe('number');
    expect(typeof size.totalBeads).toBe('number');
    expect(typeof size.scaleRatio).toBe('number');
    expect(typeof size.aspectDiff).toBe('number');

    // cols / rows は 1〜10 の整数。
    expect(Number.isInteger(size.cols)).toBe(true);
    expect(Number.isInteger(size.rows)).toBe(true);
    expect(size.cols).toBeGreaterThanOrEqual(1);
    expect(size.cols).toBeLessThanOrEqual(10);
    expect(size.rows).toBeGreaterThanOrEqual(1);
    expect(size.rows).toBeLessThanOrEqual(10);

    // totalBeads = (cols×pegCount) × (rows×pegCount) と一致する。
    expect(size.totalBeads).toBe(size.cols * pegCount * (size.rows * pegCount));

    // scaleRatio は 0 より大きく 1 以下（拡大はしないので上限1にクランプ）。
    expect(size.scaleRatio).toBeGreaterThan(0);
    expect(size.scaleRatio).toBeLessThanOrEqual(1);

    // aspectDiff は非負。
    expect(size.aspectDiff).toBeGreaterThanOrEqual(0);
  }

  // --- 正方形画像 -----------------------------------------------------------
  describe('正方形画像（512×512, pegCount=29）', () => {
    const PEG = 29;
    const result = calculateRecommendedSizes(512, 512, PEG);

    it('推奨は3件返る', () => {
      expect(result).toHaveLength(3);
    });

    it('各候補は cols/rows/totalBeads/scaleRatio/aspectDiff を持つ', () => {
      result.forEach((size) => expectValidRecommendedSize(size, PEG));
    });

    it('正方形なので全候補が正方プレート（cols===rows）で aspectDiff=0 になる', () => {
      result.forEach((size) => {
        expect(size.cols).toBe(size.rows);
        expect(size.aspectDiff).toBeCloseTo(0, 10);
      });
    });

    it('最小ビーズ数優先で 1x1 → 2x2 → 3x3 の順になる', () => {
      expect(result.map((s) => ({ cols: s.cols, rows: s.rows }))).toEqual([
        { cols: 1, rows: 1 },
        { cols: 2, rows: 2 },
        { cols: 3, rows: 3 },
      ]);
    });

    it('先頭(1x1)の総ビーズ数と縮小率が正しい', () => {
      // totalBeads = 29 × 29 = 841
      expect(result[0].totalBeads).toBe(841);
      // scaleRatio = min(29/512, 29/512, 1) = 29/512
      expect(result[0].scaleRatio).toBeCloseTo(29 / 512, 10);
    });
  });

  // --- 横長画像 -------------------------------------------------------------
  describe('横長画像（1600×900, pegCount=29）', () => {
    const PEG = 29;
    const result = calculateRecommendedSizes(1600, 900, PEG);

    it('推奨は3件返り、各候補のフィールドが整合する', () => {
      expect(result).toHaveLength(3);
      result.forEach((size) => expectValidRecommendedSize(size, PEG));
    });

    it('aspectDiff の昇順でソートされている', () => {
      for (let i = 1; i < result.length; i += 1) {
        expect(result[i].aspectDiff).toBeGreaterThanOrEqual(result[i - 1].aspectDiff);
      }
    });

    it('最も近い候補は横長プレート（cols > rows）になる', () => {
      expect(result[0].cols).toBeGreaterThan(result[0].rows);
    });

    it('元アスペクト比(16:9)に近い順に 9x5 → 7x4 → 5x3 が選ばれる', () => {
      // imageAspect = 1600/900 ≒ 1.7778
      //   9/5 = 1.8     (diff 0.0222)  ← 最も近い
      //   7/4 = 1.75    (diff 0.0278)
      //   5/3 = 1.6667  (diff 0.1111)
      expect(result.map((s) => ({ cols: s.cols, rows: s.rows }))).toEqual([
        { cols: 9, rows: 5 },
        { cols: 7, rows: 4 },
        { cols: 5, rows: 3 },
      ]);
    });
  });

  // --- 縦長画像 -------------------------------------------------------------
  describe('縦長画像（900×1600, pegCount=29）', () => {
    const PEG = 29;
    const result = calculateRecommendedSizes(900, 1600, PEG);

    it('推奨は3件返り、各候補のフィールドが整合する', () => {
      expect(result).toHaveLength(3);
      result.forEach((size) => expectValidRecommendedSize(size, PEG));
    });

    it('aspectDiff の昇順でソートされている', () => {
      for (let i = 1; i < result.length; i += 1) {
        expect(result[i].aspectDiff).toBeGreaterThanOrEqual(result[i - 1].aspectDiff);
      }
    });

    it('最も近い候補は縦長プレート（cols < rows）になる', () => {
      expect(result[0].cols).toBeLessThan(result[0].rows);
    });

    it('元アスペクト比(9:16)に近い順に 5x9 → 4x7 → 3x5 が選ばれる', () => {
      // imageAspect = 900/1600 = 0.5625
      //   5/9 = 0.5556  (diff 0.0069)  ← 最も近い
      //   4/7 = 0.5714  (diff 0.0089)
      //   3/5 = 0.6     (diff 0.0375)
      expect(result.map((s) => ({ cols: s.cols, rows: s.rows }))).toEqual([
        { cols: 5, rows: 9 },
        { cols: 4, rows: 7 },
        { cols: 3, rows: 5 },
      ]);
    });
  });

  // --- 極小画像（要件8.5） --------------------------------------------------
  describe('極小画像（幅または高さがペグ数以下 → 1x1のみ）', () => {
    it('幅・高さともにペグ数以下なら 1x1 のみを返す（20×20, pegCount=29）', () => {
      const PEG = 29;
      const result = calculateRecommendedSizes(20, 20, PEG);

      expect(result).toHaveLength(1);
      expect(result[0].cols).toBe(1);
      expect(result[0].rows).toBe(1);
      expectValidRecommendedSize(result[0], PEG);

      // totalBeads = 29 × 29 = 841
      expect(result[0].totalBeads).toBe(841);
      // 画像が図案より小さいので拡大はせず scaleRatio は 1 にクランプされる。
      expect(result[0].scaleRatio).toBe(1);
    });

    it('幅がペグ数ちょうど（境界値）でも 1x1 のみを返す（29×500, pegCount=29）', () => {
      const PEG = 29;
      const result = calculateRecommendedSizes(29, 500, PEG);

      expect(result).toHaveLength(1);
      expect(result[0].cols).toBe(1);
      expect(result[0].rows).toBe(1);
    });

    it('一方の辺だけがペグ数以下でも 1x1 のみを返す（1600×25, pegCount=29）', () => {
      // 高さ25 ≤ 29 のため、幅が大きくても 1x1 のみが推奨される（要件8.5）。
      const PEG = 29;
      const result = calculateRecommendedSizes(1600, 25, PEG);

      expect(result).toHaveLength(1);
      expect(result[0].cols).toBe(1);
      expect(result[0].rows).toBe(1);
    });

    it('ナノビーズ（pegCount=28）でも極小画像は 1x1 のみを返す（28×28）', () => {
      const PEG = 28;
      const result = calculateRecommendedSizes(28, 28, PEG);

      expect(result).toHaveLength(1);
      expect(result[0].cols).toBe(1);
      expect(result[0].rows).toBe(1);
      // totalBeads = 28 × 28 = 784
      expect(result[0].totalBeads).toBe(784);
    });
  });
});
