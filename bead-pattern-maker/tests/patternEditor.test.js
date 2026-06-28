import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { applyCellEdit, canvasPointToCell } from '../src/ui/patternEditor.js';
import { calculateUsedColors } from '../src/ui/colorList.js';

// =============================================================================
// 図案手動編集UI（patternEditor.js）のテスト
// -----------------------------------------------------------------------------
// 対象: src/ui/patternEditor.js のエクスポート純関数
//   - applyCellEdit(pattern, row, col, editTool)
//   - canvasPointToCell(canvas, event, cellSize, zoom)
// 使用色の再カウント検証には src/ui/colorList.js の calculateUsedColors を用いる。
//
// 本ファイルは以下の2タスク分のテストをまとめて実装する。
//
//   タスク16.5 / Property 22: 手動編集の反映と再カウント（プロパティテスト）
//       編集後の当該セルが選択色（paint）または null（erase）に一致し、
//       calculateUsedColors の totalBeads が編集後グリッドの非nullセル数と一致する。
//       **Validates: Requirements 12.2, 12.3, 12.4**
//
//   タスク16.6 / canvasPointToCell のユニットテスト
//       ズーム1.0/2.0で正しいセル[row][col]を返す・境界セル・グリッド外（null）を検証。
//       _Requirements: 12.2, 12.3_
//
// プロパティテストは fast-check で 200 回（最低100回以上）反復実行する。
// テスト名タグ形式: `Feature: bead-pattern-maker, Property {番号}: {プロパティ文}`
// =============================================================================

// -----------------------------------------------------------------------------
// 共通アービトラリ（ジェネレータ）
// -----------------------------------------------------------------------------

// 色名（calculateUsedColors のキー集約は id 基準なので名前は表示用の小さなプール）
const colorNameArb = fc.constantFrom(
  'しろ',
  'くろ',
  'あか',
  'あお',
  'きいろ',
  'みどり',
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
const paletteArb = fc.uniqueArray(beadColorArb, {
  minLength: 1,
  maxLength: 6,
  selector: (c) => c.id,
});

/**
 * 「編集シナリオ」を生成するアービトラリ。
 *   { pattern, row, col, editTool } を返す。
 *
 * - pattern: width(1-8) × height(1-8) の矩形グリッド。各セルは null か
 *   パレット内の色を等確率で取る（非null・未配置の両方を十分カバーする）。
 * - row/col: 必ずグリッド範囲内 [0,height)/[0,width) を生成する
 *   （applyCellEdit の編集が実際に反映されるケースを対象にする）。
 * - editTool: 「描画（paint, パレット色）」または「消しゴム（erase, null）」のいずれか。
 *
 * @returns {import('fast-check').Arbitrary} 編集シナリオのアービトラリ
 */
const editScenarioArb = paletteArb.chain((palette) => {
  const cellArb = fc.oneof(fc.constant(null), fc.constantFrom(...palette));

  return fc
    .record({
      width: fc.integer({ min: 1, max: 8 }),
      height: fc.integer({ min: 1, max: 8 }),
    })
    .chain(({ width, height }) =>
      fc
        .record({
          cells: fc.array(
            fc.array(cellArb, { minLength: width, maxLength: width }),
            { minLength: height, maxLength: height },
          ),
          row: fc.integer({ min: 0, max: height - 1 }),
          col: fc.integer({ min: 0, max: width - 1 }),
          // 描画ツール（パレット色）／消しゴム（未配置）のいずれか
          editTool: fc.oneof(
            fc.record({
              type: fc.constant('paint'),
              color: fc.constantFrom(...palette),
            }),
            fc.constant({ type: 'erase', color: null }),
          ),
        })
        .map(({ cells, row, col, editTool }) => ({
          pattern: { width, height, cells, beadType: 'perler' },
          row,
          col,
          editTool,
        })),
    );
});

/**
 * グリッドの非null（配置済み）セル数を数えるヘルパー。
 * @param {{cells: Array<Array<object|null>>}} pattern - 図案グリッド
 * @returns {number} 非nullセル数
 */
function countNonNullCells(pattern) {
  let count = 0;
  for (const row of pattern.cells) {
    for (const cell of row) {
      if (cell !== null && cell !== undefined) {
        count += 1;
      }
    }
  }
  return count;
}

// =============================================================================
// タスク16.5 / Property 22: 手動編集の反映と再カウント（プロパティテスト）
// **Validates: Requirements 12.2, 12.3, 12.4**
// =============================================================================

describe('patternEditor.applyCellEdit / プロパティテスト', () => {
  it('Feature: bead-pattern-maker, Property 22: 手動編集の反映と再カウント', () => {
    fc.assert(
      fc.property(editScenarioArb, ({ pattern, row, col, editTool }) => {
        const result = applyCellEdit(pattern, row, col, editTool);

        // (1) 編集後の当該セルが選択色（paint）または null（erase）に一致する
        //     （要件12.2: 描画 → 選択色 / 要件12.3: 消しゴム → 未配置null）
        if (editTool.type === 'paint') {
          expect(result.cells[row][col]).toEqual(editTool.color);
        } else {
          expect(result.cells[row][col]).toBeNull();
        }

        // (2) calculateUsedColors の totalBeads が編集後グリッドの非nullセル数と一致する
        //     （要件12.4: 編集後に使用色一覧・合計個数を即時再計算）
        const { totalBeads } = calculateUsedColors(result);
        expect(totalBeads).toBe(countNonNullCells(result));
      }),
      { numRuns: 200 },
    );
  });
});

// -----------------------------------------------------------------------------
// applyCellEdit のユニットテスト（具体例での正確性確認 / プロパティテストの補完）
// -----------------------------------------------------------------------------

describe('patternEditor.applyCellEdit / ユニットテスト', () => {
  const RED = { id: 'P01', name: 'あか', r: 255, g: 0, b: 0 };
  const BLUE = { id: 'P02', name: 'あお', r: 0, g: 0, b: 255 };

  /** 2×2 のテスト用グリッドを毎回新規生成する（テスト間の汚染を避ける）。 */
  function makePattern() {
    return {
      width: 2,
      height: 2,
      beadType: 'perler',
      cells: [
        [RED, null],
        [BLUE, RED],
      ],
    };
  }

  it('描画（paint）はクリックされたセルを選択色に変更する（要件12.2）', () => {
    const pattern = makePattern();
    const result = applyCellEdit(pattern, 0, 1, { type: 'paint', color: BLUE });

    expect(result.cells[0][1]).toEqual(BLUE);
    // 編集後の合計は非nullセル数（元3個 + 新規1個 = 4個）
    expect(calculateUsedColors(result).totalBeads).toBe(4);
  });

  it('消しゴム（erase）はクリックされたセルを未配置（null）に変更する（要件12.3）', () => {
    const pattern = makePattern();
    const result = applyCellEdit(pattern, 1, 1, { type: 'erase', color: null });

    expect(result.cells[1][1]).toBeNull();
    // 編集後の合計は非nullセル数（元3個 - 1個 = 2個）
    expect(calculateUsedColors(result).totalBeads).toBe(2);
  });

  it('元の図案を破壊せず、新しいグリッド参照を返す（再描画通知のため）', () => {
    const pattern = makePattern();
    const result = applyCellEdit(pattern, 0, 0, { type: 'erase', color: null });

    // 戻り値は別オブジェクト、対象行も別配列に差し替えられている
    expect(result).not.toBe(pattern);
    expect(result.cells).not.toBe(pattern.cells);
    expect(result.cells[0]).not.toBe(pattern.cells[0]);
    // 元の図案は変更されていない
    expect(pattern.cells[0][0]).toEqual(RED);
  });

  it('描画（paint）で色が未選択（null）の場合は変更せず元の図案を返す', () => {
    const pattern = makePattern();
    const result = applyCellEdit(pattern, 0, 0, { type: 'paint', color: null });

    // 塗る色が無いので no-op（同一参照を返す）
    expect(result).toBe(pattern);
  });

  it('グリッド範囲外の座標は編集せず元の図案を返す', () => {
    const pattern = makePattern();

    expect(applyCellEdit(pattern, -1, 0, { type: 'erase', color: null })).toBe(
      pattern,
    );
    expect(applyCellEdit(pattern, 0, 2, { type: 'paint', color: RED })).toBe(
      pattern,
    );
    expect(applyCellEdit(pattern, 2, 0, { type: 'paint', color: RED })).toBe(
      pattern,
    );
  });
});

// =============================================================================
// タスク16.6 / canvasPointToCell のユニットテスト
// _Requirements: 12.2, 12.3_
// =============================================================================

/**
 * テスト用のモックCanvasを生成する。
 * getBoundingClientRect と内部解像度（width/height）を持つ最小オブジェクト。
 *
 * @param {object} opts
 * @param {number} opts.width - 内部解像度の幅（canvas.width）
 * @param {number} opts.height - 内部解像度の高さ（canvas.height）
 * @param {{width?: number, height?: number, left?: number, top?: number}} [opts.rect]
 *        - getBoundingClientRect が返す表示サイズ。省略時は内部解像度と等倍。
 * @returns {object} モックCanvas
 */
function makeCanvas({ width, height, rect }) {
  const resolvedRect = rect ?? { width, height, left: 0, top: 0 };
  return {
    width,
    height,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      ...resolvedRect,
    }),
  };
}

/** offsetX/offsetY を持つクリックイベントモック。 */
function offsetEvent(offsetX, offsetY) {
  return { offsetX, offsetY };
}

/** clientX/clientY を持つクリックイベントモック（offset無し）。 */
function clientEvent(clientX, clientY) {
  return { clientX, clientY };
}

describe('patternEditor.canvasPointToCell / ユニットテスト', () => {
  // ---------------------------------------------------------------------------
  // ズーム1.0（表示=内部解像度、等倍）
  // 内部解像度 100×50、cellSize=10 → 実効セル10px、グリッド 10列×5行
  // ---------------------------------------------------------------------------
  describe('ズーム1.0', () => {
    const canvas = makeCanvas({ width: 100, height: 50 });

    it('クリック位置を正しいセル[row][col]に変換する', () => {
      // offset(25,35) → col=floor(25/10)=2, row=floor(35/10)=3
      expect(canvasPointToCell(canvas, offsetEvent(25, 35), 10, 1.0)).toEqual({
        row: 3,
        col: 2,
      });
    });

    it('原点(0,0)は先頭セル[0][0]を返す', () => {
      expect(canvasPointToCell(canvas, offsetEvent(0, 0), 10, 1.0)).toEqual({
        row: 0,
        col: 0,
      });
    });

    it('セル境界ちょうどの座標は次のセルに属する', () => {
      // x=10 はちょうど2列目の先頭 → col=1、x=9 は1列目 → col=0
      expect(canvasPointToCell(canvas, offsetEvent(10, 0), 10, 1.0)).toEqual({
        row: 0,
        col: 1,
      });
      expect(canvasPointToCell(canvas, offsetEvent(9, 0), 10, 1.0)).toEqual({
        row: 0,
        col: 0,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // ズーム2.0（実効セルサイズ = cellSize × zoom = 20px）
  // 内部解像度 200×100、cellSize=10、zoom=2 → グリッド 10列×5行
  // ---------------------------------------------------------------------------
  describe('ズーム2.0', () => {
    const canvas = makeCanvas({ width: 200, height: 100 });

    it('実効セルサイズ20pxで正しいセルに変換する', () => {
      // offset(45,65) → col=floor(45/20)=2, row=floor(65/20)=3
      expect(canvasPointToCell(canvas, offsetEvent(45, 65), 10, 2.0)).toEqual({
        row: 3,
        col: 2,
      });
    });

    it('セル境界ちょうど(20)は次のセルに属する', () => {
      // x=20 → col=1、x=19 → col=0
      expect(canvasPointToCell(canvas, offsetEvent(20, 0), 10, 2.0)).toEqual({
        row: 0,
        col: 1,
      });
      expect(canvasPointToCell(canvas, offsetEvent(19, 0), 10, 2.0)).toEqual({
        row: 0,
        col: 0,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 境界セル（グリッドの端の有効セル）
  // ---------------------------------------------------------------------------
  describe('境界セル', () => {
    const canvas = makeCanvas({ width: 100, height: 50 }); // 10列×5行

    it('右下端の有効セル[最終行][最終列]を返す', () => {
      // offset(99,49) → col=floor(99/10)=9（最終列）, row=floor(49/10)=4（最終行）
      expect(canvasPointToCell(canvas, offsetEvent(99, 49), 10, 1.0)).toEqual({
        row: 4,
        col: 9,
      });
    });

    it('最終列の先頭ピクセル(90)は最終列[9]を返す', () => {
      expect(canvasPointToCell(canvas, offsetEvent(90, 0), 10, 1.0)).toEqual({
        row: 0,
        col: 9,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // グリッド外（null返却）
  // ---------------------------------------------------------------------------
  describe('グリッド外は null を返す', () => {
    const canvas = makeCanvas({ width: 100, height: 50 }); // 10列×5行

    it('右端を超える x（=幅）は null', () => {
      // x=100 → col=floor(100/10)=10 ≥ cols(10) → null
      expect(canvasPointToCell(canvas, offsetEvent(100, 0), 10, 1.0)).toBeNull();
    });

    it('下端を超える y（=高さ）は null', () => {
      // y=50 → row=floor(50/10)=5 ≥ rows(5) → null
      expect(canvasPointToCell(canvas, offsetEvent(0, 50), 10, 1.0)).toBeNull();
    });

    it('はるか右下の座標は null', () => {
      expect(
        canvasPointToCell(canvas, offsetEvent(500, 500), 10, 1.0),
      ).toBeNull();
    });

    it('負の座標は null', () => {
      // x=-1 → col=floor(-0.1)=-1 < 0 → null
      expect(canvasPointToCell(canvas, offsetEvent(-1, 0), 10, 1.0)).toBeNull();
      expect(canvasPointToCell(canvas, offsetEvent(0, -1), 10, 1.0)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // 表示サイズと内部解像度の比（scaleX/scaleY）の補正
  // ---------------------------------------------------------------------------
  describe('表示/内部解像度比の補正', () => {
    it('表示サイズが内部解像度の半分なら offset を2倍して変換する', () => {
      // 内部 200×100、表示 100×50 → scaleX=2, scaleY=2
      // cellSize=10, zoom=1 → 実効10px、グリッド 20列×10行
      const canvas = makeCanvas({
        width: 200,
        height: 100,
        rect: { width: 100, height: 50, left: 0, top: 0 },
      });
      // offset(25,15) → canvas内部(50,30) → col=floor(50/10)=5, row=floor(30/10)=3
      expect(canvasPointToCell(canvas, offsetEvent(25, 15), 10, 1.0)).toEqual({
        row: 3,
        col: 5,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // offsetX/offsetY が無いイベントは clientX/Y − rect.left/top にフォールバック
  // ---------------------------------------------------------------------------
  describe('clientX/clientY フォールバック', () => {
    it('offset が無い場合は client 座標から rect 左上を引いて変換する', () => {
      // 内部=表示 100×50（等倍）、rect.left=20, top=10
      const canvas = makeCanvas({
        width: 100,
        height: 50,
        rect: { width: 100, height: 50, left: 20, top: 10 },
      });
      // client(45,25) → point(25,15) → col=floor(25/10)=2, row=floor(15/10)=1
      expect(canvasPointToCell(canvas, clientEvent(45, 25), 10, 1.0)).toEqual({
        row: 1,
        col: 2,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 不正入力は null（防御的）
  // ---------------------------------------------------------------------------
  describe('不正入力は null を返す', () => {
    const canvas = makeCanvas({ width: 100, height: 50 });

    it('canvas / event が無い場合は null', () => {
      expect(canvasPointToCell(null, offsetEvent(0, 0), 10, 1.0)).toBeNull();
      expect(canvasPointToCell(canvas, null, 10, 1.0)).toBeNull();
    });

    it('実効セルサイズが0以下・非数値の場合は null', () => {
      // zoom=0 → 実効0px → null
      expect(canvasPointToCell(canvas, offsetEvent(10, 10), 10, 0)).toBeNull();
      // cellSize=NaN → 非数値 → null
      expect(canvasPointToCell(canvas, offsetEvent(10, 10), NaN, 1.0)).toBeNull();
    });
  });
});
