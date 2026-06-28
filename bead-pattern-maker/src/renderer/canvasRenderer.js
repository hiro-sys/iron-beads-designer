// =============================================================================
// Canvas描画エンジン（canvasRenderer.js）
// -----------------------------------------------------------------------------
// 生成済みの図案グリッド（PatternGrid）を HTML5 Canvas に描画するモジュール。
// 以下の描画要素を担う:
//   - ビーズセル: 対応色で塗りつぶし（要件4.5 / 5）
//   - 未配置セル（null）: 白背景＋薄いグレー(#ccc)の45度対角線ハッチング（要件9.6）
//   - セル境界線: 細いグリッド線（1px / #ccc、要件5.2）
//   - プレート境界線: 太いグリッド線（2px / #333、ペグ数ごと、要件5.1）
//
// ズーム対応（要件5.3）:
//   options.zoom（0.5〜4.0、クランプは state 側の責務）でセルサイズを可変にし、
//   Canvas 自体のサイズ（canvas.width / height）を動的に設定する。
//
// 設計参照: design.md「コンポーネントとインターフェース > 4. Canvas描画エンジン」
// Requirements: 5.1, 5.2, 5.3, 9.6
//
// 注意: Canvas 描画そのものはブラウザ環境依存のため手動テスト対象とし、
//       純粋ロジック（セルサイズ計算・Canvas寸法計算等）は関数として切り出して
//       後続のユニットテスト（タスク12.4）で検証可能にしている。
// =============================================================================

/** @typedef {import('../engine/ConversionStrategy.js').PatternGrid} PatternGrid */
/** @typedef {import('../engine/ConversionStrategy.js').BeadColor} BeadColor */
/** @typedef {import('../engine/ConversionStrategy.js').BeadType} BeadType */

/**
 * 描画オプション。
 * @typedef {Object} RenderOptions
 * @property {number} [cellSize] - 1セルの基本ピクセルサイズ（既定: 10）
 * @property {number} [zoom] - ズーム倍率（既定: 1.0）
 * @property {boolean} [showGrid] - セル境界線（グリッド線）の表示フラグ（既定: true）
 * @property {boolean} [showPlateBorders] - プレート境界線の表示フラグ（既定: true）
 */

// --- 既定値 -----------------------------------------------------------------
const DEFAULT_CELL_SIZE = 10; // 1セルの基本ピクセルサイズ（ズーム1.0時）
const DEFAULT_ZOOM = 1.0;

// --- セル境界線（薄いグリッド線、要件5.2）-----------------------------------
const CELL_BORDER_COLOR = '#cccccc';
const CELL_BORDER_WIDTH = 1;

// --- プレート境界線（太いグリッド線、要件5.1）-------------------------------
const PLATE_BORDER_COLOR = '#333333';
const PLATE_BORDER_WIDTH = 2;

// --- 未配置セルのハッチング（要件9.6）---------------------------------------
const HATCH_BG_COLOR = '#ffffff'; // 背景は白
const HATCH_LINE_COLOR = '#cccccc'; // 対角線は薄いグレー
const HATCH_LINE_WIDTH = 1; // 対角線幅 1px
const HATCH_SPACING = 3; // 対角線間隔 3px

// --- ビーズタイプごとのペグ数（プレート境界線の判定に使用）-------------------
// パーラービーズ=29、ナノビーズ=28（要件5.1 / 用語集）。
const PEG_COUNT = { perler: 29, nano: 28 };

/**
 * ビーズタイプに対応するペグ数（1プレートあたりのセル数）を返す。
 * 未知のタイプはパーラービーズ（29）にフォールバックする。
 * @param {BeadType} beadType - ビーズタイプ
 * @returns {number} ペグ数
 */
export function getPegCount(beadType) {
  return PEG_COUNT[beadType] ?? PEG_COUNT.perler;
}

/**
 * ズーム適用後の実効セルサイズ（ピクセル）を計算する純関数。
 * cellSize / zoom が不正（0以下・非数値）な場合は既定値にフォールバックする。
 * @param {number} cellSize - 1セルの基本ピクセルサイズ
 * @param {number} zoom - ズーム倍率
 * @returns {number} 実効セルサイズ（px）
 */
export function computeEffectiveCellSize(cellSize, zoom) {
  const base = Number.isFinite(cellSize) && cellSize > 0 ? cellSize : DEFAULT_CELL_SIZE;
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : DEFAULT_ZOOM;
  return base * z;
}

/**
 * 図案グリッドとセルサイズ・ズームから Canvas の内部寸法（px）を計算する純関数。
 * @param {PatternGrid} pattern - 図案データ
 * @param {number} cellSize - 1セルの基本ピクセルサイズ
 * @param {number} zoom - ズーム倍率
 * @returns {{width: number, height: number}} Canvas の幅・高さ（px）
 */
export function computeCanvasDimensions(pattern, cellSize, zoom) {
  const effective = computeEffectiveCellSize(cellSize, zoom);
  const cols = pattern?.width ?? 0;
  const rows = pattern?.height ?? 0;
  return {
    width: cols * effective,
    height: rows * effective,
  };
}

/**
 * BeadColor を CSS の rgb() 文字列へ変換する。
 * @param {BeadColor} color - ビーズ色
 * @returns {string} 例: "rgb(241, 241, 241)"
 */
function beadColorToCss(color) {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

/**
 * 未配置セル（null）にハッチングパターンを描画する。
 * 白背景の上に、薄いグレー(#ccc)の45度対角線（左上→右下方向）を
 * 線幅1px・間隔3pxで描く。線はセル領域でクリップし、隣接セルへはみ出さない。
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas 2Dコンテキスト
 * @param {number} x - セルのX座標（ピクセル）
 * @param {number} y - セルのY座標（ピクセル）
 * @param {number} size - セルのサイズ（ピクセル）
 */
export function renderHatchedCell(ctx, x, y, size) {
  // 1. 背景を白で塗る
  ctx.fillStyle = HATCH_BG_COLOR;
  ctx.fillRect(x, y, size, size);

  // 2. セル領域でクリップし、対角線がセル外へはみ出さないようにする
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();

  // 3. 45度対角線（傾き+1 ＝ 左上→右下方向）を3px間隔で描画する。
  //    各線は (x+offset, y) を始点、(x+offset+size, y+size) を終点とし、
  //    offset を -size〜size の範囲で動かすことでセル全体を覆う。
  ctx.strokeStyle = HATCH_LINE_COLOR;
  ctx.lineWidth = HATCH_LINE_WIDTH;
  for (let offset = -size; offset <= size; offset += HATCH_SPACING) {
    ctx.beginPath();
    ctx.moveTo(x + offset, y);
    ctx.lineTo(x + offset + size, y + size);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * 図案の各セル（ビーズ色 or 未配置ハッチング）を描画する。
 * @param {CanvasRenderingContext2D} ctx - Canvas 2Dコンテキスト
 * @param {PatternGrid} pattern - 図案データ
 * @param {number} cellSize - 実効セルサイズ（px）
 */
function drawCells(ctx, pattern, cellSize) {
  const { width, height, cells } = pattern;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const x = col * cellSize;
      const y = row * cellSize;
      const cell = cells?.[row]?.[col] ?? null;

      if (cell == null) {
        // 未配置セル: ハッチング描画（要件9.6）
        renderHatchedCell(ctx, x, y, cellSize);
      } else {
        // ビーズセル: 対応色で塗りつぶし（要件4.5 / 5）
        ctx.fillStyle = beadColorToCss(cell);
        ctx.fillRect(x, y, cellSize, cellSize);
      }
    }
  }
}

/**
 * セル境界線（細いグリッド線 1px / #ccc）を描画する（要件5.2）。
 * @param {CanvasRenderingContext2D} ctx - Canvas 2Dコンテキスト
 * @param {number} width - 横セル数
 * @param {number} height - 縦セル数
 * @param {number} cellSize - 実効セルサイズ（px）
 */
function drawCellBorders(ctx, width, height, cellSize) {
  const totalWidth = width * cellSize;
  const totalHeight = height * cellSize;

  ctx.strokeStyle = CELL_BORDER_COLOR;
  ctx.lineWidth = CELL_BORDER_WIDTH;
  ctx.beginPath();

  // 縦線（各列の境界）
  for (let col = 0; col <= width; col++) {
    const x = col * cellSize;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, totalHeight);
  }
  // 横線（各行の境界）
  for (let row = 0; row <= height; row++) {
    const y = row * cellSize;
    ctx.moveTo(0, y);
    ctx.lineTo(totalWidth, y);
  }

  ctx.stroke();
}

/**
 * プレート境界線（太いグリッド線 2px / #333）を描画する（要件5.1）。
 * ビーズタイプに応じたペグ数（perler=29 / nano=28）ごと、および図案の外周に線を引く。
 * @param {CanvasRenderingContext2D} ctx - Canvas 2Dコンテキスト
 * @param {PatternGrid} pattern - 図案データ（beadType・width・height を参照）
 * @param {number} cellSize - 実効セルサイズ（px）
 */
function drawPlateBorders(ctx, pattern, cellSize) {
  const { width, height } = pattern;
  const pegCount = getPegCount(pattern.beadType);
  const totalWidth = width * cellSize;
  const totalHeight = height * cellSize;

  ctx.strokeStyle = PLATE_BORDER_COLOR;
  ctx.lineWidth = PLATE_BORDER_WIDTH;
  ctx.beginPath();

  // 縦のプレート境界線（ペグ数ごと）
  for (let col = 0; col <= width; col += pegCount) {
    const x = col * cellSize;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, totalHeight);
  }
  // 右端がペグ数の倍数でない場合は外周線を補う
  if (width % pegCount !== 0) {
    ctx.moveTo(totalWidth, 0);
    ctx.lineTo(totalWidth, totalHeight);
  }

  // 横のプレート境界線（ペグ数ごと）
  for (let row = 0; row <= height; row += pegCount) {
    const y = row * cellSize;
    ctx.moveTo(0, y);
    ctx.lineTo(totalWidth, y);
  }
  // 下端がペグ数の倍数でない場合は外周線を補う
  if (height % pegCount !== 0) {
    ctx.moveTo(0, totalHeight);
    ctx.lineTo(totalWidth, totalHeight);
  }

  ctx.stroke();
}

/**
 * 図案を Canvas に描画する。
 *
 * 描画順序:
 *   1. Canvas 寸法をズーム反映で動的設定し、全体をクリア
 *   2. 各セル（ビーズ色 or 未配置ハッチング）を塗る
 *   3. セル境界線（showGrid 時）
 *   4. プレート境界線（showPlateBorders 時）
 *
 * @param {HTMLCanvasElement} canvas - 描画先Canvas
 * @param {PatternGrid} pattern - 図案データ
 * @param {RenderOptions} [options] - 描画オプション
 */
export function renderPattern(canvas, pattern, options = {}) {
  if (!canvas || !pattern) return;

  const {
    cellSize = DEFAULT_CELL_SIZE,
    zoom = DEFAULT_ZOOM,
    showGrid = true,
    showPlateBorders = true,
  } = options;

  const effectiveCellSize = computeEffectiveCellSize(cellSize, zoom);
  const { width: canvasWidth, height: canvasHeight } = computeCanvasDimensions(
    pattern,
    cellSize,
    zoom,
  );

  // Canvas 自体のサイズをズーム反映で動的に設定する（要件5.3）
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // 全体をクリア
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // 1. セル本体（ビーズ色 / 未配置ハッチング）
  drawCells(ctx, pattern, effectiveCellSize);

  // 2. セル境界線（細い 1px / #ccc）
  if (showGrid) {
    drawCellBorders(ctx, pattern.width, pattern.height, effectiveCellSize);
  }

  // 3. プレート境界線（太い 2px / #333、ペグ数ごと）
  if (showPlateBorders) {
    drawPlateBorders(ctx, pattern, effectiveCellSize);
  }
}
