import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createImageData,
  createMockImage,
} from './helpers/canvasMock.js';

// =============================================================================
// テスト基盤のスモークテスト
// -----------------------------------------------------------------------------
// タスク1「プロジェクトセットアップとテスト基盤の構築」の成果物が
// 正しく機能していることを確認する。実装タスクのテストではなく、
// 基盤（jsdom / Canvas モック / ImageData / fast-check）の動作確認が目的。
// =============================================================================

describe('テスト基盤: jsdom 環境', () => {
  it('document と window が利用可能である', () => {
    expect(typeof document).toBe('object');
    expect(typeof window).toBe('object');
  });

  it('canvas 要素を生成できる', () => {
    const canvas = document.createElement('canvas');
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
  });
});

describe('テスト基盤: Canvas API モック', () => {
  it('getContext("2d") がモックコンテキストを返す', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 10;
    canvas.height = 10;
    const ctx = canvas.getContext('2d');
    expect(ctx).not.toBeNull();
    expect(typeof ctx.drawImage).toBe('function');
    expect(typeof ctx.getImageData).toBe('function');
  });

  it('getImageData が要求サイズの ImageData を返す', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 4;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, 8, 4);
    expect(imageData.width).toBe(8);
    expect(imageData.height).toBe(4);
    expect(imageData.data.length).toBe(8 * 4 * 4);
  });

  it('imageSmoothingEnabled の設定を保持できる（smooth/sharp 切替の前提）', () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    expect(ctx.imageSmoothingEnabled).toBe(false);
  });

  it('toBlob がコールバックに Blob を渡す', async () => {
    const canvas = document.createElement('canvas');
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
  });
});

describe('テスト基盤: ImageData / 画像ヘルパー', () => {
  it('createImageData が指定色で全ピクセルを塗る', () => {
    const imageData = createImageData(2, 2, { r: 255, g: 128, b: 0, a: 255 });
    expect(imageData.width).toBe(2);
    expect(imageData.height).toBe(2);
    expect(Array.from(imageData.data.slice(0, 4))).toEqual([255, 128, 0, 255]);
  });

  it('createImageData は fill 省略時に透明データを返す', () => {
    const imageData = createImageData(3, 1);
    expect(imageData.data.every((v) => v === 0)).toBe(true);
  });

  it('createMockImage が naturalWidth / naturalHeight を持つ', () => {
    const image = createMockImage(640, 480);
    expect(image.naturalWidth).toBe(640);
    expect(image.naturalHeight).toBe(480);
  });
});

describe('テスト基盤: fast-check', () => {
  it('プロパティテストを実行できる（加算の交換法則）', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        return a + b === b + a;
      }),
    );
  });
});
