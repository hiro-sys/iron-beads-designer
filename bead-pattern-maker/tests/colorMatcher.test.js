import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  deltaE,
  findClosestColor,
  remapPattern,
} from '../src/engine/colorMatcher.js';
import { rgbToLab } from '../src/utils/colorUtils.js';
import { initializePalette } from '../src/data/beadConfig.js';
import { PARLER_PALETTE } from '../src/data/parlerPalette.js';
import { NANO_PALETTE } from '../src/data/nanoPalette.js';

// =============================================================================
// 色マッチングモジュール（colorMatcher.js）のテスト
// -----------------------------------------------------------------------------
// 対象: src/engine/colorMatcher.js
//   - deltaE(lab1, lab2)            … CIE76 色差（ユークリッド距離）
//   - findClosestColor(target, pal) … パレット内のΔE最小色
//   - remapPattern(pattern, newPal) … 図案グリッドを新パレット最近色へ再マッピング
//
// 本ファイルは以下のタスク分のテストをまとめて収める。
//   - タスク2.3: deltaE の数学的性質のプロパティテスト（Property 8）
//   - タスク2.4: findClosestColor の正確性のプロパティテスト（Property 7）
//   - タスク2.5: remapPattern のプロパティテスト（Property 2）
//   - タスク2.6: colorMatcher のユニットテスト（既知値・境界値）
//
// 検証対象: Requirements 4.2, 4.3, 2.4
//
// プロパティテストは fast-check で 200 回（最低100回以上）反復実行し、各 it 名に
// タグ `Feature: bead-pattern-maker, Property {番号}: {プロパティ文}` を付与する。
// =============================================================================

// -----------------------------------------------------------------------------
// 共通アービトラリ（ジェネレータ）
// -----------------------------------------------------------------------------

/**
 * RGB色のジェネレーター（各チャネル 0-255 の整数）。
 * @type {fc.Arbitrary<{ r: number, g: number, b: number }>}
 */
const rgbColorArb = fc.record({
  r: fc.integer({ min: 0, max: 255 }),
  g: fc.integer({ min: 0, max: 255 }),
  b: fc.integer({ min: 0, max: 255 }),
});

/**
 * BeadColor 風のレコード（id/name + RGB）。
 * パレット生成やグリッドのセル色生成に用いる。lab はここでは付与せず、
 * パレットとして使う場合は initializePalette で後付けする。
 * @type {fc.Arbitrary<{ id: string, name: string, r: number, g: number, b: number }>}
 */
const beadColorArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 5 }),
  name: fc.string({ maxLength: 8 }),
  r: fc.integer({ min: 0, max: 255 }),
  g: fc.integer({ min: 0, max: 255 }),
  b: fc.integer({ min: 0, max: 255 }),
});

// 実パレット（lab 付き）。プロパティテストで「現実のパレット」もカバーするために用いる。
const REAL_PARLER = initializePalette(PARLER_PALETTE);
const REAL_NANO = initializePalette(NANO_PALETTE);

/**
 * lab 付きの非空パレットのジェネレーター。
 * - ランダムに生成した 1〜8 色のパレット（id 一意・lab 付与）
 * - 実在のパーラー／ナノパレット（lab 付き）
 * の中から選ぶ。findClosestColor / remapPattern は非空パレットを前提とするため
 * 最低1色を保証する。
 * @type {fc.Arbitrary<Array<{id:string,name:string,r:number,g:number,b:number,lab:{L:number,a:number,b:number}}>>}
 */
const paletteArb = fc.oneof(
  fc
    .uniqueArray(beadColorArb, {
      minLength: 1,
      maxLength: 8,
      selector: (c) => c.id,
    })
    .map((p) => initializePalette(p)),
  fc.constant(REAL_PARLER),
  fc.constant(REAL_NANO),
);

/**
 * 図案グリッド（PatternGrid 風）のジェネレーター。
 * 各セルは「null（未配置）」または「旧パレット色（BeadColor 風）」を等確率で取る。
 * width=0 / height=0 の空グリッドも許容する。
 * @type {fc.Arbitrary<{width:number,height:number,cells:Array<Array<object|null>>,beadType:string,plateConfig:{cols:number,rows:number}}>}
 */
const patternArb = fc
  .record({
    width: fc.integer({ min: 0, max: 6 }),
    height: fc.integer({ min: 0, max: 6 }),
  })
  .chain(({ width, height }) => {
    const cellArb = fc.oneof(fc.constant(null), beadColorArb);
    return fc
      .array(fc.array(cellArb, { minLength: width, maxLength: width }), {
        minLength: height,
        maxLength: height,
      })
      .map((cells) => ({
        width,
        height,
        cells,
        beadType: 'perler',
        plateConfig: { cols: 1, rows: 1 },
      }));
  });

// =============================================================================
// タスク2.3 / Property 8: CIE76 ΔEの数学的性質（非負性・同一色=0・対称性）
// **Validates: Requirements 4.3**
// =============================================================================
describe('colorMatcher.deltaE / プロパティテスト（タスク2.3）', () => {
  it('Feature: bead-pattern-maker, Property 8: CIE76 ΔEの数学的性質（非負性・同一色=0・対称性）', () => {
    fc.assert(
      fc.property(rgbColorArb, rgbColorArb, (c1, c2) => {
        const lab1 = rgbToLab(c1.r, c1.g, c1.b);
        const lab2 = rgbToLab(c2.r, c2.g, c2.b);

        // (1) 非負性: ΔE ≥ 0（ユークリッド距離なので常に非負）
        expect(deltaE(lab1, lab2)).toBeGreaterThanOrEqual(0);

        // (2) 同一色のΔE = 0（自分自身との距離は0）
        expect(deltaE(lab1, lab1)).toBe(0);
        expect(deltaE(lab2, lab2)).toBe(0);

        // (3) 対称性: ΔE(a,b) = ΔE(b,a)
        //     差の二乗は符号に依らず一致するため、厳密等価で成立する。
        expect(deltaE(lab1, lab2)).toBe(deltaE(lab2, lab1));
      }),
      { numRuns: 200 },
    );
  });
});

// =============================================================================
// タスク2.4 / Property 7: 最近色変換の正確性
//   findClosestColor が返す色のΔEは、パレット内のどの色のΔE以下である。
// **Validates: Requirements 4.2, 4.3**
// =============================================================================
describe('colorMatcher.findClosestColor / プロパティテスト（タスク2.4）', () => {
  it('Feature: bead-pattern-maker, Property 7: 最近色変換の正確性（返す色はパレット内のどの色よりもΔEが小さいか等しい）', () => {
    fc.assert(
      fc.property(rgbColorArb, paletteArb, (target, palette) => {
        const result = findClosestColor(target, palette);

        // 非空パレットなので必ず色を返し、その色はパレットの要素である（参照一致）。
        expect(result).not.toBeNull();
        expect(palette).toContain(result);

        // 返した色のΔEは、パレット内のどの色のΔEよりも小さいか等しい（=最小）。
        const targetLab = rgbToLab(target.r, target.g, target.b);
        const resultDist = deltaE(targetLab, result.lab);
        for (const color of palette) {
          expect(deltaE(targetLab, color.lab)).toBeGreaterThanOrEqual(
            resultDist,
          );
        }
      }),
      { numRuns: 200 },
    );
  });
});

// =============================================================================
// タスク2.5 / Property 2: ビーズタイプ切替時の色再マッピング
//   remapPattern 後の全非nullセルが新パレット内の色であり、かつ元の色に対する
//   ΔEが新パレット内で最小の色である。nullセルは維持される。
// **Validates: Requirements 2.4**
// =============================================================================
describe('colorMatcher.remapPattern / プロパティテスト（タスク2.5）', () => {
  it('Feature: bead-pattern-maker, Property 2: ビーズタイプ切替時の色再マッピング（全セルが新パレット内かつ元色に対するΔE最小色、nullセルは維持）', () => {
    fc.assert(
      fc.property(patternArb, paletteArb, (pattern, newPalette) => {
        const result = remapPattern(pattern, newPalette);

        // グリッドの行数・列数は維持される。
        expect(result.cells).toHaveLength(pattern.cells.length);

        for (let row = 0; row < pattern.cells.length; row += 1) {
          expect(result.cells[row]).toHaveLength(pattern.cells[row].length);

          for (let col = 0; col < pattern.cells[row].length; col += 1) {
            const orig = pattern.cells[row][col];
            const mapped = result.cells[row][col];

            if (orig === null || orig === undefined) {
              // nullセル（未配置）は維持される。
              expect(mapped).toBeNull();
            } else {
              // 非nullセルは新パレット内の色（参照一致）になる。
              expect(newPalette).toContain(mapped);

              // 元の色に対するΔEが新パレット内で最小の色にマッピングされている。
              const origLab = rgbToLab(orig.r, orig.g, orig.b);
              const mappedDist = deltaE(origLab, mapped.lab);
              for (const color of newPalette) {
                expect(deltaE(origLab, color.lab)).toBeGreaterThanOrEqual(
                  mappedDist,
                );
              }
            }
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});

// =============================================================================
// タスク2.6: colorMatcher のユニットテスト（既知値・境界値）
// **検証対象: Requirements 4.2, 4.3**
// =============================================================================
describe('colorMatcher ユニットテスト（タスク2.6）', () => {
  // --- deltaE ---------------------------------------------------------------
  describe('deltaE', () => {
    it('同一Lab値のΔEは0', () => {
      expect(deltaE({ L: 50, a: 10, b: -20 }, { L: 50, a: 10, b: -20 })).toBe(0);
    });

    it('既知の3-4-5直角三角形でΔE=5', () => {
      // (3² + 4² + 0²) = 25、√25 = 5
      expect(deltaE({ L: 0, a: 0, b: 0 }, { L: 3, a: 4, b: 0 })).toBe(5);
    });

    it('L成分のみの差はそのままΔEになる', () => {
      expect(deltaE({ L: 10, a: 0, b: 0 }, { L: 20, a: 0, b: 0 })).toBe(10);
    });

    it('3次元の既知値（2-3-6→7）', () => {
      // (2² + 3² + 6²) = 4 + 9 + 36 = 49、√49 = 7
      expect(deltaE({ L: 0, a: 0, b: 0 }, { L: 2, a: 3, b: 6 })).toBe(7);
    });

    it('対称性（具体例）: ΔE(a,b) === ΔE(b,a)', () => {
      const a = { L: 12, a: -5, b: 30 };
      const b = { L: 80, a: 20, b: -10 };
      expect(deltaE(a, b)).toBe(deltaE(b, a));
    });
  });

  // --- findClosestColor -----------------------------------------------------
  describe('findClosestColor', () => {
    // 原色＋白＋黒の5色パレット（lab 付き）。
    const palette = initializePalette([
      { id: 'R', name: 'red', r: 255, g: 0, b: 0 },
      { id: 'G', name: 'green', r: 0, g: 255, b: 0 },
      { id: 'B', name: 'blue', r: 0, g: 0, b: 255 },
      { id: 'W', name: 'white', r: 255, g: 255, b: 255 },
      { id: 'K', name: 'black', r: 0, g: 0, b: 0 },
    ]);

    it('赤に近い色は赤（R）を返す', () => {
      expect(findClosestColor({ r: 250, g: 8, b: 8 }, palette).id).toBe('R');
    });

    it('完全一致する色（青）を返す', () => {
      expect(findClosestColor({ r: 0, g: 0, b: 255 }, palette).id).toBe('B');
    });

    it('白に近い明るいグレーは白（W）を返す', () => {
      expect(findClosestColor({ r: 240, g: 240, b: 240 }, palette).id).toBe('W');
    });

    it('黒に近い暗い色は黒（K）を返す', () => {
      expect(findClosestColor({ r: 12, g: 12, b: 12 }, palette).id).toBe('K');
    });

    it('空パレット／null パレットは null を返す', () => {
      expect(findClosestColor({ r: 1, g: 2, b: 3 }, [])).toBeNull();
      expect(findClosestColor({ r: 1, g: 2, b: 3 }, null)).toBeNull();
    });

    it('lab 未キャッシュのパレットでも rgbToLab でフォールバックして最近色を返す', () => {
      const raw = [
        { id: 'R', name: 'red', r: 255, g: 0, b: 0 },
        { id: 'K', name: 'black', r: 0, g: 0, b: 0 },
      ];
      expect(findClosestColor({ r: 250, g: 5, b: 5 }, raw).id).toBe('R');
    });

    it('ΔEが同値の場合は先に出現した色を優先する', () => {
      // A と B は同一RGB（=対象から等距離）。strict `<` 更新のため先頭の A が残る。
      const tie = initializePalette([
        { id: 'A', name: 'a', r: 100, g: 100, b: 100 },
        { id: 'B', name: 'b', r: 100, g: 100, b: 100 },
      ]);
      expect(findClosestColor({ r: 0, g: 0, b: 0 }, tie).id).toBe('A');
    });

    it('実在のパーラーパレットに対しても有効な色を返す', () => {
      const result = findClosestColor({ r: 0, g: 0, b: 0 }, REAL_PARLER);
      expect(REAL_PARLER).toContain(result);
      // 黒系の対象色は「くろ」に最も近い。
      expect(result.name).toBe('くろ');
    });
  });

  // --- remapPattern ---------------------------------------------------------
  describe('remapPattern', () => {
    const newPalette = initializePalette([
      { id: 'R', name: 'red', r: 255, g: 0, b: 0 },
      { id: 'B', name: 'blue', r: 0, g: 0, b: 255 },
    ]);
    const oldRed = { id: 'OR', name: 'oldred', r: 250, g: 10, b: 10 };
    const oldBlue = { id: 'OB', name: 'oldblue', r: 10, g: 10, b: 250 };

    it('nullセルは維持し、非nullセルは新パレット最近色へ写像する', () => {
      const pattern = {
        width: 2,
        height: 2,
        cells: [
          [oldRed, null],
          [oldBlue, oldRed],
        ],
      };

      const result = remapPattern(pattern, newPalette);

      expect(result.cells[0][0].id).toBe('R');
      expect(result.cells[0][1]).toBeNull();
      expect(result.cells[1][0].id).toBe('B');
      expect(result.cells[1][1].id).toBe('R');
    });

    it('originalCells も同じ新パレットへ再マッピングする', () => {
      const pattern = {
        width: 1,
        height: 1,
        cells: [[null]],
        originalCells: [[oldRed]],
      };

      const result = remapPattern(pattern, newPalette);

      expect(result.cells[0][0]).toBeNull();
      expect(result.originalCells[0][0].id).toBe('R');
    });

    it('元の図案オブジェクト・配列を破壊せず、新しい配列を返す', () => {
      const cells = [[oldRed]];
      const pattern = { width: 1, height: 1, cells };

      const result = remapPattern(pattern, newPalette);

      // 元の cells 配列・セル参照は不変。
      expect(pattern.cells).toBe(cells);
      expect(pattern.cells[0][0]).toBe(oldRed);
      // 結果は別配列で、最近色へ写像済み。
      expect(result.cells).not.toBe(cells);
      expect(result.cells[0][0].id).toBe('R');
    });

    it('width/height/beadType/plateConfig など他プロパティを維持する', () => {
      const pattern = {
        width: 1,
        height: 1,
        cells: [[null]],
        beadType: 'nano',
        plateConfig: { cols: 1, rows: 1 },
      };

      const result = remapPattern(pattern, newPalette);

      expect(result.width).toBe(1);
      expect(result.height).toBe(1);
      expect(result.beadType).toBe('nano');
      expect(result.plateConfig).toEqual({ cols: 1, rows: 1 });
    });

    it('同一RGBのセルは同一の新色オブジェクト（参照一致）へ写像する', () => {
      const pattern = {
        width: 2,
        height: 1,
        cells: [[oldRed, { ...oldRed }]],
      };

      const result = remapPattern(pattern, newPalette);

      // 同じ入力色はキャッシュにより同じ出力オブジェクトを共有する。
      expect(result.cells[0][0]).toBe(result.cells[0][1]);
    });
  });
});
