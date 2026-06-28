import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { ensureImageData } from './helpers/canvasMock.js';
import { initializePalette } from '../src/data/beadConfig.js';
import { PARLER_PALETTE } from '../src/data/parlerPalette.js';

// =============================================================================
// LocalConversionStrategy（src/engine/LocalConversionStrategy.js）のテスト
// -----------------------------------------------------------------------------
// 対象: LocalConversionStrategy.convert(image, options) のパイプライン
//   フィット／リサイズ → 透明判定・白合成 → 減色（任意）→
//   パレット最近色マッチング → 背景除外（任意）→ PatternGrid 生成
//
// 本ファイルは以下の3タスク分のテストをまとめて収める。
//   - タスク9.3: Property 19 透明ピクセルの未配置変換（alpha<128→null, alpha>=128→非null）
//                検証対象: Requirements 4.6, 4.7
//   - タスク9.4: Property 21 無効色の除外（非nullセルは全て有効パレット内、無効化色は不使用）
//                検証対象: Requirements 11.2
//   - タスク9.5: ユニットテスト（減色→マッチングの順序、半透明の白合成、
//                背景除外オフ時の透明→null、PatternGrid構造）
//                検証対象: Requirements 4.4, 4.6, 4.7, 11.4
//
// 【Canvas/ImageData の制御方針】
//   convert は内部で imageProcessor.resizeImage を呼び、Canvas経由で ImageData を
//   得る。テストでは特定の alpha 値・ピクセル色を持つデータを convert へ流したいので、
//   imageProcessor モジュールを vi.mock で差し替え、resizeImage が任意に構築した
//   ImageData を返すようにする。これにより透明/不透明・色を厳密に制御できる。
//   reduceColors / findClosestColor / applyBackgroundExclusion は実装をそのまま用い、
//   パイプライン全体の実挙動を検証する。
// =============================================================================

// imageProcessor をモックし、resizeImage の戻り ImageData をテストから制御する。
// （vi.mock はファイル先頭へ巻き上げられるため、対象モジュールの import より前に
//   登録された状態になる。LocalConversionStrategy 内の resizeImage も同じモックを参照する。）
vi.mock('../src/engine/imageProcessor.js', () => ({
  resizeImage: vi.fn(),
}));

import { resizeImage } from '../src/engine/imageProcessor.js';
import { LocalConversionStrategy } from '../src/engine/LocalConversionStrategy.js';

// -----------------------------------------------------------------------------
// 共有フィクスチャ / ヘルパー
// -----------------------------------------------------------------------------

const strategy = new LocalConversionStrategy();

// Lab をキャッシュした実パレット（プロパティテストの有効パレット母集合に用いる）。
const FULL_PALETTE = initializePalette(PARLER_PALETTE);

// convert は image が truthy であることだけを要求する（resizeImage はモック済みで
// 実画像を参照しない）。寸法は ImageData 側で制御するため、ダミーで十分。
const dummyImage = { width: 10, height: 10, naturalWidth: 10, naturalHeight: 10 };

/**
 * 任意のピクセル列（{r,g,b,a}[]、行優先 [row][col]）から ImageData を構築する。
 * resizeImage のモック戻り値として用い、convert に特定のピクセルデータを流す。
 *
 * @param {number} width - 幅（ビーズ数）
 * @param {number} height - 高さ（ビーズ数）
 * @param {{r:number,g:number,b:number,a:number}[]} pixels - width*height 個のピクセル（行優先）
 * @returns {ImageData} 構築した ImageData（data 長は width*height*4）
 */
function makeImageData(width, height, pixels) {
  const ImageDataCtor = ensureImageData();
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 1) {
    const p = pixels[i];
    data[i * 4] = p.r;
    data[i * 4 + 1] = p.g;
    data[i * 4 + 2] = p.b;
    data[i * 4 + 3] = p.a;
  }
  return new ImageDataCtor(data, width, height);
}

beforeEach(() => {
  // 各テストごとにモックを初期化する（呼び出し履歴・戻り値設定をリセット）。
  resizeImage.mockReset();
});

// -----------------------------------------------------------------------------
// テスト用ジェネレータ
// -----------------------------------------------------------------------------

// 任意のRGBAピクセル（透明/不透明が混在しうる）
const rgbaArb = fc.record({
  r: fc.integer({ min: 0, max: 255 }),
  g: fc.integer({ min: 0, max: 255 }),
  b: fc.integer({ min: 0, max: 255 }),
  a: fc.integer({ min: 0, max: 255 }),
});

// 幅・高さ（1〜6）と、その寸法ぴったりのピクセル列をまとめて生成する。
const gridArb = fc
  .tuple(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 6 }))
  .chain(([width, height]) =>
    fc.record({
      width: fc.constant(width),
      height: fc.constant(height),
      pixels: fc.array(rgbaArb, { minLength: width * height, maxLength: width * height }),
    }),
  );

// 不透明ピクセル（alpha>=128）のみのグリッド。全セルが非nullになり、無効色除外の
// 検証（Property 21）で「実際に色が使われるセル」を十分に確保できる。
const opaqueGridArb = fc
  .tuple(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 6 }))
  .chain(([width, height]) =>
    fc.record({
      width: fc.constant(width),
      height: fc.constant(height),
      pixels: fc.array(
        fc.record({
          r: fc.integer({ min: 0, max: 255 }),
          g: fc.integer({ min: 0, max: 255 }),
          b: fc.integer({ min: 0, max: 255 }),
          a: fc.integer({ min: 128, max: 255 }),
        }),
        { minLength: width * height, maxLength: width * height },
      ),
    }),
  );

// 有効パレット（FULL_PALETTE の非空な部分集合）。ブールマスクで各色の有効/無効を
// 決め、全色無効（空集合）は除外する。全色無効は確率的にほぼ起きないため filter の
// 棄却はほぼ発生しない。
const activePaletteArb = fc
  .array(fc.boolean(), { minLength: FULL_PALETTE.length, maxLength: FULL_PALETTE.length })
  .map((mask) => FULL_PALETTE.filter((_, i) => mask[i]))
  .filter((arr) => arr.length >= 1);

// 最大色数（制限なし or 小さな整数）。減色あり/なしの双方の経路を踏ませる。
const maxColorsArb = fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 12 }));

// =============================================================================
// タスク9.3: Property 19 透明ピクセルの未配置変換
// =============================================================================
describe('LocalConversionStrategy プロパティテスト: 透明ピクセルの未配置変換（タスク9.3）', () => {
  // **Validates: Requirements 4.6, 4.7**
  it('Feature: bead-pattern-maker, Property 19: 任意の画像において、アルファ値128未満のピクセルに対応するセルは全て未配置(null)であり、アルファ値128以上のピクセルに対応するセルは全てビーズ色(非null)である', () => {
    fc.assert(
      fc.property(gridArb, ({ width, height, pixels }) => {
        // resizeImage が当該ピクセルデータを返すようにする
        resizeImage.mockReturnValue(makeImageData(width, height, pixels));

        const pattern = strategy.convert(dummyImage, {
          width,
          height,
          activePalette: FULL_PALETTE,
          resizeMethod: 'smooth',
          fitMode: 'contain',
          maxColors: null,
          // 背景除外なし（非nullセルが背景除外でnull化されないようにする）
        });

        for (let row = 0; row < height; row += 1) {
          for (let col = 0; col < width; col += 1) {
            const alpha = pixels[row * width + col].a;
            const cell = pattern.cells[row][col];
            if (alpha < 128) {
              // 透明・半透明（alpha<128）→ 未配置(null)、色変換しない（要件4.6）
              expect(cell).toBeNull();
            } else {
              // alpha>=128 → 白合成後にパレット最近色へ変換され非null（要件4.7）
              expect(cell).not.toBeNull();
              expect(typeof cell.r).toBe('number');
              expect(typeof cell.g).toBe('number');
              expect(typeof cell.b).toBe('number');
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// タスク9.4: Property 21 無効色の除外
// =============================================================================
describe('LocalConversionStrategy プロパティテスト: 無効色の除外（タスク9.4）', () => {
  // **Validates: Requirements 11.2**
  it('Feature: bead-pattern-maker, Property 21: 任意の図案と無効化色集合に対して、生成された図案のセル(非null)の色は全て有効パレット(無効化色を除いた集合)に含まれ、無効化色は1つも使われない', () => {
    fc.assert(
      fc.property(
        opaqueGridArb,
        activePaletteArb,
        maxColorsArb,
        ({ width, height, pixels }, activePalette, maxColors) => {
          resizeImage.mockReturnValue(makeImageData(width, height, pixels));

          const pattern = strategy.convert(dummyImage, {
            width,
            height,
            activePalette,
            resizeMethod: 'smooth',
            fitMode: 'contain',
            maxColors,
          });

          const activeIds = new Set(activePalette.map((c) => c.id));
          // 無効化色 = 全パレット − 有効パレット
          const disabledIds = new Set(
            FULL_PALETTE.filter((c) => !activeIds.has(c.id)).map((c) => c.id),
          );

          for (const rowCells of pattern.cells) {
            for (const cell of rowCells) {
              if (cell !== null) {
                // 非nullセルは必ず有効パレット内の色である
                expect(activeIds.has(cell.id)).toBe(true);
                // 無効化色は1つも使われない
                expect(disabledIds.has(cell.id)).toBe(false);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// タスク9.5: LocalConversionStrategy のユニットテスト
// =============================================================================
describe('LocalConversionStrategy ユニットテスト（タスク9.5）', () => {
  // --- パイプライン順序（減色 → パレットマッチング） -------------------------
  describe('パイプライン順序（減色がマッチングの前に適用される）', () => {
    // 赤・青の2色だけのパレット
    const palette = initializePalette([
      { id: 'R', name: 'あか', r: 255, g: 0, b: 0 },
      { id: 'B', name: 'あお', r: 0, g: 0, b: 255 },
    ]);
    // 2x1 画像: 不透明の赤と不透明の青
    const redBluePixels = [
      { r: 255, g: 0, b: 0, a: 255 },
      { r: 0, g: 0, b: 255, a: 255 },
    ];

    it('maxColors=1 のとき、減色が先に行われ赤と青が1代表色へ集約されてからマッチングされる（両セルが同一ビーズ色になる）', () => {
      resizeImage.mockReturnValue(makeImageData(2, 1, redBluePixels));

      const pattern = strategy.convert(dummyImage, {
        width: 2,
        height: 1,
        activePalette: palette,
        resizeMethod: 'sharp',
        fitMode: 'stretch',
        maxColors: 1,
      });

      // 減色（maxColors=1）が「先」に適用され、赤と青が1つの代表色（平均色）へ集約される。
      // その単一の代表色をマッチングするため、両セルは同一のビーズ色（同一参照）になる。
      expect(pattern.cells[0][0]).toBe(pattern.cells[0][1]);
      const distinctIds = new Set(
        pattern.cells.flat().filter(Boolean).map((c) => c.id),
      );
      expect(distinctIds.size).toBe(1);
    });

    it('maxColors=null（減色なし）では赤→赤・青→青で異なるビーズ色になる（順序の対照）', () => {
      resizeImage.mockReturnValue(makeImageData(2, 1, redBluePixels));

      const pattern = strategy.convert(dummyImage, {
        width: 2,
        height: 1,
        activePalette: palette,
        resizeMethod: 'sharp',
        fitMode: 'stretch',
        maxColors: null,
      });

      // 減色が無ければ各ピクセルはそのままマッチングされ、赤と青は別々のビーズ色になる。
      // この対照により、maxColors=1 のときの集約が「減色→マッチング」の順序に起因する
      // ことが確認できる。
      expect(pattern.cells[0][0].id).toBe('R');
      expect(pattern.cells[0][1].id).toBe('B');
      expect(pattern.cells[0][0].id).not.toBe(pattern.cells[0][1].id);
    });
  });

  // --- 半透明ピクセルの白合成（alpha 128-254） ------------------------------
  describe('半透明ピクセルの白合成（alpha 128-254 を白背景に合成）', () => {
    const palette = initializePalette([
      { id: 'BLACK', name: 'くろ', r: 0, g: 0, b: 0 },
      { id: 'GRAY', name: 'はい', r: 128, g: 128, b: 128 },
      { id: 'WHITE', name: 'しろ', r: 255, g: 255, b: 255 },
    ]);

    it('alpha=128 の黒は白背景に合成されて中間グレー(≈127)になり GRAY にマッチする（白合成あり、要件4.7）', () => {
      // 黒(0,0,0) を alpha=128 で白(255,255,255)に合成: ≈ (127,127,127)
      resizeImage.mockReturnValue(makeImageData(1, 1, [{ r: 0, g: 0, b: 0, a: 128 }]));

      const pattern = strategy.convert(dummyImage, {
        width: 1,
        height: 1,
        activePalette: palette,
        resizeMethod: 'smooth',
        fitMode: 'contain',
        maxColors: null,
      });

      // 白合成の結果（≈グレー）が GRAY にマッチする。白合成が無ければ生の黒が
      // BLACK にマッチするはずなので、GRAY であることが白合成の実施を示す。
      expect(pattern.cells[0][0].id).toBe('GRAY');
      expect(pattern.cells[0][0].id).not.toBe('BLACK');
    });

    it('alpha=255 の黒は合成されず BLACK にマッチする（不透明は白合成しない対照）', () => {
      resizeImage.mockReturnValue(makeImageData(1, 1, [{ r: 0, g: 0, b: 0, a: 255 }]));

      const pattern = strategy.convert(dummyImage, {
        width: 1,
        height: 1,
        activePalette: palette,
        resizeMethod: 'smooth',
        fitMode: 'contain',
        maxColors: null,
      });

      // 完全不透明（alpha=255）は白合成されず、生の黒がそのまま BLACK にマッチする。
      expect(pattern.cells[0][0].id).toBe('BLACK');
    });
  });

  // --- 背景除外オフ時の透明 → null ------------------------------------------
  describe('背景除外オフ時も透明ピクセルは未配置(null)になる（背景トグルと独立、要件4.6）', () => {
    const palette = initializePalette([
      { id: 'K', name: 'くろ', r: 0, g: 0, b: 0 },
      { id: 'W', name: 'しろ', r: 255, g: 255, b: 255 },
    ]);
    // 2x1 画像: col0 は透明(alpha=0)、col1 は不透明(alpha=255)。色は同一にして
    // 「透明かどうか」だけが結果を分けることを明確にする。
    const pixels = [
      { r: 50, g: 50, b: 50, a: 0 },
      { r: 50, g: 50, b: 50, a: 255 },
    ];

    it('backgroundExclusion 未指定でも alpha<128 は null、alpha>=128 は非null になる', () => {
      resizeImage.mockReturnValue(makeImageData(2, 1, pixels));

      const pattern = strategy.convert(dummyImage, {
        width: 2,
        height: 1,
        activePalette: palette,
        resizeMethod: 'smooth',
        fitMode: 'contain',
        maxColors: null,
      });

      expect(pattern.cells[0][0]).toBeNull();
      expect(pattern.cells[0][1]).not.toBeNull();
    });

    it('backgroundExclusion.enabled=false でも透明→null は背景除外と独立に常に適用される', () => {
      resizeImage.mockReturnValue(makeImageData(2, 1, pixels));

      const pattern = strategy.convert(dummyImage, {
        width: 2,
        height: 1,
        activePalette: palette,
        resizeMethod: 'smooth',
        fitMode: 'contain',
        maxColors: null,
        backgroundExclusion: { enabled: false, color: { r: 50, g: 50, b: 50 }, threshold: 10 },
      });

      expect(pattern.cells[0][0]).toBeNull();
      expect(pattern.cells[0][1]).not.toBeNull();
    });
  });

  // --- PatternGrid 構造（生成結果の整合性、要件4.4） ------------------------
  describe('生成結果は正しい PatternGrid 構造を持つ（要件4.4）', () => {
    it('cells / originalCells は height×width の2次元配列で、beadType・plateConfig を含む', () => {
      const palette = initializePalette([{ id: 'K', name: 'くろ', r: 0, g: 0, b: 0 }]);
      const width = 3;
      const height = 2;
      const pixels = Array.from({ length: width * height }, () => ({ r: 0, g: 0, b: 0, a: 255 }));
      resizeImage.mockReturnValue(makeImageData(width, height, pixels));

      const pattern = strategy.convert(dummyImage, {
        width,
        height,
        activePalette: palette,
        beadType: 'perler',
        plateConfig: { cols: 1, rows: 1 },
        resizeMethod: 'smooth',
        fitMode: 'contain',
        maxColors: null,
      });

      expect(pattern.width).toBe(width);
      expect(pattern.height).toBe(height);
      expect(pattern.cells).toHaveLength(height);
      expect(pattern.cells[0]).toHaveLength(width);
      expect(pattern.originalCells).toHaveLength(height);
      expect(pattern.originalCells[0]).toHaveLength(width);
      expect(pattern.beadType).toBe('perler');
      expect(pattern.plateConfig).toEqual({ cols: 1, rows: 1 });
    });
  });
});
