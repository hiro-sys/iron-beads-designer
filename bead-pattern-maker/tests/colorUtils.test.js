import { describe, it, expect } from 'vitest';
import { rgbToLab } from '../src/utils/colorUtils.js';

// =============================================================================
// 色変換ユーティリティ（colorUtils.js）のユニットテスト
// -----------------------------------------------------------------------------
// 対象: src/utils/colorUtils.js の rgbToLab(r, g, b)
//
// タスク2.6 のうち colorUtils 分。既知の RGB→Lab 変換値（白・黒・原色）と
// 無彩色・境界値を検証する。期待値は sRGB（D65 白色点）標準の公開 Lab 値であり、
// 実装が標準的な CIE76 用の変換を行えていることを確認する（循環参照を避けるため、
// 実装の出力そのものではなく確立された標準値と突き合わせる）。
//
// **検証対象: Requirements 4.2, 4.3**
// =============================================================================

describe('colorUtils.rgbToLab / ユニットテスト（タスク2.6）', () => {
  // --- 白・黒（無彩色の両端） ----------------------------------------------
  it('白(255,255,255) → L≈100, a≈0, b≈0', () => {
    const lab = rgbToLab(255, 255, 255);
    expect(lab.L).toBeCloseTo(100, 2);
    expect(lab.a).toBeCloseTo(0, 2);
    expect(lab.b).toBeCloseTo(0, 2);
  });

  it('黒(0,0,0) → L=0, a=0, b=0', () => {
    const lab = rgbToLab(0, 0, 0);
    expect(lab.L).toBeCloseTo(0, 4);
    expect(lab.a).toBeCloseTo(0, 4);
    expect(lab.b).toBeCloseTo(0, 4);
  });

  // --- 原色（RGB プライマリ）の既知 Lab 値 ---------------------------------
  // 期待値は sRGB / D65 における標準的な Lab 値（小数2桁まで）。
  it('赤(255,0,0) → L≈53.24, a≈80.09, b≈67.20', () => {
    const lab = rgbToLab(255, 0, 0);
    expect(lab.L).toBeCloseTo(53.24, 1);
    expect(lab.a).toBeCloseTo(80.09, 1);
    expect(lab.b).toBeCloseTo(67.2, 1);
  });

  it('緑(0,255,0) → L≈87.73, a≈-86.18, b≈83.18', () => {
    const lab = rgbToLab(0, 255, 0);
    expect(lab.L).toBeCloseTo(87.73, 1);
    expect(lab.a).toBeCloseTo(-86.18, 1);
    expect(lab.b).toBeCloseTo(83.18, 1);
  });

  it('青(0,0,255) → L≈32.30, a≈79.19, b≈-107.86', () => {
    const lab = rgbToLab(0, 0, 255);
    expect(lab.L).toBeCloseTo(32.3, 1);
    expect(lab.a).toBeCloseTo(79.19, 1);
    expect(lab.b).toBeCloseTo(-107.86, 1);
  });

  // --- 無彩色（中間グレー） -------------------------------------------------
  it('中間グレー(128,128,128) → 無彩色（a≈0, b≈0）でLは0と100の間', () => {
    const lab = rgbToLab(128, 128, 128);
    // R=G=B の無彩色は a≈0, b≈0 になる。
    expect(lab.a).toBeCloseTo(0, 2);
    expect(lab.b).toBeCloseTo(0, 2);
    // 明度は黒と白の間に収まる。
    expect(lab.L).toBeGreaterThan(0);
    expect(lab.L).toBeLessThan(100);
  });

  // --- 構造・有限性 ---------------------------------------------------------
  it('返り値は {L, a, b} を持ち、いずれも有限値である', () => {
    const lab = rgbToLab(10, 20, 30);
    expect(lab).toHaveProperty('L');
    expect(lab).toHaveProperty('a');
    expect(lab).toHaveProperty('b');
    expect(Number.isFinite(lab.L)).toBe(true);
    expect(Number.isFinite(lab.a)).toBe(true);
    expect(Number.isFinite(lab.b)).toBe(true);
  });

  // --- 無彩色の単調性（明るいほどLが大きい） -------------------------------
  it('無彩色の明度Lは入力が明るいほど大きい（黒 < 中間グレー < 白）', () => {
    const black = rgbToLab(0, 0, 0).L;
    const gray = rgbToLab(128, 128, 128).L;
    const white = rgbToLab(255, 255, 255).L;
    expect(black).toBeLessThan(gray);
    expect(gray).toBeLessThan(white);
  });
});
