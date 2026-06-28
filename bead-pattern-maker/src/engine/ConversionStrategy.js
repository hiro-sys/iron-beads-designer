// =============================================================================
// 変換エンジン（Strategy パターン）の契約定義
// -----------------------------------------------------------------------------
// 「画像 → 図案グリッド（PatternGrid）」への変換アルゴリズムを、交換可能な
// Strategy として抽象化するモジュール。
//
// JavaScript にはインターフェース構文が存在しないため、変換 Strategy が満たす
// べき契約（convert(image, options): PatternGrid）を、JSDoc の @typedef /
// @callback と抽象基底クラスの組み合わせで表現する。
//
// 具体的な変換ロジックは本ファイルでは実装せず、別モジュールが提供する:
//   - LocalConversionStrategy : ブラウザ内で完結するローカル変換（現行）
//   - AIConversionStrategy     : Amazon Bedrock 等を用いた AI 変換（将来）
//
// これにより、要件4.9「図案生成処理を交換可能なモジュール（変換エンジン）として
// 実装し、将来的に異なる変換アルゴリズムを追加可能な設計とする」を満たす。
//
// Requirements: 4.9
// 設計参照: design.md「コンポーネントとインターフェース > 1. 変換エンジン
//           （Strategy パターン）」「データモデル」
// @module engine/ConversionStrategy
// =============================================================================

/**
 * ビーズタイプ。
 * @typedef {'perler' | 'nano'} BeadType
 */

/**
 * ビーズ1色を表すデータモデル。
 *
 * 変換契約（{@link ConversionOptions}.activePalette や {@link PatternGrid}.cells）が
 * 参照する型として宣言する。色データの正典はカラーパレット層
 * （`data/parlerPalette.js` / `data/nanoPalette.js`）で定義し、`initializePalette`
 * によって `lab`（Lab 色空間値）をキャッシュした上で変換エンジンへ渡す。
 *
 * @typedef {Object} BeadColor
 * @property {string} id - 色の一意識別子（例: "P01"）
 * @property {string} name - 色名（例: "しろ"）
 * @property {number} r - 赤成分 (0-255)
 * @property {number} g - 緑成分 (0-255)
 * @property {number} b - 青成分 (0-255)
 * @property {{L: number, a: number, b: number}} [lab] - Lab 色空間値（初期化時にキャッシュ）
 */

/**
 * 図案グリッド。変換 Strategy の `convert` が返すデータモデル。
 *
 * `cells` は背景除外適用後、`originalCells` は背景除外適用前のグリッドを保持する。
 * いずれの 2 次元配列も `[row][col]` でアクセスし、`null` セルは「未配置
 * （ビーズを置かない）」を意味する（ビーズ製品の「とうめい」色とは異なる）。
 *
 * @typedef {Object} PatternGrid
 * @property {number} width - 横ビーズ数
 * @property {number} height - 縦ビーズ数
 * @property {(BeadColor|null)[][]} cells - 2 次元配列 [row][col]。null は未配置
 * @property {(BeadColor|null)[][]} originalCells - 背景除外前の元セル（復元用）
 * @property {BeadType} beadType - ビーズタイプ
 * @property {{cols: number, rows: number}} plateConfig - プレート構成
 */

/**
 * 変換オプション。画像を図案へ変換する際のパラメータ一式。
 *
 * @typedef {Object} ConversionOptions
 * @property {number} width - 図案の横ビーズ数（cols × pegCount）
 * @property {number} height - 図案の縦ビーズ数（rows × pegCount）
 * @property {BeadColor[]} activePalette - 使用パレット（無効化色を除いた有効色のみ）
 * @property {'smooth' | 'sharp'} resizeMethod - リサイズ方式（要件10）
 * @property {'stretch' | 'contain' | 'cover'} fitMode - フィットモード（要件10）
 * @property {number | null} maxColors - 最大色数（null は制限なし、要件11）
 */

/**
 * 変換 Strategy の中核となる変換関数の契約。
 *
 * すべての変換 Strategy はこのシグネチャに従う `convert` を提供し、元画像と
 * 変換オプションから図案グリッドを生成して返す。
 *
 * @callback ConvertFunction
 * @param {HTMLImageElement} image - アップロードされた元画像（リサイズ前）
 * @param {ConversionOptions} options - 変換オプション
 * @returns {PatternGrid} 生成された図案グリッド
 */

/**
 * 変換 Strategy インターフェース（契約）。
 *
 * design.md のクラス図における `<<interface>> ConversionStrategy` に対応する。
 * `convert` を実装したオブジェクトはこの型を満たす（ダックタイピング）。
 *
 * @typedef {Object} ConversionStrategy
 * @property {ConvertFunction} convert - 画像と変換オプションから図案グリッドを生成する
 */

/**
 * 変換 Strategy の抽象基底クラス。
 *
 * design.md の `<<interface>> ConversionStrategy` を JavaScript の抽象基底クラス
 * として表現したもの。具体的な変換ロジックはサブクラス（例:
 * LocalConversionStrategy）が `convert` をオーバーライドして実装する。
 * 基底クラスの `convert` は未実装であり、呼び出されると例外を投げる。
 *
 * 継承は必須ではなく、`ConvertFunction` の契約を満たす任意のオブジェクトを
 * Strategy として扱える。本クラスは契約の明示と「未実装の検知」を目的とした
 * 任意の土台として提供する。
 *
 * @abstract
 * @implements {ConversionStrategy}
 */
export class AbstractConversionStrategy {
  /**
   * 画像を図案グリッドへ変換する。
   *
   * @abstract
   * @param {HTMLImageElement} image - アップロードされた元画像（リサイズ前）
   * @param {ConversionOptions} options - 変換オプション
   * @returns {PatternGrid} 生成された図案グリッド
   * @throws {Error} サブクラスで `convert` が実装されていない場合
   */
  // eslint-disable-next-line no-unused-vars
  convert(image, options) {
    throw new Error(
      'AbstractConversionStrategy.convert() は抽象メソッドです。サブクラス（例: LocalConversionStrategy）で実装してください。',
    );
  }
}

// このモジュールは主に型（JSDoc typedef / callback）の定義を提供する。
// 値としてのエクスポートは抽象基底クラス AbstractConversionStrategy のみ。
// 型は他モジュールから次のように参照できる:
//   /** @typedef {import('./ConversionStrategy.js').ConversionOptions} ConversionOptions */
//   /** @typedef {import('./ConversionStrategy.js').PatternGrid} PatternGrid */
//   /** @typedef {import('./ConversionStrategy.js').ConversionStrategy} ConversionStrategy */
