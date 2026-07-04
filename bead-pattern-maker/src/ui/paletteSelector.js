// =============================================================================
// 使用パレット選択UI（paletteSelector.js）
// -----------------------------------------------------------------------------
// 変換に使用する色の「有効／無効」と「最大色数」を設定するUIコンポーネント。
//
// 役割（要件11）:
//   - 選択中ビーズタイプの全色をスウォッチのグリッドで表示し、クリックで各色の
//     有効／無効をトグルする。無効化された色は淡色表示で区別する（要件11.1）。
//   - 無効化された色のIDを state.disabledColorIds に保持する。これは最近色
//     マッチングの対象から除外される（要件11.2、除外は getActivePalette が担う）。
//   - 「最大色数」を入力できる（空欄＝制限なし／整数値）。値は state.maxColors
//     （null = 制限なし）に保持する。初期値は「制限なし」（要件11.3）。
//   - 有効色が1色も無い（全色無効）状態では図案生成をブロックし、
//     「最低1色を有効にしてください」というメッセージを表示する（要件11.5）。
//   - 有効／無効または最大色数が変更されたら onSelectionChange を発火して
//     図案再生成を促す（要件11.6）。
//
// 設計書「11. 使用パレット選択UIコンポーネント（paletteSelector.js）」に対応。
// Requirements: 11.1, 11.2, 11.3, 11.5, 11.6
//
// 【純関数と副作用の分離】
//   有効パレットの算出は純関数 getActivePalette として切り出す（タスク16.2で
//   ユニットテストされる）。DOM操作・状態更新を伴う初期化処理は
//   initPaletteSelectorUI に集約する。UI自体は手動テスト対象（design.md
//   「テスト戦略」）のため、本タスクは実装のみとする。
//
// 【分担について】
//   本コンポーネントは「使用する色の有効/無効」と「最大色数」の設定に責務を
//   限定する。ビーズタイプの選択と全パレットの表示は beadTypeSelector.js が、
//   減色処理そのものは colorReducer.js（state.maxColors を参照）が担当する。
// =============================================================================

import { getPaletteForBeadType } from './beadTypeSelector.js';
import { t, getColorName } from '../i18n.js';

/**
 * @typedef {Object} BeadColor
 * @property {string} id - 色の一意識別子（例: "P01"）
 * @property {string} name - 色名
 * @property {number} r - 赤成分 (0-255)
 * @property {number} g - 緑成分 (0-255)
 * @property {number} b - 青成分 (0-255)
 * @property {{L: number, a: number, b: number}} [lab] - Lab色空間値（キャッシュ）
 */

/**
 * 有効パレット（無効化色を除いた色配列）を算出する純関数。
 *
 * - `fullPalette` から、`disabledColorIds` に含まれるIDの色を除外して返す。
 * - 無効化IDが空（または配列でない）の場合は、全色を有効とみなして複製を返す。
 * - 全色が無効化されている場合は空配列を返す（要件11.5の「有効色0」状態）。
 * - 入力を破壊しない（新しい配列を返す）。
 *
 * @param {BeadColor[]} fullPalette - 選択中ビーズタイプの全パレット
 * @param {string[]} disabledColorIds - 無効化された色IDの配列
 * @returns {BeadColor[]} 有効色のみの配列（無効化色を除外）
 */
export function getActivePalette(fullPalette, disabledColorIds) {
  // パレットが配列でなければ有効色なしとして空配列を返す。
  if (!Array.isArray(fullPalette)) {
    return [];
  }
  // 無効化IDが無ければ全色有効。元配列を破壊しないよう複製して返す。
  if (!Array.isArray(disabledColorIds) || disabledColorIds.length === 0) {
    return [...fullPalette];
  }
  // O(1) 照合のため Set 化してからフィルタする。
  const disabledSet = new Set(disabledColorIds);
  return fullPalette.filter((color) => !disabledSet.has(color.id));
}

/**
 * 第3引数（options）を正規化する。
 * 関数が直接渡された場合（design.md のシグネチャ）は onSelectionChange として扱い、
 * オブジェクトが渡された場合（タスク補足のシグネチャ）はそのプロパティを使う。
 * 両方のシグネチャを受け付けることで、main.js（17.1）からの結線を柔軟にする。
 *
 * @param {function|object|undefined} options
 * @returns {{onSelectionChange?: function, getPalette?: function}}
 */
function normalizeOptions(options) {
  if (typeof options === 'function') {
    return { onSelectionChange: options };
  }
  if (options && typeof options === 'object') {
    return options;
  }
  return {};
}

/**
 * 使用パレット選択UIを初期化してコンテナに描画する。
 *
 * 初期状態は state.disabledColorIds（既定: []）と state.maxColors（既定: null=
 * 制限なし）に従う。スウォッチのクリックで色の有効／無効をトグルし、最大色数の
 * 入力で state.maxColors を更新する。いずれの変更でも onSelectionChange を発火
 * して図案再生成を促す（要件11.6）が、全色無効（有効色0）になった場合は生成を
 * ブロックし、onSelectionChange を発火せずメッセージを表示する（要件11.5）。
 *
 * @param {HTMLElement|null} container - UIの描画先コンテナ要素
 * @param {object} state - アプリケーション状態ストア（state.js の createAppState の戻り値）
 * @param {function|object} [options] - コールバック関数、またはオプションオブジェクト
 * @param {function(object): void} [options.onSelectionChange] - 有効/無効・最大色数の
 *        変更後に呼ばれるコールバック。引数は { activePalette, maxColors, disabledColorIds }。
 *        図案再生成の起点に使う。
 * @param {function(): BeadColor[]} [options.getPalette] - 全パレット取得関数（省略時は
 *        getPaletteForBeadType(state.beadType) を使用）。beadTypeSelector のハンドルと
 *        同一パレットを共有したい場合に渡す。
 * @returns {{refresh: function(): void, getActivePalette: function(): BeadColor[], canGenerate: function(): boolean, destroy: function(): void}}
 *          外部から再同期・有効パレット取得・生成可否判定・破棄ができるハンドル
 */
export function initPaletteSelectorUI(container, state, options = {}) {
  // コンテナが無い場合は no-op ハンドルを返し、呼び出し側がクラッシュしないようにする。
  if (!container) {
    return {
      refresh() {},
      getActivePalette() {
        return [];
      },
      canGenerate() {
        return false;
      },
      destroy() {},
    };
  }

  const { onSelectionChange, getPalette } = normalizeOptions(options);

  /**
   * 選択中ビーズタイプの全パレット（lab付き）を取得する。
   * options.getPalette が指定されていればそれを優先し、無ければ beadType から導出する。
   * @returns {BeadColor[]}
   */
  function getFullPalette() {
    if (typeof getPalette === 'function') {
      const palette = getPalette();
      return Array.isArray(palette) ? palette : [];
    }
    return getPaletteForBeadType(state.beadType);
  }

  /**
   * 現在の無効化色IDを安全に取得する（常に配列）。
   * @returns {string[]}
   */
  function getDisabledIds() {
    return Array.isArray(state.disabledColorIds) ? state.disabledColorIds : [];
  }

  /**
   * 色の有効／無効をトグルする。
   * 既に無効なら有効化（IDを除去）、有効なら無効化（IDを追加）する。
   * 更新後にUIを再描画し、変更を通知する。
   * @param {string} colorId - トグル対象の色ID
   */
  function toggleColor(colorId) {
    if (colorId === undefined || colorId === null) {
      return;
    }
    const current = getDisabledIds();
    const next = current.includes(colorId)
      ? current.filter((id) => id !== colorId)
      : [...current, colorId];

    state.setDisabledColorIds(next);
    render();
    emitChange();
  }

  /**
   * 最大色数の入力値を state に反映する。
   * state.setMaxColors が正規化を担う（空文字・0以下・非数値は null=制限なしになる）。
   * @param {string} rawValue - 入力欄の生の値
   */
  function applyMaxColors(rawValue) {
    state.setMaxColors(rawValue);
    render();
    emitChange();
  }

  /**
   * 変更を呼び出し側へ通知する（要件11.6）。
   * ただし有効色が0色（全色無効）の場合は図案生成をブロックするため、
   * onSelectionChange を発火しない（要件11.5）。メッセージ表示は render が担う。
   */
  function emitChange() {
    const activePalette = getActivePalette(getFullPalette(), getDisabledIds());
    if (activePalette.length === 0) {
      // 有効色0 → 生成ブロック。通知しない。
      return;
    }
    if (typeof onSelectionChange === 'function') {
      onSelectionChange({
        activePalette,
        maxColors: state.maxColors,
        disabledColorIds: [...getDisabledIds()],
      });
    }
  }

  // --- DOM構築ヘルパー -------------------------------------------------------

  /**
   * 見出し（有効色数 / 全色数）を生成する。
   * @param {number} totalCount - 全色数
   * @param {number} activeCount - 有効色数
   * @returns {HTMLDivElement}
   */
  function buildHeading(totalCount, activeCount) {
    const heading = document.createElement('div');
    heading.className = 'palette-selector__heading';
    heading.textContent = t('paletteSelector.heading', {
      active: activeCount,
      total: totalCount,
    });
    return heading;
  }

  /**
   * 最大色数の入力コントロールを生成する（要件11.3）。
   * 空欄＝制限なし、1以上の整数＝その色数まで。change（確定）時に state へ反映する。
   * @returns {HTMLDivElement}
   */
  function buildMaxColorsControl() {
    const wrap = document.createElement('div');
    wrap.className = 'palette-selector__max-colors';

    const label = document.createElement('label');
    label.className = 'palette-selector__max-colors-label';

    const labelText = document.createElement('span');
    labelText.className = 'palette-selector__max-colors-text';
    labelText.textContent = t('paletteSelector.maxColorsLabel');

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.step = '1';
    input.placeholder = t('paletteSelector.maxColorsPlaceholder');
    input.className = 'palette-selector__max-colors-input';
    // null（制限なし）のときは空欄、指定時はその値を表示する。
    input.value = state.maxColors == null ? '' : String(state.maxColors);
    // change（フォーカスアウト/Enter）で確定し、連続入力中の再描画を避ける。
    input.addEventListener('change', () => {
      applyMaxColors(input.value);
    });

    label.appendChild(labelText);
    label.appendChild(input);
    wrap.appendChild(label);

    // 現在の設定を補助表示する（「制限なし」か「N色まで」か）。
    const hint = document.createElement('span');
    hint.className = 'palette-selector__max-colors-hint';
    hint.textContent =
      state.maxColors == null
        ? t('paletteSelector.maxColorsHintUnlimited')
        : t('paletteSelector.maxColorsHintLimited', { count: state.maxColors });
    wrap.appendChild(hint);

    return wrap;
  }

  /**
   * 1色分のスウォッチボタンを生成する。
   * クリックで有効／無効をトグルし、無効化色は淡色＋取り消し線で区別する。
   * @param {BeadColor} color - 表示する色
   * @param {boolean} isDisabled - 無効化されているか
   * @returns {HTMLButtonElement}
   */
  function buildSwatchButton(color, isDisabled) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className =
      'palette-selector__swatch-button' +
      (isDisabled ? ' palette-selector__swatch-button--disabled' : '');
    // aria-pressed=true を「有効（押下＝使用中）」として表現する。
    button.setAttribute('aria-pressed', String(!isDisabled));
    const statusLabel = isDisabled
      ? t('paletteSelector.disabled')
      : t('paletteSelector.enabled');
    button.title = `${color.id ?? ''} ${getColorName(color)}（${statusLabel}）`.trim();

    // 色見本（矩形）。背景色は動的なのでインラインで設定する。
    // CSS未整備でも矩形として視認できるよう最小限のスタイルを付与する。
    const swatch = document.createElement('span');
    swatch.className = 'palette-selector__swatch';
    swatch.style.backgroundColor = `rgb(${color.r}, ${color.g}, ${color.b})`;
    swatch.style.display = 'inline-block';
    swatch.style.width = '20px';
    swatch.style.height = '20px';
    // 無効化色は淡色表示で区別する（要件11.1）。
    swatch.style.opacity = isDisabled ? '0.3' : '1';
    swatch.setAttribute('aria-hidden', 'true');

    // 色名（色見本だけでは判別しづらいため併記）。
    const name = document.createElement('span');
    name.className = 'palette-selector__swatch-name';
    name.textContent = getColorName(color);
    if (isDisabled) {
      // 無効であることをテキストでも示す。
      name.style.textDecoration = 'line-through';
      name.style.opacity = '0.5';
    }

    button.appendChild(swatch);
    button.appendChild(name);
    button.addEventListener('click', () => toggleColor(color.id));

    return button;
  }

  /**
   * 全色のスウォッチグリッドを生成する（要件11.1, 11.2）。
   * @param {BeadColor[]} fullPalette - 全パレット
   * @param {string[]} disabledIds - 無効化色ID
   * @returns {HTMLDivElement}
   */
  function buildSwatchGrid(fullPalette, disabledIds) {
    const grid = document.createElement('div');
    grid.className = 'palette-selector__grid';
    // CSS未整備でも横並び＋折り返しになるよう最小限のスタイルを付与する。
    grid.style.display = 'flex';
    grid.style.flexWrap = 'wrap';
    grid.style.gap = '4px';

    const disabledSet = new Set(disabledIds);
    for (const color of fullPalette) {
      grid.appendChild(buildSwatchButton(color, disabledSet.has(color.id)));
    }
    return grid;
  }

  /**
   * 「最低1色を有効にしてください」メッセージを生成する（要件11.5）。
   * 設計のエラー表示方針に合わせて赤テキストで表示する。
   * @returns {HTMLParagraphElement}
   */
  function buildEmptyMessage() {
    const message = document.createElement('p');
    message.className = 'palette-selector__error';
    message.setAttribute('role', 'alert');
    message.textContent = t('paletteSelector.emptyError');
    // CSS未整備でも警告と分かるよう赤テキストにする。
    message.style.color = '#cc0000';
    return message;
  }

  /**
   * 現在の state に基づいてUI全体を描画する。
   * 既存内容をクリアしてから再構築する（refresh やトグルからも再利用）。
   */
  function render() {
    container.innerHTML = '';

    const fullPalette = getFullPalette();
    const disabledIds = getDisabledIds();
    const activePalette = getActivePalette(fullPalette, disabledIds);

    const root = document.createElement('div');
    root.className = 'palette-selector';

    root.appendChild(buildHeading(fullPalette.length, activePalette.length));
    root.appendChild(buildMaxColorsControl());

    // 有効色が0色のときのみ、生成ブロックのメッセージを表示する（要件11.5）。
    if (activePalette.length === 0) {
      root.appendChild(buildEmptyMessage());
    }

    root.appendChild(buildSwatchGrid(fullPalette, disabledIds));

    container.appendChild(root);
  }

  // 初期描画。
  render();

  return {
    /**
     * 外部からの state 変更（例: ビーズタイプ変更）にUIを同期させる。
     * 現在の state に基づいてUIを再描画する。
     */
    refresh() {
      render();
    },

    /**
     * 現在の有効パレット（無効化色を除外した色配列）を返す。
     * main.js が図案生成時に「使用パレット」として参照する。
     * @returns {BeadColor[]}
     */
    getActivePalette() {
      return getActivePalette(getFullPalette(), getDisabledIds());
    },

    /**
     * 図案生成が可能か（有効色が1色以上あるか）を返す（要件11.5）。
     * main.js は生成前にこれを確認し、false ならブロックできる。
     * @returns {boolean}
     */
    canGenerate() {
      return getActivePalette(getFullPalette(), getDisabledIds()).length > 0;
    },

    /**
     * UIを破棄する（コンテナを空にする）。
     */
    destroy() {
      container.innerHTML = '';
    },
  };
}
