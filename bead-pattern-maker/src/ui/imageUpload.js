// =============================================================================
// 画像アップロードUI（imageUpload.js）
// -----------------------------------------------------------------------------
// 【役割】
//   ユーザーが図案の元になる画像を読み込むためのUIコンポーネント。
//   - ファイル選択ダイアログ（input[type=file]）による選択（要件1.1）
//   - アップロード領域へのドラッグ&ドロップ（要件1.7）
//   の2経路で画像を受け付け、いずれも同じ検証・読み込み・プレビュー処理に流す。
//
//   読み込みの流れ:
//     ファイル受領 → validateImageFile で検証 → FileReader + Image で読み込み
//       → プレビュー表示 ＋ onImageLoaded(HTMLImageElement) コールバック（要件1.3）
//
//   エラー処理（design.md「エラーハンドリング」方針に準拠）:
//     - 形式不正（要件1.4）・サイズ超過（要件1.6）は validateImageFile が返す
//       メッセージを赤テキストでインライン表示し、ファイルを受け付けない。
//     - 画像の読み込み失敗（要件1.5）は読み込みエラーを赤テキストで表示し、
//       入力欄を無効化せず再選択可能な状態を維持する。
//     - エラーは次の操作で消去し、一定時間後にも自動消去する。
//
// 【設計上の位置づけ（design.md）】
//   - 「ファイル構成」の src/ui/imageUpload.js に対応。
//   - バリデーションは utils/validation.js の validateImageFile を唯一の出典とし、
//     本ファイルでは形式・サイズの判定ロジックを重複実装しない。
//   - 純粋なDOM操作部品として、生成したHTMLImageElementを onImageLoaded で
//     呼び出し側（後続の main.js / 17.1）へ引き渡す。状態管理や図案生成は持たない。
//
//   本UIモジュールは手動テスト対象（design.md「テスト戦略」）。そのため
//   検証分岐・読み込み・プレビュー・エラー表示をそれぞれ独立した関数に分割し、
//   挙動を追いやすくしている。
//
// _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7_
// =============================================================================

import { validateImageFile } from '../utils/validation.js';

/**
 * 画像読み込み失敗時に表示するメッセージ（要件1.5）。
 * FileReader / Image いずれの失敗もユーザー視点では「読み込み失敗」として扱う。
 * @type {string}
 */
const READ_ERROR_MESSAGE = '画像の読み込みに失敗しました。別のファイルを選択してください。';

/**
 * エラーメッセージを自動消去するまでの時間（ミリ秒）。
 * design.md のエラーハンドリング方針「3秒後に自動的に消える」に対応する。
 * @type {number}
 */
const ERROR_DISPLAY_MS = 3000;

/**
 * input[type=file] の accept 属性に設定する許可MIMEタイプ。
 * ファイル選択ダイアログの初期フィルタを許可形式（要件1.2）に合わせる。
 * ※ accept はあくまでダイアログ側のヒントであり、最終的な可否は
 *   validateImageFile による検証で決定する。
 * @type {string}
 */
const ACCEPT_TYPES = 'image/jpeg,image/png,image/gif,image/webp';

/**
 * input 要素の id を一意化するためのインスタンス連番。
 * label の for と input の id を確実に対応付けるために用いる（アクセシビリティ）。
 * @type {number}
 */
let instanceCounter = 0;

/**
 * @callback OnImageLoaded
 * @param {HTMLImageElement} image - 読み込み済みの画像要素（デコード完了済み）
 * @param {File} file - 読み込み元のファイル
 * @returns {void}
 */

/**
 * @typedef {Object} ImageUploadController
 * @property {HTMLElement} element - 生成したルート要素（コンテナへ挿入済み）
 * @property {() => void} reset - プレビューとエラー表示を初期状態に戻す
 */

/**
 * 画像アップロードUIを初期化し、指定コンテナに描画する。
 *
 * 生成するDOM構成:
 *   - ドロップゾーン（ドラッグ&ドロップ受付領域）
 *       - label（input と for/id で関連付け）
 *       - input[type=file]（accept で許可形式をフィルタ）
 *   - エラーメッセージ領域（role="alert"・赤テキスト、初期は非表示）
 *   - プレビュー領域（img、初期は非表示）
 *
 * @param {HTMLElement} container - UIを描画するコンテナ要素
 * @param {{ onImageLoaded?: OnImageLoaded }} [options] - コールバック等のオプション
 * @returns {ImageUploadController} 後続結線用のコントローラ（ルート要素・reset）
 */
export function initImageUploadUI(container, options = {}) {
  const onImageLoaded = options.onImageLoaded;
  const inputId = `image-upload-input-${instanceCounter++}`;
  const errorId = `${inputId}-error`;

  // --- DOM構築 -------------------------------------------------------------
  const root = document.createElement('div');
  root.className = 'image-upload';

  const dropzone = document.createElement('div');
  dropzone.className = 'image-upload__dropzone';
  // CSS未整備でもドロップ領域だと分かるよう最小限の見た目を付与する
  // （詳細なスタイルは後続タスク17.1で style.css に集約する）。
  dropzone.style.border = '2px dashed #aaa';
  dropzone.style.padding = '24px';
  dropzone.style.textAlign = 'center';

  // label と input を for/id で関連付ける（アクセシビリティ）。
  const label = document.createElement('label');
  label.className = 'image-upload__label';
  label.setAttribute('for', inputId);
  label.textContent = '画像ファイルを選択、またはここにドラッグ&ドロップ';

  const input = document.createElement('input');
  input.className = 'image-upload__input';
  input.type = 'file';
  input.id = inputId;
  input.accept = ACCEPT_TYPES;
  // エラー領域を補助情報として関連付け、支援技術にエラーを伝わりやすくする。
  input.setAttribute('aria-describedby', errorId);

  dropzone.appendChild(label);
  dropzone.appendChild(input);

  // エラーメッセージ領域（赤テキスト）。role="alert" で内容変化を即時通知する。
  const errorEl = document.createElement('p');
  errorEl.className = 'image-upload__error';
  errorEl.id = errorId;
  errorEl.setAttribute('role', 'alert');
  errorEl.setAttribute('aria-live', 'assertive');
  // 要件で「赤テキスト」が明示されているため、CSS未整備でも赤になるよう保証する。
  errorEl.style.color = '#d32f2f';
  errorEl.style.display = 'none';

  // プレビュー領域。
  const previewWrap = document.createElement('div');
  previewWrap.className = 'image-upload__preview';

  const previewImg = document.createElement('img');
  previewImg.className = 'image-upload__preview-img';
  previewImg.alt = 'アップロードした画像のプレビュー';
  previewImg.style.display = 'none';
  previewImg.style.maxWidth = '100%';
  previewWrap.appendChild(previewImg);

  root.appendChild(dropzone);
  root.appendChild(errorEl);
  root.appendChild(previewWrap);

  // 既存内容をクリアしてから挿入する（再初期化にも耐えるようにする）。
  container.innerHTML = '';
  container.appendChild(root);

  // --- エラー表示の制御 ----------------------------------------------------
  // 自動消去タイマーIDをクロージャで保持し、表示更新ごとに付け替える。
  let errorTimerId = null;

  /**
   * エラーメッセージを赤テキストで表示する（要件1.4, 1.5, 1.6）。
   * 一定時間後に自動消去するタイマーを併せて仕掛ける。
   * @param {string} message - 表示するエラーメッセージ
   */
  function showError(message) {
    errorEl.textContent = message;
    errorEl.style.display = '';
    if (errorTimerId !== null) {
      clearTimeout(errorTimerId);
    }
    errorTimerId = setTimeout(clearError, ERROR_DISPLAY_MS);
  }

  /**
   * エラーメッセージを消去し、表示を初期状態へ戻す。
   * 次の操作開始時や読み込み成功時に呼び、古いエラーが残らないようにする。
   */
  function clearError() {
    if (errorTimerId !== null) {
      clearTimeout(errorTimerId);
      errorTimerId = null;
    }
    errorEl.textContent = '';
    errorEl.style.display = 'none';
  }

  /**
   * プレビュー画像を表示する（要件1.3, 1.7）。
   * @param {string} dataUrl - 画像のデータURL（FileReader の結果）
   */
  function showPreview(dataUrl) {
    previewImg.src = dataUrl;
    previewImg.style.display = '';
  }

  /**
   * 1件のファイルを検証・読み込みし、成功時にプレビュー表示とコールバックを行う。
   *
   * 処理順:
   *   1. 直前のエラーを消去する（次の操作で消える挙動）。
   *   2. validateImageFile で形式・サイズを検証する。不正なら赤テキストで
   *      エラー表示し、ファイルを受け付けず終了する（要件1.4, 1.6）。
   *   3. FileReader + Image で読み込む。成功でプレビュー表示＋onImageLoaded、
   *      失敗で読み込みエラーを表示する（要件1.5）。いずれも入力欄は有効なまま。
   *
   * @param {File|null|undefined} file - 処理対象のファイル（先頭1件のみを想定）
   */
  function handleFile(file) {
    clearError();
    if (!file) {
      return;
    }

    // --- 形式・サイズ検証（要件1.4, 1.6） ----------------------------------
    const validation = validateImageFile(file);
    if (!validation.valid) {
      // 不正なファイルは受け付けず、理由（対応形式 / サイズ上限）を表示する。
      showError(validation.error);
      return;
    }

    // --- 読み込み（要件1.3, 1.5） ------------------------------------------
    loadImageFile(file)
      .then(({ image, dataUrl }) => {
        showPreview(dataUrl);
        if (typeof onImageLoaded === 'function') {
          onImageLoaded(image, file);
        }
      })
      .catch(() => {
        // 読み込み失敗。エラーを表示しつつ、入力欄は無効化せず再選択を維持する。
        showError(READ_ERROR_MESSAGE);
      });
  }

  // --- ファイル選択ダイアログ（要件1.1） -----------------------------------
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    handleFile(file);
    // 同一ファイルを連続選択しても change が発火するよう値をリセットする。
    // （読み込みは File 参照を保持済みのためリセットの影響を受けない）
    input.value = '';
  });

  // --- ドラッグ&ドロップ（要件1.7） ----------------------------------------
  // dragover で preventDefault しないとブラウザがドロップを受け付けないため必須。
  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('image-upload__dropzone--active');
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('image-upload__dropzone--active');
  });
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('image-upload__dropzone--active');
    const file =
      event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    handleFile(file);
  });

  /**
   * プレビューとエラー表示を初期状態へ戻す（後続の結線から利用可能）。
   */
  function reset() {
    clearError();
    previewImg.removeAttribute('src');
    previewImg.style.display = 'none';
    input.value = '';
  }

  return { element: root, reset };
}

/**
 * ファイルを FileReader でデータURL化し、Image でデコードして読み込む。
 *
 * FileReader（ファイル読み出し）と Image（画像デコード）のどちらが失敗しても
 * reject し、呼び出し側で読み込みエラーとして扱えるようにする（要件1.5）。
 * データURLを用いるためオブジェクトURLの解放（revoke）は不要。
 *
 * @param {File} file - 読み込み対象のファイル（検証済みであること）
 * @returns {Promise<{image: HTMLImageElement, dataUrl: string}>}
 *   デコード済み画像要素と、その元データURL
 */
export function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error('FileReader による読み込みに失敗しました'));
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== 'string') {
        reject(new Error('読み込み結果が不正です'));
        return;
      }

      const image = new Image();
      image.onload = () => resolve({ image, dataUrl });
      image.onerror = () => reject(new Error('画像のデコードに失敗しました'));
      image.src = dataUrl;
    };

    reader.readAsDataURL(file);
  });
}
