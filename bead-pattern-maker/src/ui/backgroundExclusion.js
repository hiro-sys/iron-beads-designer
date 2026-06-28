// =============================================================================
// 背景除外UI（backgroundExclusion.js）
// -----------------------------------------------------------------------------
// 背景除外機能の設定UIを提供するコンポーネント。
//   - ON/OFFトグル（初期OFF、要件9.8）
//   - ON時の背景色 自動検出（四隅サンプリング）＋カラースウォッチ表示（要件9.1）
//   - ΔE閾値スライダー（range、0〜50、初期10、要件9.4）
//   - 除外セル数の表示（例: 「除外セル: 156個 (18.5%)」）
//   - 画像プレビュー上のクリックによる背景色の手動選択（要件9.2）
//
// 設定（トグル／閾値／手動色選択）が変わるたびに onSettingsChange を発火し、
// 呼び出し側（main.js / タスク17.1）に図案の再生成・再描画を促す（要件9.9）。
//
// 設計書「8. 背景除外UIコンポーネント（backgroundExclusion.js）」に対応。
// Requirements: 9.1, 9.2, 9.4, 9.8, 9.9
//
// 【色空間の注意（重要・要件9.2）】
//   本UIが扱う背景色は、自動検出（detectBackgroundColor）／手動クリック
//   （pickColorFromPreview）のいずれも「生ピクセル色（RAW RGB）」である。
//   背景判定で比較する「ビーズ色空間」とは異なるため、背景判定の前に
//   findClosestColor で有効パレットの最近色（背景ビーズ色）へ変換する必要がある。
//   その変換は変換エンジン側（LocalConversionStrategy）の責務であり、本UIでは
//   生ピクセル色のまま state.backgroundExclusion.color に保持する。
//   （詳細は design.md「6. 背景検出モジュール」の色空間整合性を参照）
//
// 【このファイルの分担について】
//   本コンポーネントは「背景除外の設定UIと状態反映」に責務を限定する。実際の
//   背景色 → ビーズ色変換とセルの未配置化（applyBackgroundExclusion）は変換
//   エンジン側が担う。本UIは設定を state に書き込み、onSettingsChange で再生成を
//   促し、生成後の図案（state.pattern）から除外セル数を集計して表示する。
//
//   UI各モジュールは手動テスト対象（design.md「テスト戦略」）のため、本タスクは
//   実装のみとし自動テストは作成しない。
// =============================================================================

import { detectBackgroundColor } from '../engine/backgroundDetector.js';

/** @typedef {{ r: number, g: number, b: number }} RgbColor */

/** ΔE閾値スライダーの範囲（要件9.4）。 */
const THRESHOLD_MIN = 0;
const THRESHOLD_MAX = 50;

/** label と input を確実に関連付けるための一意ID採番カウンタ。 */
let instanceCounter = 0;

/**
 * 図案グリッドから「背景除外によって未配置(null)になったセル数」を集計する純関数。
 *
 * 集計方針:
 *   - PatternGrid が `originalCells`（背景除外前）を持つ場合は、
 *     「除外前は非null だが 除外後（cells）は null」になったセルを背景除外による
 *     除外セルとして数える。これにより、透明ピクセルや contain のフィット余白
 *     由来の null（背景除外とは無関係）はカウントから除外できる。
 *   - `originalCells` が無い場合は、`cells` 内の null セル数をフォールバックとして
 *     数える。
 *   - 割合（percent）は図案全体のセル数（width × height 相当＝走査した全セル数）に
 *     対する除外セルの百分率。
 *
 * @param {object|null|undefined} pattern - 図案グリッド（PatternGrid）
 * @returns {{ excluded: number, total: number, percent: number }}
 *          excluded=除外セル数 / total=全セル数 / percent=除外割合（0-100）
 */
export function countExcludedCells(pattern) {
  if (!pattern || !Array.isArray(pattern.cells)) {
    return { excluded: 0, total: 0, percent: 0 };
  }

  const cells = pattern.cells;
  const originalCells = Array.isArray(pattern.originalCells) ? pattern.originalCells : null;

  let excluded = 0;
  let total = 0;

  for (let row = 0; row < cells.length; row += 1) {
    const cellRow = cells[row];
    if (!Array.isArray(cellRow)) {
      continue;
    }
    const origRow = originalCells ? originalCells[row] : null;

    for (let col = 0; col < cellRow.length; col += 1) {
      total += 1;
      const cell = cellRow[col];
      const isNull = cell === null || cell === undefined;

      if (originalCells) {
        // 背景除外前は非null、除外後は null になったセルのみを「背景除外」として数える。
        const orig = origRow ? origRow[col] : undefined;
        const origPlaced = orig !== null && orig !== undefined;
        if (origPlaced && isNull) {
          excluded += 1;
        }
      } else if (isNull) {
        // originalCells が無い場合のフォールバック: null セルを数える。
        excluded += 1;
      }
    }
  }

  const percent = total > 0 ? (excluded / total) * 100 : 0;
  return { excluded, total, percent };
}

/**
 * 画像プレビューのクリックイベントから、クリック位置の「生ピクセル色」を取得する。
 *
 * 【色空間の注意（要件9.2）】
 *   返すのは Canvas 上のクリック位置の生ピクセル色（RAW RGB, { r, g, b }）である。
 *   背景判定で用いるビーズ色空間とは異なるため、背景判定の前に findClosestColor で
 *   有効パレットの最近色（背景ビーズ色）へ変換する必要がある。その変換は変換エンジン
 *   側（LocalConversionStrategy）の責務であり、本関数では行わない。
 *
 * 座標マッピング:
 *   Canvas の表示サイズ（getBoundingClientRect）と内部解像度（canvas.width/height）の
 *   比を補正し、クリック位置を内部ピクセル座標へ変換してから getImageData で 1px を読む。
 *   getBoundingClientRect / clientX・clientY が使えない環境では offsetX/offsetY に
 *   フォールバックする。
 *
 * 失敗時の扱い（要件9.2）:
 *   Canvas やコンテキストが取得できない、座標が画像範囲外、getImageData が失敗（例:
 *   クロスオリジンで tainted）した場合は null を返す。呼び出し側は null のとき
 *   「現在の背景色設定を維持」する（＝色を上書きしない）。
 *
 * @param {HTMLCanvasElement} previewCanvas - プレビュー画像を描画した Canvas
 * @param {MouseEvent} event - クリックイベント
 * @returns {RgbColor | null} クリック位置の生ピクセル色 { r, g, b }。取得失敗時は null
 */
export function pickColorFromPreview(previewCanvas, event) {
  // Canvas と 2D コンテキストのガード。
  if (!previewCanvas || typeof previewCanvas.getContext !== 'function' || !event) {
    return null;
  }

  let ctx;
  try {
    ctx = previewCanvas.getContext('2d');
  } catch (_error) {
    return null;
  }
  if (!ctx) {
    return null;
  }

  const internalWidth = previewCanvas.width;
  const internalHeight = previewCanvas.height;
  if (!internalWidth || !internalHeight) {
    return null;
  }

  // クリック位置を Canvas の内部解像度座標へ変換する。
  let canvasX;
  let canvasY;
  const rect =
    typeof previewCanvas.getBoundingClientRect === 'function'
      ? previewCanvas.getBoundingClientRect()
      : null;

  if (
    rect &&
    rect.width > 0 &&
    rect.height > 0 &&
    typeof event.clientX === 'number' &&
    typeof event.clientY === 'number'
  ) {
    // 表示サイズと内部解像度の比でスケールする（CSSで拡縮されていても正しく対応）。
    const scaleX = internalWidth / rect.width;
    const scaleY = internalHeight / rect.height;
    canvasX = (event.clientX - rect.left) * scaleX;
    canvasY = (event.clientY - rect.top) * scaleY;
  } else if (typeof event.offsetX === 'number' && typeof event.offsetY === 'number') {
    // フォールバック: offsetX/Y は対象要素のパディングボックス基準の座標。
    canvasX = event.offsetX;
    canvasY = event.offsetY;
  } else {
    return null;
  }

  const x = Math.floor(canvasX);
  const y = Math.floor(canvasY);

  // 範囲外クリックは取得失敗として扱う（現在設定を維持・要件9.2）。
  if (x < 0 || y < 0 || x >= internalWidth || y >= internalHeight) {
    return null;
  }

  try {
    const data = ctx.getImageData(x, y, 1, 1).data;
    return { r: data[0], g: data[1], b: data[2] };
  } catch (_error) {
    // getImageData は tainted canvas 等で例外を投げうる。取得失敗として null を返す。
    return null;
  }
}

/**
 * HTMLImageElement をオフスクリーン Canvas に等倍で描画し、ImageData を取得する。
 * 背景色の自動検出（detectBackgroundColor）に渡すための補助。
 *
 * 画像が未ロード（naturalWidth/Height が 0）や getImageData 失敗（tainted 等）の
 * 場合は null を返し、呼び出し側は「自動検出結果なし」として扱う（手動選択を促す）。
 *
 * @param {HTMLImageElement|null|undefined} image - 元画像
 * @returns {{ imageData: ImageData, width: number, height: number } | null}
 */
function extractImageData(image) {
  if (!image) {
    return null;
  }
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) {
    return null;
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }
    ctx.drawImage(image, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    return { imageData, width, height };
  } catch (_error) {
    return null;
  }
}

/**
 * 現在アップロードされている画像から背景色を自動検出する（要件9.1）。
 * 画像が無い／検出不能な場合は null を返す。
 *
 * @param {object} state - アプリケーション状態ストア
 * @returns {RgbColor | null} 検出された背景色（生ピクセル色）。失敗時は null
 */
function detectBackgroundFromState(state) {
  const extracted = extractImageData(state.uploadedImage);
  if (!extracted) {
    return null;
  }
  return detectBackgroundColor(extracted.imageData, extracted.width, extracted.height);
}

/**
 * 背景除外UIを初期化し、指定コンテナに描画する。
 *
 * 初期状態は state.backgroundExclusion（初期 enabled=false, threshold=10）に従う
 * （要件9.8）。トグルをONにすると現在の画像から背景色を自動検出してスウォッチを
 * 表示し（要件9.1）、ΔE閾値スライダー（0〜50）で閾値を調整できる（要件9.4）。
 * トグル／閾値／手動色選択の変更時に onSettingsChange を発火し、呼び出し側に図案の
 * 再生成・再描画を促す（要件9.9）。生成後の図案（state.pattern）から背景除外で
 * 未配置になったセル数を集計して表示する。
 *
 * @param {HTMLElement} container - UIの描画先コンテナ要素
 * @param {object} state - アプリケーション状態ストア（state.js の createAppState の戻り値）
 * @param {object} [options] - オプション
 * @param {function(object): void} [options.onSettingsChange] - 背景除外設定が変更された
 *        ときに呼ばれるコールバック。引数は現在の backgroundExclusion 設定のスナップ
 *        ショット。main.js 側で図案の再生成・再描画の起点に使う。
 * @returns {{
 *   refresh: function(): void,
 *   pickFromPreview: function(HTMLCanvasElement, MouseEvent): (RgbColor|null),
 *   destroy: function(): void
 * }} 外部から再同期（refresh）・プレビュークリックでの手動選択（pickFromPreview）・
 *    破棄（destroy）を行うコントローラ
 */
export function initBackgroundExclusionUI(container, state, options = {}) {
  if (!container) {
    throw new TypeError('initBackgroundExclusionUI: container 要素が必要です');
  }
  if (!state || typeof state.setBackgroundExclusion !== 'function') {
    throw new TypeError('initBackgroundExclusionUI: 有効な state ストアが必要です');
  }

  const { onSettingsChange } = options;

  instanceCounter += 1;
  const idBase = `background-exclusion-${instanceCounter}`;
  const toggleId = `${idBase}-toggle`;
  const thresholdId = `${idBase}-threshold`;

  // --- DOM構築 -------------------------------------------------------------
  container.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'background-exclusion';

  // ヘッダー: 「背景除外」ラベル ＋ ON/OFFトグル（要件9.8）。
  const header = document.createElement('div');
  header.className = 'background-exclusion__header';

  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'background-exclusion__toggle-label';
  toggleLabel.setAttribute('for', toggleId);
  toggleLabel.textContent = '背景除外';

  const toggleInput = document.createElement('input');
  toggleInput.type = 'checkbox';
  toggleInput.id = toggleId;
  toggleInput.className = 'background-exclusion__toggle';

  header.appendChild(toggleLabel);
  header.appendChild(toggleInput);
  root.appendChild(header);

  // 詳細セクション（ONのときのみ表示）。
  const details = document.createElement('div');
  details.className = 'background-exclusion__details';

  // --- 背景色スウォッチ（要件9.1, 9.2） -----------------------------------
  const colorRow = document.createElement('div');
  colorRow.className = 'background-exclusion__color-row';

  const colorLabel = document.createElement('span');
  colorLabel.className = 'background-exclusion__color-label';
  colorLabel.textContent = '背景色:';

  // カラースウォッチ（背景色は動的設定。CSS未整備でも見えるよう最小スタイルを付与）。
  const swatch = document.createElement('span');
  swatch.className = 'background-exclusion__swatch';
  swatch.style.display = 'inline-block';
  swatch.style.width = '20px';
  swatch.style.height = '20px';
  swatch.style.border = '1px solid #999';
  swatch.style.verticalAlign = 'middle';
  swatch.setAttribute('aria-hidden', 'true');

  const swatchText = document.createElement('span');
  swatchText.className = 'background-exclusion__swatch-text';

  colorRow.appendChild(colorLabel);
  colorRow.appendChild(swatch);
  colorRow.appendChild(swatchText);
  details.appendChild(colorRow);

  // 手動選択のヒント（画像プレビューのクリックで背景色を変更できる・要件9.2）。
  const hint = document.createElement('p');
  hint.className = 'background-exclusion__hint';
  hint.textContent = '画像プレビューをクリックすると、その位置の色で背景色を変更できます。';
  details.appendChild(hint);

  // --- ΔE閾値スライダー（要件9.4） ----------------------------------------
  const thresholdRow = document.createElement('div');
  thresholdRow.className = 'background-exclusion__threshold-row';

  const thresholdLabel = document.createElement('label');
  thresholdLabel.className = 'background-exclusion__threshold-label';
  thresholdLabel.setAttribute('for', thresholdId);
  thresholdLabel.textContent = 'ΔE閾値:';

  const thresholdInput = document.createElement('input');
  thresholdInput.type = 'range';
  thresholdInput.id = thresholdId;
  thresholdInput.className = 'background-exclusion__threshold';
  thresholdInput.min = String(THRESHOLD_MIN);
  thresholdInput.max = String(THRESHOLD_MAX);
  thresholdInput.step = '1';

  // 現在の閾値を数値で併記する。
  const thresholdValue = document.createElement('span');
  thresholdValue.className = 'background-exclusion__threshold-value';

  thresholdRow.appendChild(thresholdLabel);
  thresholdRow.appendChild(thresholdInput);
  thresholdRow.appendChild(thresholdValue);
  details.appendChild(thresholdRow);

  // --- 除外セル数表示 ------------------------------------------------------
  const excludedCount = document.createElement('div');
  excludedCount.className = 'background-exclusion__excluded-count';
  details.appendChild(excludedCount);

  root.appendChild(details);
  container.appendChild(root);

  // --- 状態 → UI 同期 ------------------------------------------------------

  /**
   * スウォッチ（色見本）と説明テキストを現在の背景色設定に合わせて更新する。
   * @param {{color: RgbColor|null, autoDetected: boolean}} bg - 背景除外設定
   */
  function updateSwatch(bg) {
    if (bg.color) {
      const { r, g, b } = bg.color;
      swatch.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
      swatch.style.visibility = 'visible';
      const source = bg.autoDetected ? '自動検出' : '手動選択';
      swatchText.textContent = `${source}: rgb(${r}, ${g}, ${b})`;
    } else {
      // 背景色が未検出のとき（画像なし・検出失敗）は手動選択を促す（design エラー方針）。
      swatch.style.backgroundColor = 'transparent';
      swatch.style.visibility = 'hidden';
      swatchText.textContent = '背景色が未検出です。画像をクリックして選択してください。';
    }
  }

  /**
   * 除外セル数の表示を現在の図案（state.pattern）から再計算して更新する。
   * 図案が無い場合はプレースホルダ（-）を表示する。
   */
  function updateExcludedCount() {
    const { excluded, total, percent } = countExcludedCells(state.pattern);
    if (total === 0) {
      excludedCount.textContent = '除外セル: -';
    } else {
      excludedCount.textContent = `除外セル: ${excluded}個 (${percent.toFixed(1)}%)`;
    }
  }

  /**
   * state.backgroundExclusion と state.pattern に基づきUI全体を同期する。
   * 外部（main.js）が図案を再生成した後の再表示にも使う（refresh として公開）。
   */
  function syncFromState() {
    const bg = state.backgroundExclusion;
    toggleInput.checked = bg.enabled;
    details.style.display = bg.enabled ? '' : 'none';
    updateSwatch(bg);
    thresholdInput.value = String(bg.threshold);
    thresholdValue.textContent = String(bg.threshold);
    updateExcludedCount();
  }

  /**
   * onSettingsChange を発火する（設定変更を呼び出し側へ通知し、図案再生成を促す）。
   */
  function fireSettingsChange() {
    if (typeof onSettingsChange === 'function') {
      onSettingsChange({ ...state.backgroundExclusion });
    }
  }

  // --- イベントハンドラ ----------------------------------------------------

  /**
   * トグルのON/OFF切り替え（要件9.8, 9.9）。
   * ONにしたら背景色を自動検出して設定し（要件9.1）、OFFにしたら無効化する。
   * いずれも onSettingsChange を発火して図案再生成を促し、再生成後の図案で
   * 除外セル数を更新する。
   */
  function handleToggleChange() {
    if (toggleInput.checked) {
      // ON: 現在の画像から背景色を自動検出する（要件9.1）。
      const detected = detectBackgroundFromState(state);
      if (detected) {
        state.setBackgroundExclusion({
          enabled: true,
          color: detected,
          autoDetected: true,
        });
      } else {
        // 検出できない場合は有効化のみ行い、既存の色（あれば）を維持する。
        // 色が無ければスウォッチ表示で手動選択を促す。
        state.setBackgroundExclusion({ enabled: true });
      }
    } else {
      // OFF: 背景除外を無効化する（色はそのまま保持）。
      state.setBackgroundExclusion({ enabled: false });
    }

    // 先に再生成を促し、その後で最新の図案・設定をUIへ反映する。
    fireSettingsChange();
    syncFromState();
  }

  /**
   * ΔE閾値スライダーのドラッグ中（input）: 表示値のみライブ更新する。
   * 図案の再生成はスライダー確定時（change）に行い、ドラッグ中の過剰な再生成を避ける。
   */
  function handleThresholdInput() {
    thresholdValue.textContent = String(thresholdInput.value);
  }

  /**
   * ΔE閾値スライダーの確定（change、要件9.4, 9.9）。
   * 閾値を state に反映し、onSettingsChange を発火して図案を再生成、除外セル数を更新する。
   */
  function handleThresholdChange() {
    state.setBackgroundExclusion({ threshold: Number(thresholdInput.value) });
    fireSettingsChange();
    syncFromState();
  }

  toggleInput.addEventListener('change', handleToggleChange);
  thresholdInput.addEventListener('input', handleThresholdInput);
  thresholdInput.addEventListener('change', handleThresholdChange);

  // 初期描画（初期状態は OFF・閾値10）。
  syncFromState();

  return {
    /**
     * 外部要因（図案の再生成や別UIによる state 変更）にUIを同期させる。
     * main.js は onSettingsChange での図案再生成後にこれを呼ぶと、除外セル数や
     * スウォッチ表示が最新の状態に更新される。
     */
    refresh() {
      syncFromState();
    },

    /**
     * 画像プレビューのクリックから背景色を手動選択する（要件9.2）。
     * main.js がプレビューCanvasの click イベントに結線して使う。
     *
     * 取得に成功したら background色を上書き（autoDetected=false）し、onSettingsChange を
     * 発火して図案を再生成、UIを更新する。取得に失敗（null）した場合は現在の背景色設定を
     * 維持し、何も変更しない（要件9.2）。
     *
     * @param {HTMLCanvasElement} previewCanvas - プレビュー画像を描画した Canvas
     * @param {MouseEvent} event - クリックイベント
     * @returns {RgbColor | null} 選択された生ピクセル色。取得失敗時は null
     */
    pickFromPreview(previewCanvas, event) {
      const color = pickColorFromPreview(previewCanvas, event);
      // 取得失敗時は現在設定を維持する（要件9.2）。
      if (!color) {
        return null;
      }
      // 生ピクセル色のまま保持する（ビーズ色への変換は変換エンジンの責務・要件9.2）。
      state.setBackgroundExclusion({ color, autoDetected: false });
      fireSettingsChange();
      syncFromState();
      return color;
    },

    /**
     * イベントリスナーを解除し、コンテナを空にする（後始末用）。
     */
    destroy() {
      toggleInput.removeEventListener('change', handleToggleChange);
      thresholdInput.removeEventListener('input', handleThresholdInput);
      thresholdInput.removeEventListener('change', handleThresholdChange);
      container.innerHTML = '';
    },
  };
}
