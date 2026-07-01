import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installCanvasMock, uninstallCanvasMock, createMockImage, ensureImageData } from './helpers/canvasMock.js';
import { initializePalette } from '../src/data/beadConfig.js';
import { PARLER_PALETTE } from '../src/data/parlerPalette.js';

// =============================================================================
// 変換方式非依存の統合テスト（tests/integration.ai.test.js / タスク11.1）
// -----------------------------------------------------------------------------
// 目的:
//   AI変換由来の PatternGrid と ローカル変換由来の PatternGrid が、下流機能
//   （使用色一覧計算・手動編集・エクスポート用構造）で同様に動作することを検証する。
//   変換方式に依存しない PatternGrid 契約の統合確認。
//
// 検証する受け入れ基準:
//   - 要件9.3: 図案表示・使用色一覧・手動編集・エクスポートが PatternGrid の内容のみに
//     基づき動作し、生成元の変換方式に依存しない
//   - 要件9.2: AI変換が利用不可（キー未設定・ネットワーク不通）でもローカル変換の
//     生成・表示・編集・エクスポートが提供される
//
// 【テスト構成】
//   (1) AI変換経由の PatternGrid に対して下流機能が正常動作すること（要件9.3）
//   (2) AI利用不可時にローカル変換で同等構造の PatternGrid を生成・利用可能なこと（要件9.2）
// =============================================================================

// --- imageProcessor モック（ローカル変換テスト用） ---
vi.mock('../src/engine/imageProcessor.js', () => ({
  resizeImage: vi.fn(),
}));

import { resizeImage } from '../src/engine/imageProcessor.js';
import { AIConversionStrategy } from '../src/engine/AIConversionStrategy.js';
import { LocalConversionStrategy } from '../src/engine/LocalConversionStrategy.js';
import { calculateUsedColors } from '../src/ui/colorList.js';
import { computeExportDimensions, computeExportCellSize } from '../src/renderer/exporter.js';

// -----------------------------------------------------------------------------
// 共有フィクスチャ
// -----------------------------------------------------------------------------

// 有効パレット（lab 付き）
const ACTIVE_PALETTE = initializePalette(PARLER_PALETTE);

// テスト用の小さな 3×3 グリッド
const WIDTH = 3;
const HEIGHT = 3;

// パレットの先頭3色を使用する（AI応答で返すインデックスと対応）
const COLOR_0 = ACTIVE_PALETTE[0]; // P01 しろ
const COLOR_1 = ACTIVE_PALETTE[5]; // P06 あか
const COLOR_2 = ACTIVE_PALETTE[24]; // P25 くろ

// AI応答のモック: 3×3 グリッド、-1 は未配置
// レイアウト:
//   Row0: 0(しろ)  5(あか)  -1(未配置)
//   Row1: 24(くろ) 0(しろ)  5(あか)
//   Row2: -1(未配置) 24(くろ) 0(しろ)
const AI_GRID_RESPONSE = {
  width: WIDTH,
  height: HEIGHT,
  grid: [
    [0, 5, -1],
    [24, 0, 5],
    [-1, 24, 0],
  ],
};

// ローカル変換用ピクセルデータ（同じ色配置を resizeImage で再現する）
// COLOR_0(しろ): r=241,g=241,b=241  COLOR_1(あか): r=219,g=46,b=52  COLOR_2(くろ): r=42,g=42,b=44
// 透明ピクセル: a=0
const PIXEL_WHITE = { r: 241, g: 241, b: 241, a: 255 };
const PIXEL_RED = { r: 219, g: 46, b: 52, a: 255 };
const PIXEL_BLACK = { r: 42, g: 42, b: 44, a: 255 };
const PIXEL_TRANS = { r: 0, g: 0, b: 0, a: 0 };

const LOCAL_PIXELS = [
  PIXEL_WHITE, PIXEL_RED, PIXEL_TRANS,
  PIXEL_BLACK, PIXEL_WHITE, PIXEL_RED,
  PIXEL_TRANS, PIXEL_BLACK, PIXEL_WHITE,
];

/**
 * fetch モックのレスポンスを生成する。
 * Gemini API の応答形式: candidates[0].content.parts[0].text に JSON文字列。
 */
function makeFetchResponse(responseData) {
  const body = {
    candidates: [
      {
        content: {
          parts: [
            { text: JSON.stringify(responseData) },
          ],
        },
      },
    ],
  };
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  };
}

/**
 * ローカル変換用の ImageData を生成する。
 */
function makeImageData(width, height, pixels) {
  const ImageDataCtor = ensureImageData();
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 1) {
    const p = pixels[i];
    data[i * 4] = p.r;
    data[i * 4 + 1] = p.g;
    data[i * 4 + 2] = p.b;
    data[i * 4 + 3] = p.a;
  }
  return new ImageDataCtor(data, width, height);
}

// =============================================================================
// (1) AI変換の PatternGrid が下流機能と互換動作する（要件9.3）
// =============================================================================
describe('統合: AI生成由来の PatternGrid に対する下流機能の動作（要件9.3）', () => {
  let originalFetch;

  beforeEach(() => {
    installCanvasMock();
    // fetch をモックして AI 応答を制御する
    originalFetch = global.fetch;
    global.fetch = vi.fn(() => Promise.resolve(makeFetchResponse(AI_GRID_RESPONSE)));
  });

  afterEach(() => {
    uninstallCanvasMock();
    global.fetch = originalFetch;
  });

  /**
   * AIConversionStrategy.generateFromText を実行し PatternGrid を取得する。
   */
  async function runAiConvert() {
    const strategy = new AIConversionStrategy();
    return strategy.generateFromText('ねこ', {
      width: WIDTH,
      height: HEIGHT,
      activePalette: ACTIVE_PALETTE,
      maxColors: null,
      apiKey: 'test-api-key-dummy',
      beadType: 'perler',
      plateConfig: { cols: 1, rows: 1 },
    });
  }

  it('AI生成で正しい寸法・構造の PatternGrid が生成される', async () => {
    const pattern = await runAiConvert();

    expect(pattern.width).toBe(WIDTH);
    expect(pattern.height).toBe(HEIGHT);
    expect(pattern.cells).toHaveLength(HEIGHT);
    for (const row of pattern.cells) {
      expect(row).toHaveLength(WIDTH);
    }
    expect(pattern.originalCells).toHaveLength(HEIGHT);
    expect(pattern.originalCells[0]).toHaveLength(WIDTH);
    expect(pattern.beadType).toBe('perler');
    expect(pattern.plateConfig).toEqual({ cols: 1, rows: 1 });
  });

  it('calculateUsedColors が AI由来 PatternGrid で正しく集計される（色と個数）', async () => {
    const pattern = await runAiConvert();
    const used = calculateUsedColors(pattern);

    // 非nullセル数: 7（しろ3 + あか2 + くろ2）、未配置: 2
    expect(used.totalBeads).toBe(7);
    expect(used.excludedCount).toBe(2);
    expect(used.totalBeads + used.excludedCount).toBe(WIDTH * HEIGHT);

    // 色が3種類で個数が正しいこと
    expect(used.colors).toHaveLength(3);
    const countMap = {};
    for (const c of used.colors) {
      countMap[c.id] = c.count;
    }
    expect(countMap[COLOR_0.id]).toBe(3); // しろ
    expect(countMap[COLOR_1.id]).toBe(2); // あか
    expect(countMap[COLOR_2.id]).toBe(2); // くろ
  });

  it('手動編集（セルを null にする / 別色に書き換える）が AI由来 PatternGrid で動作する', async () => {
    const pattern = await runAiConvert();

    // セルを null（未配置）にする操作（消しゴム相当）
    const editedCells = pattern.cells.map((row) => row.slice());
    editedCells[0][0] = null; // しろ→未配置
    const editedPattern = { ...pattern, cells: editedCells };

    const usedAfterErase = calculateUsedColors(editedPattern);
    expect(usedAfterErase.totalBeads).toBe(6); // 7-1=6
    expect(usedAfterErase.excludedCount).toBe(3); // 2+1=3

    // セルを別色に書き換える操作（ペイント相当）
    const paintedCells = editedPattern.cells.map((row) => row.slice());
    paintedCells[0][2] = COLOR_1; // 未配置→あか
    const paintedPattern = { ...editedPattern, cells: paintedCells };

    const usedAfterPaint = calculateUsedColors(paintedPattern);
    expect(usedAfterPaint.totalBeads).toBe(7); // 6+1=7
    // あかの個数が1増えている
    const paintCountMap = {};
    for (const c of usedAfterPaint.colors) {
      paintCountMap[c.id] = c.count;
    }
    expect(paintCountMap[COLOR_1.id]).toBe(3); // 元2 + 1 = 3
  });

  it('エクスポート用の構造（width/height/cells/beadType/plateConfig）が揃っている', async () => {
    const pattern = await runAiConvert();

    // エクスポーターが必要とするフィールドが存在すること
    expect(pattern).toHaveProperty('width');
    expect(pattern).toHaveProperty('height');
    expect(pattern).toHaveProperty('cells');
    expect(pattern).toHaveProperty('beadType');
    expect(pattern).toHaveProperty('plateConfig');
    expect(pattern.plateConfig).toHaveProperty('cols');
    expect(pattern.plateConfig).toHaveProperty('rows');

    // computeExportDimensions が正常に動作すること（例外が出ないこと）
    const dims = computeExportDimensions(pattern, { cellSize: 20 });
    expect(dims.cellSize).toBeGreaterThanOrEqual(20);
    expect(dims.patternWidth).toBe(WIDTH * dims.cellSize);
    expect(dims.patternHeight).toBe(HEIGHT * dims.cellSize);
    expect(dims.width).toBeGreaterThanOrEqual(dims.patternWidth);
    expect(dims.height).toBeGreaterThanOrEqual(dims.patternHeight);
  });
});

// =============================================================================
// (2) AI利用不可時にローカル変換で同等の PatternGrid が利用可能（要件9.2）
// =============================================================================
describe('統合: AI利用不可時のローカル変換フォールバック（要件9.2）', () => {
  beforeEach(() => {
    installCanvasMock();
    resizeImage.mockReset();
  });

  afterEach(() => {
    uninstallCanvasMock();
  });

  /**
   * ローカル変換を実行する（imageProcessor をモックして制御された画像データを使用）。
   */
  function runLocalConvert() {
    resizeImage.mockReturnValue(makeImageData(WIDTH, HEIGHT, LOCAL_PIXELS));
    const strategy = new LocalConversionStrategy();
    const image = createMockImage(100, 100);
    return strategy.convert(image, {
      width: WIDTH,
      height: HEIGHT,
      activePalette: ACTIVE_PALETTE,
      resizeMethod: 'sharp',
      fitMode: 'stretch',
      maxColors: null,
      beadType: 'perler',
      plateConfig: { cols: 1, rows: 1 },
    });
  }

  it('ローカル変換で正しい PatternGrid 構造が生成される（width/height/cells/originalCells）', () => {
    const pattern = runLocalConvert();

    expect(pattern.width).toBe(WIDTH);
    expect(pattern.height).toBe(HEIGHT);
    expect(pattern.cells).toHaveLength(HEIGHT);
    for (const row of pattern.cells) {
      expect(row).toHaveLength(WIDTH);
    }
    expect(pattern.originalCells).toHaveLength(HEIGHT);
    expect(pattern.originalCells[0]).toHaveLength(WIDTH);
    expect(pattern.beadType).toBe('perler');
    expect(pattern.plateConfig).toEqual({ cols: 1, rows: 1 });
  });

  it('calculateUsedColors がローカル変換由来 PatternGrid で正しく集計される', () => {
    const pattern = runLocalConvert();
    const used = calculateUsedColors(pattern);

    // 非nullセル: 7（透明2個以外の7セル）、未配置: 2
    expect(used.totalBeads).toBe(7);
    expect(used.excludedCount).toBe(2);
    expect(used.totalBeads + used.excludedCount).toBe(WIDTH * HEIGHT);

    // 色数が3種類であること
    expect(used.colors).toHaveLength(3);
  });

  it('手動編集がローカル変換由来 PatternGrid で動作する', () => {
    const pattern = runLocalConvert();
    const before = calculateUsedColors(pattern);

    // 消しゴム（非nullセルをnullにする）
    const editedCells = pattern.cells.map((row) => row.slice());
    // Row0[0] は非null（しろ系の色にマッチング済み）
    expect(editedCells[0][0]).not.toBeNull();
    editedCells[0][0] = null;
    const editedPattern = { ...pattern, cells: editedCells };
    const afterErase = calculateUsedColors(editedPattern);
    expect(afterErase.totalBeads).toBe(before.totalBeads - 1);

    // ペイント（nullセルに色を置く）
    const paintCells = editedPattern.cells.map((row) => row.slice());
    // Row0[2] は null（透明由来）
    expect(paintCells[0][2]).toBeNull();
    paintCells[0][2] = COLOR_1;
    const paintedPattern = { ...editedPattern, cells: paintCells };
    const afterPaint = calculateUsedColors(paintedPattern);
    expect(afterPaint.totalBeads).toBe(afterErase.totalBeads + 1);
  });

  it('エクスポート用構造がローカル変換由来 PatternGrid で有効である', () => {
    const pattern = runLocalConvert();

    // エクスポーターが必要とするフィールドの存在チェック
    expect(pattern).toHaveProperty('width');
    expect(pattern).toHaveProperty('height');
    expect(pattern).toHaveProperty('cells');
    expect(pattern).toHaveProperty('beadType');
    expect(pattern).toHaveProperty('plateConfig');

    // computeExportDimensions / computeExportCellSize が動作すること
    const cellSize = computeExportCellSize({ cellSize: 20 });
    expect(cellSize).toBeGreaterThanOrEqual(20);

    const dims = computeExportDimensions(pattern, { cellSize: 20 });
    expect(dims.patternWidth).toBe(WIDTH * cellSize);
    expect(dims.patternHeight).toBe(HEIGHT * cellSize);
    expect(dims.width).toBeGreaterThanOrEqual(dims.patternWidth);
    expect(dims.height).toBeGreaterThanOrEqual(dims.patternHeight);
  });

  it('AI変換が失敗してもローカル変換は独立して利用可能である', async () => {
    // AI変換が失敗するシナリオ（fetch がネットワークエラーを返す）
    const originalFetch = global.fetch;
    global.fetch = vi.fn(() => Promise.reject(new TypeError('Network error')));

    const aiStrategy = new AIConversionStrategy();

    // AIお題生成は例外を投げる
    await expect(
      aiStrategy.generateFromText('ねこ', {
        width: WIDTH,
        height: HEIGHT,
        activePalette: ACTIVE_PALETTE,
        maxColors: null,
        apiKey: 'test-api-key',
        beadType: 'perler',
        plateConfig: { cols: 1, rows: 1 },
      }),
    ).rejects.toThrow();

    global.fetch = originalFetch;

    // その後でもローカル変換は正常に動作する
    const localPattern = runLocalConvert();
    expect(localPattern.width).toBe(WIDTH);
    expect(localPattern.height).toBe(HEIGHT);
    expect(localPattern.cells).toHaveLength(HEIGHT);

    // 下流機能（使用色一覧）も動作する
    const used = calculateUsedColors(localPattern);
    expect(used.totalBeads).toBe(7);
    expect(used.excludedCount).toBe(2);
  });
});
