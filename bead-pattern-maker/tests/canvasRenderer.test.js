import { describe, it, expect } from 'vitest';
import {
  computeEffectiveCellSize,
  computeCanvasDimensions,
  getPegCount,
} from '../src/renderer/canvasRenderer.js';

// =============================================================================
// Canvas描画エンジン（canvasRenderer.js）の純ロジックのユニットテスト
// -----------------------------------------------------------------------------
// 本ファイルはタスク12.4（canvasRenderer 分）を担う。
//   - computeEffectiveCellSize: cellSize×zoom の計算、不正値のフォールバック、
//     ズーム 1.0 / 2.0 の反映
//   - computeCanvasDimensions: ズーム反映後の Canvas 寸法（width=cols×effectiveCellSize 等）
//   - getPegCount: perler→29 / nano→28 / 未知→29 フォールバック
//
// Canvas 描画そのものはブラウザ環境依存のため手動テスト対象とし、ここでは
// 描画に依存しない座標・寸法計算ロジックのみを自動検証する。
//
// 検証対象: Requirements 7.1, 5.3
//
// 設計参照: design.md「4. Canvas描画エンジン（canvasRenderer.js）」「ズーム対応」
// =============================================================================

const DEFAULT_CELL_SIZE = 10; // 実装の既定セルサイズ（ズーム1.0時）
const DEFAULT_ZOOM = 1.0;

// -----------------------------------------------------------------------------
// computeEffectiveCellSize（実効セルサイズ = cellSize × zoom）
// -----------------------------------------------------------------------------
describe('computeEffectiveCellSize（タスク12.4 / Requirements 5.3）', () => {
  describe('正常系: cellSize × zoom を計算する', () => {
    it.each([
      ['zoom 1.0 はセルサイズそのまま', 10, 1.0, 10],
      ['zoom 2.0 はセルサイズの2倍', 10, 2.0, 20],
      ['cellSize 20 × zoom 2.0 = 40', 20, 2.0, 40],
      ['cellSize 8 × zoom 1.5 = 12', 8, 1.5, 12],
      ['zoom 0.5（縮小）は半分', 10, 0.5, 5],
      ['zoom 4.0（最大相当）は4倍', 10, 4.0, 40],
    ])('%s', (_label, cellSize, zoom, expected) => {
      expect(computeEffectiveCellSize(cellSize, zoom)).toBe(expected);
    });
  });

  describe('不正な cellSize は既定値(10)へフォールバックする', () => {
    it.each([
      ['0', 0],
      ['負数', -5],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['文字列', 'abc'],
      ['null', null],
      ['undefined', undefined],
    ])('cellSize=%s のとき base=10 として扱う（zoom 2.0 → 20）', (_label, cellSize) => {
      expect(computeEffectiveCellSize(cellSize, 2.0)).toBe(DEFAULT_CELL_SIZE * 2.0);
    });
  });

  describe('不正な zoom は既定値(1.0)へフォールバックする', () => {
    it.each([
      ['0', 0],
      ['負数', -1],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['文字列', 'x'],
      ['null', null],
      ['undefined', undefined],
    ])('zoom=%s のとき z=1.0 として扱う（cellSize 10 → 10）', (_label, zoom) => {
      expect(computeEffectiveCellSize(10, zoom)).toBe(DEFAULT_CELL_SIZE * DEFAULT_ZOOM);
    });
  });

  it('cellSize・zoom がともに不正なら既定値同士の積（10 × 1.0 = 10）', () => {
    expect(computeEffectiveCellSize(NaN, NaN)).toBe(10);
    expect(computeEffectiveCellSize(0, 0)).toBe(10);
  });
});

// -----------------------------------------------------------------------------
// computeCanvasDimensions（Canvas 内部寸法 = セル数 × 実効セルサイズ）
// -----------------------------------------------------------------------------
describe('computeCanvasDimensions（タスク12.4 / Requirements 5.3）', () => {
  it('ズーム1.0: width=cols×cellSize, height=rows×cellSize', () => {
    const pattern = { width: 3, height: 4 };
    expect(computeCanvasDimensions(pattern, 10, 1.0)).toEqual({ width: 30, height: 40 });
  });

  it('ズーム2.0: 実効セルサイズ(20)が反映され寸法が2倍になる', () => {
    const pattern = { width: 3, height: 4 };
    expect(computeCanvasDimensions(pattern, 10, 2.0)).toEqual({ width: 60, height: 80 });
  });

  it('ズーム0.5: 実効セルサイズ(5)が反映され寸法が半分になる', () => {
    const pattern = { width: 4, height: 2 };
    expect(computeCanvasDimensions(pattern, 10, 0.5)).toEqual({ width: 20, height: 10 });
  });

  it('1プレート相当（29×29）× cellSize10 × zoom1.0 = 290×290', () => {
    const pattern = { width: 29, height: 29 };
    expect(computeCanvasDimensions(pattern, 10, 1.0)).toEqual({ width: 290, height: 290 });
  });

  it('不正な cellSize は既定値(10)へフォールバックして寸法計算する', () => {
    const pattern = { width: 2, height: 2 };
    // cellSize=0 → base 10、zoom 1.0 → 実効 10 → 20×20
    expect(computeCanvasDimensions(pattern, 0, 1.0)).toEqual({ width: 20, height: 20 });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['width/height 欠落', {}],
  ])('pattern=%s のときは cols=rows=0 として {0,0} を返す', (_label, pattern) => {
    expect(computeCanvasDimensions(pattern, 10, 1.0)).toEqual({ width: 0, height: 0 });
  });

  it('実効セルサイズ = cellSize × zoom が width/height に一貫して反映される', () => {
    const pattern = { width: 5, height: 7 };
    const cellSize = 12;
    const zoom = 2.0;
    const effective = computeEffectiveCellSize(cellSize, zoom); // 24
    const dims = computeCanvasDimensions(pattern, cellSize, zoom);
    expect(dims.width).toBe(pattern.width * effective);
    expect(dims.height).toBe(pattern.height * effective);
  });
});

// -----------------------------------------------------------------------------
// getPegCount（ビーズタイプ → ペグ数）
// -----------------------------------------------------------------------------
describe('getPegCount（タスク12.4 / Requirements 7.1, 5.3）', () => {
  it('perler は 29 を返す', () => {
    expect(getPegCount('perler')).toBe(29);
  });

  it('nano は 28 を返す', () => {
    expect(getPegCount('nano')).toBe(28);
  });

  it.each([
    ['未知のタイプ', 'unknown'],
    ['空文字', ''],
    ['undefined', undefined],
    ['null', null],
  ])('%s は perler(29) にフォールバックする', (_label, beadType) => {
    expect(getPegCount(beadType)).toBe(29);
  });
});
