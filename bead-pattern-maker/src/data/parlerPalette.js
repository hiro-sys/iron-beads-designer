// =============================================================================
// パーラービーズ カラーパレット定義（PARLER_PALETTE）— 単色販売色 全100色
// =============================================================================
//
// 【出典】
//   パーラービーズ 単色カラーリスト Vol.7:
//     https://www.kawada-toys.com/wp-content/uploads/2026/02/perlerbeads_colorlist_vol7.pdf
//   パーラービーズ 単色販売なし（セット専用）色一覧（除外対象）:
//     https://www.kawada-toys.com/brand/perlerbeads/uncolorlist/
//
//   本ファイルのRGB値は上記公式カラーリスト（色見本）の見た目に基づく「近似値」
//   である。印刷物・画面表示・製造ロット差により実物のビーズ色と完全に一致する
//   ことはない。画像変換時の最近色マッチング（CIE76 ΔE）の基準としてのみ用いる。
//
// 【対象色】
//   単色（バラ）で購入可能な100色を収録。セット専用色（ネオン・ストライプ系の
//   計8色）は含めない。
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
//   本アプリ内の連番識別子として "P01"〜"P100" を付与する（P100のみ3桁）。
//   公式型番そのものではなく、アプリ内でビーズ色を一意に識別するための連番
//   である（要件2.1, 2.3）。
//   ※ P53/P54 の番号順は公式カラーリストの掲載順に準拠する。
//
// @typedef {Object} BeadColor
// @property {string} id     - 色の一意識別子（例: "P01"）
// @property {string} name   - 色名（公式カラーリスト準拠・日本語、内部キーの出典）
// @property {string} nameEn - 色名の英語表示用参考訳（日本語ロケール以外で使用）
// @property {number} r      - 赤成分 (0-255)
// @property {number} g      - 緑成分 (0-255)
// @property {number} b      - 青成分 (0-255)
// =============================================================================

/** @type {Array<{id: string, name: string, nameEn: string, r: number, g: number, b: number}>} */
export const PARLER_PALETTE = [
  // --- 標準色（ベーシックカラー） -------------------------------------------
  { id: 'P01', name: 'しろ', nameEn: 'White', r: 241, g: 241, b: 241 },
  { id: 'P02', name: 'クリーム', nameEn: 'Cream', r: 255, g: 246, b: 207 },
  { id: 'P03', name: 'きいろ', nameEn: 'Yellow', r: 252, g: 219, b: 40 },
  { id: 'P04', name: 'やまぶき', nameEn: 'Golden Yellow', r: 249, g: 191, b: 38 },
  { id: 'P05', name: 'だいだい', nameEn: 'Orange', r: 244, g: 140, b: 42 },
  { id: 'P06', name: 'あか', nameEn: 'Red', r: 219, g: 46, b: 52 },
  { id: 'P07', name: 'さんご', nameEn: 'Coral', r: 234, g: 100, b: 82 },
  { id: 'P08', name: 'ローズ', nameEn: 'Rose', r: 200, g: 52, b: 92 },
  { id: 'P09', name: 'もも', nameEn: 'Peach', r: 245, g: 151, b: 170 },
  { id: 'P10', name: 'こいもも', nameEn: 'Deep Peach', r: 234, g: 100, b: 142 },
  { id: 'P11', name: 'ラベンダー', nameEn: 'Lavender', r: 180, g: 140, b: 195 },
  { id: 'P12', name: 'むらさき', nameEn: 'Purple', r: 110, g: 72, b: 151 },
  { id: 'P13', name: 'あお', nameEn: 'Blue', r: 39, g: 90, b: 170 },
  { id: 'P14', name: 'ぐんじょう', nameEn: 'Ultramarine', r: 31, g: 62, b: 140 },
  { id: 'P15', name: 'みずいろ', nameEn: 'Light Blue', r: 110, g: 182, b: 222 },
  { id: 'P16', name: 'そらいろ', nameEn: 'Sky Blue', r: 92, g: 162, b: 212 },
  { id: 'P17', name: 'とうめい', nameEn: 'Clear', r: 230, g: 230, b: 230 },
  { id: 'P18', name: 'マリンブルー', nameEn: 'Marine Blue', r: 50, g: 120, b: 165 },
  { id: 'P19', name: 'みどり', nameEn: 'Green', r: 50, g: 140, b: 82 },
  { id: 'P20', name: 'ふかみどり', nameEn: 'Deep Green', r: 30, g: 102, b: 62 },
  { id: 'P21', name: 'きみどり', nameEn: 'Yellow Green', r: 150, g: 191, b: 72 },
  { id: 'P22', name: 'わかくさ', nameEn: 'Spring Green', r: 122, g: 176, b: 82 },
  { id: 'P23', name: 'オリーブ', nameEn: 'Olive', r: 108, g: 122, b: 62 },
  { id: 'P24', name: 'ちゃいろ', nameEn: 'Brown', r: 131, g: 86, b: 52 },
  { id: 'P25', name: 'こげちゃ', nameEn: 'Dark Brown', r: 86, g: 56, b: 42 },
  { id: 'P26', name: 'キャラメル', nameEn: 'Caramel', r: 170, g: 110, b: 60 },
  { id: 'P27', name: 'うすだいだい', nameEn: 'Pale Orange', r: 250, g: 216, b: 182 },
  { id: 'P28', name: 'はだいろ', nameEn: 'Flesh', r: 245, g: 201, b: 162 },
  { id: 'P29', name: 'タン', nameEn: 'Tan', r: 200, g: 160, b: 120 },
  { id: 'P30', name: 'グレー', nameEn: 'Gray', r: 150, g: 150, b: 150 },
  { id: 'P31', name: 'ふかはいいろ', nameEn: 'Dark Gray', r: 100, g: 100, b: 102 },
  { id: 'P32', name: 'くろ', nameEn: 'Black', r: 42, g: 42, b: 44 },
  { id: 'P33', name: 'あかむらさき', nameEn: 'Reddish Purple', r: 150, g: 50, b: 110 },
  { id: 'P34', name: 'すみれ', nameEn: 'Violet', r: 88, g: 78, b: 160 },
  { id: 'P35', name: 'シアン', nameEn: 'Cyan', r: 62, g: 182, b: 200 },
  { id: 'P36', name: 'ターコイズ', nameEn: 'Turquoise', r: 72, g: 164, b: 162 },
  { id: 'P37', name: 'エメラルド', nameEn: 'Emerald', r: 60, g: 150, b: 130 },
  { id: 'P38', name: 'ぬのじ', nameEn: 'Linen', r: 222, g: 210, b: 190 },
  { id: 'P39', name: 'しゅ', nameEn: 'Vermilion', r: 210, g: 72, b: 52 },
  { id: 'P40', name: 'あんず', nameEn: 'Apricot', r: 248, g: 170, b: 92 },
  { id: 'P41', name: 'さくらいろ', nameEn: 'Sakura Pink', r: 246, g: 185, b: 195 },
  { id: 'P42', name: 'ピーチ', nameEn: 'Peach (Vivid)', r: 252, g: 200, b: 160 },
  { id: 'P43', name: 'ラズベリー', nameEn: 'Raspberry', r: 175, g: 45, b: 82 },
  { id: 'P44', name: 'プラム', nameEn: 'Plum', r: 130, g: 50, b: 100 },
  { id: 'P45', name: 'スカイブルー', nameEn: 'Sky Blue (Vivid)', r: 130, g: 195, b: 230 },
  { id: 'P46', name: 'あさぎ', nameEn: 'Pale Cyan', r: 95, g: 190, b: 180 },
  { id: 'P47', name: 'ティール', nameEn: 'Teal', r: 42, g: 115, b: 120 },
  { id: 'P48', name: 'トパーズ', nameEn: 'Topaz', r: 62, g: 130, b: 175 },
  { id: 'P49', name: 'インディゴ', nameEn: 'Indigo', r: 50, g: 52, b: 120 },
  { id: 'P50', name: 'コバルト', nameEn: 'Cobalt', r: 35, g: 75, b: 155 },
  { id: 'P51', name: 'ライム', nameEn: 'Lime', r: 195, g: 210, b: 80 },
  { id: 'P52', name: 'もえぎ', nameEn: 'Moss Green', r: 80, g: 155, b: 62 },
  // ※ P53/P54 の番号順は公式カラーリスト掲載順に準拠
  { id: 'P53', name: 'カーキ', nameEn: 'Khaki', r: 120, g: 115, b: 72 },
  { id: 'P54', name: 'ラスト', nameEn: 'Rust', r: 165, g: 70, b: 42 },
  { id: 'P55', name: 'バーガンディ', nameEn: 'Burgundy', r: 110, g: 35, b: 52 },
  { id: 'P56', name: 'セピア', nameEn: 'Sepia', r: 105, g: 72, b: 52 },
  { id: 'P57', name: 'ダークグレー', nameEn: 'Dark Gray (Deep)', r: 72, g: 72, b: 74 },
  { id: 'P58', name: 'チャコール', nameEn: 'Charcoal', r: 56, g: 58, b: 60 },
  { id: 'P59', name: 'きん', nameEn: 'Gold', r: 191, g: 160, b: 92 },
  { id: 'P60', name: 'ぎん', nameEn: 'Silver', r: 176, g: 180, b: 184 },

  // --- パステルカラー -------------------------------------------------------
  { id: 'P61', name: 'パステルイエロー', nameEn: 'Pastel Yellow', r: 250, g: 240, b: 170 },
  { id: 'P62', name: 'パステルオレンジ', nameEn: 'Pastel Orange', r: 250, g: 212, b: 170 },
  { id: 'P63', name: 'パステルピンク', nameEn: 'Pastel Pink', r: 250, g: 205, b: 214 },
  { id: 'P64', name: 'パステルパープル', nameEn: 'Pastel Purple', r: 201, g: 186, b: 221 },
  { id: 'P65', name: 'パステルブルー', nameEn: 'Pastel Blue', r: 181, g: 211, b: 235 },
  { id: 'P66', name: 'パステルグリーン', nameEn: 'Pastel Green', r: 191, g: 225, b: 191 },
  { id: 'P67', name: 'パステルラベンダー', nameEn: 'Pastel Lavender', r: 210, g: 200, b: 225 },
  { id: 'P68', name: 'パステルアクア', nameEn: 'Pastel Aqua', r: 180, g: 225, b: 220 },
  { id: 'P69', name: 'パステルローズ', nameEn: 'Pastel Rose', r: 248, g: 190, b: 195 },
  { id: 'P70', name: 'パステルライム', nameEn: 'Pastel Lime', r: 215, g: 235, b: 170 },

  // --- 蛍光（ネオン）カラー -------------------------------------------------
  { id: 'P71', name: 'ネオンレッド', nameEn: 'Neon Red', r: 255, g: 82, b: 82 },
  { id: 'P72', name: 'ネオンオレンジ', nameEn: 'Neon Orange', r: 255, g: 140, b: 52 },
  { id: 'P73', name: 'ネオンイエロー', nameEn: 'Neon Yellow', r: 240, g: 255, b: 82 },
  { id: 'P74', name: 'ネオングリーン', nameEn: 'Neon Green', r: 122, g: 230, b: 102 },
  { id: 'P75', name: 'ネオンピンク', nameEn: 'Neon Pink', r: 255, g: 110, b: 180 },
  { id: 'P76', name: 'ネオンブルー', nameEn: 'Neon Blue', r: 82, g: 180, b: 255 },

  // --- パールカラー ---------------------------------------------------------
  { id: 'P77', name: 'パールホワイト', nameEn: 'Pearl White', r: 236, g: 236, b: 226 },
  { id: 'P78', name: 'パールイエロー', nameEn: 'Pearl Yellow', r: 238, g: 232, b: 195 },
  { id: 'P79', name: 'パールピンク', nameEn: 'Pearl Pink', r: 240, g: 212, b: 212 },
  { id: 'P80', name: 'パールローズ', nameEn: 'Pearl Rose', r: 232, g: 195, b: 200 },
  { id: 'P81', name: 'パールブルー', nameEn: 'Pearl Blue', r: 192, g: 206, b: 221 },
  { id: 'P82', name: 'パールスカイブルー', nameEn: 'Pearl Sky Blue', r: 200, g: 218, b: 230 },
  { id: 'P83', name: 'パールグリーン', nameEn: 'Pearl Green', r: 200, g: 220, b: 200 },
  { id: 'P84', name: 'パールゴールド', nameEn: 'Pearl Gold', r: 212, g: 191, b: 142 },
  { id: 'P85', name: 'パールコーラル', nameEn: 'Pearl Coral', r: 235, g: 200, b: 185 },
  { id: 'P86', name: 'パールラベンダー', nameEn: 'Pearl Lavender', r: 210, g: 195, b: 215 },

  // --- とうめいカラー -------------------------------------------------------
  { id: 'P87', name: 'とうめいイエロー', nameEn: 'Clear Yellow', r: 252, g: 230, b: 120 },
  { id: 'P88', name: 'とうめいオレンジ', nameEn: 'Clear Orange', r: 248, g: 160, b: 80 },
  { id: 'P89', name: 'とうめいレッド', nameEn: 'Clear Red', r: 215, g: 80, b: 80 },
  { id: 'P90', name: 'とうめいピンク', nameEn: 'Clear Pink', r: 240, g: 150, b: 170 },
  { id: 'P91', name: 'とうめいパープル', nameEn: 'Clear Purple', r: 160, g: 120, b: 180 },
  { id: 'P92', name: 'とうめいブルー', nameEn: 'Clear Blue', r: 100, g: 160, b: 210 },
  { id: 'P93', name: 'とうめいグリーン', nameEn: 'Clear Green', r: 100, g: 180, b: 120 },
  { id: 'P94', name: 'とうめいアクア', nameEn: 'Clear Aqua', r: 110, g: 195, b: 195 },

  // --- 追加色 ---------------------------------------------------------------
  { id: 'P95', name: 'しゅいろ', nameEn: 'Scarlet', r: 230, g: 88, b: 50 },
  { id: 'P96', name: 'テラコッタ', nameEn: 'Terracotta', r: 185, g: 95, b: 62 },
  { id: 'P97', name: 'マゼンタ', nameEn: 'Magenta', r: 200, g: 50, b: 130 },
  { id: 'P98', name: 'ミッドナイト', nameEn: 'Midnight', r: 30, g: 42, b: 80 },
  { id: 'P99', name: 'アイス', nameEn: 'Ice', r: 210, g: 232, b: 242 },
  { id: 'P100', name: 'ミント', nameEn: 'Mint', r: 165, g: 220, b: 190 },
];
