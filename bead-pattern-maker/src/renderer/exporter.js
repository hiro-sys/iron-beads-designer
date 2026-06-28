// =============================================================================
// PNG エクスポーター（exporter.js）
// -----------------------------------------------------------------------------
// 生成済みの図案グリッド（PatternGrid）を 1 枚の PNG 画像として書き出し、
// ブラウザのダウンロードとして保存するモジュール。
//
// 画像の構成（上から順に）:
//   1. 図案本体: 各ビーズセルを対応色で塗りつぶし、未配置（null）セルは
//      ハッチングで描画する。セル境界線（細）・プレート境界線（太）を含む。
//      （要件7.1, 7.2 / 設計「5. エクスポーター」）
//   2. 図案下部の使用色一覧: 色見本の矩形・色名・使用個数を一覧描画する。
//      未配置セルは使用色一覧に含めない（要件7.3, 9.7）。
//
// セルサイズは最低 20px を保証する（要件7.1 / Property 12）。セルサイズ計算は
// 純関数 computeExportCellSize として切り出し、プロパティテスト（タスク12.3）で
// 検証可能にしている。
//
// 図案にビーズが 1 つも配置されていない（非null セルが 0）場合はエクスポートを
// 実行せず、その旨のメッセージを返す（要件7.4）。エクスポート処理中の例外は
// 捕捉し、失敗メッセージを返す。図案データ（pattern）は読み取り専用で扱い、
// 一切変更しないため常に保持される（要件7.5）。
//
// 図案本体の描画は canvasRenderer.js の renderPattern を再利用する。renderPattern は
// 内部で renderHatchedCell（未配置セルのハッチング）・セル境界線・プレート境界線を
// 描画するため、オンスクリーン表示と同一の見た目を PNG にも反映できる。
//
// 設計参照: design.md「コンポーネントとインターフェース > 5. エクスポーター
//           （exporter.js）」「データモデル > ExportOptions」
// Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
// =============================================================================

import { calculateUsedColors } from '../ui/colorList.js';
import { renderPattern } from './canvasRenderer.js';

/** @typedef {import('../engine/ConversionStrategy.js').PatternGrid} PatternGrid */
/** @typedef {import('../engine/ConversionStrategy.js').BeadColor} BeadColor */

// --- セルサイズ（要件7.1 / Property 12）------------------------------------
// エクスポート時の 1 セルは最低 20px を保証する。
const MIN_CELL_SIZE = 20;

// --- 使用色一覧のレイアウト定数 ---------------------------------------------
const LIST_PADDING = 24; // 一覧領域の上下左右パディング（px）
const LIST_TITLE_HEIGHT = 36; // 「使用色一覧（合計: N個）」見出しの高さ（px）
const LIST_ENTRY_HEIGHT = 30; // 1 色あたりの行高（px）
const LIST_SWATCH_SIZE = 22; // 色見本（矩形）の 1 辺（px）
const LIST_SWATCH_GAP = 12; // 色見本とテキストの間隔（px）
const LIST_MIN_WIDTH = 360; // 使用色一覧領域の最小幅（px）

// --- 色・線のスタイル --------------------------------------------------------
const CANVAS_BG_COLOR = '#ffffff'; // 画像全体の背景（白）
const LIST_SEPARATOR_COLOR = '#999999'; // 図案と一覧を区切る線
const LIST_TEXT_COLOR = '#333333'; // 見出し・色名・個数のテキスト色
const SWATCH_BORDER_COLOR = '#333333'; // 色見本の枠線色
const TITLE_FONT = 'bold 18px sans-serif';
const ENTRY_FONT = '16px sans-serif';

/**
 * エクスポートオプション。
 * @typedef {Object} ExportOptions
 * @property {number} [cellSize] - エクスポート時の 1 セルサイズ（最低 20px。未指定/20未満は 20 に補正）
 * @property {boolean} [includeColorList] - 使用色一覧を画像に含めるか（既定: true）
 * @property {boolean} [includeGrid] - セル境界線（グリッド線）を含めるか（既定: true）
 * @property {string} [filename] - ダウンロードファイル名（未指定時は日時から自動生成）
 */

/**
 * エクスポート結果。
 * @typedef {Object} ExportResult
 * @property {boolean} success - エクスポートが成功したか
 * @property {boolean} exported - 実際にダウンロードが実行されたか（7.4 でブロックした場合 false）
 * @property {string} message - ユーザー向けメッセージ
 * @property {Error} [error] - 失敗時のエラー（7.5）
 */

/**
 * エクスポート時のセルサイズ（px）を計算する純関数。
 *
 * 要件7.1（各ビーズ 1 セルあたり最低 20×20px）を満たすため、必ず 20 以上を返す。
 * options.cellSize が 20 以上の有限数のときはその値（整数化）を、それ以外
 * （未指定・20 未満・非数値）のときは 20 を返す。
 *
 * @param {ExportOptions} [options] - エクスポートオプション
 * @returns {number} セルサイズ（px、>= 20）
 */
export function computeExportCellSize(options = {}) {
  const opts = options || {};
  const requested = opts.cellSize;
  if (Number.isFinite(requested) && requested >= MIN_CELL_SIZE) {
    // 20 以上の値は整数へ丸める（floor しても 20 を下回らない）
    return Math.floor(requested);
  }
  return MIN_CELL_SIZE;
}

/**
 * 使用色一覧領域の高さ（px）を計算する純関数。
 *
 * 高さ = 上下パディング + 見出し + （色数 × 行高）。
 * 色数が 0 以下の場合は見出しのみ（パディング込み）の高さを返す。
 *
 * @param {number} colorCount - 一覧に表示する色数
 * @returns {number} 一覧領域の高さ（px）
 */
export function computeColorListHeight(colorCount) {
  const count = Number.isFinite(colorCount) && colorCount > 0 ? Math.floor(colorCount) : 0;
  return LIST_PADDING * 2 + LIST_TITLE_HEIGHT + count * LIST_ENTRY_HEIGHT;
}

/**
 * エクスポート画像全体の寸法（px）を計算する純関数。
 *
 * - 図案本体: 幅 = width × cellSize, 高さ = height × cellSize
 * - 使用色一覧: includeColorList が true のとき図案の下に追加する
 * - 画像全体の幅は「図案幅」と「一覧最小幅」の大きい方（>= 図案幅を保証）
 * - 画像全体の高さは「図案高さ + 一覧高さ」（>= 図案高さを保証）
 *
 * これにより Property 12（セルサイズ >= 20、画像全体 >= (width×cellSize)×(height×cellSize)）を満たす。
 *
 * @param {PatternGrid} pattern - 図案データ
 * @param {ExportOptions} [options] - エクスポートオプション
 * @param {number} [colorCountOverride] - 一覧に描画する色数（描画側で確定済みの値を渡せる）
 * @returns {{width: number, height: number, cellSize: number, patternWidth: number, patternHeight: number, listHeight: number, listWidth: number, colorCount: number}}
 */
export function computeExportDimensions(pattern, options = {}, colorCountOverride) {
  const opts = options || {};
  const cellSize = computeExportCellSize(opts);

  const cols = pattern?.width ?? 0;
  const rows = pattern?.height ?? 0;
  const patternWidth = cols * cellSize;
  const patternHeight = rows * cellSize;

  const includeColorList = opts.includeColorList !== false; // 既定 true

  // 一覧に描画する色数。明示指定が無ければ図案から集計する（未配置は除外）。
  const colorCount = Number.isFinite(colorCountOverride)
    ? Math.max(0, Math.floor(colorCountOverride))
    : includeColorList
      ? calculateUsedColors(pattern).colors.length
      : 0;

  const listHeight = includeColorList ? computeColorListHeight(colorCount) : 0;
  const listWidth = includeColorList && colorCount > 0 ? LIST_MIN_WIDTH : 0;

  // 図案が空でも 0px キャンバスにならないよう最低 1px を保証する。
  const width = Math.max(patternWidth, listWidth, 1);
  const height = Math.max(patternHeight + listHeight, 1);

  return {
    width,
    height,
    cellSize,
    patternWidth,
    patternHeight,
    listHeight,
    listWidth,
    colorCount,
  };
}

/**
 * 一覧に描画する色エントリ（色見本・色名・個数）を確定する。
 *
 * 呼び出し側が個数付きの使用色配列（UsedColorEntry[]）を渡した場合はそれを尊重し、
 * 個数を持たない配列や未指定の場合は図案から集計した結果（calculateUsedColors）を用いる。
 *
 * @param {{colors: Array<BeadColor & {count: number}>}} usedResult - calculateUsedColors の結果
 * @param {Array<BeadColor & {count?: number}>|null|undefined} usedColors - 呼び出し側指定の使用色一覧
 * @returns {Array<BeadColor & {count: number}>} 描画に使う色エントリ
 */
function resolveListColors(usedResult, usedColors) {
  if (
    Array.isArray(usedColors) &&
    usedColors.length > 0 &&
    usedColors.every((c) => c && Number.isFinite(c.count))
  ) {
    return usedColors;
  }
  return usedResult.colors;
}

/**
 * 使用色一覧（見出し・色見本・色名・個数）を 2D コンテキストへ描画する。
 *
 * @param {CanvasRenderingContext2D} ctx - 描画先 2D コンテキスト
 * @param {Array<BeadColor & {count: number}>} colors - 使用色エントリ（個数降順 → 色名昇順でソート済み想定）
 * @param {number} totalBeads - 合計ビーズ数（非null セル数。要件6.4）
 * @param {number} startY - 一覧領域の開始 Y 座標（図案の下端、px）
 * @param {number} canvasWidth - キャンバス全体の幅（区切り線・背景に使用）
 */
function drawColorList(ctx, colors, totalBeads, startY, canvasWidth) {
  // 図案と一覧の境界を示す区切り線
  ctx.strokeStyle = LIST_SEPARATOR_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, Math.floor(startY) + 0.5);
  ctx.lineTo(canvasWidth, Math.floor(startY) + 0.5);
  ctx.stroke();

  const x = LIST_PADDING;
  let y = startY + LIST_PADDING;

  // 見出し（合計個数を併記。要件6.4）
  ctx.fillStyle = LIST_TEXT_COLOR;
  ctx.font = TITLE_FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`使用色一覧（合計: ${totalBeads}個）`, x, y);
  y += LIST_TITLE_HEIGHT;

  // 各色: 色見本（矩形）・色名・使用個数（要件7.3 / 6.2）
  ctx.font = ENTRY_FONT;
  for (const color of colors) {
    // 色見本（塗り＋枠線）
    ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
    ctx.fillRect(x, y, LIST_SWATCH_SIZE, LIST_SWATCH_SIZE);
    ctx.strokeStyle = SWATCH_BORDER_COLOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, LIST_SWATCH_SIZE, LIST_SWATCH_SIZE);

    // 色名 + 使用個数（色見本の縦中央に揃える）
    ctx.fillStyle = LIST_TEXT_COLOR;
    ctx.textBaseline = 'middle';
    ctx.fillText(
      `${color.name}  ${color.count}個`,
      x + LIST_SWATCH_SIZE + LIST_SWATCH_GAP,
      y + LIST_SWATCH_SIZE / 2,
    );
    ctx.textBaseline = 'top';

    y += LIST_ENTRY_HEIGHT;
  }
}

/**
 * 図案＋使用色一覧を描画したオフスクリーン Canvas を生成して返す。
 *
 * 図案本体は canvasRenderer.renderPattern を一時 Canvas に描画してから本 Canvas へ
 * 転写する（未配置セルのハッチング・セル境界線・プレート境界線を再利用）。
 *
 * @param {PatternGrid} pattern - 図案データ
 * @param {Array<BeadColor & {count?: number}>|null} [usedColors] - 使用色一覧（個数付き。未指定なら図案から集計）
 * @param {ExportOptions} [options] - エクスポートオプション
 * @returns {HTMLCanvasElement} 描画済み Canvas
 * @throws {Error} 2D コンテキストが取得できない場合
 */
export function createExportCanvas(pattern, usedColors = null, options = {}) {
  const opts = options || {};
  const cellSize = computeExportCellSize(opts);
  const includeColorList = opts.includeColorList !== false; // 既定 true
  const includeGrid = opts.includeGrid !== false; // 既定 true

  // 使用色の集計（未配置 null は除外。要件7.3 / 9.7）
  const usedResult = calculateUsedColors(pattern);
  const listColors = includeColorList ? resolveListColors(usedResult, usedColors) : [];

  // 画像全体の寸法（描画する色数に基づいて確定）
  const dims = computeExportDimensions(pattern, opts, listColors.length);

  const canvas = document.createElement('canvas');
  canvas.width = dims.width;
  canvas.height = dims.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('エクスポート用の 2D コンテキストを取得できませんでした。');
  }

  // 画像全体を白で塗る（図案より広い領域や一覧領域を不透明にする）
  ctx.fillStyle = CANVAS_BG_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 図案本体を一時 Canvas に描画して転写する（renderPattern を再利用）
  const patternCanvas = document.createElement('canvas');
  renderPattern(patternCanvas, pattern, {
    cellSize,
    zoom: 1,
    showGrid: includeGrid, // セル境界線（要件7.2）
    showPlateBorders: true, // プレート境界線は常に含める（要件7.2）
  });
  ctx.drawImage(patternCanvas, 0, 0);

  // 図案下部に使用色一覧を描画（要件7.3）
  if (includeColorList && listColors.length > 0) {
    drawColorList(ctx, listColors, usedResult.totalBeads, dims.patternHeight, canvas.width);
  }

  return canvas;
}

/**
 * ダウンロード用のファイル名を日時から生成する（例: bead-pattern-20240131-153000.png）。
 * @returns {string} PNG ファイル名
 */
function generateFilename() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `bead-pattern-${stamp}.png`;
}

/**
 * Blob をダウンロードリンク経由でファイル保存する。
 * URL.createObjectURL で一時 URL を作り、非表示の <a download> をクリックする。
 *
 * @param {Blob} blob - 保存する画像 Blob
 * @param {string} filename - ファイル名
 */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    // ブラウザがダウンロードを取りこぼさないよう、解放は少し遅延させる
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/**
 * 図案を PNG 画像として生成し、ダウンロードする。
 *
 * 処理の流れ:
 *   1. ビーズ数の検証: 非null セルが 0 の場合はエクスポートせずメッセージを返す（要件7.4）
 *   2. オフスクリーン Canvas に図案＋使用色一覧を描画（要件7.1, 7.2, 7.3）
 *   3. canvas.toBlob() で PNG Blob を生成し、createObjectURL でダウンロード
 *   4. 例外発生時は失敗メッセージを返す。pattern は変更しないため保持される（要件7.5）
 *
 * 描画と toBlob は非同期を含むため、結果は Promise で返す。
 *
 * @param {PatternGrid} pattern - 図案データ
 * @param {Array<BeadColor & {count?: number}>|null} [usedColors] - 使用色一覧（個数付き。未指定なら図案から集計）
 * @param {ExportOptions} [options] - エクスポートオプション
 * @returns {Promise<ExportResult>} エクスポート結果
 */
export function exportAsPng(pattern, usedColors = null, options = {}) {
  const opts = options || {};

  // --- 要件7.4: ビーズが 1 つも配置されていない場合はエクスポートしない -----
  const usedResult = calculateUsedColors(pattern);
  if (usedResult.totalBeads === 0) {
    return Promise.resolve({
      success: false,
      exported: false,
      message: 'ビーズが1つも配置されていないため、エクスポートできません。',
    });
  }

  // --- 描画 → Blob 生成 → ダウンロード（要件7.1, 7.2, 7.3） ----------------
  try {
    const canvas = createExportCanvas(pattern, usedColors, opts);
    const filename = typeof opts.filename === 'string' && opts.filename ? opts.filename : generateFilename();

    return new Promise((resolve) => {
      // toBlob 呼び出し自体が失敗するケースも捕捉する（要件7.5）
      try {
        canvas.toBlob((blob) => {
          if (!blob) {
            resolve({
              success: false,
              exported: false,
              message: 'エクスポートに失敗しました。画像の生成に失敗しました。',
              error: new Error('canvas.toBlob() が null を返しました。'),
            });
            return;
          }
          try {
            triggerDownload(blob, filename);
            resolve({
              success: true,
              exported: true,
              message: 'PNG画像をエクスポートしました。',
            });
          } catch (downloadError) {
            // ダウンロード処理中の失敗（要件7.5。pattern は未変更で保持）
            resolve({
              success: false,
              exported: false,
              message: 'エクスポートに失敗しました。ファイルの保存に失敗しました。',
              error: downloadError,
            });
          }
        }, 'image/png');
      } catch (blobError) {
        resolve({
          success: false,
          exported: false,
          message: 'エクスポートに失敗しました。画像の生成に失敗しました。',
          error: blobError,
        });
      }
    });
  } catch (error) {
    // 描画（Canvas 生成）中の失敗（要件7.5。pattern は未変更で保持）
    return Promise.resolve({
      success: false,
      exported: false,
      message: 'エクスポートに失敗しました。',
      error,
    });
  }
}
