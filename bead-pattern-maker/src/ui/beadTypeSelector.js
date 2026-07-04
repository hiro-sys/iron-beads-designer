// =============================================================================
// ビーズタイプ選択UI（beadTypeSelector.js）
// -----------------------------------------------------------------------------
// パーラービーズ／ナノビーズの選択UI（ラジオボタン）と、選択中ビーズタイプに
// 対応するカラーパレットの全色を一覧表示する「色選択UI」を提供する。
//
// ビーズタイプ変更時の挙動:
//   - state.beadType を更新する（要件2.1）
//   - 選択UIを新しいビーズタイプのパレットで再描画する（要件2.2, 2.3）
//   - 図案（state.pattern）が存在すれば remapPattern で新パレットの最近色へ
//     再マッピングして state.pattern を更新する（要件2.4）
//   - 図案が無ければパレット切替のみを行い、エラーを発生させない（要件2.5）
//   - onBeadTypeChange コールバックを発火し、呼び出し側（main.js）に再描画を促す
//
// 設計書「データモデル > BeadType」「カラーパレットデータ構造」に対応。
// Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
//
// 【このファイルの分担について】
//   本コンポーネントは「ビーズタイプの選択」と「対応パレットの一覧表示」に責務を
//   限定する。色の有効/無効トグルや最大色数の制御は使用パレット選択UI
//   （paletteSelector.js / タスク16.1）、塗り色の選択は図案手動編集UI
//   （patternEditor.js / タスク16.4）が担当する。
//
//   UI各モジュールは手動テスト対象（design.md「テスト戦略」）のため、本タスクは
//   実装のみとし自動テストは作成しない。
// =============================================================================

import { BEAD_CONFIG, initializePalette } from '../data/beadConfig.js';
import { PARLER_PALETTE } from '../data/parlerPalette.js';
import { NANO_PALETTE } from '../data/nanoPalette.js';
import { remapPattern } from '../engine/colorMatcher.js';
import { t, getColorName } from '../i18n.js';

/**
 * ビーズタイプ → 表示ラベルの翻訳キー対応表。
 * BEAD_CONFIG.label（日本語固定）は内部識別・他モジュールの互換性のために残し、
 * UI表示は i18n 辞書のキー経由でロケールに応じた文言を取得する。
 * @type {Record<string, string>}
 */
const BEAD_TYPE_LABEL_KEYS = {
  perler: 'beadConfig.perler',
  nano: 'beadConfig.nano',
};

/** @typedef {'perler' | 'nano'} BeadType */

/**
 * ビーズタイプ → 生パレット（{ id, name, r, g, b }[]）の対応表。
 * lab はここでは付与せず、表示・再マッピング時に initializePalette で付与する。
 * @type {Record<BeadType, Array<{id: string, name: string, r: number, g: number, b: number}>>}
 */
const RAW_PALETTES = {
  perler: PARLER_PALETTE,
  nano: NANO_PALETTE,
};

/**
 * 指定ビーズタイプの「初期化済みパレット」（各色に lab をキャッシュ）を返す。
 *
 * 最近色マッチング（remapPattern → findClosestColor）で lab を再計算しないよう、
 * initializePalette で事前に lab を付与する。未知のビーズタイプが渡された場合は
 * 安全側に倒してパーラービーズのパレットを返す。
 *
 * @param {BeadType} beadType - ビーズタイプ（'perler' / 'nano'）
 * @returns {Array<{id: string, name: string, r: number, g: number, b: number, lab: {L: number, a: number, b: number}}>}
 *          lab を付与した新しいパレット配列
 */
export function getPaletteForBeadType(beadType) {
  const raw = RAW_PALETTES[beadType] || PARLER_PALETTE;
  return initializePalette(raw);
}

/**
 * ビーズタイプ選択用のラジオボタン群（fieldset）を生成する。
 *
 * BEAD_CONFIG の定義順（perler → nano）で選択肢を並べるため、初期表示では
 * パーラービーズが先頭かつ選択済みになる（要件2.1）。
 *
 * @param {BeadType} currentBeadType - 現在選択中のビーズタイプ（このタイプを checked にする）
 * @param {function(BeadType): void} onSelect - ラジオ選択時に呼ばれるハンドラ
 * @returns {HTMLFieldSetElement} ラジオボタン群を含む fieldset 要素
 */
function buildOptions(currentBeadType, onSelect) {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'bead-type-selector__options';

  const legend = document.createElement('legend');
  legend.className = 'bead-type-selector__legend';
  legend.textContent = t('beadType.legend');
  fieldset.appendChild(legend);

  // 同一ラジオグループにまとめるための name。
  const groupName = 'bead-type';

  for (const [type, config] of Object.entries(BEAD_CONFIG)) {
    const label = document.createElement('label');
    label.className = 'bead-type-selector__option';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = groupName;
    radio.value = type;
    radio.className = 'bead-type-selector__radio';
    radio.checked = type === currentBeadType;
    // チェックされた（＝選択された）ときのみ変更を伝播する。
    radio.addEventListener('change', () => {
      if (radio.checked) {
        onSelect(/** @type {BeadType} */ (type));
      }
    });

    const text = document.createElement('span');
    text.className = 'bead-type-selector__option-label';
    text.textContent = t(BEAD_TYPE_LABEL_KEYS[type] ?? config.label);

    label.appendChild(radio);
    label.appendChild(text);
    fieldset.appendChild(label);
  }

  return fieldset;
}

/**
 * 指定パレットの全色を「色選択UI」として一覧表示する要素を生成する（要件2.2, 2.3）。
 *
 * 各色は色見本（スウォッチ）と色名で構成し、ホバー時に「ID 色名」をツールチップ
 * （title 属性）として表示する。CSS未整備でも矩形として視認できるよう、最小限の
 * インラインスタイルをスウォッチに付与する（colorList.js と同方針）。
 *
 * @param {Array<{id: string, name: string, r: number, g: number, b: number}>} palette - 表示するパレット
 * @returns {HTMLDivElement} パレット一覧を含むコンテナ要素
 */
function buildPalette(palette) {
  const wrapper = document.createElement('div');
  wrapper.className = 'bead-type-selector__palette';

  // 何色あるかの見出し（要件2.3: 全単色の一覧であることを明示）。
  const heading = document.createElement('div');
  heading.className = 'bead-type-selector__palette-heading';
  heading.textContent = t('beadType.paletteHeading', { count: palette.length });
  wrapper.appendChild(heading);

  const list = document.createElement('ul');
  list.className = 'bead-type-selector__colors';

  for (const color of palette) {
    const item = document.createElement('li');
    item.className = 'bead-type-selector__color';
    // ホバーで「ID 色名」を表示（色見本だけでは判別しづらいため）。
    item.title = `${color.id} ${getColorName(color)}`;

    // 色見本（矩形）。背景色は動的なのでインラインで設定する。
    const swatch = document.createElement('span');
    swatch.className = 'bead-type-selector__swatch';
    swatch.style.backgroundColor = `rgb(${color.r}, ${color.g}, ${color.b})`;
    swatch.style.display = 'inline-block';
    swatch.style.width = '20px';
    swatch.style.height = '20px';
    // 色見本は装飾。色名がテキストで併記されるため読み上げ対象から除外する。
    swatch.setAttribute('aria-hidden', 'true');

    // 色名（要件2.3）。
    const name = document.createElement('span');
    name.className = 'bead-type-selector__color-name';
    name.textContent = getColorName(color);

    item.appendChild(swatch);
    item.appendChild(name);
    list.appendChild(item);
  }

  wrapper.appendChild(list);
  return wrapper;
}

/**
 * ビーズタイプ選択UIを初期化してコンテナに描画する。
 *
 * 初期状態は state.beadType（既定値はパーラービーズ）に従う（要件2.1）。
 * ラジオでビーズタイプを切り替えると、対応パレットを色選択UIに再表示し（要件2.2,
 * 2.3）、図案があれば新パレットの最近色へ再マッピングして state を更新する（要件
 * 2.4）。図案が無ければパレット切替のみを行いエラーを出さない（要件2.5）。変更後は
 * onBeadTypeChange を発火して呼び出し側に再描画を促す。
 *
 * @param {HTMLElement|null} container - UIの描画先コンテナ要素
 * @param {object} state - アプリケーション状態ストア（state.js の createAppState の戻り値）
 * @param {object} [options] - オプション
 * @param {function(object): void} [options.onBeadTypeChange] - ビーズタイプ変更後に
 *        呼ばれるコールバック。引数は { beadType, palette, pattern }。再描画の起点に使う。
 * @returns {{ refresh: function(): void, getPalette: function(): object[], destroy: function(): void }}
 *          外部から再同期（refresh）・現在パレット取得（getPalette）・破棄（destroy）できるハンドル
 */
export function initBeadTypeSelectorUI(container, state, options = {}) {
  // コンテナが無い場合は no-op ハンドルを返し、呼び出し側がクラッシュしないようにする。
  if (!container) {
    return {
      refresh() {},
      getPalette() {
        return [];
      },
      destroy() {},
    };
  }

  const { onBeadTypeChange } = options;

  // 現在選択中ビーズタイプの初期化済みパレット（lab付与）。
  // 再マッピングと再描画の双方で再利用する。
  let currentPalette = getPaletteForBeadType(state.beadType);

  /**
   * ビーズタイプ変更を処理する。
   * @param {BeadType} newBeadType - 新しく選択されたビーズタイプ
   */
  function handleBeadTypeChange(newBeadType) {
    // 同一タイプの再選択は何もしない（無駄な再マッピング・再描画を避ける）。
    if (newBeadType === state.beadType) {
      return;
    }

    // 1) ビーズタイプを更新（要件2.1）。
    state.setBeadType(newBeadType);

    // 2) 新パレット（lab付与）を用意（要件2.2, 2.3）。
    currentPalette = getPaletteForBeadType(newBeadType);

    // 3) 図案があれば新パレットの最近色へ再マッピングして state を更新（要件2.4）。
    //    図案が無ければこのステップをスキップし、パレット切替のみとする（要件2.5）。
    if (state.pattern) {
      state.setPattern(remapPattern(state.pattern, currentPalette));
    }

    // 4) UIを新しい状態で再描画（選択中ラジオ・パレット一覧を更新）。
    render();

    // 5) 呼び出し側（main.js）に再描画を促す（要件2.4: 図案の再描画）。
    if (typeof onBeadTypeChange === 'function') {
      onBeadTypeChange({
        beadType: newBeadType,
        palette: currentPalette,
        pattern: state.pattern,
      });
    }
  }

  /**
   * 現在の state と currentPalette に基づいてUI全体を描画する。
   * 既存内容をクリアしてから再構築するため、refresh からも再利用できる。
   */
  function render() {
    container.innerHTML = '';

    const root = document.createElement('div');
    root.className = 'bead-type-selector';

    root.appendChild(buildOptions(state.beadType, handleBeadTypeChange));
    root.appendChild(buildPalette(currentPalette));

    container.appendChild(root);
  }

  // 初期描画。
  render();

  return {
    /**
     * 外部からの state 変更（例: 別UIによる beadType 変更）にUIを同期させる。
     * 現在の state.beadType に基づいてパレットを取り直し、UIを再描画する。
     */
    refresh() {
      currentPalette = getPaletteForBeadType(state.beadType);
      render();
    },

    /**
     * 現在選択中ビーズタイプの初期化済みパレット（lab付与）を返す。
     * 他コンポーネント（paletteSelector 等）が同一パレットを参照する際に使う。
     * @returns {object[]} 初期化済みパレット
     */
    getPalette() {
      return currentPalette;
    },

    /**
     * UIを破棄する（コンテナを空にする）。
     */
    destroy() {
      container.innerHTML = '';
    },
  };
}
