// =============================================================================
// おすすめサイズ計算（recommendedSizes.js）
// -----------------------------------------------------------------------------
// アップロードされた画像の解像度とアスペクト比から、再現に適したプレート構成
// （推奨サイズ）を算出する。1x1〜10x10 の全構成を候補として列挙し、元画像の
// アスペクト比に最も近い順（差分の昇順）に並べて上位3件を返す。
//
// 設計書「7. おすすめサイズ計算」のアルゴリズムに準拠する。
// Requirements: 8.1, 8.2, 8.4, 8.5
//
// 【このファイルの分担について】
//   純関数 `calculateRecommendedSizes`（タスク13.1）と、その結果を表示・選択する
//   UI `initRecommendedSizesUI`（タスク15.4）の双方を本ファイルに収める。
//   純粋ロジックとDOM描画を分離し、計算ロジックを単体でテスト可能に保つ。
// =============================================================================

import { BEAD_CONFIG } from '../data/beadConfig.js';

/**
 * @typedef {Object} RecommendedSize
 * @property {number} cols - 横プレート数（1-10）
 * @property {number} rows - 縦プレート数（1-10）
 * @property {number} totalBeads - 総ビーズ数（(cols×pegCount)×(rows×pegCount)）
 * @property {number} scaleRatio - 画像の縮小率（0-1、1=縮小なし）
 * @property {number} aspectDiff - 元画像アスペクト比との差分（0以上、小さいほど近い）
 */

/**
 * プレート構成（cols×rows）1件分の推奨サイズ情報を組み立てる（内部ヘルパー）。
 *
 * - 候補アスペクト比は (cols×pegCount)/(rows×pegCount) = cols/rows と等しい。
 * - 縮小率 scaleRatio は、アスペクト比を維持して図案内に画像を収める（フィット）
 *   ときの倍率 min(targetWidth/imageWidth, targetHeight/imageHeight) とし、
 *   拡大はしない方針で上限1にクランプして 0-1 の範囲に収める。
 *
 * @param {number} cols - 横プレート数
 * @param {number} rows - 縦プレート数
 * @param {number} imageWidth - 画像の幅（px、正の有限数）
 * @param {number} imageHeight - 画像の高さ（px、正の有限数）
 * @param {number} pegCount - 1プレートあたりのペグ数（パーラー29 / ナノ28）
 * @param {number} imageAspect - 画像のアスペクト比（imageWidth / imageHeight）
 * @returns {RecommendedSize}
 */
function buildRecommendedSize(cols, rows, imageWidth, imageHeight, pegCount, imageAspect) {
  const targetWidth = cols * pegCount;
  const targetHeight = rows * pegCount;

  // 候補のアスペクト比。pegCount は分子分母で打ち消されるため cols/rows に等しい。
  const candidateAspect = cols / rows;
  const aspectDiff = Math.abs(candidateAspect - imageAspect);

  const totalBeads = targetWidth * targetHeight;

  // アスペクト比維持で図案内に収めるときの倍率。拡大はしないので上限1にクランプ。
  const scaleRatio = Math.min(targetWidth / imageWidth, targetHeight / imageHeight, 1);

  return { cols, rows, totalBeads, scaleRatio, aspectDiff };
}

/**
 * 画像の解像度とアスペクト比から推奨プレート構成を計算する（純粋関数）。
 *
 * アルゴリズム（設計書「7. おすすめサイズ計算」）:
 *   1. 画像のアスペクト比 imageAspect = imageWidth / imageHeight を算出する。
 *   2. 1x1〜10x10 の全プレート構成を候補として列挙する。
 *   3. 各候補について、候補アスペクト比（cols/rows）との差分 |candidateAspect - imageAspect|
 *      を計算する。
 *   4. アスペクト比差分の昇順でソートする（同差分は総ビーズ数の昇順で安定化）。
 *   5. 上位3件を返す（要件8.1, 8.4）。
 *
 * 特例（要件8.5）:
 *   画像の幅または高さがペグ数以下で、1x1プレートで十分な場合は 1x1 のみを返す。
 *
 * 入力が不正（0以下・非有限）な場合は空配列を返す（呼び出し側で安全に扱えるようにする）。
 *
 * @param {number} imageWidth - 画像の幅（px）
 * @param {number} imageHeight - 画像の高さ（px）
 * @param {number} pegCount - 1プレートあたりのペグ数（パーラー29 / ナノ28）
 * @returns {RecommendedSize[]} 推奨サイズ一覧（最大3件、アスペクト差分の昇順）
 */
export function calculateRecommendedSizes(imageWidth, imageHeight, pegCount) {
  // --- 入力バリデーション ---------------------------------------------------
  // 0除算（imageHeight=0）や NaN/Infinity の混入でソートが壊れるのを防ぐ。
  if (
    !Number.isFinite(imageWidth) ||
    !Number.isFinite(imageHeight) ||
    !Number.isFinite(pegCount) ||
    imageWidth <= 0 ||
    imageHeight <= 0 ||
    pegCount <= 0
  ) {
    return [];
  }

  const imageAspect = imageWidth / imageHeight;

  // --- 要件8.5: 低解像度画像は 1x1 のみ ------------------------------------
  // 幅または高さがペグ数以下の場合、1x1プレート（pegCount×pegCount）で十分なため、
  // 推奨は 1x1 のみとする。
  if (imageWidth <= pegCount || imageHeight <= pegCount) {
    return [buildRecommendedSize(1, 1, imageWidth, imageHeight, pegCount, imageAspect)];
  }

  // --- 1x1〜10x10 の全構成を候補列挙 ---------------------------------------
  const candidates = [];
  for (let cols = 1; cols <= 10; cols += 1) {
    for (let rows = 1; rows <= 10; rows += 1) {
      candidates.push(
        buildRecommendedSize(cols, rows, imageWidth, imageHeight, pegCount, imageAspect),
      );
    }
  }

  // --- アスペクト比差分の昇順でソート（要件8.4） ----------------------------
  // 差分が同じ候補（例: 1x1 と 2x2、1x2 と 2x4 など約分で同比になる構成）は、
  // 総ビーズ数の昇順を第2キーにして順序を一意・予測可能にする。
  candidates.sort((a, b) => {
    if (a.aspectDiff !== b.aspectDiff) {
      return a.aspectDiff - b.aspectDiff;
    }
    return a.totalBeads - b.totalBeads;
  });

  // --- 上位3件を返す（要件8.1） --------------------------------------------
  return candidates.slice(0, 3);
}

// =============================================================================
// おすすめサイズ表示・選択UI（initRecommendedSizesUI） — タスク15.4
// -----------------------------------------------------------------------------
// calculateRecommendedSizes の結果（最大3件）を一覧表示し、ユーザーが選択した
// プレート構成を state に反映する。図案の再生成やプレート構成入力欄の同期は、
// 呼び出し側（main.js / 17.1）に onSizeSelected コールバックで委ねる。
//
// Requirements:
//   - 8.1 : 画像アップロード時、解像度と縦横比に基づく推奨構成を最大3件表示する
//   - 8.2 : 各推奨サイズに総ビーズ数と画像の縮小率を併せて表示する
//   - 8.3 : 推奨サイズ選択時、そのプレート構成をプレート設定（state）に反映する
//
// 本UIは手動テスト対象（design.md「テスト戦略」）。状態への副作用は
// state.setPlateConfig のみとし、再描画・入力欄同期は呼び出し側へ委譲する。
// =============================================================================

/**
 * 画像が未アップロードのときに表示する案内文（要件8.1）。
 * @type {string}
 */
const NO_IMAGE_MESSAGE = '画像をアップロードすると、おすすめのプレート構成が表示されます。';

/**
 * 画像はあるが推奨を算出できなかったときの案内文。
 * （解像度が取得できない等の異常時。クラッシュさせず、空表示の代わりに表示する）
 * @type {string}
 */
const NO_RESULT_MESSAGE = 'おすすめサイズを計算できませんでした。';

/**
 * 縮小率（scaleRatio: 0-1）をパーセント文字列に整形する（要件8.2）。
 * 端数は小数1桁に丸め、不要な末尾の .0 は省く（例: 0.452 → "45.2%"、1 → "100%"）。
 *
 * @param {number} scaleRatio - 画像の縮小率（0-1、1=縮小なし）
 * @returns {string} パーセント表記の文字列
 */
function formatScaleRatioPercent(scaleRatio) {
  const percent = Number((scaleRatio * 100).toFixed(1));
  return `${percent}%`;
}

/**
 * state.uploadedImage から画像の実寸（naturalWidth/Height）を取得する。
 * 取得できない場合は 0 を返し、呼び出し側で「推奨なし」として安全に扱えるようにする。
 *
 * @param {HTMLImageElement|null|undefined} image - アップロード画像
 * @returns {{ width: number, height: number }} 画像の幅・高さ（px）
 */
function readImageSize(image) {
  if (!image) {
    return { width: 0, height: 0 };
  }
  // 実寸（naturalWidth/Height）を優先し、無ければ表示サイズ（width/height）で代替する。
  const width = image.naturalWidth || image.width || 0;
  const height = image.naturalHeight || image.height || 0;
  return { width, height };
}

/**
 * 案内メッセージ（画像なし／推奨なし）の段落要素を生成する。
 * @param {string} message - 表示文言
 * @returns {HTMLParagraphElement}
 */
function buildMessage(message) {
  const p = document.createElement('p');
  p.className = 'recommended-sizes__message';
  p.textContent = message;
  return p;
}

/**
 * 推奨サイズ1件分の選択ボタン（li > button）を生成する。
 *
 * ボタン内には以下を表示する（要件8.2）:
 *   - プレート構成（例: 2×1。横×縦の順で plateConfig.js の表示と統一）
 *   - 総ビーズ数（totalBeads、桁区切り）
 *   - 画像の縮小率（scaleRatio をパーセント表記）
 *
 * 現在の plateConfig と一致する場合は選択中として aria-pressed を立てる。
 *
 * @param {RecommendedSize} size - 推奨サイズ1件
 * @param {boolean} isSelected - 現在のプレート構成と一致するか
 * @param {function(RecommendedSize): void} onClick - クリック時ハンドラ
 * @returns {HTMLLIElement}
 */
function buildSizeItem(size, isSelected, onClick) {
  const item = document.createElement('li');
  item.className = 'recommended-sizes__item';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'recommended-sizes__button';
  if (isSelected) {
    button.classList.add('recommended-sizes__button--selected');
  }
  // トグル的な選択状態を支援技術へ伝える。
  button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');

  // プレート構成（例: 2×1）。
  const config = document.createElement('span');
  config.className = 'recommended-sizes__config';
  config.textContent = `${size.cols}×${size.rows}`;

  // 総ビーズ数（要件8.2）。桁区切りで読みやすくする。
  const beads = document.createElement('span');
  beads.className = 'recommended-sizes__beads';
  beads.textContent = `総ビーズ数: ${size.totalBeads.toLocaleString()}個`;

  // 画像の縮小率（要件8.2）。
  const scale = document.createElement('span');
  scale.className = 'recommended-sizes__scale';
  scale.textContent = `縮小率: ${formatScaleRatioPercent(size.scaleRatio)}`;

  button.appendChild(config);
  button.appendChild(beads);
  button.appendChild(scale);
  button.addEventListener('click', () => onClick(size));

  item.appendChild(button);
  return item;
}

/**
 * おすすめサイズ表示・選択UIを初期化してコンテナに描画する（タスク15.4）。
 *
 * 表示内容は state.uploadedImage（実寸）と state.beadType（→ pegCount）から
 * calculateRecommendedSizes で算出する。画像が無い場合や推奨が0件の場合は
 * 案内メッセージを表示し、クラッシュさせない（要件8.1）。
 *
 * 推奨サイズのボタンをクリックすると、その構成を state.setPlateConfig に反映し
 * （要件8.3）、選択中表示を更新したうえで onSizeSelected を発火する。図案の
 * 再生成やプレート構成入力欄（plateConfig.js）の同期は呼び出し側に委ねる。
 *
 * 画像のアップロードやビーズタイプの変更で表示を更新したいときは、返り値の
 * refresh() を呼ぶ（main.js / 17.1 が結線する）。
 *
 * @param {HTMLElement|null} container - UIの描画先コンテナ要素
 * @param {object} state - アプリケーション状態ストア（createAppState の戻り値）
 * @param {object} [options] - オプション
 * @param {function(RecommendedSize): void} [options.onSizeSelected]
 *   - 推奨サイズ選択（state反映後）に呼ばれるコールバック。図案再生成・入力欄同期の起点。
 * @returns {{ refresh: function(): void, destroy: function(): void }}
 *   表示更新（refresh）と後始末（destroy）を行うハンドル
 */
export function initRecommendedSizesUI(container, state, options = {}) {
  // コンテナが無い場合は no-op ハンドルを返し、呼び出し側がクラッシュしないようにする。
  if (!container) {
    return {
      refresh() {},
      destroy() {},
    };
  }
  if (!state || typeof state.setPlateConfig !== 'function') {
    throw new TypeError('initRecommendedSizesUI: 有効な state ストアが必要です');
  }

  const { onSizeSelected } = options;

  /**
   * 推奨サイズ選択時の処理（要件8.3）。
   *   1. state にプレート構成を反映する（setPlateConfig）。
   *   2. 選択中表示を更新するため再描画する。
   *   3. onSizeSelected を発火し、図案再生成・入力欄同期を呼び出し側に委ねる。
   * @param {RecommendedSize} size - 選択された推奨サイズ
   */
  function handleSelect(size) {
    state.setPlateConfig({ cols: size.cols, rows: size.rows });
    // プレート構成が変わったので選択中ハイライトを更新する。
    render();
    if (typeof onSizeSelected === 'function') {
      onSizeSelected({ ...size });
    }
  }

  /**
   * 現在の state に基づいてUI全体を描画する。
   *   - 画像なし（実寸が取れない）→ 案内メッセージ（要件8.1）
   *   - 推奨0件 → 計算不可メッセージ
   *   - 推奨あり → 最大3件の選択ボタンを並べる（要件8.1, 8.2）
   */
  function render() {
    container.innerHTML = '';

    const root = document.createElement('div');
    root.className = 'recommended-sizes';

    const heading = document.createElement('div');
    heading.className = 'recommended-sizes__heading';
    heading.textContent = 'おすすめサイズ';
    root.appendChild(heading);

    const { width, height } = readImageSize(state.uploadedImage);

    // 画像が無い（実寸が取得できない）場合は案内のみ表示する（要件8.1）。
    if (width <= 0 || height <= 0) {
      root.appendChild(buildMessage(NO_IMAGE_MESSAGE));
      container.appendChild(root);
      return;
    }

    // ペグ数は選択中ビーズタイプの BEAD_CONFIG から取得する。
    // 未知タイプにも備え、安全側に倒してパーラービーズの値にフォールバックする。
    const beadConfig = BEAD_CONFIG[state.beadType] || BEAD_CONFIG.perler;
    const sizes = calculateRecommendedSizes(width, height, beadConfig.pegCount);

    // 推奨が0件（不正な実寸等）の場合は計算不可メッセージを表示する。
    if (sizes.length === 0) {
      root.appendChild(buildMessage(NO_RESULT_MESSAGE));
      container.appendChild(root);
      return;
    }

    // 現在のプレート構成（選択中ハイライト用）。
    const current = state.plateConfig || { cols: 0, rows: 0 };

    const list = document.createElement('ul');
    list.className = 'recommended-sizes__list';

    // calculateRecommendedSizes は最大3件を返すため、そのまま全件描画する（要件8.1）。
    for (const size of sizes) {
      const isSelected = size.cols === current.cols && size.rows === current.rows;
      list.appendChild(buildSizeItem(size, isSelected, handleSelect));
    }

    root.appendChild(list);
    container.appendChild(root);
  }

  // 初期描画。
  render();

  return {
    /**
     * 外部要因（画像アップロード・ビーズタイプ変更・プレート構成変更）で
     * 表示を更新したいときに呼ぶ。現在の state に基づいて再描画する。
     */
    refresh() {
      render();
    },

    /**
     * UIを破棄する（コンテナを空にする）。ボタンのイベントリスナーは
     * 要素破棄に伴い解放される。
     */
    destroy() {
      container.innerHTML = '';
    },
  };
}
