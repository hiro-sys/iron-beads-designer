// =============================================================================
// 画像処理モジュール（imageProcessor.js）
// -----------------------------------------------------------------------------
// アップロードされた画像を、指定したビーズグリッド寸法（targetWidth × targetHeight）
// にリサイズして ImageData を返す。
// リサイズ方式（補間方法）とフィットモード（アスペクト比の合わせ方）を適用する。
//
// 設計書「3. 画像処理モジュール（imageProcessor.js）」に対応。
// Requirements: 4.1, 10.2, 10.3, 10.5, 10.6, 10.7
//
// 重要: いずれのフィットモードでも、出力 ImageData の寸法は常に
//       targetWidth × targetHeight で一定。フィットモードは「画像をどう収めるか」
//       を変えるだけで、グリッド寸法そのものは変えない。
//       contain のみ、収まらない領域が透明（alpha=0）＝未配置として表現される。
// =============================================================================

/**
 * @typedef {Object} ResizeOptions
 * @property {'smooth' | 'sharp'} [resizeMethod] - リサイズ方式（既定: 'smooth'、要件10）
 * @property {'stretch' | 'contain' | 'cover'} [fitMode] - フィットモード（既定: 'contain'、要件10）
 */

/**
 * フィットモードに応じた描画先矩形（drawImage の dx/dy/dWidth/dHeight）を計算する。
 *
 * - stretch: アスペクト比を無視し、ターゲット全体を埋める（要件10.5）
 * - contain: アスペクト比を維持し縮小（scale=min）、中央寄せ。余白は透明のまま残る（要件10.6）
 * - cover:   アスペクト比を維持し拡大（scale=max）、中央寄せ。はみ出し領域は
 *            描画矩形がターゲット外に出ることで自然にクリップされる（要件10.7）
 *
 * @param {number} sourceWidth - 元画像の幅
 * @param {number} sourceHeight - 元画像の高さ
 * @param {number} targetWidth - 目標幅
 * @param {number} targetHeight - 目標高さ
 * @param {'stretch' | 'contain' | 'cover'} fitMode - フィットモード
 * @returns {{dx: number, dy: number, dWidth: number, dHeight: number}} 描画先矩形
 */
function computeDestinationRect(sourceWidth, sourceHeight, targetWidth, targetHeight, fitMode) {
  // stretch: アスペクト比を無視してターゲット全体を埋める
  if (fitMode === 'stretch') {
    return { dx: 0, dy: 0, dWidth: targetWidth, dHeight: targetHeight };
  }

  // contain / cover はアスペクト比を維持するため、軸ごとの拡縮率からスケール係数を決める
  const scaleX = targetWidth / sourceWidth;
  const scaleY = targetHeight / sourceHeight;

  // contain: 収まる方（小さいスケール=min）／ cover: 埋める方（大きいスケール=max）
  const scale = fitMode === 'cover'
    ? Math.max(scaleX, scaleY)
    : Math.min(scaleX, scaleY);

  const dWidth = sourceWidth * scale;
  const dHeight = sourceHeight * scale;

  // 中央寄せで配置する。
  // contain では余白（レターボックス）が透明ピクセルのまま残り、
  // cover では負のオフセットによりはみ出した領域がターゲット外へ出てクリップされる。
  const dx = (targetWidth - dWidth) / 2;
  const dy = (targetHeight - dHeight) / 2;

  return { dx, dy, dWidth, dHeight };
}

/**
 * 画像をCanvas経由で指定サイズにリサイズし ImageData を返す。
 * リサイズ方式（補間方法）とフィットモード（アスペクト比の合わせ方）を適用する。
 *
 * @param {HTMLImageElement} image - アップロードされた画像
 * @param {number} targetWidth - 目標幅（ビーズ数 = cols × pegCount）
 * @param {number} targetHeight - 目標高さ（ビーズ数 = rows × pegCount）
 * @param {ResizeOptions} [options] - リサイズ方式・フィットモード
 * @returns {ImageData} リサイズ済み画像データ（寸法は常に targetWidth × targetHeight）
 */
export function resizeImage(image, targetWidth, targetHeight, options = {}) {
  const { resizeMethod = 'smooth', fitMode = 'contain' } = options;

  // オフスクリーンCanvasを目標寸法で生成する
  // （テストでは canvasMock が getContext を差し替える）
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');

  // 描画前に必ず全体を透明（alpha=0）でクリアする。
  // これにより contain の余白や未描画領域が透明ピクセルとして残り、
  // 下流（LocalConversionStrategy）で未配置セルになる。
  ctx.clearRect(0, 0, targetWidth, targetHeight);

  // リサイズ方式に応じた補間制御
  if (resizeMethod === 'sharp') {
    // くっきり: 最近傍補間でエッジの色を保持（ドット絵向き、要件10.3）
    ctx.imageSmoothingEnabled = false;
  } else {
    // なめらか: 高品質スムージングでピクセル色を平均化（写真向き、要件10.2）
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }

  // 元画像の寸法（naturalWidth/Height を優先し、無ければ width/height にフォールバック）
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;

  // フィットモードに応じた描画先矩形を決定して描画する
  const { dx, dy, dWidth, dHeight } = computeDestinationRect(
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
    fitMode,
  );
  ctx.drawImage(image, dx, dy, dWidth, dHeight);

  // ピクセルデータを取得して返す（寸法は常に targetWidth × targetHeight）
  return ctx.getImageData(0, 0, targetWidth, targetHeight);
}
