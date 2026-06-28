import { vi } from 'vitest';

// =============================================================================
// Canvas API モックヘルパー（雛形）
// -----------------------------------------------------------------------------
// jsdom は HTMLCanvasElement.getContext を実装していないため、
// Canvas を利用するモジュール（imageProcessor / canvasRenderer / exporter 等）の
// 自動テストにはモックが必要となる。
// 本ヘルパーは以下を提供する:
//   - ImageData ポリフィル（jsdom 環境に ImageData が無い場合のフォールバック）
//   - createImageData: テスト用 ImageData の生成
//   - createMockContext2D: 2D コンテキストのモック（描画系はスパイ）
//   - installCanvasMock / uninstallCanvasMock: getContext / toBlob の差し替え
//   - createMockImage: 擬似 HTMLImageElement の生成
// =============================================================================

// jsdom が ImageData を提供しない場合に使う簡易ポリフィル
class ImageDataPolyfill {
  constructor(dataOrWidth, widthOrHeight, height) {
    if (dataOrWidth instanceof Uint8ClampedArray) {
      // new ImageData(data, width[, height])
      this.data = dataOrWidth;
      this.width = widthOrHeight;
      this.height = height ?? this.data.length / 4 / widthOrHeight;
    } else {
      // new ImageData(width, height)
      const w = dataOrWidth;
      const h = widthOrHeight;
      this.width = w;
      this.height = h;
      this.data = new Uint8ClampedArray(w * h * 4);
    }
  }
}

/**
 * グローバルに ImageData が存在することを保証する。
 * 無ければポリフィルを登録する。
 * @returns {Function} 利用可能な ImageData コンストラクタ
 */
export function ensureImageData() {
  if (typeof globalThis.ImageData === 'undefined') {
    globalThis.ImageData = ImageDataPolyfill;
  }
  return globalThis.ImageData;
}

/**
 * テスト用の ImageData を生成する。
 * @param {number} width - 幅（ピクセル）
 * @param {number} height - 高さ（ピクセル）
 * @param {{r?: number, g?: number, b?: number, a?: number}} [fill] - 全ピクセルを塗る色（省略時は透明）
 * @returns {ImageData} 生成された ImageData
 */
export function createImageData(width, height, fill) {
  const ImageDataCtor = ensureImageData();
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill) {
    const { r = 0, g = 0, b = 0, a = 0 } = fill;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return new ImageDataCtor(data, width, height);
}

/**
 * 2D 描画コンテキストのモックを生成する。
 * 描画系メソッドは vi.fn() のスパイで、呼び出し検証に利用できる。
 * getImageData は __setImageData で差し替え可能（未設定時は要求サイズの透明データを返す）。
 * @param {HTMLCanvasElement} [canvas] - 紐づく canvas 要素
 * @returns {object} モック 2D コンテキスト
 */
export function createMockContext2D(canvas) {
  // getImageData が返すデータ。テストから __setImageData で上書きできる。
  let stored = null;

  const ctx = {
    canvas,
    // --- 状態系プロパティ ---
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    globalAlpha: 1,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    // --- 描画系メソッド（スパイ）---
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    rect: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    clip: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    setLineDash: vi.fn(),
    createPattern: vi.fn(() => ({})),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    putImageData: vi.fn(),
    // getImageData: 保存済みがあればそれを、無ければ要求サイズの透明データを返す
    getImageData: vi.fn((sx = 0, sy = 0, sw, sh) => {
      if (stored) return stored;
      const width = sw ?? canvas?.width ?? 0;
      const height = sh ?? canvas?.height ?? 0;
      return createImageData(width, height);
    }),
  };

  // テスト用: getImageData が返す ImageData を差し替える
  ctx.__setImageData = (imageData) => {
    stored = imageData;
  };

  return ctx;
}

// オリジナル実装の退避（uninstall 時に復元するため）
let originalGetContext = null;
let originalToBlob = null;

/**
 * HTMLCanvasElement.prototype.getContext / toBlob をモックへ差し替える。
 * jsdom 環境でない場合は何もしない。
 */
export function installCanvasMock() {
  ensureImageData();
  if (typeof HTMLCanvasElement === 'undefined') return;

  if (!originalGetContext) {
    originalGetContext = HTMLCanvasElement.prototype.getContext;
  }
  HTMLCanvasElement.prototype.getContext = function (type) {
    if (type === '2d') {
      if (!this.__mockCtx) {
        this.__mockCtx = createMockContext2D(this);
      }
      return this.__mockCtx;
    }
    return null;
  };

  if (!originalToBlob) {
    originalToBlob = HTMLCanvasElement.prototype.toBlob;
  }
  HTMLCanvasElement.prototype.toBlob = function (callback, type = 'image/png') {
    const blob = new Blob([''], { type });
    // 実ブラウザの非同期挙動に近づけたい場合は queueMicrotask 等に置き換え可能
    callback(blob);
  };
}

/**
 * installCanvasMock で差し替えた getContext / toBlob を元に戻す。
 */
export function uninstallCanvasMock() {
  if (typeof HTMLCanvasElement === 'undefined') return;

  if (originalGetContext) {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    originalGetContext = null;
  }
  if (originalToBlob) {
    HTMLCanvasElement.prototype.toBlob = originalToBlob;
    originalToBlob = null;
  }
}

/**
 * 擬似 HTMLImageElement を生成する。
 * resizeImage 等が参照する width / height / naturalWidth / naturalHeight を持つ。
 * @param {number} width - 画像の幅
 * @param {number} height - 画像の高さ
 * @returns {object} 擬似画像オブジェクト
 */
export function createMockImage(width, height) {
  return {
    width,
    height,
    naturalWidth: width,
    naturalHeight: height,
    complete: true,
    src: '',
  };
}
