// =============================================================================
// 背景検出モジュール（backgroundDetector.js）
// -----------------------------------------------------------------------------
// 画像の四隅をサンプリングして「背景色」を自動検出する。
// 四隅それぞれから内側に2〜4ピクセルの範囲で3x3＝各9ピクセル、計36サンプルを取得し、
// CIE76色差（ΔE）が近い色どうし（ΔE≤5）を同一グループへまとめ、最も大きいグループの
// 中心（代表）色を背景色 { r, g, b } として返す。
//
// 四隅から少し内側を採るのは、画像端のエッジアーティファクト（圧縮ノイズや
// アンチエイリアスのにじみ）を避けて、安定した背景色を得るため。
//
// 設計書「6. 背景検出モジュール（backgroundDetector.js）」の
// 「背景自動検出アルゴリズム」「背景除外のデータフロー」「処理順序」に対応。
// Requirements: 9.1, 9.2, 9.3, 9.5, 9.8, 9.9
//
// 本モジュールが提供する関数:
//   - detectBackgroundColor    : 四隅サンプリングによる背景色の自動検出（タスク7.1）
//   - isBackgroundColor        : ある色が背景色のΔE閾値以内かの判定（タスク7.2）
//   - applyBackgroundExclusion : 図案グリッドへの背景除外の適用（タスク7.2）
//
// 色空間の整合性（重要・要件9.2）:
//   背景判定は一貫して「ビーズ色空間」（有効パレット内の色）で行う。背景色の入力
//   （手動クリック／四隅の自動検出）はいずれも生ピクセル色なので、呼び出し側が
//   findClosestColor で有効パレットの最近色（＝背景ビーズ色）へ変換してから
//   isBackgroundColor / applyBackgroundExclusion に渡すこと。本モジュールでは
//   生ピクセル色 → ビーズ色の変換は行わない（変換は呼び出し側の責務）。
// =============================================================================

import { rgbToLab } from '../utils/colorUtils.js';
import { deltaE } from './colorMatcher.js';

/** @typedef {import('./ConversionStrategy.js').BeadColor} BeadColor */
/** @typedef {import('./ConversionStrategy.js').PatternGrid} PatternGrid */

/**
 * @typedef {{ r: number, g: number, b: number }} RgbColor
 */

/**
 * @typedef {{ L: number, a: number, b: number }} LabColor
 */

// 近似色グルーピングのΔE閾値。これ以下の色差は同一の背景色グループとして扱う（設計: ΔE≤5）。
const GROUPING_DELTA_E = 5;

// 各コーナーで採取するサンプルの内側オフセット（端から2〜4ピクセル）。
// 3値 × 3値 = 9ピクセルを1コーナーから取得し、4コーナーで計36サンプルになる。
const CORNER_INSETS = [2, 3, 4];

/**
 * 値を [min, max] の範囲にクランプする。
 * 極端に小さい画像でもサンプリング座標が画像範囲外へ出ないようにするための補助。
 *
 * @param {number} value - 対象値
 * @param {number} min - 下限
 * @param {number} max - 上限
 * @returns {number} クランプ後の値
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * ImageData から指定座標 (x, y) のピクセルのRGB値を取り出す（アルファは無視）。
 *
 * @param {ImageData} imageData - 画像データ（data は RGBA 並びの Uint8ClampedArray）
 * @param {number} width - 画像の幅（行ストライド計算に使用）
 * @param {number} x - X座標（0-based）
 * @param {number} y - Y座標（0-based）
 * @returns {RgbColor} ピクセルのRGB値
 */
function getPixelRgb(imageData, width, x, y) {
  const offset = (y * width + x) * 4;
  const data = imageData.data;
  return { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
}

/**
 * 画像の四隅（左上・右上・左下・右下）から、それぞれ内側 2〜4 ピクセルの
 * 3x3＝9ピクセルを採取し、計36サンプルのRGB配列を返す。
 *
 * 端から少し内側（CORNER_INSETS）を採ることでエッジのにじみを避ける。
 * 画像が極端に小さい場合は座標をクランプするためサンプルが重複することがあるが、
 * 常に36件のサンプルを返す（後続の検出処理を一様に扱えるようにするため）。
 *
 * @param {ImageData} imageData - 画像データ
 * @param {number} width - 画像の幅
 * @param {number} height - 画像の高さ
 * @returns {RgbColor[]} 36件のサンプル色
 */
function collectCornerSamples(imageData, width, height) {
  // 左端／右端それぞれの列インデックス（内側オフセットを左右で反転）。
  const leftCols = CORNER_INSETS.map((inset) => clamp(inset, 0, width - 1));
  const rightCols = CORNER_INSETS.map((inset) => clamp(width - 1 - inset, 0, width - 1));
  // 上端／下端それぞれの行インデックス。
  const topRows = CORNER_INSETS.map((inset) => clamp(inset, 0, height - 1));
  const bottomRows = CORNER_INSETS.map((inset) => clamp(height - 1 - inset, 0, height - 1));

  // 4コーナーの (列集合, 行集合) の組み合わせ。
  const corners = [
    { cols: leftCols, rows: topRows }, // 左上
    { cols: rightCols, rows: topRows }, // 右上
    { cols: leftCols, rows: bottomRows }, // 左下
    { cols: rightCols, rows: bottomRows }, // 右下
  ];

  const samples = [];
  for (const { cols, rows } of corners) {
    for (const y of rows) {
      for (const x of cols) {
        samples.push(getPixelRgb(imageData, width, x, y));
      }
    }
  }
  return samples;
}

/**
 * サンプル色を、CIE76色差が近い（ΔE≤閾値）もの同士でグルーピングする。
 *
 * 貪欲法: 各サンプルをLab空間へ変換し、既存グループの代表Lab色と比較する。
 * 最初に ΔE≤閾値 となったグループへ加え、どのグループにも近くなければ新規グループを
 * 作る（先頭サンプルのLab値をそのグループの代表とする）。
 *
 * @param {RgbColor[]} samples - サンプル色の配列
 * @param {number} threshold - 同一グループとみなすΔE閾値
 * @returns {{ labRep: LabColor, members: RgbColor[] }[]} グループ配列（出現順）
 */
function groupBySimilarity(samples, threshold) {
  /** @type {{ labRep: LabColor, members: RgbColor[] }[]} */
  const groups = [];

  for (const sample of samples) {
    const lab = rgbToLab(sample.r, sample.g, sample.b);

    // 既存グループの代表色とのΔEを順に確認し、最初に閾値以内となったものへ加える。
    let target = null;
    for (const group of groups) {
      if (deltaE(lab, group.labRep) <= threshold) {
        target = group;
        break;
      }
    }

    if (target) {
      target.members.push(sample);
    } else {
      // 新規グループ。代表Lab色は先頭サンプルのLab値とする。
      groups.push({ labRep: lab, members: [sample] });
    }
  }

  return groups;
}

/**
 * グループ内サンプルの平均RGB（中心色）を整数に丸めて返す。
 * グループが単一色のみで構成される場合は、その色がそのまま返る。
 *
 * @param {RgbColor[]} members - グループのサンプル色
 * @returns {RgbColor} 中心（代表）色
 */
function computeCentroid(members) {
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (const { r, g, b } of members) {
    sumR += r;
    sumG += g;
    sumB += b;
  }
  const count = members.length;
  return {
    r: Math.round(sumR / count),
    g: Math.round(sumG / count),
    b: Math.round(sumB / count),
  };
}

/**
 * 画像の四隅をサンプリングして背景色を自動検出する（要件9.1）。
 *
 * アルゴリズム:
 *   1. 四隅それぞれから内側2〜4pxの3x3＝計36サンプルを採取する
 *   2. 各サンプルをLab空間へ変換し、ΔE≤5 で近似色をグルーピングする
 *   3. 最も大きいグループの中心（平均）色を背景色として返す
 *
 * 4コーナーが全て異なる色（＝同数グループが並ぶ）場合でも、最も頻度の高いグループの
 * 代表色を返す。同数のときは厳密な「より大きい」で更新するため、最初に出現した
 * グループ（左上コーナー由来）が優先され、結果は常に一意・決定的になる。
 *
 * @param {ImageData} imageData - 画像データ（RGBA）
 * @param {number} width - 画像の幅（px）
 * @param {number} height - 画像の高さ（px）
 * @returns {RgbColor | null} 検出された背景色 { r, g, b }。検出不能時（不正入力）は null
 */
export function detectBackgroundColor(imageData, width, height) {
  // 入力ガード: データや寸法が不正な場合は「検出結果なし」として null を返す
  // （設計のエラーハンドリング: 背景色検出失敗 → 自動検出結果なしとして扱う）。
  if (!imageData || !imageData.data || width <= 0 || height <= 0) {
    return null;
  }

  // 1. 四隅から計36サンプルを採取する
  const samples = collectCornerSamples(imageData, width, height);
  if (samples.length === 0) {
    return null;
  }

  // 2. ΔE≤5 で近似色をグルーピングする
  const groups = groupBySimilarity(samples, GROUPING_DELTA_E);

  // 3. 最大グループを選ぶ。同数の場合は厳密な「より大きい」で更新するため、
  //    先に出現したグループ（左上由来）が優先される＝決定的。
  let largest = groups[0];
  for (const group of groups) {
    if (group.members.length > largest.members.length) {
      largest = group;
    }
  }

  // 最大グループの中心（平均）色を背景色として返す
  return computeCentroid(largest.members);
}

/**
 * 指定色が背景色のΔE閾値以内かどうかを判定する（要件9.3）。
 *
 * 2色をそれぞれ CIE Lab 色空間へ変換し、CIE76 色差（ΔE）が threshold 以下なら
 * 「背景色と同一」と見なして true を返す。判定は等価を含む「以下（≤）」で行う
 * （閾値ちょうどの色差も背景色として扱う）。
 *
 * 【色空間の前提（重要・要件9.2）】
 * pixelColor・backgroundColor はいずれも「ビーズ色空間の色」である前提とする。
 * とくに backgroundColor は、生ピクセル色を呼び出し側が findClosestColor で
 * 有効パレットの最近色へ変換した「背景ビーズ色」であること。生ピクセル色のまま
 * 渡すと、ビーズ色空間との不整合（色空間ミスマッチ）が生じるため注意する。
 *
 * @param {RgbColor} pixelColor - 判定対象の色（{ r, g, b }、各0-255）
 * @param {RgbColor} backgroundColor - 背景色（ビーズ色空間。findClosestColor 済みの想定）
 * @param {number} threshold - ΔE閾値（0-50、要件9.4）
 * @returns {boolean} 背景色と見なす場合 true
 */
export function isBackgroundColor(pixelColor, backgroundColor, threshold) {
  // 両色を Lab 空間へ変換し、ΔE（ユークリッド距離）を閾値と比較する。
  const pixelLab = rgbToLab(pixelColor.r, pixelColor.g, pixelColor.b);
  const backgroundLab = rgbToLab(backgroundColor.r, backgroundColor.g, backgroundColor.b);
  return deltaE(pixelLab, backgroundLab) <= threshold;
}

/**
 * 図案グリッドに背景除外を適用し、背景色に該当するセルを未配置（null）にする。
 *
 * 設計書「6. 背景検出モジュール」の「背景除外のデータフロー」「処理順序」に従う。
 * 背景除外は色変換（パレット最近色マッチング）の後に実行される前提で、各セルの
 * 「ビーズ色」と「背景ビーズ色」を ΔE 比較し、閾値以内のセルを未配置にする
 * （要件9.5。未配置はビーズ製品の「とうめい」色とは異なり、物理的にビーズを置かない）。
 *
 * 【色空間の前提（重要・要件9.2）】
 * backgroundColor は「ビーズ色空間の色（findClosestColor 済みの背景ビーズ色）」で
 * ある前提とする。生ピクセル色 → 有効パレット最近色への変換は、呼び出し側（後続の
 * UI／変換エンジン）の責務であり、本関数では行わない。これにより、各セルのビーズ色と
 * 背景ビーズ色という同一の色空間どうしで比較され、判定が一貫する（要件9.2）。
 *
 * 【可逆性のための originalCells（要件9.8 / 9.9）】
 * 戻り値は新規 PatternGrid オブジェクトであり、入力 pattern は破壊しない。
 * `originalCells` には「背景除外前」のグリッドを保持する。入力 pattern が既に
 * originalCells を持つ場合はそれ（＝真の除外前グリッド）を維持し、無い場合は現在の
 * cells を除外前グリッドとして採用する。背景除外をオフに戻す際は、この originalCells
 * から cells を復元でき、データの欠損が発生しない。
 *
 * 【判定の基準グリッド】
 * 各セルの判定は「除外前グリッド（= originalCells があればそれ、無ければ cells）」を
 * 基準に行う。これにより、閾値を変えて再適用しても常に除外前の状態から一貫して
 * null 化されるため、閾値の単調性（要件9.3）と可逆性（要件9.8/9.9）が両立する。
 * 除外前グリッドで既に null のセル（透明ピクセルや contain のフィット余白に由来）は
 * null のまま維持する。
 *
 * @param {PatternGrid} pattern - 対象の図案グリッド
 * @param {RgbColor} backgroundColor - 背景ビーズ色（findClosestColor 済み）。nullish の場合は除外を行わない
 * @param {number} threshold - ΔE閾値（0-50）
 * @returns {PatternGrid} 背景除外を適用した新しい図案グリッド（新規オブジェクト）
 */
export function applyBackgroundExclusion(pattern, backgroundColor, threshold) {
  // 除外前グリッド（＝真の背景除外前の状態）を決定する。
  // 既存の originalCells があればそれを基準にし（再適用でも除外前から一貫して判定し、
  // 閾値変更や ON→OFF で原状へ戻せる）、無ければ現在の cells を除外前グリッドとみなす。
  const sourceCells = Array.isArray(pattern.originalCells)
    ? pattern.originalCells
    : pattern.cells;

  // originalCells は「背景除外前」のスナップショットとして新しい行配列で保持する
  // （要件9.8/9.9 の可逆性）。行配列は新規生成し、ビーズ色オブジェクトの参照は共有する。
  const preservedOriginalCells = sourceCells.map((row) => row.slice());

  // 背景色が未指定（nullish）の場合は除外を行わず、除外前グリッドのコピーをそのまま返す。
  if (!backgroundColor) {
    return {
      ...pattern,
      cells: sourceCells.map((row) => row.slice()),
      originalCells: preservedOriginalCells,
    };
  }

  // 相異なるセル色 → 背景判定（true/false）のキャッシュ。ビーズ色の種類はパレット
  // サイズ程度に限られるため、セルごとの ΔE 再計算を避けられる。
  const decisionCache = new Map();

  /**
   * セル色が背景色（ΔE≤threshold）かどうかを判定する（色ごとにキャッシュ）。
   * 判定そのものは公開関数 isBackgroundColor に委譲し、単一の真実源とする。
   * @param {BeadColor} cell - 非nullのビーズ色セル
   * @returns {boolean} 背景色と見なす場合 true
   */
  const isCellBackground = (cell) => {
    const key = `${cell.r},${cell.g},${cell.b}`;
    if (decisionCache.has(key)) {
      return decisionCache.get(key);
    }
    const decision = isBackgroundColor(cell, backgroundColor, threshold);
    decisionCache.set(key, decision);
    return decision;
  };

  // 除外前グリッドの各セルを走査し、背景に該当する非nullセルを null（未配置）にする。
  // 既に null のセルは null のまま維持する。
  const cells = sourceCells.map((row) =>
    row.map((cell) => {
      if (cell === null || cell === undefined) {
        return null;
      }
      return isCellBackground(cell) ? null : cell;
    }),
  );

  // 新規 PatternGrid を返す（width/height/beadType/plateConfig 等の他プロパティは維持）。
  return {
    ...pattern,
    cells,
    originalCells: preservedOriginalCells,
  };
}
