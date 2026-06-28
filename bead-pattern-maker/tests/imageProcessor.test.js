import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { resizeImage } from '../src/engine/imageProcessor.js';
import { createMockImage, ensureImageData } from './helpers/canvasMock.js';

// =============================================================================
// imageProcessor.resizeImage のテスト
// -----------------------------------------------------------------------------
// 本ファイルは以下の3タスクをまとめて検証する:
//   - タスク5.2: Property 6  画像リサイズ出力サイズ（出力幅=cols×pegCount, 高さ=rows×pegCount）
//   - タスク5.3: Property 18 フィットモードの出力寸法（fitModeに関わらず寸法不変）
//   - タスク5.4: ユニットテスト（smooth/sharp の補間設定、contain の余白が透明）
//
// Canvas API は tests/setup.js 経由で tests/helpers/canvasMock.js のモックが
// 自動注入される。標準モックの getImageData は要求サイズの透明 ImageData を返す
// ため、寸法検証（Property 6 / 18）はそのまま行える。
// contain の「余白が透明」をピクセルレベルで確かめるテストでは、drawImage を
// 簡易再現するピクセル対応モックをテスト内で一時的に差し替えて検証する。
// =============================================================================

// -----------------------------------------------------------------------------
// テスト用ジェネレータ / ヘルパー
// -----------------------------------------------------------------------------

// 元画像の寸法（1〜1000px）。contain/cover は元寸法で割るため最小1で0除算を避ける
const sourceDimArb = fc.integer({ min: 1, max: 1000 });
// プレート枚数（横・縦とも1〜10枚）
const colsArb = fc.integer({ min: 1, max: 10 });
const rowsArb = fc.integer({ min: 1, max: 10 });
// ペグ数（パーラービーズ=29 / ナノビーズ=28）
const pegArb = fc.constantFrom(28, 29);
// フィットモード3種
const fitModeArb = fc.constantFrom('stretch', 'contain', 'cover');
// リサイズ方式2種
const resizeMethodArb = fc.constantFrom('smooth', 'sharp');

/**
 * document.createElement をスパイし、生成された canvas 要素を捕捉する。
 * resizeImage はオフスクリーン canvas を内部生成するため、生成後に
 * captured[0].__mockCtx で（標準モックの）2Dコンテキストを参照できる。
 * @returns {{captured: HTMLCanvasElement[], restore: () => void}}
 */
function spyOnCanvasCreation() {
  const captured = [];
  const realCreateElement = document.createElement.bind(document);
  const spy = vi.spyOn(document, 'createElement').mockImplementation((tagName, ...rest) => {
    const el = realCreateElement(tagName, ...rest);
    if (String(tagName).toLowerCase() === 'canvas') {
      captured.push(el);
    }
    return el;
  });
  return { captured, restore: () => spy.mockRestore() };
}

/**
 * 描画を簡易再現するピクセル対応の 2D コンテキストを生成する。
 * - 初期状態は全ピクセル透明（alpha=0）
 * - clearRect: 指定領域を透明に戻す
 * - drawImage（5引数形式）: 描画先矩形を不透明色で塗る（実Canvasの描画を簡易再現）
 * - getImageData: 現在のピクセルバッファを ImageData として返す
 * これにより contain の余白（描画されない領域）が透明のまま残ることを実ピクセルで検証できる。
 * @param {HTMLCanvasElement} canvas
 */
function createPixelAwareContext(canvas) {
  const ImageDataCtor = ensureImageData();
  const width = canvas.width;
  const height = canvas.height;
  const data = new Uint8ClampedArray(width * height * 4); // 透明初期化（全0）

  // 矩形 [x0,x1) × [y0,y1) を canvas 範囲にクリップしつつ指定色で塗る
  const paintRect = (x0, y0, x1, y1, [r, g, b, a]) => {
    const xs = Math.max(0, Math.min(width, x0));
    const ys = Math.max(0, Math.min(height, y0));
    const xe = Math.max(0, Math.min(width, x1));
    const ye = Math.max(0, Math.min(height, y1));
    for (let y = ys; y < ye; y++) {
      for (let x = xs; x < xe; x++) {
        const idx = (y * width + x) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = a;
      }
    }
  };

  return {
    canvas,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
    clearRect: vi.fn((x, y, w, h) => {
      paintRect(Math.floor(x), Math.floor(y), Math.ceil(x + w), Math.ceil(y + h), [0, 0, 0, 0]);
    }),
    drawImage: vi.fn((_image, dx, dy, dWidth, dHeight) => {
      // 5引数形式（image, dx, dy, dWidth, dHeight）を想定し、描画先を不透明色で塗る
      paintRect(
        Math.round(dx),
        Math.round(dy),
        Math.round(dx + dWidth),
        Math.round(dy + dHeight),
        [10, 20, 30, 255],
      );
    }),
    getImageData: vi.fn(() => new ImageDataCtor(data.slice(), width, height)),
  };
}

/**
 * HTMLCanvasElement.prototype.getContext をピクセル対応モックへ一時的に差し替える。
 * getContext 呼び出し時点で canvas.width/height は設定済みである前提（resizeImage の実装順）。
 * @returns {() => void} 元の getContext に戻す関数
 */
function installPixelAwareCanvas() {
  const savedGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function getContextMock(type) {
    if (type !== '2d') return null;
    if (!this.__pixelCtx) {
      this.__pixelCtx = createPixelAwareContext(this);
    }
    return this.__pixelCtx;
  };
  return () => {
    HTMLCanvasElement.prototype.getContext = savedGetContext;
  };
}

/** ImageData の (x, y) ピクセルのアルファ値を返す */
function alphaAt(imageData, x, y) {
  return imageData.data[(y * imageData.width + x) * 4 + 3];
}

// -----------------------------------------------------------------------------
// タスク5.2: Property 6 画像リサイズ出力サイズ
// -----------------------------------------------------------------------------
describe('imageProcessor.resizeImage - 出力サイズのプロパティ（タスク5.2）', () => {
  // **Validates: Requirements 4.1**
  it('Feature: bead-pattern-maker, Property 6: 任意の入力画像サイズとプレート構成に対して、resizeImage の出力 ImageData の幅は cols×pegCount、高さは rows×pegCount と一致する', () => {
    fc.assert(
      fc.property(
        sourceDimArb,
        sourceDimArb,
        colsArb,
        rowsArb,
        pegArb,
        resizeMethodArb,
        fitModeArb,
        (sourceWidth, sourceHeight, cols, rows, pegCount, resizeMethod, fitMode) => {
          const targetWidth = cols * pegCount;
          const targetHeight = rows * pegCount;

          const result = resizeImage(
            createMockImage(sourceWidth, sourceHeight),
            targetWidth,
            targetHeight,
            { resizeMethod, fitMode },
          );

          // 出力 ImageData の寸法はターゲット寸法（cols×pegCount, rows×pegCount）と一致する
          expect(result.width).toBe(targetWidth);
          expect(result.height).toBe(targetHeight);
          // ピクセルバッファ長も width×height×4 と整合する
          expect(result.data.length).toBe(targetWidth * targetHeight * 4);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// -----------------------------------------------------------------------------
// タスク5.3: Property 18 フィットモードの出力寸法
// -----------------------------------------------------------------------------
describe('imageProcessor.resizeImage - フィットモード出力寸法のプロパティ（タスク5.3）', () => {
  // **Validates: Requirements 10.5, 10.6, 10.7**
  it('Feature: bead-pattern-maker, Property 18: 任意の入力画像サイズ・プレート構成・フィットモードに対して、リサイズ結果の寸法は常に (cols×pegCount)×(rows×pegCount) で不変である', () => {
    fc.assert(
      fc.property(
        sourceDimArb,
        sourceDimArb,
        colsArb,
        rowsArb,
        pegArb,
        fitModeArb,
        resizeMethodArb,
        (sourceWidth, sourceHeight, cols, rows, pegCount, fitMode, resizeMethod) => {
          const targetWidth = cols * pegCount;
          const targetHeight = rows * pegCount;

          const result = resizeImage(
            createMockImage(sourceWidth, sourceHeight),
            targetWidth,
            targetHeight,
            { resizeMethod, fitMode },
          );

          // fitMode（stretch/contain/cover）に関わらず出力寸法は常にターゲット寸法で不変
          expect(result.width).toBe(targetWidth);
          expect(result.height).toBe(targetHeight);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Feature: bead-pattern-maker, Property 18: 同一入力に対して 3 つのフィットモードの出力寸法は互いに等しい（寸法はフィットモード非依存）', () => {
    fc.assert(
      fc.property(
        sourceDimArb,
        sourceDimArb,
        colsArb,
        rowsArb,
        pegArb,
        (sourceWidth, sourceHeight, cols, rows, pegCount) => {
          const targetWidth = cols * pegCount;
          const targetHeight = rows * pegCount;
          const image = createMockImage(sourceWidth, sourceHeight);

          const dims = ['stretch', 'contain', 'cover'].map((fitMode) => {
            const r = resizeImage(image, targetWidth, targetHeight, { fitMode });
            return `${r.width}x${r.height}`;
          });

          // 3モードすべてが同一寸法、かつターゲット寸法に一致
          expect(new Set(dims).size).toBe(1);
          expect(dims[0]).toBe(`${targetWidth}x${targetHeight}`);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// -----------------------------------------------------------------------------
// タスク5.4: imageProcessor のユニットテスト
// -----------------------------------------------------------------------------
describe('imageProcessor.resizeImage - 補間設定とフィット余白のユニットテスト（タスク5.4）', () => {
  it('リサイズ方式 smooth では imageSmoothingEnabled=true / quality=high を設定する (Requirements 10.2)', () => {
    const { captured, restore } = spyOnCanvasCreation();
    try {
      resizeImage(createMockImage(20, 20), 10, 10, { resizeMethod: 'smooth', fitMode: 'stretch' });

      expect(captured.length).toBeGreaterThan(0);
      const ctx = captured[0].__mockCtx;
      expect(ctx.imageSmoothingEnabled).toBe(true);
      expect(ctx.imageSmoothingQuality).toBe('high');
    } finally {
      restore();
    }
  });

  it('リサイズ方式 sharp では imageSmoothingEnabled=false を設定する (Requirements 10.3)', () => {
    const { captured, restore } = spyOnCanvasCreation();
    try {
      resizeImage(createMockImage(20, 20), 10, 10, { resizeMethod: 'sharp', fitMode: 'stretch' });

      const ctx = captured[0].__mockCtx;
      expect(ctx.imageSmoothingEnabled).toBe(false);
    } finally {
      restore();
    }
  });

  it('リサイズ方式を省略した場合は smooth（imageSmoothingEnabled=true）が既定となる (Requirements 10.2)', () => {
    const { captured, restore } = spyOnCanvasCreation();
    try {
      resizeImage(createMockImage(20, 20), 10, 10, {});

      const ctx = captured[0].__mockCtx;
      expect(ctx.imageSmoothingEnabled).toBe(true);
    } finally {
      restore();
    }
  });

  it('フィットモード contain ではアスペクト比の違いで生じる余白が透明（alpha=0）になる (Requirements 10.6)', () => {
    const restore = installPixelAwareCanvas();
    try {
      const targetWidth = 10;
      const targetHeight = 10;
      // 横長画像(40x20)を正方形(10x10)へ contain → アスペクト比維持・中央寄せで上下に余白が生じる
      const result = resizeImage(
        createMockImage(40, 20),
        targetWidth,
        targetHeight,
        { resizeMethod: 'sharp', fitMode: 'contain' },
      );

      // 上端の行（レターボックス余白）は全ピクセル透明
      for (let x = 0; x < targetWidth; x++) {
        expect(alphaAt(result, x, 0)).toBe(0);
      }
      // 下端の行（レターボックス余白）も全ピクセル透明
      for (let x = 0; x < targetWidth; x++) {
        expect(alphaAt(result, x, targetHeight - 1)).toBe(0);
      }
      // 中央付近（画像が描画される領域）は不透明
      expect(alphaAt(result, Math.floor(targetWidth / 2), Math.floor(targetHeight / 2))).toBe(255);
    } finally {
      restore();
    }
  });

  it('contain では描画前に Canvas 全体を透明クリア（clearRect）してから drawImage する (Requirements 10.6)', () => {
    const { captured, restore } = spyOnCanvasCreation();
    try {
      resizeImage(createMockImage(40, 20), 10, 10, { fitMode: 'contain' });

      const ctx = captured[0].__mockCtx;
      // Canvas 全体を透明クリア
      expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 10, 10);
      expect(ctx.drawImage).toHaveBeenCalled();
      // clearRect が drawImage より前に呼ばれている（余白が透明として残る前提）
      const clearOrder = ctx.clearRect.mock.invocationCallOrder[0];
      const drawOrder = ctx.drawImage.mock.invocationCallOrder[0];
      expect(clearOrder).toBeLessThan(drawOrder);
    } finally {
      restore();
    }
  });
});
