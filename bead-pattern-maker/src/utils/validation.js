// =============================================================================
// グリッド計算・各種バリデーション（validation.js）
// =============================================================================
//
// 【役割】
//   図案のサイズ算出と、ユーザー入力の妥当性検証をまとめた純粋関数群。
//   いずれも副作用を持たず、同じ入力に対して常に同じ結果を返す。
//
//   - calculateTotalBeads: プレート構成とビーズタイプから総ビーズ数を算出する
//     （要件3.3）。
//   - createEmptyGrid:    全セルが未配置（null）の空グリッドを生成する（要件3.4）。
//   - validatePlateCount: プレート枚数入力を 1〜10 の整数のみ有効と判定する
//     （要件3.1, 3.2, 3.6）。
//   - validateImageFile:  画像ファイルを許可形式かつ10MB以下のみ受け付ける
//     （要件1.2, 1.4, 1.6）。
//
// 【設計上の位置づけ（design.md）】
//   - 「エラーハンドリング > バリデーション戦略」の validatePlateCount /
//     validateImageFile の実装方針に準拠する。
//   - 「データモデル > PatternGrid」の構造（width / height / cells /
//     originalCells / beadType / plateConfig）に準拠して空グリッドを生成する。
//   - ペグ数は data/beadConfig.js の BEAD_CONFIG（perler=29, nano=28）を
//     唯一の出典として参照し、本ファイルでは数値をハードコードしない。
//
// _Requirements: 3.3, 3.4, 3.1, 3.2, 3.6, 1.2, 1.4, 1.6_
// =============================================================================

import { BEAD_CONFIG } from '../data/beadConfig.js';

/**
 * 画像アップロードで許可するMIMEタイプ（要件1.2: JPEG / PNG / GIF / WebP）。
 * @type {readonly string[]}
 */
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/**
 * 画像ファイルサイズの上限（要件1.2, 1.6: 10MB）。
 * 10 × 1024 × 1024 バイト。
 * @type {number}
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * @typedef {import('../data/beadConfig.js').BeadType} BeadType
 */

/**
 * ビーズ色レコード（design.md「データモデル > BeadColor」）。
 * @typedef {Object} BeadColor
 * @property {string} id - 色の一意識別子
 * @property {string} name - 色名
 * @property {number} r - 赤成分 (0-255)
 * @property {number} g - 緑成分 (0-255)
 * @property {number} b - 青成分 (0-255)
 * @property {{L: number, a: number, b: number}} [lab] - Lab色空間値（キャッシュ）
 */

/**
 * 図案グリッド（design.md「データモデル > PatternGrid」）。
 * @typedef {Object} PatternGrid
 * @property {number} width - 横ビーズ数（cols × pegCount）
 * @property {number} height - 縦ビーズ数（rows × pegCount）
 * @property {(BeadColor|null)[][]} cells - 2次元配列 [row][col]。nullは未配置
 * @property {(BeadColor|null)[][]} originalCells - 背景除外前の元セル（復元用）
 * @property {BeadType} beadType - ビーズタイプ
 * @property {{cols: number, rows: number}} plateConfig - プレート構成
 */

/**
 * プレート構成とビーズタイプから図案の総ビーズ数を算出する（要件3.3）。
 *
 * 総ビーズ数 =（横枚数 × ペグ数）×（縦枚数 × ペグ数）。
 * ペグ数は選択中のビーズタイプに依存し、パーラービーズは29、ナノビーズは28。
 *
 * @param {{cols: number, rows: number}} plateConfig - プレート構成（横・縦の枚数）
 * @param {BeadType} beadType - ビーズタイプ（'perler' | 'nano'）
 * @returns {number} 総ビーズ数
 */
export function calculateTotalBeads(plateConfig, beadType) {
  const { pegCount } = BEAD_CONFIG[beadType];
  const width = plateConfig.cols * pegCount;
  const height = plateConfig.rows * pegCount;
  return width * height;
}

/**
 * 全セルが未配置（null）の空の図案グリッドを生成する（要件3.4）。
 *
 * 幅は `cols × pegCount`、高さは `rows × pegCount`。
 * cells と originalCells は独立した2次元配列として生成し、後段の手動編集や
 * 背景除外で一方を書き換えても他方へ波及しないようにする（参照の共有を避ける）。
 *
 * @param {{cols: number, rows: number}} plateConfig - プレート構成（横・縦の枚数）
 * @param {BeadType} beadType - ビーズタイプ（'perler' | 'nano'）
 * @returns {PatternGrid} 全セル未配置の空グリッド
 */
export function createEmptyGrid(plateConfig, beadType) {
  const { pegCount } = BEAD_CONFIG[beadType];
  const width = plateConfig.cols * pegCount;
  const height = plateConfig.rows * pegCount;
  return {
    width,
    height,
    cells: createNullCells(width, height),
    originalCells: createNullCells(width, height),
    beadType,
    plateConfig: { cols: plateConfig.cols, rows: plateConfig.rows },
  };
}

/**
 * 幅 width × 高さ height の、全要素 null の2次元配列 [row][col] を生成する。
 * 各行は独立した配列インスタンスとして生成する。
 *
 * @param {number} width - 横方向の要素数（列数）
 * @param {number} height - 縦方向の要素数（行数）
 * @returns {null[][]} 全要素 null の2次元配列
 */
function createNullCells(width, height) {
  const cells = [];
  for (let row = 0; row < height; row += 1) {
    cells.push(new Array(width).fill(null));
  }
  return cells;
}

/**
 * プレート枚数の入力値を検証する（要件3.1, 3.2, 3.6）。
 *
 * 1以上10以下の整数のみを有効とし、負数・0・小数・11以上・非数値は無効とする。
 * `parseInt` でパースした整数値と `Number` で評価した値が一致しない場合
 * （例: "5.5" や "5px"）も小数・非整数として無効にする。
 *
 * @param {*} value - 検証対象の入力値（文字列または数値）
 * @returns {{valid: true, value: number} | {valid: false}} 検証結果。
 *   有効なら正規化済みの整数値 value を含む。
 */
export function validatePlateCount(value) {
  const num = parseInt(value, 10);
  if (Number.isNaN(num) || num < 1 || num > 10 || num !== Number(value)) {
    return { valid: false };
  }
  return { valid: true, value: num };
}

/**
 * 画像ファイルを検証する（要件1.2, 1.4, 1.6）。
 *
 * 許可形式（JPEG / PNG / GIF / WebP）かつ 10MB 以下のファイルのみ受け付ける。
 * いずれかに反する場合は理由を示すエラーメッセージ付きで拒否する。
 *
 * @param {File} file - 検証対象のファイル（type と size を参照する）
 * @returns {{valid: true} | {valid: false, error: string}} 検証結果
 */
export function validateImageFile(file) {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { valid: false, error: '対応形式: JPEG、PNG、GIF、WebP' };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: 'ファイルサイズは10MB以下にしてください' };
  }
  return { valid: true };
}
