// =============================================================================
// 使用色一覧（colorList.js）
// -----------------------------------------------------------------------------
// 生成済み図案グリッドから「使用されているビーズ色とその個数」を集計し、
// 色見本・色名・使用個数のリストとしてDOMに描画する。
// 未配置（null）セルは使用色一覧に含めず、合計個数にも加算しない。
// 未配置の個数と割合はリストの外に独立表示する。
//
// 設計書「9. 使用色一覧（colorList.js）の更新」に対応。
// Requirements: 6.1, 6.2, 6.3, 6.4, 9.7
//
// 純粋ロジック（calculateUsedColors）とDOM描画（renderColorList）を分離し、
// 集計ロジックを単体でテスト可能にする。
// =============================================================================

/**
 * @typedef {Object} BeadColor
 * @property {string} id - 色の一意識別子
 * @property {string} name - 色名
 * @property {number} r - 赤成分 (0-255)
 * @property {number} g - 緑成分 (0-255)
 * @property {number} b - 青成分 (0-255)
 */

/**
 * @typedef {Object} PatternGrid
 * @property {number} width - 横ビーズ数
 * @property {number} height - 縦ビーズ数
 * @property {(BeadColor|null)[][]} cells - 2次元配列 [row][col]。null は未配置
 */

/**
 * @typedef {Object} UsedColorEntry
 * @property {string} id - 色の一意識別子
 * @property {string} name - 色名
 * @property {number} r - 赤成分 (0-255)
 * @property {number} g - 緑成分 (0-255)
 * @property {number} b - 青成分 (0-255)
 * @property {number} count - 図案内での使用個数
 */

import { t, getColorName } from '../i18n.js';

/**
 * @typedef {Object} UsedColorsResult
 * @property {UsedColorEntry[]} colors - 使用色エントリ（個数降順 → 色名昇順でソート済み）
 * @property {number} totalBeads - 非null（配置済み）セルの合計個数
 * @property {number} excludedCount - null（未配置）セルの個数
 */

/**
 * 図案グリッドから使用色一覧を計算する（純粋関数）。
 *
 * - null セル（未配置）はカウントから除外し、`excludedCount` として別途集計する
 * - `totalBeads` は null を除いた非nullセル数（＝各色 count の合計）
 * - `colors` は使用個数の降順、同数の場合は色名の昇順（辞書順 / localeCompare）でソートする
 *
 * @param {PatternGrid|null|undefined} pattern - 図案データ
 * @returns {UsedColorsResult} 使用色一覧・合計個数・未配置数
 */
export function calculateUsedColors(pattern) {
  // key（色の同一性キー）-> UsedColorEntry の集計マップ
  const colorMap = new Map();
  let totalBeads = 0;
  let excludedCount = 0;

  const cells = pattern && Array.isArray(pattern.cells) ? pattern.cells : [];

  for (const row of cells) {
    if (!Array.isArray(row)) {
      continue;
    }
    for (const cell of row) {
      // null / undefined は未配置セル。色一覧にも合計にも含めない（要件9.7）。
      if (cell === null || cell === undefined) {
        excludedCount += 1;
        continue;
      }

      totalBeads += 1;

      // 同一色の集約キー。通常は一意な id を用いる。
      // id が欠落している場合に備え、色名+RGB の複合キーにフォールバックする。
      const key =
        cell.id !== undefined && cell.id !== null
          ? `id:${cell.id}`
          : `rgb:${cell.name}|${cell.r},${cell.g},${cell.b}`;

      const existing = colorMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        colorMap.set(key, {
          id: cell.id,
          name: cell.name,
          nameEn: cell.nameEn,
          r: cell.r,
          g: cell.g,
          b: cell.b,
          count: 1,
        });
      }
    }
  }

  // 使用個数の降順、同数なら色名の昇順（辞書順）でソートする（要件6.3）。
  const colors = Array.from(colorMap.values()).sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    return String(a.name).localeCompare(String(b.name));
  });

  return { colors, totalBeads, excludedCount };
}

/**
 * 使用色一覧をDOMに描画する。
 *
 * 構成:
 *   - 合計個数の表示（要件6.4）
 *   - 色見本（矩形）・色名・使用個数のリスト（要件6.1, 6.2, 6.3）
 *   - 未配置情報「未配置: X個 (Y%)」をリストの外に独立表示（要件9.7）
 *
 * 図案が存在しない（セルが0件）場合はコンテナを空にして何も描画しない。
 *
 * @param {HTMLElement|null} container - 描画先のコンテナ要素
 * @param {PatternGrid|null|undefined} pattern - 図案データ
 * @returns {UsedColorsResult} 計算結果（呼び出し側での再利用用）
 */
export function renderColorList(container, pattern) {
  const result = calculateUsedColors(pattern);

  if (!container) {
    return result;
  }

  // 既存の描画内容をクリアする
  container.innerHTML = '';

  const { colors, totalBeads, excludedCount } = result;
  const totalCells = totalBeads + excludedCount;

  // 図案が無い（セルが0件）場合は空表示のままにする
  if (totalCells === 0) {
    return result;
  }

  const root = document.createElement('div');
  root.className = 'color-list';

  // --- 合計個数（要件6.4） -------------------------------------------------
  const summary = document.createElement('div');
  summary.className = 'color-list__summary';
  summary.textContent = t('colorList.summary', { count: totalBeads });
  root.appendChild(summary);

  // --- 使用色リスト（要件6.1, 6.2, 6.3） -----------------------------------
  const list = document.createElement('ul');
  list.className = 'color-list__items';

  for (const color of colors) {
    const item = document.createElement('li');
    item.className = 'color-list__item';

    // 色見本（矩形）。背景色は動的なのでインラインで設定する。
    // CSS未整備でも矩形として見えるよう最小限のサイズ指定も付与する。
    const swatch = document.createElement('span');
    swatch.className = 'color-list__swatch';
    swatch.style.backgroundColor = `rgb(${color.r}, ${color.g}, ${color.b})`;
    swatch.style.display = 'inline-block';
    swatch.style.width = '16px';
    swatch.style.height = '16px';
    // 色見本は装飾。色名がテキストで併記されるため読み上げ対象から除外する。
    swatch.setAttribute('aria-hidden', 'true');

    // 色名（要件6.2）
    const name = document.createElement('span');
    name.className = 'color-list__name';
    name.textContent = getColorName(color);

    // 使用個数（要件6.2）
    const count = document.createElement('span');
    count.className = 'color-list__count';
    count.textContent = t('colorList.count', { count: color.count });

    item.appendChild(swatch);
    item.appendChild(name);
    item.appendChild(count);
    list.appendChild(item);
  }

  root.appendChild(list);

  // --- 未配置情報（リストの外に独立表示・要件9.7） -------------------------
  // 未配置セルが存在する場合のみ「未配置: X個 (Y%)」を表示する。
  if (excludedCount > 0) {
    const percent = ((excludedCount / totalCells) * 100).toFixed(1);
    const unplaced = document.createElement('div');
    unplaced.className = 'color-list__unplaced';
    unplaced.textContent = t('colorList.unplaced', { excluded: excludedCount, percent });
    root.appendChild(unplaced);
  }

  container.appendChild(root);

  return result;
}
