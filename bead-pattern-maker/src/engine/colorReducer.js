// =============================================================================
// 減色モジュール（colorReducer.js）
// -----------------------------------------------------------------------------
// 最大色数が指定された場合に、不透明ピクセル集合の代表色を抽出して使用色数を制限する。
// median cut（メディアンカット）法で最大 maxColors 個の代表色を求め、
// 各ピクセル色を最も近い代表色へ写像する mapping を返す。
//
// 設計書「10. 減色モジュール（colorReducer.js）」に対応。
// Requirements: 11.4
//
// 処理位置（重要）:
//   減色はパレットマッチングの「前」に、RGB色空間で実行する。
//   パイプライン: 透明判定・白合成 → 【減色（reduceColors）】 → パレット最近色マッチング
//
// 色数保証（Property 20）:
//   返す代表色の数は必ず maxColors 以下（<=）になる。
//   （median cut は分割可能なボックスが尽きると停止するため、
//    代表色数 = min(maxColors, 入力の相異なる色数) となる）
//
// パススルー:
//   maxColors が null（制限なし）または 'unlimited' の場合は減色を行わず、
//   入力をそのまま通す（mapping は恒等写像）。
// =============================================================================

/**
 * @typedef {{ r: number, g: number, b: number }} RgbColor
 */

/**
 * @typedef {Object} ColorReductionResult
 * @property {RgbColor[]} representativeColors - 抽出された代表色（最大 maxColors 個）
 * @property {function(RgbColor): RgbColor} mapping - 各ピクセル色を代表色へ写像する関数
 */

/**
 * 不透明ピクセル集合を最大 maxColors 色に減色する。
 *
 * @param {RgbColor[]} pixels - 減色対象の不透明ピクセル配列（{ r, g, b }）
 * @param {number | null | 'unlimited'} maxColors - 最大色数（null / 'unlimited' は減色しない）
 * @returns {ColorReductionResult} 代表色とマッピング関数
 */
export function reduceColors(pixels, maxColors) {
  const safePixels = Array.isArray(pixels) ? pixels : [];

  // --- パススルー（減色しない） ---------------------------------------------
  // maxColors が null / undefined / 'unlimited' の場合は入力をそのまま通す。
  // mapping は恒等写像（入力色のコピーをそのまま返す）とし、
  // representativeColors は入力に存在する相異なる色（パレット）とする。
  if (maxColors === null || maxColors === undefined || maxColors === 'unlimited') {
    return {
      representativeColors: dedupeColors(safePixels),
      mapping: (color) => ({ r: color.r, g: color.g, b: color.b }),
    };
  }

  // maxColors を正の整数に正規化する
  const limit = Math.floor(Number(maxColors));

  // --- 異常系のガード -------------------------------------------------------
  // 入力が空、または上限が1未満の場合は代表色を作れない。
  // Property 20（代表色数 <= maxColors）を満たすため、代表色は空配列を返し、
  // mapping は入力色をそのまま返す（写像先が無いため）。
  if (safePixels.length === 0 || !Number.isFinite(limit) || limit < 1) {
    return {
      representativeColors: [],
      mapping: (color) => ({ r: color.r, g: color.g, b: color.b }),
    };
  }

  // --- median cut で代表色を抽出 -------------------------------------------
  const representativeColors = medianCut(safePixels, limit);

  // 各ピクセル色を最も近い代表色へ写像する関数。
  // 出力は必ず representativeColors のいずれかの色になるため、
  // 図案全体で使われる相異なる色は maxColors 以下に収まる。
  const mapping = (color) => findNearestColor(color, representativeColors);

  return { representativeColors, mapping };
}

// =============================================================================
// 内部ヘルパー
// =============================================================================

/**
 * median cut（メディアンカット）法で代表色を抽出する。
 *
 * アルゴリズム概要:
 *   1. 全色を含む1つのボックスから開始する
 *   2. ボックス数が maxColors に達するまで、最も色の広がり（レンジ）が大きい
 *      ボックスを、最長軸の中央値で2分割する
 *   3. 分割可能なボックス（レンジ > 0）が無くなったら停止する
 *   4. 各ボックスの平均色を代表色とする
 *
 * @param {RgbColor[]} pixels - 入力ピクセル
 * @param {number} maxColors - 最大色数（>= 1）
 * @returns {RgbColor[]} 代表色（個数は maxColors 以下）
 */
function medianCut(pixels, maxColors) {
  let boxes = [createBox(pixels)];

  while (boxes.length < maxColors) {
    // 分割対象（最大レンジが最も大きく、かつ分割可能なボックス）を選ぶ
    const target = selectBoxToSplit(boxes);
    if (!target) {
      // これ以上分割できない（全ボックスが単一色）。これ以上増やせない。
      break;
    }

    const [boxA, boxB] = splitBox(target);
    // 対象ボックスを2つの子ボックスで置き換える
    boxes = boxes.filter((box) => box !== target);
    boxes.push(boxA, boxB);
  }

  // 各ボックスの平均色を代表色とする
  return boxes.map(averageColor);
}

/**
 * 色配列からボックスを生成する（チャネルごとのレンジをキャッシュする）。
 *
 * @param {RgbColor[]} colors - ボックスに含まれる色
 * @returns {{ colors: RgbColor[], rRange: number, gRange: number, bRange: number, maxRange: number }}
 */
function createBox(colors) {
  let rMin = Infinity;
  let rMax = -Infinity;
  let gMin = Infinity;
  let gMax = -Infinity;
  let bMin = Infinity;
  let bMax = -Infinity;

  for (const c of colors) {
    if (c.r < rMin) rMin = c.r;
    if (c.r > rMax) rMax = c.r;
    if (c.g < gMin) gMin = c.g;
    if (c.g > gMax) gMax = c.g;
    if (c.b < bMin) bMin = c.b;
    if (c.b > bMax) bMax = c.b;
  }

  const rRange = rMax - rMin;
  const gRange = gMax - gMin;
  const bRange = bMax - bMin;

  return {
    colors,
    rRange,
    gRange,
    bRange,
    maxRange: Math.max(rRange, gRange, bRange),
  };
}

/**
 * 分割すべきボックスを選ぶ（最大レンジが最も大きく、かつ分割可能なもの）。
 * レンジが 0 のボックス（単一色のみ）は分割できないため対象外とする。
 *
 * @param {ReturnType<typeof createBox>[]} boxes - ボックス一覧
 * @returns {ReturnType<typeof createBox> | null} 分割対象（無ければ null）
 */
function selectBoxToSplit(boxes) {
  let target = null;
  let largest = 0;

  for (const box of boxes) {
    // レンジ 0 = 全色が同一。複数要素でも分割しても意味がないため除外する。
    if (box.maxRange > largest) {
      largest = box.maxRange;
      target = box;
    }
  }

  return target;
}

/**
 * ボックスを最長軸の中央値で2分割する。
 * 分割は最大レンジを持つチャネルで色をソートし、中央インデックスで切り分ける。
 *
 * @param {ReturnType<typeof createBox>} box - 分割対象ボックス（maxRange > 0 が前提）
 * @returns {[ReturnType<typeof createBox>, ReturnType<typeof createBox>]} 2つの子ボックス
 */
function splitBox(box) {
  const { colors, rRange, gRange, bRange, maxRange } = box;

  // 最大レンジを持つチャネルを選ぶ（r → g → b の順で判定）
  let channel = 'b';
  if (maxRange === rRange) {
    channel = 'r';
  } else if (maxRange === gRange) {
    channel = 'g';
  }

  // 選んだチャネルでソートし、中央で2分割する
  const sorted = [...colors].sort((a, b) => a[channel] - b[channel]);
  const mid = Math.floor(sorted.length / 2);

  // mid は 1 以上 sorted.length-1 以下になる（maxRange > 0 なので要素数 >= 2）。
  // よって左右いずれも非空になる。
  const left = sorted.slice(0, mid);
  const right = sorted.slice(mid);

  return [createBox(left), createBox(right)];
}

/**
 * ボックス内の色の平均値（各チャネルを四捨五入）を代表色として返す。
 *
 * @param {ReturnType<typeof createBox>} box - 対象ボックス
 * @returns {RgbColor} 代表色
 */
function averageColor(box) {
  const { colors } = box;
  const n = colors.length;

  let r = 0;
  let g = 0;
  let b = 0;
  for (const c of colors) {
    r += c.r;
    g += c.g;
    b += c.b;
  }

  return {
    r: Math.round(r / n),
    g: Math.round(g / n),
    b: Math.round(b / n),
  };
}

/**
 * 候補色（代表色）の中から、対象色に最も近い色を返す。
 * 距離は RGB 空間のユークリッド距離の2乗で比較する（平方根は順序に影響しないため省略）。
 *
 * @param {RgbColor} color - 対象色
 * @param {RgbColor[]} candidates - 候補色（代表色）
 * @returns {RgbColor} 最も近い代表色のコピー（候補が空なら対象色のコピー）
 */
function findNearestColor(color, candidates) {
  let best = null;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    const dr = color.r - candidate.r;
    const dg = color.g - candidate.g;
    const db = color.b - candidate.b;
    const distance = dr * dr + dg * dg + db * db;

    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  // 候補が空の場合は対象色をそのまま返す（写像先が無いため）
  if (best === null) {
    return { r: color.r, g: color.g, b: color.b };
  }

  return { r: best.r, g: best.g, b: best.b };
}

/**
 * 色配列から相異なる色（重複を除いた色）を抽出する。
 * パススルー時の representativeColors（パレット）算出に用いる。
 *
 * @param {RgbColor[]} colors - 入力色
 * @returns {RgbColor[]} 重複を除いた色の配列
 */
function dedupeColors(colors) {
  const seen = new Set();
  const result = [];

  for (const c of colors) {
    const key = `${c.r},${c.g},${c.b}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ r: c.r, g: c.g, b: c.b });
    }
  }

  return result;
}
