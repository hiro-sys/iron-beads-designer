// =============================================================================
// 色マッチングモジュール（colorMatcher.js）
// -----------------------------------------------------------------------------
// RGB色とビーズパレットの間で、CIE76色差（ΔE）に基づく最近色マッチングを行う。
// 「画像のピクセル色 → 最も近いビーズ色」への変換と、ビーズタイプ切替時の
// 図案グリッド全体の再マッピングを提供する。
//
// 設計書「2. 色マッチングモジュール（colorMatcher.js）」に対応。
// Requirements: 4.2, 4.3, 2.4
//
// 色差計算（CIE76）:
//   RGBをCIE Lab色空間に変換し、Lab空間でのユークリッド距離を色差ΔEとする。
//   RGB⇔Lab変換は utils/colorUtils.js の rgbToLab に委譲する。
//
//   ΔE = √((L₁-L₂)² + (a₁-a₂)² + (b₁-b₂)²)
// =============================================================================

import { rgbToLab } from '../utils/colorUtils.js';

/** @typedef {import('./ConversionStrategy.js').BeadColor} BeadColor */
/** @typedef {import('./ConversionStrategy.js').PatternGrid} PatternGrid */

/**
 * @typedef {{ L: number, a: number, b: number }} LabColor
 */

/**
 * @typedef {{ r: number, g: number, b: number }} RgbColor
 */

/**
 * 2色間のCIE76色差（ΔE）を計算する。
 *
 * Lab色空間における2点間のユークリッド距離を色差とする。
 * 距離なので常に非負・同一色なら0・対称（deltaE(a,b) === deltaE(b,a)）になる。
 *
 * @param {LabColor} lab1 - 色1のLab値（{ L, a, b }）
 * @param {LabColor} lab2 - 色2のLab値（{ L, a, b }）
 * @returns {number} ΔE値（非負）
 */
export function deltaE(lab1, lab2) {
  const dL = lab1.L - lab2.L;
  const da = lab1.a - lab2.a;
  const db = lab1.b - lab2.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

/**
 * 対象色（RGB）に対し、パレット内でΔEが最小の色を返す。
 *
 * 対象色をLabに変換し、パレット各色のLab値とのΔEを比較して最小のものを選ぶ。
 * パレット色は初期化時に `lab` をキャッシュしている想定だが、未キャッシュの場合は
 * `rgbToLab` でフォールバック計算する。
 *
 * @param {RgbColor} targetColor - 対象色（{ r, g, b }、各 0-255）
 * @param {BeadColor[]} palette - カラーパレット（各色は lab をキャッシュ済みの想定）
 * @returns {BeadColor | null} ΔE最小の色。パレットが空の場合は null
 */
export function findClosestColor(targetColor, palette) {
  if (!Array.isArray(palette) || palette.length === 0) {
    return null;
  }

  // 対象色をLab空間へ変換しておく（パレット各色との比較基準）
  const targetLab = rgbToLab(targetColor.r, targetColor.g, targetColor.b);

  let closest = null;
  let smallestDistance = Infinity;

  for (const color of palette) {
    // lab がキャッシュされていれば再利用し、無ければその場で算出する
    const lab = color.lab || rgbToLab(color.r, color.g, color.b);
    const distance = deltaE(targetLab, lab);

    // 厳密な「より小さい」で更新するため、ΔEが同値の場合は先に出現した色を優先する
    if (distance < smallestDistance) {
      smallestDistance = distance;
      closest = color;
    }
  }

  return closest;
}

/**
 * 図案グリッドの全セルを、新しいパレットの最近色へ再マッピングする。
 *
 * ビーズタイプ切替（要件2.4）で用いる。各セルについて:
 *   - 非nullセル（ビーズ色）: `findClosestColor` で新パレットの最近色へ置き換える
 *   - nullセル（未配置）: null のまま維持する
 *
 * 元の図案を破壊しないよう、`cells` / `originalCells` ともに新しい2次元配列を生成して返す。
 * `originalCells`（背景除外前の復元用グリッド）も同様に再マッピングし、背景除外トグルの
 * 可逆性が切替後も新パレット基準で保たれるようにする。
 *
 * 同一RGB色は同じ新色（同一オブジェクト参照）へ写像されるよう内部でキャッシュし、
 * 相異なる色ごとに最近色探索を1回だけ行う。
 *
 * @param {PatternGrid} pattern - 再マッピング対象の図案グリッド
 * @param {BeadColor[]} newPalette - 新しいカラーパレット
 * @returns {PatternGrid} 全セルを新パレットの最近色へ再マッピングした新しい図案グリッド
 */
export function remapPattern(pattern, newPalette) {
  // 相異なる入力色 → 新パレット最近色 のキャッシュ（RGBをキーにする）。
  // cells と originalCells で共有し、同一色は同じ新色オブジェクトへ写像する。
  const cache = new Map();

  /**
   * 1セルを再マッピングする。null（未配置）はそのまま維持する。
   * @param {BeadColor|null} cell - 対象セル
   * @returns {BeadColor|null} 再マッピング後のセル
   */
  const remapCell = (cell) => {
    if (cell === null || cell === undefined) {
      return null;
    }

    const key = `${cell.r},${cell.g},${cell.b}`;
    if (cache.has(key)) {
      return cache.get(key);
    }

    const mapped = findClosestColor(cell, newPalette);
    cache.set(key, mapped);
    return mapped;
  };

  /**
   * 2次元グリッドを再マッピングした新しい2次元配列を生成する（元配列は破壊しない）。
   * @param {(BeadColor|null)[][]} grid - 対象グリッド
   * @returns {(BeadColor|null)[][]} 再マッピング後のグリッド
   */
  const remapGrid = (grid) =>
    grid.map((row) => row.map((cell) => remapCell(cell)));

  // 元オブジェクトの他プロパティ（width, height, beadType, plateConfig 等）は維持し、
  // cells / originalCells のみ再マッピング後の新配列で差し替える。
  const result = {
    ...pattern,
    cells: remapGrid(pattern.cells),
  };

  // originalCells が存在する場合のみ再マッピングする（同じキャッシュを共有）。
  if (Array.isArray(pattern.originalCells)) {
    result.originalCells = remapGrid(pattern.originalCells);
  }

  return result;
}
