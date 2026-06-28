// =============================================================================
// ローカル変換 Strategy（LocalConversionStrategy.js）
// -----------------------------------------------------------------------------
// ブラウザ内で完結する「画像 → 図案グリッド（PatternGrid）」の変換を実装する
// 変換 Strategy。AbstractConversionStrategy を継承し、convert(image, options) を
// design.md「コンポーネントとインターフェース > 1. 変換エンジン >
// LocalConversionStrategy」のパイプライン順序に厳密に従って実装する。
//
// 【パイプライン順序（要件4・10・11）】
//   1. フィット／リサイズ        : imageProcessor.resizeImage（fitMode / resizeMethod を適用）
//                                  contain の余白は透明（alpha=0）で出力される（要件10.6）
//   2. 透明判定・白合成          : alpha<128 → 未配置(null)（要件4.6）
//                                  alpha>=128 → 白背景(255,255,255)に合成し不透明RGB化（要件4.7）
//   3. 減色（任意）              : maxColors 指定時のみ colorReducer.reduceColors（要件11.4）
//                                  null / 'unlimited' のときはスキップ（パススルー）
//   4. パレット最近色マッチング  : colorMatcher.findClosestColor（有効パレットのみ、要件4.2/11.2）
//   5. 背景除外（任意）          : backgroundDetector.applyBackgroundExclusion（色変換の後、要件9）
//   6. PatternGrid 生成          : cells=背景除外後 / originalCells=背景除外前（ステップ4完了時点）
//
// 【設計上の重要事項】
//   - ステップ2の「透明 → 未配置(null)」変換は、背景除外トグルのオン・オフとは
//     独立して常に適用される。contain の余白やもともと透明な領域は、背景除外が
//     オフであっても未配置セルになる（design.md のステップ2注記）。
//   - 減色はパレットマッチングの「前」に RGB 色空間で実行する。これにより最近色
//     マッチングへ渡る入力色が最大 maxColors 種類に絞られ、最終的な相異なるビーズ
//     色数は maxColors 以下になる（design.md「10. 減色モジュール」）。
//   - 背景除外は色変換の「後」に適用する。背景色（生ピクセル色）は findClosestColor で
//     有効パレットの最近色（背景ビーズ色）へ変換してから渡し、ビーズ色空間どうしで
//     一貫して比較する（design.md「6. 背景検出モジュール」の色空間整合性、要件9.2）。
//
// 【エラーハンドリング（要件4.8）】
//   生成に失敗する不正な入力（画像なし・寸法不正・有効色0色など）に対しては例外を
//   投げる。呼び出し側はこれを捕捉してエラーメッセージを表示し、前回生成済みの図案を
//   保持できる（design.md「エラーハンドリング > 図案生成失敗」）。
//
// Requirements: 4.2, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 10.5, 10.6, 10.7, 11.2, 11.4
// @module engine/LocalConversionStrategy
// =============================================================================

import { AbstractConversionStrategy } from './ConversionStrategy.js';
import { resizeImage } from './imageProcessor.js';
import { reduceColors } from './colorReducer.js';
import { findClosestColor } from './colorMatcher.js';
import { applyBackgroundExclusion } from './backgroundDetector.js';
import { BEAD_CONFIG } from '../data/beadConfig.js';

/** @typedef {import('./ConversionStrategy.js').BeadColor} BeadColor */
/** @typedef {import('./ConversionStrategy.js').BeadType} BeadType */
/** @typedef {import('./ConversionStrategy.js').PatternGrid} PatternGrid */
/** @typedef {import('./ConversionStrategy.js').ConversionOptions} BaseConversionOptions */

/**
 * @typedef {{ r: number, g: number, b: number }} RgbColor
 */

/**
 * 背景除外設定（任意）。state.backgroundExclusion と同形。
 * @typedef {Object} BackgroundExclusionOption
 * @property {boolean} enabled - 背景除外の有効/無効
 * @property {RgbColor|null} color - 背景色（生ピクセル色。findClosestColor 前）
 * @property {number} [threshold] - ΔE閾値（0-50、既定10）
 */

/**
 * LocalConversionStrategy が受け取る変換オプション。
 * 基底の {@link BaseConversionOptions} に、PatternGrid を組み立てるためのメタ情報
 * （beadType / plateConfig）と、任意の背景除外設定（backgroundExclusion）を加える。
 * beadType / plateConfig が省略された場合は width / height とペグ数から導出する。
 *
 * @typedef {BaseConversionOptions & {
 *   beadType?: BeadType,
 *   plateConfig?: { cols: number, rows: number },
 *   backgroundExclusion?: BackgroundExclusionOption,
 * }} LocalConversionOptions
 */

// --- 定数 --------------------------------------------------------------------

/**
 * 透明判定のアルファ境界（要件4.6 / 4.7）。
 * alpha < 128 を未配置（null）、alpha >= 128 を白合成して不透明RGB化する。
 * @type {number}
 */
const ALPHA_THRESHOLD = 128;

/** 半透明ピクセルの合成先となる白背景（要件4.7）。 */
const WHITE = 255;

/** 背景除外のΔE閾値の既定値（要件9.3）。 */
const DEFAULT_BACKGROUND_THRESHOLD = 10;

// --- 内部ヘルパー（純関数） --------------------------------------------------

/**
 * 最大色数の指定が「減色を要求している」かどうかを判定する。
 *
 * null / undefined / 'unlimited'、および 1 未満・非数値は「減色しない（パススルー）」と
 * みなす。1 以上の整数として解釈できる場合のみ減色を行う（design.md ステップ3）。
 *
 * @param {number | null | undefined | 'unlimited'} maxColors - 最大色数
 * @returns {boolean} 減色を実行するなら true
 */
function isReductionRequested(maxColors) {
  if (maxColors === null || maxColors === undefined || maxColors === 'unlimited') {
    return false;
  }
  const limit = Math.floor(Number(maxColors));
  return Number.isFinite(limit) && limit >= 1;
}

/**
 * 半透明（alpha>=128）ピクセルを白背景（255,255,255）に合成して不透明RGBを返す（要件4.7）。
 *
 * アルファ合成（source-over, 背景=白）の標準式:
 *   out = fg × a + 白 × (1 - a)   （a = alpha / 255）
 * 完全不透明（alpha=255）の場合は元のRGBをそのまま返す（丸め誤差を避ける）。
 *
 * @param {number} r - 赤成分 (0-255)
 * @param {number} g - 緑成分 (0-255)
 * @param {number} b - 青成分 (0-255)
 * @param {number} alpha - アルファ値 (0-255、呼び出し側で 128 以上を保証)
 * @returns {RgbColor} 白背景に合成した不透明RGB
 */
function compositeOnWhite(r, g, b, alpha) {
  // 完全不透明はそのまま（合成しても値は変わらないが、丸めを避けて厳密に保つ）
  if (alpha >= 255) {
    return { r, g, b };
  }
  const a = alpha / 255;
  const inv = 1 - a;
  return {
    r: Math.round(r * a + WHITE * inv),
    g: Math.round(g * a + WHITE * inv),
    b: Math.round(b * a + WHITE * inv),
  };
}

/**
 * 2次元グリッド [row][col] を新しい配列としてシャローコピーする。
 * セル（BeadColor|null）の参照は共有し、行配列のみ新規生成する。
 * cells と originalCells が行配列を共有して相互に影響し合うのを防ぐために用いる。
 *
 * @param {(BeadColor|null)[][]} grid - 対象グリッド
 * @returns {(BeadColor|null)[][]} 行配列を複製した新しいグリッド
 */
function cloneGrid(grid) {
  return grid.map((row) => row.slice());
}

/**
 * PatternGrid に格納する beadType を正規化する。
 * BEAD_CONFIG に存在する有効なビーズタイプのみ採用し、未知の値は 'perler' にフォールバックする。
 *
 * @param {*} beadType - 入力ビーズタイプ
 * @returns {BeadType} 正規化済みビーズタイプ
 */
function normalizeBeadType(beadType) {
  return BEAD_CONFIG[beadType] ? beadType : 'perler';
}

/**
 * PatternGrid に格納する plateConfig を決定する。
 * options で明示された場合はそれを優先し、無ければ width / height とペグ数から
 * 逆算する（width = cols × pegCount, height = rows × pegCount）。
 *
 * @param {{cols: number, rows: number} | undefined} plateConfig - 明示指定（任意）
 * @param {number} width - 図案の横ビーズ数
 * @param {number} height - 図案の縦ビーズ数
 * @param {BeadType} beadType - 正規化済みビーズタイプ
 * @returns {{cols: number, rows: number}} プレート構成
 */
function resolvePlateConfig(plateConfig, width, height, beadType) {
  if (
    plateConfig &&
    Number.isFinite(plateConfig.cols) &&
    Number.isFinite(plateConfig.rows)
  ) {
    return { cols: plateConfig.cols, rows: plateConfig.rows };
  }
  const { pegCount } = BEAD_CONFIG[beadType];
  return {
    cols: Math.max(1, Math.round(width / pegCount)),
    rows: Math.max(1, Math.round(height / pegCount)),
  };
}

// =============================================================================
// LocalConversionStrategy
// =============================================================================

/**
 * ブラウザ内で完結するローカル変換 Strategy。
 *
 * AbstractConversionStrategy を継承し、convert(image, options) で画像から図案
 * グリッド（PatternGrid）を生成する。具体的なアルゴリズムはモジュール冒頭に示した
 * 6 ステップのパイプライン（フィット／リサイズ → 透明判定・白合成 → 減色 →
 * パレット最近色マッチング → 背景除外 → PatternGrid 生成）として実装する。
 *
 * 状態を持たない（インスタンスフィールドなし）ため、1 つのインスタンスを使い回せる。
 *
 * @augments AbstractConversionStrategy
 */
export class LocalConversionStrategy extends AbstractConversionStrategy {
  /**
   * 画像を図案グリッドへ変換する。
   *
   * @param {HTMLImageElement} image - アップロードされた元画像（リサイズ前）
   * @param {LocalConversionOptions} options - 変換オプション
   * @returns {PatternGrid} 生成された図案グリッド
   * @throws {Error} 不正な入力（画像なし・寸法不正・有効パレットが空など）の場合（要件4.8）
   */
  convert(image, options) {
    // --- 入力バリデーション（要件4.8: 生成失敗は例外） -----------------------
    if (!image) {
      throw new Error('LocalConversionStrategy.convert: 変換対象の画像が指定されていません。');
    }
    if (!options || typeof options !== 'object') {
      throw new Error('LocalConversionStrategy.convert: 変換オプションが指定されていません。');
    }

    const { width, height, activePalette } = options;

    // 図案寸法は (cols × pegCount) × (rows × pegCount) の正の整数である必要がある。
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new Error(
        `LocalConversionStrategy.convert: 図案寸法が不正です（width=${width}, height=${height}）。正の整数を指定してください。`,
      );
    }

    // 有効パレットが空（全色無効）の場合は最近色マッチングができない（要件11.5 に対応する防御）。
    if (!Array.isArray(activePalette) || activePalette.length === 0) {
      throw new Error(
        'LocalConversionStrategy.convert: 有効なカラーパレットが空です。最低1色を有効にしてください。',
      );
    }

    // PatternGrid のメタ情報（beadType / plateConfig）を確定する。
    const beadType = normalizeBeadType(options.beadType);
    const plateConfig = resolvePlateConfig(options.plateConfig, width, height, beadType);

    // --- ステップ1: フィット／リサイズ（要件4.1, 10.5/10.6/10.7） -----------
    // resizeImage は常に width × height の ImageData を返す。contain の余白は
    // 透明（alpha=0）でクリアされており、後段で未配置(null)になる。
    const imageData = resizeImage(image, width, height, {
      resizeMethod: options.resizeMethod,
      fitMode: options.fitMode,
    });
    const { data } = imageData;

    // --- ステップ2: 透明判定・白合成（要件4.6, 4.7） ------------------------
    // 各ピクセルを「未配置(null)」または「白合成後の不透明RGB」に振り分ける。
    // 不透明ピクセルは減色（ステップ3）の入力集合としても収集する。
    /** @type {(RgbColor|null)[][]} */
    const compositedGrid = [];
    /** @type {RgbColor[]} 減色対象の不透明ピクセル集合 */
    const opaquePixels = [];

    for (let row = 0; row < height; row += 1) {
      /** @type {(RgbColor|null)[]} */
      const rowColors = new Array(width);
      for (let col = 0; col < width; col += 1) {
        const offset = (row * width + col) * 4;
        const alpha = data[offset + 3];

        if (alpha < ALPHA_THRESHOLD) {
          // alpha<128 は未配置。色変換は行わない（要件4.6）。
          rowColors[col] = null;
        } else {
          // alpha>=128 は白背景に合成して不透明RGB化（要件4.7）。
          const composited = compositeOnWhite(
            data[offset],
            data[offset + 1],
            data[offset + 2],
            alpha,
          );
          rowColors[col] = composited;
          opaquePixels.push(composited);
        }
      }
      compositedGrid.push(rowColors);
    }

    // --- ステップ3: 減色（任意、要件11.4） ----------------------------------
    // maxColors 指定時のみ、不透明ピクセル集合から代表色を抽出する写像を得る。
    // パススルー時（null / 'unlimited'）は mapping を作らず、元の合成色をそのまま使う。
    let reduceMapping = null;
    if (isReductionRequested(options.maxColors)) {
      const { mapping } = reduceColors(opaquePixels, options.maxColors);
      reduceMapping = mapping;
    }

    // --- ステップ4: パレット最近色マッチング（要件4.2, 11.2） ---------------
    // 各（減色後の）ピクセル色を有効パレット内の最近色（ΔE 最小）へ写像する。
    // 同一色は同じビーズ色へ写像されるため、合成色をキーにキャッシュして
    // findClosestColor の呼び出し回数を相異なる色数に抑える。
    /** @type {Map<string, BeadColor>} 合成色キー → ビーズ色 のキャッシュ */
    const matchCache = new Map();

    /** @type {(BeadColor|null)[][]} 背景除外前（ステップ4完了時点）のグリッド */
    const matchedCells = compositedGrid.map((row) =>
      row.map((cell) => {
        // 未配置(null)は色変換せずそのまま維持する（要件4.6）。
        if (cell === null) {
          return null;
        }
        const key = `${cell.r},${cell.g},${cell.b}`;
        const cached = matchCache.get(key);
        if (cached !== undefined) {
          return cached;
        }
        // 減色が有効なら代表色へ写像してからマッチング、無効ならそのままマッチング。
        const sourceColor = reduceMapping ? reduceMapping(cell) : cell;
        const bead = findClosestColor(sourceColor, activePalette);
        matchCache.set(key, bead);
        return bead;
      }),
    );

    // --- ステップ5/6: 背景除外（任意）＋ PatternGrid 生成 -------------------
    const exclusion = options.backgroundExclusion;
    if (exclusion && exclusion.enabled && exclusion.color) {
      // 背景色（生ピクセル色）を有効パレットの最近色＝背景ビーズ色へ変換する（要件9.2）。
      const backgroundBead = findClosestColor(exclusion.color, activePalette);
      const threshold =
        exclusion.threshold === undefined ? DEFAULT_BACKGROUND_THRESHOLD : exclusion.threshold;

      // applyBackgroundExclusion は originalCells を「背景除外前」として保持し、
      // cells を「背景除外後」にした新規 PatternGrid を返す。ここでは matchedCells を
      // 除外前グリッドとして渡す（同関数が内部で行配列を複製するため別名で安全）。
      return applyBackgroundExclusion(
        {
          width,
          height,
          cells: matchedCells,
          originalCells: matchedCells,
          beadType,
          plateConfig,
        },
        backgroundBead,
        threshold,
      );
    }

    // 背景除外なし: cells と originalCells を独立した配列として保持する
    // （手動編集や後からの背景除外で一方を書き換えても他方へ波及しないようにする）。
    return {
      width,
      height,
      cells: matchedCells,
      originalCells: cloneGrid(matchedCells),
      beadType,
      plateConfig,
    };
  }
}

/**
 * 既定のローカル変換 Strategy インスタンス。
 * LocalConversionStrategy は状態を持たないため、アプリ全体で 1 つを共有してよい。
 * @type {LocalConversionStrategy}
 */
export const localConversionStrategy = new LocalConversionStrategy();
