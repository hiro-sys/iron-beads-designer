import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  calculateTotalBeads,
  createEmptyGrid,
  validatePlateCount,
  validateImageFile,
} from '../src/utils/validation.js';

// =============================================================================
// グリッド計算・バリデーション（validation.js）のプロパティテスト
// -----------------------------------------------------------------------------
// 対象: src/utils/validation.js
//   - calculateTotalBeads(plateConfig, beadType) … 総ビーズ数
//   - createEmptyGrid(plateConfig, beadType)      … 全セル未配置の空グリッド
//   - validatePlateCount(value)                   … プレート枚数バリデーション
//   - validateImageFile(file)                     … 画像ファイルバリデーション
//
// 本ファイルは以下の4タスク分のプロパティテストをまとめて収める。
//   - タスク4.2: 総ビーズ数計算のプロパティテスト（Property 4）
//   - タスク4.3: 空グリッド生成のプロパティテスト（Property 5）
//   - タスク4.4: プレート枚数バリデーションのプロパティテスト（Property 3）
//   - タスク4.5: ファイルバリデーションのプロパティテスト（Property 1）
//
// 検証対象: Requirements 3.3, 3.4, 3.1, 3.2, 3.6, 1.2, 1.4, 1.6
//
// プロパティテストは fast-check で 200 回（最低100回以上）反復実行し、各 it 名に
// タグ `Feature: bead-pattern-maker, Property {番号}: {プロパティ文}` を付与する。
//
// 【独立オラクル方針】
//   テストが実装をそのまま写し取らないよう、期待値はテスト側で独立に定義する。
//   ペグ数（perler=29 / nano=28）や許可形式・上限サイズは要件で定められた値を
//   テスト内に明示し、実装の内部定数には依存しない。
// =============================================================================

// -----------------------------------------------------------------------------
// 共通アービトラリ（ジェネレータ）と独立オラクル
// -----------------------------------------------------------------------------

/**
 * ビーズタイプのジェネレーター（'perler' | 'nano'）。
 * @type {fc.Arbitrary<'perler' | 'nano'>}
 */
const beadTypeArb = fc.constantFrom('perler', 'nano');

/**
 * 有効なプレート構成のジェネレーター（cols / rows ともに 1〜10 の整数、要件3.1/3.2）。
 * @type {fc.Arbitrary<{ cols: number, rows: number }>}
 */
const plateConfigArb = fc.record({
  cols: fc.integer({ min: 1, max: 10 }),
  rows: fc.integer({ min: 1, max: 10 }),
});

/**
 * ビーズタイプごとのペグ数（独立オラクル）。
 * 要件3.3: パーラービーズ=29、ナノビーズ=28。実装の BEAD_CONFIG には依存しない。
 * @param {'perler' | 'nano'} beadType
 * @returns {number} ペグ数
 */
function pegCountOf(beadType) {
  return beadType === 'perler' ? 29 : 28;
}

// =============================================================================
// タスク4.2 / Property 4: 総ビーズ数計算の正確性
//   任意の有効なプレート構成（cols/rows: 1-10）とビーズタイプに対して、
//   calculateTotalBeads は (cols×pegCount)×(rows×pegCount) と一致する。
// **Validates: Requirements 3.3**
// =============================================================================
describe('validation.calculateTotalBeads / プロパティテスト（タスク4.2）', () => {
  it('Feature: bead-pattern-maker, Property 4: 総ビーズ数計算の正確性（(cols×pegCount)×(rows×pegCount) と一致、pegCount: perler=29/nano=28）', () => {
    fc.assert(
      fc.property(plateConfigArb, beadTypeArb, (plateConfig, beadType) => {
        const pegCount = pegCountOf(beadType);
        const expected =
          plateConfig.cols * pegCount * (plateConfig.rows * pegCount);

        expect(calculateTotalBeads(plateConfig, beadType)).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });
});

// =============================================================================
// タスク4.3 / Property 5: プレート構成変更時のグリッドサイズ
//   任意の有効なプレート構成とビーズタイプに対して、createEmptyGrid の
//   width=cols×pegCount, height=rows×pegCount であり、全セルが null（未配置）。
// **Validates: Requirements 3.4**
// =============================================================================
describe('validation.createEmptyGrid / プロパティテスト（タスク4.3）', () => {
  it('Feature: bead-pattern-maker, Property 5: プレート構成変更時のグリッドサイズ（幅=cols×pegCount, 高さ=rows×pegCount, 全セル未配置）', () => {
    fc.assert(
      fc.property(plateConfigArb, beadTypeArb, (plateConfig, beadType) => {
        const pegCount = pegCountOf(beadType);
        const expectedWidth = plateConfig.cols * pegCount;
        const expectedHeight = plateConfig.rows * pegCount;

        const grid = createEmptyGrid(plateConfig, beadType);

        // width / height は (cols×pegCount) / (rows×pegCount) と一致する。
        expect(grid.width).toBe(expectedWidth);
        expect(grid.height).toBe(expectedHeight);

        // cells / originalCells はともに height 行 × width 列。
        expect(grid.cells).toHaveLength(expectedHeight);
        expect(grid.originalCells).toHaveLength(expectedHeight);

        // 全行が width 列で、全セルが null（未配置）であることを確認する。
        // 大きなグリッド（最大290×290）でも高速に判定できるよう every で集約する。
        const cellsAllNull = grid.cells.every(
          (row) => row.length === expectedWidth && row.every((c) => c === null),
        );
        const originalAllNull = grid.originalCells.every(
          (row) => row.length === expectedWidth && row.every((c) => c === null),
        );
        expect(cellsAllNull).toBe(true);
        expect(originalAllNull).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});

// =============================================================================
// タスク4.4 / Property 3: プレート枚数バリデーション
//   任意の入力値に対して、validatePlateCount は 1〜10 の整数のみ valid、
//   それ以外（負数 / 0 / 小数 / 非数値 / 11以上）を invalid と判定する。
// **Validates: Requirements 3.1, 3.2, 3.6**
//
// 入力空間を「期待結果が確定するカテゴリ」に分割して生成する（ラベル付きジェネレータ）。
// 各ケースは { input, shouldBeValid, expectedValue? } を持ち、期待結果を独立に定める。
// =============================================================================

/**
 * 有効ケース: 1〜10 の整数。数値そのものと文字列表現の両方を生成する。
 * @type {fc.Arbitrary<{ input: (number|string), shouldBeValid: true, expectedValue: number }>}
 */
const validPlateCountArb = fc.integer({ min: 1, max: 10 }).chain((n) =>
  fc.constantFrom(n, String(n)).map((input) => ({
    input,
    shouldBeValid: true,
    expectedValue: n,
  })),
);

/**
 * 無効ケース: 11以上の整数（範囲超過）。数値・文字列の両方。
 * @type {fc.Arbitrary<{ input: (number|string), shouldBeValid: false }>}
 */
const tooLargePlateCountArb = fc.integer({ min: 11, max: 100000 }).chain((n) =>
  fc.constantFrom(n, String(n)).map((input) => ({ input, shouldBeValid: false })),
);

/**
 * 無効ケース: 0以下の整数（負数・0）。数値・文字列の両方。
 * @type {fc.Arbitrary<{ input: (number|string), shouldBeValid: false }>}
 */
const tooSmallPlateCountArb = fc.integer({ min: -100000, max: 0 }).chain((n) =>
  fc.constantFrom(n, String(n)).map((input) => ({ input, shouldBeValid: false })),
);

/**
 * 無効ケース: 小数（非整数）。整数部 + frac/100（frac:1-99）で常に非整数を作る。
 * 数値・文字列の両方を生成する。小数は決して 1〜10 の整数にならないため常に無効。
 * @type {fc.Arbitrary<{ input: (number|string), shouldBeValid: false }>}
 */
const decimalPlateCountArb = fc
  .tuple(fc.integer({ min: -20, max: 20 }), fc.integer({ min: 1, max: 99 }))
  .chain(([intPart, frac]) => {
    const value = intPart + frac / 100; // 小数部が必ず残るため非整数
    return fc
      .constantFrom(value, String(value))
      .map((input) => ({ input, shouldBeValid: false }));
  });

/**
 * 無効ケース: 非数値の文字列（英字のみ）。parseInt が必ず NaN になるため常に無効。
 * @type {fc.Arbitrary<{ input: string, shouldBeValid: false }>}
 */
const nonNumericStringArb = fc
  .array(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'),
    { minLength: 1, maxLength: 8 },
  )
  .map((chars) => ({ input: chars.join(''), shouldBeValid: false }));

/**
 * 無効ケース: 明示的なエッジ入力（空文字・空白・null・undefined・NaN・真偽値・無限大など）。
 * いずれも parseInt が NaN になり無効と判定される。
 * @type {fc.Arbitrary<{ input: *, shouldBeValid: false }>}
 */
const edgePlateCountArb = fc
  .constantFrom('', ' ', 'NaN', 'Infinity', null, undefined, NaN, true, false, Infinity, -Infinity)
  .map((input) => ({ input, shouldBeValid: false }));

const plateCountCaseArb = fc.oneof(
  validPlateCountArb,
  tooLargePlateCountArb,
  tooSmallPlateCountArb,
  decimalPlateCountArb,
  nonNumericStringArb,
  edgePlateCountArb,
);

describe('validation.validatePlateCount / プロパティテスト（タスク4.4）', () => {
  it('Feature: bead-pattern-maker, Property 3: プレート枚数バリデーション（1〜10の整数のみ valid、負数/0/小数/非数値/11以上は invalid）', () => {
    fc.assert(
      fc.property(plateCountCaseArb, ({ input, shouldBeValid, expectedValue }) => {
        const result = validatePlateCount(input);

        expect(result.valid).toBe(shouldBeValid);
        if (shouldBeValid) {
          // 有効時は正規化済みの整数値を返す。
          expect(result.value).toBe(expectedValue);
        }
      }),
      { numRuns: 200 },
    );
  });
});

// =============================================================================
// タスク4.5 / Property 1: ファイルバリデーションの正確性
//   任意のファイル（type と size の組み合わせ）に対して、validateImageFile は
//   許可形式（image/jpeg, image/png, image/gif, image/webp）かつ 10MB以下のみ
//   valid、それ以外を invalid と判定する。
// **Validates: Requirements 1.2, 1.4, 1.6**
//
// File は { type, size } を持つモックオブジェクトで生成する（実装は type/size のみ参照）。
// =============================================================================

/**
 * 許可される MIME タイプ（独立オラクル、要件1.2）。実装の内部定数には依存しない。
 * @type {readonly string[]}
 */
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/**
 * ファイルサイズ上限（独立オラクル、要件1.2/1.6: 10MB）。
 * @type {number}
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * 許可 MIME タイプのジェネレーター。
 * @type {fc.Arbitrary<string>}
 */
const allowedTypeArb = fc.constantFrom(...ALLOWED_TYPES);

/**
 * 非許可 MIME タイプのジェネレーター。
 * 代表的な非許可タイプの定数群に加え、許可リストに含まれない任意文字列も生成する。
 * 大文字違い（'IMAGE/JPEG'）など、完全一致でないケースも非許可として扱う。
 * @type {fc.Arbitrary<string>}
 */
const disallowedTypeArb = fc.oneof(
  fc.constantFrom(
    'image/bmp',
    'image/svg+xml',
    'image/tiff',
    'image/x-icon',
    'text/plain',
    'application/pdf',
    'application/octet-stream',
    'video/mp4',
    '',
    'jpeg',
    'png',
    'image/jpg',
    'IMAGE/JPEG',
    'image/PNG',
  ),
  fc.string({ maxLength: 20 }).filter((s) => !ALLOWED_TYPES.includes(s)),
);

/**
 * MIME タイプのジェネレーター（許可・非許可を混在）。
 * @type {fc.Arbitrary<string>}
 */
const fileTypeArb = fc.oneof(allowedTypeArb, disallowedTypeArb);

/**
 * ファイルサイズ（バイト）のジェネレーター。
 * 上限以下・上限超過の両方を広く生成し、境界（0, MAX-1, MAX, MAX+1）も明示的に含める。
 * @type {fc.Arbitrary<number>}
 */
const fileSizeArb = fc.oneof(
  fc.integer({ min: 0, max: MAX_FILE_SIZE }), // 上限以下（0 と ちょうど上限を含む）
  fc.integer({ min: MAX_FILE_SIZE + 1, max: MAX_FILE_SIZE * 5 }), // 上限超過
  fc.constantFrom(0, 1, MAX_FILE_SIZE - 1, MAX_FILE_SIZE, MAX_FILE_SIZE + 1), // 境界値
);

describe('validation.validateImageFile / プロパティテスト（タスク4.5）', () => {
  it('Feature: bead-pattern-maker, Property 1: ファイルバリデーションの正確性（許可形式かつ10MB以下のみ valid、それ以外は invalid）', () => {
    fc.assert(
      fc.property(fileTypeArb, fileSizeArb, (type, size) => {
        const file = { type, size };
        const result = validateImageFile(file);

        // 独立オラクル: 許可形式 かつ 10MB以下 のときのみ valid。
        const shouldBeValid = ALLOWED_TYPES.includes(type) && size <= MAX_FILE_SIZE;

        expect(result.valid).toBe(shouldBeValid);
        if (!shouldBeValid) {
          // 無効時は理由を示すエラーメッセージ（文字列）を返す。
          expect(typeof result.error).toBe('string');
          expect(result.error.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 200 },
    );
  });
});
