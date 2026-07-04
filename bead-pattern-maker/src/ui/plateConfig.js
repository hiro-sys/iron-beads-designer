// =============================================================================
// プレート構成設定UI（plateConfig.js）
// -----------------------------------------------------------------------------
// プレートの横（列）・縦（行）の枚数（1〜10）を入力するUIを提供する。
// 入力値は validatePlateCount で検証し、無効値（1未満・0・小数・非数値・11以上）
// は受け付けず直前の有効値を維持する。プレート構成が変更されたとき、既存の図案
// データ（state.pattern）が存在する場合はクリアされる旨の確認を求め、確認後に
// 新サイズの空グリッド（createEmptyGrid）を生成して state を更新する。
//
// 設計書「コンポーネントとインターフェース > ファイル構成（ui/plateConfig.js）」
// および「エラーハンドリング > プレート枚数不正値（入力拒否・直前値維持）」に対応。
//
// Requirements:
//   - 3.1 : プレートの横方向の枚数を1〜10の整数で指定する機能を提供する
//   - 3.2 : プレートの縦方向の枚数を1〜10の整数で指定する機能を提供する
//   - 3.4 : プレート構成変更時、既存図案をクリアし新サイズの空グリッドを生成する
//   - 3.6 : 1未満/小数/非数値の入力は受け付けず、直前の有効値を維持する
//   - 3.7 : プレート構成変更時、既存図案があればクリア確認をユーザーに求める
//
// 注: 本モジュールは手動テスト対象（design.md「テスト戦略」）。純粋ロジックは
//     検証・グリッド生成を validation.js に委譲しているため、本ファイルは
//     DOM操作とユーザー確認のフロー結線に専念する。
// =============================================================================

import { validatePlateCount, createEmptyGrid } from '../utils/validation.js';
import { t } from '../i18n.js';

/** プレート枚数の下限・上限（要件3.1, 3.2）。input要素の min/max にも用いる。 */
const PLATE_MIN = 1;
const PLATE_MAX = 10;

/** label と input を確実に関連付けるための一意ID採番カウンタ。 */
let instanceCounter = 0;

/**
 * 数値入力フィールド（ラベル付き）を1つ生成する内部ヘルパー。
 *
 * @param {string} idPrefix - input要素のid接頭辞（label の for と関連付ける）
 * @param {string} labelText - ラベル文言
 * @param {number} initialValue - 初期表示値（現在のプレート枚数）
 * @returns {{ field: HTMLDivElement, input: HTMLInputElement }}
 */
function createAxisField(idPrefix, labelText, initialValue) {
  const field = document.createElement('div');
  field.className = 'plate-config__field';

  const inputId = `${idPrefix}-input`;

  const label = document.createElement('label');
  label.className = 'plate-config__label';
  label.setAttribute('for', inputId);
  label.textContent = labelText;

  const input = document.createElement('input');
  input.className = 'plate-config__input';
  input.id = inputId;
  input.type = 'number';
  input.min = String(PLATE_MIN);
  input.max = String(PLATE_MAX);
  input.step = '1';
  // モバイルで数値キーボードを優先する（任意の補助属性）。
  input.inputMode = 'numeric';
  input.value = String(initialValue);

  field.appendChild(label);
  field.appendChild(input);

  return { field, input };
}

/**
 * プレート構成設定UIを初期化する。
 *
 * `container` 内に横（列）・縦（行）の枚数入力（number、1〜10）を描画し、
 * 値の検証・確認・反映フローを結線する。値が有効に変更されたときは
 * `onPlateConfigChange(newPlateConfig)` を発火し、main.js（タスク17.1）側で
 * 図案の再生成などを行えるようにする。
 *
 * 変更フロー（change イベント時、横・縦それぞれ独立に処理）:
 *   1. validatePlateCount で検証する。無効なら受け付けず直前の有効値に戻す（3.6）。
 *   2. 値が現在値と同じなら何もしない（正規化のみ）。
 *   3. 既存図案（state.pattern）があれば window.confirm でクリア確認を求める（3.7）。
 *      キャンセルされたら直前の値に戻す。
 *   4. 反映: state.setPlateConfig で構成を更新する（3.1, 3.2）。図案があった場合は
 *      新サイズの空グリッド（createEmptyGrid）を生成して state.setPattern で
 *      置き換える（3.4）。図案が無い場合は確認なしで構成のみ反映する。
 *   5. onPlateConfigChange を発火する。
 *
 * @param {HTMLElement} container - UIの描画先コンテナ要素
 * @param {object} state - アプリケーション状態ストア（createAppState の戻り値）
 * @param {object} [callbacks] - コールバック群
 * @param {function({cols: number, rows: number}): void} [callbacks.onPlateConfigChange]
 *   - プレート構成が有効に変更されたときに呼ばれる
 * @returns {{ syncFromState: function(): void, destroy: function(): void }}
 *   外部からの再同期（syncFromState）と後始末（destroy）を行うコントローラ
 */
export function initPlateConfigUI(container, state, { onPlateConfigChange } = {}) {
  if (!container) {
    throw new TypeError('initPlateConfigUI: container 要素が必要です');
  }
  if (!state || typeof state.setPlateConfig !== 'function') {
    throw new TypeError('initPlateConfigUI: 有効な state ストアが必要です');
  }

  instanceCounter += 1;
  const idBase = `plate-config-${instanceCounter}`;

  // --- 現在のプレート構成（{cols, rows}）のスナップショットを取得する内部関数 ---
  // state.plateConfig は内部オブジェクトを返すため、値だけを読み取って複製する。
  function readConfig() {
    const pc = state.plateConfig;
    return { cols: pc.cols, rows: pc.rows };
  }

  const current = readConfig();

  // --- DOM構築 -------------------------------------------------------------
  container.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'plate-config';

  const colsField = createAxisField(`${idBase}-cols`, t('plateConfig.cols'), current.cols);
  const separator = document.createElement('span');
  separator.className = 'plate-config__separator';
  separator.textContent = '×';
  separator.setAttribute('aria-hidden', 'true');
  const rowsField = createAxisField(`${idBase}-rows`, t('plateConfig.rows'), current.rows);

  root.appendChild(colsField.field);
  root.appendChild(separator);
  root.appendChild(rowsField.field);
  container.appendChild(root);

  const colsInput = colsField.input;
  const rowsInput = rowsField.input;

  // --- 入力欄を現在のstate値に同期する -------------------------------------
  function syncInputs() {
    const { cols, rows } = readConfig();
    colsInput.value = String(cols);
    rowsInput.value = String(rows);
  }

  /**
   * 有効に変更された新プレート構成を state に反映する。
   *
   * @param {{cols: number, rows: number}} nextConfig - 反映する新構成
   * @param {boolean} regenerateEmptyGrid - 既存図案をクリアして空グリッドを作るか
   *   （図案が存在し、ユーザーが確認した場合に true）
   */
  function applyPlateConfig(nextConfig, regenerateEmptyGrid) {
    // プレート構成を更新する（要件3.1, 3.2）。setter 側で 1〜10 に正規化される。
    state.setPlateConfig(nextConfig);

    if (regenerateEmptyGrid) {
      // 既存図案をクリアし、新サイズの空白グリッドを生成する（要件3.4）。
      const emptyGrid = createEmptyGrid(nextConfig, state.beadType);
      state.setPattern(emptyGrid);
    }

    // setter 側の正規化結果に表示を合わせる。
    syncInputs();

    if (typeof onPlateConfigChange === 'function') {
      onPlateConfigChange({ ...readConfig() });
    }
  }

  /**
   * 1軸（横 or 縦）の change イベントを処理する。
   *
   * @param {'cols' | 'rows'} axis - 対象の軸
   * @param {HTMLInputElement} inputEl - 対象の入力要素
   */
  function handleAxisChange(axis, inputEl) {
    const config = readConfig();
    const result = validatePlateCount(inputEl.value);

    // 要件3.6: 無効値（1未満・0・小数・非数値・11以上）は受け付けず直前値を維持。
    if (!result.valid) {
      inputEl.value = String(config[axis]);
      return;
    }

    const nextValue = result.value;

    // 値が変わっていなければ何もしない（確認も再生成も不要）。表示だけ正規化する。
    if (nextValue === config[axis]) {
      inputEl.value = String(nextValue);
      return;
    }

    const nextConfig = { ...config, [axis]: nextValue };

    // 要件3.7: 既存図案があるときはクリア確認を求める。
    const hasPattern = state.pattern !== null && state.pattern !== undefined;
    if (hasPattern) {
      const confirmed = window.confirm(t('plateConfig.confirmClear'));
      if (!confirmed) {
        // キャンセル時は直前の有効値に戻し、何も変更しない。
        inputEl.value = String(config[axis]);
        return;
      }
    }

    // 図案があった場合のみ空グリッドを再生成する（要件3.4）。
    // 図案が無い場合は確認なしで構成のみ反映する。
    applyPlateConfig(nextConfig, hasPattern);
  }

  // --- イベント結線 ---------------------------------------------------------
  const onColsChange = () => handleAxisChange('cols', colsInput);
  const onRowsChange = () => handleAxisChange('rows', rowsInput);
  colsInput.addEventListener('change', onColsChange);
  rowsInput.addEventListener('change', onRowsChange);

  return {
    /**
     * 外部要因（例: おすすめサイズ選択 タスク15.4）で state.plateConfig が
     * 変わったとき、入力欄の表示を最新の state 値へ同期する。
     */
    syncFromState() {
      syncInputs();
    },

    /**
     * イベントリスナーを解除し、コンテナを空にする（後始末用）。
     */
    destroy() {
      colsInput.removeEventListener('change', onColsChange);
      rowsInput.removeEventListener('change', onRowsChange);
      container.innerHTML = '';
    },
  };
}
