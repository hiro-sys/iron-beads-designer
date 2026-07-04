// =============================================================================
// ナノビーズ カラーパレット定義（NANO_PALETTE）— 全55色
// =============================================================================
//
// 【出典】
//   ナノビーズ カタログ（カラーリスト）:
//     https://www.kawada-toys.com/brand/nanobeads/catalog/
//
//   本ファイルのRGB値は上記公式カタログ（色見本）の見た目に基づく「近似値」
//   である。印刷物・画面表示・製造ロット差により実物のビーズ色と完全に一致する
//   ことはない。画像変換時の最近色マッチング（CIE76 ΔE）の基準としてのみ用いる。
//
// 【対象色】
//   ナノビーズの全55色を収録。
//
// 【データ構造の方針】
//   - 各色は { id, name, nameEn, r, g, b } の「独立したレコード」として保持する。
//   - 将来、実物スキャンによる測色値での補正を可能にするため、id と name は
//     維持したまま r/g/b のみを差し替えられる構造とする。
//   - name は公式カラーリスト準拠の日本語名（内部キー・ソート等の基準としても
//     利用する、唯一の出典）。nameEn は日本語ロケール以外での表示用の英語名で、
//     参考訳（意訳）であり公式訳ではない。表示切替は i18n.js の getColorName /
//     UI各コンポーネントが担う。
//   - Lab色空間値（lab）はこのファイルではキャッシュしない。実行時に
//     initializePalette（data/beadConfig.js）が rgbToLab を用いて各レコードへ
//     付与する。
//
// 【id 体系】
//   本アプリ内の連番識別子として "N01"〜"N55"（ゼロ埋め2桁）を昇順で付与する。
//   これは公式型番そのものではなく、アプリ内でビーズ色を一意に識別するための
//   連番である（要件2.1, 2.3）。
//
// @typedef {Object} BeadColor
// @property {string} id     - 色の一意識別子（例: "N01"）
// @property {string} name   - 色名（公式カラーリスト準拠・日本語、内部キーの出典）
// @property {string} nameEn - 色名の英語表示用参考訳（日本語ロケール以外で使用）
// @property {number} r      - 赤成分 (0-255)
// @property {number} g      - 緑成分 (0-255)
// @property {number} b      - 青成分 (0-255)
// =============================================================================

/** @type {Array<{id: string, name: string, nameEn: string, r: number, g: number, b: number}>} */
export const NANO_PALETTE = [
  // --- 標準色（ベーシックカラー） -------------------------------------------
  { id: 'N01', name: 'しろ', nameEn: 'White', r: 242, g: 242, b: 242 },
  { id: 'N02', name: 'クリーム', nameEn: 'Cream', r: 255, g: 247, b: 210 },
  { id: 'N03', name: 'きいろ', nameEn: 'Yellow', r: 252, g: 220, b: 46 },
  { id: 'N04', name: 'やまぶき', nameEn: 'Golden Yellow', r: 249, g: 190, b: 44 },
  { id: 'N05', name: 'だいだい', nameEn: 'Orange', r: 244, g: 138, b: 46 },
  { id: 'N06', name: 'あか', nameEn: 'Red', r: 218, g: 46, b: 54 },
  { id: 'N07', name: 'さんご', nameEn: 'Coral', r: 232, g: 100, b: 84 },
  { id: 'N08', name: 'ローズ', nameEn: 'Rose', r: 200, g: 54, b: 96 },
  { id: 'N09', name: 'もも', nameEn: 'Peach', r: 246, g: 152, b: 172 },
  { id: 'N10', name: 'こいもも', nameEn: 'Deep Peach', r: 232, g: 98, b: 140 },
  { id: 'N11', name: 'ラベンダー', nameEn: 'Lavender', r: 182, g: 142, b: 197 },
  { id: 'N12', name: 'むらさき', nameEn: 'Purple', r: 112, g: 74, b: 153 },
  { id: 'N13', name: 'あお', nameEn: 'Blue', r: 40, g: 92, b: 172 },
  { id: 'N14', name: 'ぐんじょう', nameEn: 'Ultramarine', r: 32, g: 64, b: 142 },
  { id: 'N15', name: 'みずいろ', nameEn: 'Light Blue', r: 112, g: 184, b: 224 },
  { id: 'N16', name: 'そらいろ', nameEn: 'Sky Blue', r: 94, g: 164, b: 214 },
  { id: 'N17', name: 'とうめい', nameEn: 'Clear', r: 232, g: 232, b: 232 },
  { id: 'N18', name: 'みどり', nameEn: 'Green', r: 52, g: 142, b: 84 },
  { id: 'N19', name: 'ふかみどり', nameEn: 'Deep Green', r: 32, g: 104, b: 64 },
  { id: 'N20', name: 'きみどり', nameEn: 'Yellow Green', r: 152, g: 192, b: 74 },
  { id: 'N21', name: 'わかくさ', nameEn: 'Spring Green', r: 124, g: 178, b: 84 },
  { id: 'N22', name: 'ちゃいろ', nameEn: 'Brown', r: 132, g: 88, b: 54 },
  { id: 'N23', name: 'こげちゃ', nameEn: 'Dark Brown', r: 88, g: 58, b: 44 },
  { id: 'N24', name: 'うすだいだい', nameEn: 'Pale Orange', r: 250, g: 218, b: 184 },
  { id: 'N25', name: 'はだいろ', nameEn: 'Flesh', r: 246, g: 202, b: 164 },
  { id: 'N26', name: 'グレー', nameEn: 'Gray', r: 152, g: 152, b: 152 },
  { id: 'N27', name: 'ふかはいいろ', nameEn: 'Dark Gray', r: 102, g: 102, b: 104 },
  { id: 'N28', name: 'くろ', nameEn: 'Black', r: 44, g: 44, b: 46 },
  { id: 'N29', name: 'きん', nameEn: 'Gold', r: 192, g: 162, b: 94 },
  { id: 'N30', name: 'ぎん', nameEn: 'Silver', r: 178, g: 182, b: 186 },

  // --- パステルカラー -------------------------------------------------------
  { id: 'N31', name: 'パステルイエロー', nameEn: 'Pastel Yellow', r: 251, g: 241, b: 172 },
  { id: 'N32', name: 'パステルピンク', nameEn: 'Pastel Pink', r: 251, g: 206, b: 216 },
  { id: 'N33', name: 'パステルパープル', nameEn: 'Pastel Purple', r: 202, g: 188, b: 222 },
  { id: 'N34', name: 'パステルブルー', nameEn: 'Pastel Blue', r: 182, g: 212, b: 236 },
  { id: 'N35', name: 'パステルグリーン', nameEn: 'Pastel Green', r: 192, g: 226, b: 192 },

  // --- 蛍光（ネオン）カラー -------------------------------------------------
  { id: 'N36', name: 'ネオンレッド', nameEn: 'Neon Red', r: 255, g: 84, b: 84 },
  { id: 'N37', name: 'ネオンオレンジ', nameEn: 'Neon Orange', r: 255, g: 142, b: 54 },
  { id: 'N38', name: 'ネオンイエロー', nameEn: 'Neon Yellow', r: 241, g: 255, b: 84 },
  { id: 'N39', name: 'ネオングリーン', nameEn: 'Neon Green', r: 124, g: 231, b: 104 },
  { id: 'N40', name: 'ネオンピンク', nameEn: 'Neon Pink', r: 255, g: 112, b: 182 },
  { id: 'N41', name: 'ネオンブルー', nameEn: 'Neon Blue', r: 84, g: 182, b: 255 },

  // --- 追加色 ---------------------------------------------------------------
  { id: 'N42', name: 'あかむらさき', nameEn: 'Reddish Purple', r: 152, g: 52, b: 112 },
  { id: 'N43', name: 'すみれ', nameEn: 'Violet', r: 90, g: 80, b: 162 },
  { id: 'N44', name: 'シアン', nameEn: 'Cyan', r: 64, g: 184, b: 202 },
  { id: 'N45', name: 'ターコイズ', nameEn: 'Turquoise', r: 74, g: 166, b: 164 },
  { id: 'N46', name: 'エメラルド', nameEn: 'Emerald', r: 62, g: 152, b: 132 },
  { id: 'N47', name: 'ぬのじ', nameEn: 'Linen', r: 224, g: 212, b: 192 },
  { id: 'N48', name: 'しゅ', nameEn: 'Vermilion', r: 212, g: 74, b: 54 },
  { id: 'N49', name: 'あんず', nameEn: 'Apricot', r: 250, g: 172, b: 94 },
  { id: 'N50', name: 'さくらいろ', nameEn: 'Sakura Pink', r: 248, g: 186, b: 196 },
  { id: 'N51', name: 'ラズベリー', nameEn: 'Raspberry', r: 177, g: 47, b: 84 },
  { id: 'N52', name: 'スカイブルー', nameEn: 'Sky Blue (Vivid)', r: 132, g: 197, b: 232 },
  { id: 'N53', name: 'あさぎ', nameEn: 'Pale Cyan', r: 97, g: 192, b: 182 },
  { id: 'N54', name: 'ライム', nameEn: 'Lime', r: 197, g: 212, b: 82 },
  { id: 'N55', name: 'もえぎ', nameEn: 'Moss Green', r: 82, g: 157, b: 64 },
];
