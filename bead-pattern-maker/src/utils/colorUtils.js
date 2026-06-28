// 色変換ユーティリティ。
// RGB（sRGB）色空間と CIE Lab 色空間の相互変換を提供する。
// CIE76 色差（ΔE）計算や最近色マッチング、パレット初期化が依存する純粋関数群。

// CIE標準の定数（XYZ→Lab変換の非線形関数で使用）。
// ε = (6/29)^3 = 216/24389、κ = (29/3)^3 = 24389/27。
// この厳密値を使うことで、しきい値前後で関数が連続になる。
const EPSILON = 216 / 24389; // ≈ 0.008856
const KAPPA = 24389 / 27; // ≈ 903.296

// D65白色点（2°観測者）基準のXYZ三刺激値。
// 下記のsRGB→XYZ変換行列は、白（R=G=B=1）を入力すると
// X=0.95047, Y=1.0, Z=1.08883 を返すため、これを正規化スケールとして用いる。
const REF_X = 0.95047;
const REF_Y = 1.0;
const REF_Z = 1.08883;

/**
 * sRGBの1チャネル値（0-1）をリニアRGB（ガンマ補正を除去した値）に変換する。
 * @param {number} channel - 0以上1以下に正規化したチャネル値
 * @returns {number} リニア化したチャネル値
 */
function srgbToLinear(channel) {
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/**
 * XYZ→Lab変換で用いる非線形関数 f(t)。
 * しきい値 ε を境に、立方根と線形近似を切り替える。
 * @param {number} t - 白色点で正規化した三刺激値（X/Xn など）
 * @returns {number} 変換後の値
 */
function pivotXyz(t) {
  return t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
}

/**
 * RGB色をCIE Lab色空間に変換する。
 * sRGBリニア化 → XYZ変換 → Lab変換（D65白色点基準）という標準手順で計算する。
 * @param {number} r - 赤成分 (0-255)
 * @param {number} g - 緑成分 (0-255)
 * @param {number} b - 青成分 (0-255)
 * @returns {{L: number, a: number, b: number}} Lab色空間値
 */
export function rgbToLab(r, g, b) {
  // 1. 0-255 を 0-1 に正規化し、sRGB をリニアRGB へ変換する。
  const rLinear = srgbToLinear(r / 255);
  const gLinear = srgbToLinear(g / 255);
  const bLinear = srgbToLinear(b / 255);

  // 2. リニアRGB → XYZ（sRGB / D65 の標準変換行列）。
  const x = rLinear * 0.4124564 + gLinear * 0.3575761 + bLinear * 0.1804375;
  const y = rLinear * 0.2126729 + gLinear * 0.7151522 + bLinear * 0.0721750;
  const z = rLinear * 0.0193339 + gLinear * 0.1191920 + bLinear * 0.9503041;

  // 3. 白色点（D65）で正規化し、非線形関数 f を適用する。
  const fx = pivotXyz(x / REF_X);
  const fy = pivotXyz(y / REF_Y);
  const fz = pivotXyz(z / REF_Z);

  // 4. XYZ → Lab。
  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}
