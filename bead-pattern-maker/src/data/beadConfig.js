// =============================================================================
// ビーズ設定（BEAD_CONFIG）とパレット初期化ヘルパー（initializePalette）
// =============================================================================
//
// 【役割】
//   - BEAD_CONFIG: ビーズタイプ（perler / nano）ごとの「ペグ数」と「表示ラベル」を
//     一元管理する設定オブジェクト。グリッド寸法・総ビーズ数の算出（要件3.3）や
//     ビーズタイプ選択UIのラベル表示（要件2.1）の基準として全モジュールから参照する。
//   - initializePalette: パレット（{ id, name, r, g, b }[]）の各色に Lab色空間値（lab）を
//     キャッシュした新しい配列を返す。最近色マッチング（CIE76 ΔE）のたびに rgbToLab を
//     再計算しないための事前計算であり、RGB値は各製品の公式カラーチャートに基づく
//     近似値（要件2.6）であるため、その近似RGBから一度だけ Lab を求めて保持する。
//
// 【設計上の位置づけ（design.md）】
//   - 「データモデル > BeadType」の BEAD_CONFIG 定義に準拠する。
//   - 「カラーパレットデータ構造」の initializePalette に準拠する。
//   - lab は parlerPalette.js / nanoPalette.js 側ではキャッシュせず、本ファイルの
//     initializePalette が実行時に rgbToLab で付与する（データ定義と派生値の分離）。
//
// _Requirements: 2.6, 3.3_
// =============================================================================

import { rgbToLab } from '../utils/colorUtils.js';

/**
 * ビーズタイプの設定（ペグ数・表示ラベル）。
 *
 * - pegCount: 1プレートあたりの縦横のビーズ配置数。グリッド寸法は
 *   （横枚数 × pegCount）×（縦枚数 × pegCount）で決まる（要件3.3）。
 *   パーラービーズは29、ナノビーズは28。
 * - label: ビーズタイプ選択UI等に表示する日本語名（要件2.1）。
 *
 * 設定値の意図しない書き換えを防ぐため、ネストしたオブジェクトごと凍結する。
 *
 * @typedef {'perler' | 'nano'} BeadType
 * @type {Readonly<Record<BeadType, Readonly<{ pegCount: number, label: string }>>>}
 */
export const BEAD_CONFIG = Object.freeze({
  perler: Object.freeze({ pegCount: 29, label: 'パーラービーズ' }),
  nano: Object.freeze({ pegCount: 28, label: 'ナノビーズ' }),
});

/**
 * パレットの各色に Lab色空間値（lab）をキャッシュした新しい配列を返す。
 *
 * 入力配列・各色オブジェクトは破壊せず、スプレッドで複製した新オブジェクトに
 * `lab` を付与する（元データは差し替え可能な近似RGBレコードとして保持し続ける）。
 *
 * @param {Array<{id: string, name: string, r: number, g: number, b: number}>} palette
 *        ビーズ色レコードの配列（{ id, name, r, g, b }）
 * @returns {Array<{id: string, name: string, r: number, g: number, b: number, lab: {L: number, a: number, b: number}}>}
 *        各色に lab を付与した新しい配列
 */
export function initializePalette(palette) {
  return palette.map((color) => ({
    ...color,
    lab: rgbToLab(color.r, color.g, color.b),
  }));
}
