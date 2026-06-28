# 実装計画: Bead Pattern Maker

## 概要

本実装計画は、設計書「技術設計書: Bead Pattern Maker」を、コード生成LLMが段階的に実装できる一連のコーディングタスクへ分解したものである。実装は依存関係の少ない基盤から積み上げ、各ステップが前のステップの上に構築されるように並べてある。最終的に `main.js` で全コンポーネントを結線し、孤立したコードが残らないようにする。

実装言語は設計どおり Vanilla JavaScript（ESモジュール）、テストは Vitest + fast-check（プロパティベーステスト）を用いる。

実装順序の基本方針:

1. 色変換基盤（`utils/colorUtils.js` の RGB⇔Lab 変換、`engine/colorMatcher.js` の CIE76・最近色検索）
2. データ（カラーパレット、ビーズ設定）
3. グリッド計算・バリデーション
4. 画像処理エンジン（リサイズ／フィット）、減色、背景検出
5. 変換エンジン（Strategy）でパイプラインを統合
6. 状態管理、描画（Canvas）、エクスポート、おすすめサイズ計算
7. UIコンポーネント
8. `main.js`・`index.html`・`style.css` での全体配線

変換パイプラインの順序（設計の `LocalConversionStrategy`）: フィット／リサイズ → 透明判定・白合成 → 減色（任意） → パレット最近色マッチング → 背景除外（任意） → 手動編集。

> **プロパティテストの注記**: `*` 付きの各プロパティテストは fast-check で最低100回反復実行し、テストにはタグ `Feature: bead-pattern-maker, Property {番号}: {プロパティ文}` を付与する。テストファイルは `tests/` 配下に配置する。

## タスク

- [x] 1. プロジェクトセットアップとテスト基盤の構築
  - `package.json` の devDependencies に `vitest` と `fast-check` を追加する
  - `vitest.config.js` を作成し、`test` スクリプト（`vitest --run`）と coverage 設定を追加する
  - `src/engine/`, `src/renderer/`, `src/data/`, `src/ui/`, `src/utils/`, `tests/` のディレクトリ構造を作成する
  - `tests/` 配下に Canvas API のモック用ヘルパー（jsdom/canvasモック）の雛形を用意する
  - _対象: 設計「テスト戦略」「ファイル構成」セクション_

- [ ] 2. 色変換基盤（カラーユーティリティと色マッチング）
  - [x] 2.1 RGB⇔Lab変換ユーティリティを実装する
    - `src/utils/colorUtils.js` を作成する
    - `rgbToLab(r, g, b)` を実装する（sRGBリニア化 → XYZ変換 → Lab変換、D65白色点基準）
    - _Requirements: 4.3_

  - [x] 2.2 CIE76色差計算・最近色検索・パレット再マッピングを実装する
    - `src/engine/colorMatcher.js` を作成する
    - `deltaE(lab1, lab2)` を実装する（ユークリッド距離によるCIE76）
    - `findClosestColor(targetColor, palette)` を実装する（パレット内ΔE最小の色を返す）
    - `remapPattern(pattern, newPalette)` を実装する（全セルを新パレットの最近色へ再マッピング、nullセルは維持）
    - _Requirements: 4.2, 4.3, 2.4_

  - [x] 2.3 deltaE の数学的性質のプロパティテストを書く
    - **Property 8: CIE76 ΔEの数学的性質**（非負性・同一色=0・対称性）
    - **検証対象: Requirements 4.3**

  - [x] 2.4 findClosestColor の正確性のプロパティテストを書く
    - **Property 7: 最近色変換の正確性**（返す色はパレット内のどの色よりもΔEが小さいか等しい）
    - **検証対象: Requirements 4.2, 4.3**

  - [x] 2.5 remapPattern のプロパティテストを書く
    - **Property 2: ビーズタイプ切替時の色再マッピング**（全セルが新パレット内かつ元色に対するΔE最小色）
    - **検証対象: Requirements 2.4**

  - [x] 2.6 colorUtils / colorMatcher のユニットテストを書く
    - 既知のRGB↔Lab変換値、白・黒・原色の境界値を検証する
    - _Requirements: 4.2, 4.3_

- [ ] 3. カラーパレットデータとビーズ設定
  - [x] 3.1 パーラービーズ・ナノビーズのパレットデータを定義する
    - `src/data/parlerPalette.js`（`PARLER_PALETTE`）を作成する
    - `src/data/nanoPalette.js`（`NANO_PALETTE`）を作成する
    - 各色を `{ id, name, r, g, b }` の独立レコードとして定義し、出典（公式カラーチャート等）をコードコメントで明記する
    - _Requirements: 2.1, 2.3, 2.6_

  - [x] 3.2 ビーズ設定とパレット初期化ヘルパーを実装する
    - `src/data/beadConfig.js` を作成する
    - `BEAD_CONFIG`（perler: pegCount 29 / nano: pegCount 28、ラベル）を定義する
    - `initializePalette(palette)` を実装し、各色に `lab` をキャッシュする（`colorUtils.rgbToLab` を使用）
    - _Requirements: 2.6, 3.3_

- [ ] 4. グリッド計算とバリデーション
  - [x] 4.1 グリッド計算と各種バリデーションを実装する
    - `src/utils/validation.js` を作成する
    - `calculateTotalBeads(plateConfig, beadType)` を実装する（(cols×pegCount)×(rows×pegCount)）
    - `createEmptyGrid(plateConfig, beadType)` を実装する（全セルnullの空グリッド生成）
    - `validatePlateCount(value)` を実装する（1〜10の整数のみ有効、負数/0/小数/非数値を無効）
    - `validateImageFile(file)` を実装する（JPEG/PNG/GIF/WebP かつ 10MB以下のみ許可）
    - _Requirements: 3.3, 3.4, 3.1, 3.2, 3.6, 1.2, 1.4, 1.6_

  - [x] 4.2 総ビーズ数計算のプロパティテストを書く
    - **Property 4: 総ビーズ数計算の正確性**
    - **検証対象: Requirements 3.3**

  - [x] 4.3 空グリッド生成のプロパティテストを書く
    - **Property 5: プレート構成変更時のグリッドサイズ**（幅=cols×pegCount, 高さ=rows×pegCount, 全セル未配置）
    - **検証対象: Requirements 3.4**

  - [x] 4.4 プレート枚数バリデーションのプロパティテストを書く
    - **Property 3: プレート枚数バリデーション**
    - **検証対象: Requirements 3.1, 3.2, 3.6**

  - [x] 4.5 ファイルバリデーションのプロパティテストを書く
    - **Property 1: ファイルバリデーションの正確性**
    - **検証対象: Requirements 1.2, 1.4, 1.6**

- [ ] 5. 画像処理エンジン（リサイズ・フィット）
  - [x] 5.1 画像リサイズ・フィット処理を実装する
    - `src/engine/imageProcessor.js` を作成する
    - `resizeImage(image, targetWidth, targetHeight, options)` を実装する
    - 描画前にオフスクリーンCanvasを透明（alpha=0）でクリアする（`clearRect`）
    - リサイズ方式: `smooth`（`imageSmoothingEnabled=true`/`quality='high'`）/ `sharp`（`imageSmoothingEnabled=false`、最近傍）を切り替える
    - フィットモード: `stretch`（全面伸縮）/ `contain`（アスペクト維持・中央寄せ・余白は透明）/ `cover`（アスペクト維持・はみ出しクリップ）の描画矩形を切り替える
    - _Requirements: 4.1, 10.2, 10.3, 10.5, 10.6, 10.7_

  - [x] 5.2 リサイズ出力サイズのプロパティテストを書く
    - **Property 6: 画像リサイズ出力サイズ**（出力幅=cols×pegCount, 高さ=rows×pegCount）
    - **検証対象: Requirements 4.1**

  - [x] 5.3 フィットモード出力寸法のプロパティテストを書く
    - **Property 18: フィットモードの出力寸法**（fitModeに関わらず寸法不変）
    - **検証対象: Requirements 10.5, 10.6, 10.7**

  - [x] 5.4 imageProcessor のユニットテストを書く
    - smooth/sharp の補間設定、contain の余白が透明であることを検証する
    - _Requirements: 10.2, 10.3, 10.6_

- [ ] 6. 減色モジュール
  - [x] 6.1 減色処理を実装する
    - `src/engine/colorReducer.js` を作成する
    - `reduceColors(pixels, maxColors)` を median cut（または簡易量子化）で実装する
    - 各ピクセルを代表色へ写像する `mapping` を返す
    - `maxColors` が `null`/`'unlimited'` の場合は減色せず入力をそのまま通す（パススルー）
    - _Requirements: 11.4_

  - [x] 6.2 減色の上限保証のプロパティテストを書く
    - **Property 20: 減色の上限保証**（代表色の数 ≤ maxColors）
    - **検証対象: Requirements 11.4**

  - [x] 6.3 colorReducer のユニットテストを書く
    - 単色画像、maxColors=1、パススルー（null）のケースを検証する
    - _Requirements: 11.4_

- [ ] 7. 背景検出・除外モジュール
  - [x] 7.1 背景色の自動検出を実装する
    - `src/engine/backgroundDetector.js` を作成する
    - `detectBackgroundColor(imageData, width, height)` を実装する（四隅から各3x3=計36サンプル、ΔE≤5でグルーピングし最大グループの代表色を返す）
    - _Requirements: 9.1_

  - [x] 7.2 背景除外の判定と適用を実装する
    - `backgroundDetector.js` に `isBackgroundColor(pixelColor, backgroundColor, threshold)` を実装する
    - `applyBackgroundExclusion(pattern, backgroundColor, threshold)` を実装する（新規オブジェクトを返し `originalCells` を保持、背景に該当するセルを `cells` で null にする）
    - 比較はビーズ色空間で行う前提とし、生の背景色は呼び出し側で `findClosestColor` により有効パレット最近色へ変換してから渡す
    - _Requirements: 9.2, 9.3, 9.5, 9.8, 9.9_

  - [x] 7.3 背景自動検出の一貫性のプロパティテストを書く
    - **Property 14: 背景自動検出の一貫性**（四隅が同一色ならその色を返す）
    - **検証対象: Requirements 9.1**

  - [x] 7.4 背景除外閾値の単調性のプロパティテストを書く
    - **Property 15: 背景除外閾値の単調性**（T1<T2 のとき未配置セル数は T1≤T2）
    - **検証対象: Requirements 9.3, 9.4**

  - [x] 7.5 背景除外トグルの可逆性のプロパティテストを書く
    - **Property 17: 背景除外トグルの可逆性**（ON→OFFで全セルが元のビーズ色に復元、欠損なし）
    - **検証対象: Requirements 9.8, 9.9**

  - [x] 7.6 背景色の色空間整合性のプロパティテストを書く
    - **Property 23: 背景色の色空間整合性**（背景色を有効パレット最近色へ変換した上でビーズ色空間で判定）
    - **検証対象: Requirements 9.2**

  - [x] 7.7 backgroundDetector のユニットテストを書く
    - 四隅が異なる色のケース、閾値0/50の境界を検証する
    - _Requirements: 9.1, 9.3_

- [x] 8. チェックポイント — 基盤モジュールのテスト確認
  - すべてのテストが通ることを確認し、疑問があればユーザーに確認する。

- [ ] 9. 変換エンジン（Strategy）
  - [x] 9.1 ConversionStrategy インターフェースを定義する
    - `src/engine/ConversionStrategy.js` を作成する
    - `convert(image, options)` を持つStrategyの型（JSDoc typedef）と `ConversionOptions` を定義する
    - _Requirements: 4.9_

  - [x] 9.2 LocalConversionStrategy を実装する
    - `src/engine/LocalConversionStrategy.js` を作成する
    - パイプラインを実装する: フィット／リサイズ（imageProcessor）→ 透明判定（alpha<128 は null）と白背景合成（alpha≥128）→ 減色（colorReducer、maxColors指定時）→ 有効パレット最近色マッチング（colorMatcher）→ 背景除外（任意、backgroundDetector）
    - `PatternGrid` を生成し、`cells`（背景除外後）と `originalCells`（背景除外前）を保持する
    - 生成失敗時は例外を投げ、呼び出し側がエラー表示・前回図案保持できるようにする
    - _Requirements: 4.2, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 10.5, 10.6, 10.7, 11.2, 11.4_

  - [x] 9.3 透明ピクセルの未配置変換のプロパティテストを書く
    - **Property 19: 透明ピクセルの未配置変換**（alpha<128→null, alpha≥128→非null）
    - **検証対象: Requirements 4.6, 4.7**

  - [x] 9.4 無効色の除外のプロパティテストを書く
    - **Property 21: 無効色の除外**（非nullセルは全て有効パレット内、無効化色は不使用）
    - **検証対象: Requirements 11.2**

  - [x] 9.5 LocalConversionStrategy のユニットテストを書く
    - パイプライン順序（減色→マッチング）、白合成、背景除外オフ時の透明→null を検証する
    - _Requirements: 4.4, 4.6, 4.7, 11.4_

- [ ] 10. アプリケーション状態管理
  - [x] 10.1 状態管理を実装する
    - `src/state.js` を作成する
    - `AppState` の初期値（beadType=perler, plateConfig=1x1, zoom=1.0, resizeMethod='smooth', fitMode='contain', disabledColorIds=[], maxColors=null, backgroundExclusion 初期値, editTool）を定義する
    - ズーム値を 0.5〜4.0 にクランプするsetterを実装する
    - 各種setter（beadType, plateConfig, 背景除外設定, resizeMethod/fitMode, disabledColorIds, maxColors, editTool）と変更通知の仕組みを実装する
    - _Requirements: 2.1, 3.5, 5.3, 10.1, 10.4, 11.3_

  - [x] 10.2 ズーム値クランプのプロパティテストを書く
    - **Property 9: ズーム値のクランプ**（0.5以上4.0以下にクランプ）
    - **検証対象: Requirements 5.3**

  - [x] 10.3 state のユニットテストを書く
    - 初期値、各setterの反映、ズーム境界（0.4→0.5, 5.0→4.0）を検証する
    - _Requirements: 2.1, 3.5, 5.3_

- [ ] 11. 使用色一覧計算
  - [x] 11.1 使用色一覧の計算とリスト描画を実装する
    - `src/ui/colorList.js` を作成する
    - `calculateUsedColors(pattern)` を実装する（nullセルを除外、使用個数の降順→色名昇順でソート、合計個数、未配置セル数と割合を算出）
    - 色見本・色名・使用個数のリストと、未配置情報（リスト外）をDOMに描画する
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 9.7_

  - [x] 11.2 使用色一覧の正確性のプロパティテストを書く
    - **Property 10: 使用色一覧の正確性**（色集合の一致、使用個数合計＝全セル数）
    - **検証対象: Requirements 6.1, 6.4**

  - [x] 11.3 使用色ソート順のプロパティテストを書く
    - **Property 11: 使用色ソート順**（個数降順、同数は色名昇順）
    - **検証対象: Requirements 6.3**

  - [x] 11.4 未配置セル除外の色カウント整合性のプロパティテストを書く
    - **Property 16: 未配置セル除外の色カウント整合性**（色合計＋未配置数＝全セル数）
    - **検証対象: Requirements 9.7**

- [ ] 12. Canvas描画とエクスポート
  - [x] 12.1 Canvas描画エンジンを実装する
    - `src/renderer/canvasRenderer.js` を作成する
    - `renderPattern(canvas, pattern, options)` を実装する（ビーズセル塗り、セル境界線1px/#ccc、プレート境界線2px/#333、ズーム対応でCanvasサイズ可変）
    - `renderHatchedCell(ctx, x, y, size)` を実装する（白背景＋#cccの45度対角線ハッチング、3px間隔）でnullセルを描画する
    - _Requirements: 5.1, 5.2, 5.3, 9.6_

  - [x] 12.2 PNGエクスポーターを実装する
    - `src/renderer/exporter.js` を作成する
    - `exportAsPng(pattern, usedColors, options)` を実装する（セルサイズ最低20px、ハッチングでnullセル描画、図案下部に使用色一覧を描画、`toBlob`＋`createObjectURL`でダウンロード）
    - ビーズが1つも無い場合はエクスポートせずメッセージを返す。エクスポート失敗時はエラーを返し図案データを保持する
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 12.3 エクスポートセルサイズ保証のプロパティテストを書く
    - **Property 12: エクスポートセルサイズ保証**（セルサイズ≥20px、画像全体≥(w×cellSize)×(h×cellSize)）
    - **検証対象: Requirements 7.1**

  - [x] 12.4 canvasRenderer / exporter の純ロジックのユニットテストを書く
    - セルサイズ計算、ズーム時のCanvas寸法計算を検証する（描画自体はブラウザ手動テスト）
    - _Requirements: 7.1, 5.3_

- [ ] 13. おすすめサイズ計算
  - [x] 13.1 推奨プレート構成の計算を実装する
    - `src/ui/recommendedSizes.js` を作成し、純関数 `calculateRecommendedSizes(imageWidth, imageHeight, pegCount)` をエクスポートする
    - 1x1〜10x10を候補列挙し、アスペクト比差分の昇順でソート、上位3件（小さい画像は1x1のみ）を返す
    - 各候補に総ビーズ数・縮小率・アスペクト差分を含める
    - _Requirements: 8.1, 8.2, 8.4, 8.5_

  - [x] 13.2 推奨サイズのアスペクト比順序と件数制限のプロパティテストを書く
    - **Property 13: 推奨サイズのアスペクト比順序と件数制限**（最大3件、アスペクト差分昇順）
    - **検証対象: Requirements 8.1, 8.4**

  - [x] 13.3 recommendedSizes 計算のユニットテストを書く
    - 正方形・横長・縦長・極小画像のケースを検証する
    - _Requirements: 8.2, 8.5_

- [x] 14. チェックポイント — エンジン・描画・計算層のテスト確認
  - すべてのテストが通ることを確認し、疑問があればユーザーに確認する。

- [ ] 15. 入力系UIコンポーネント
  - [x] 15.1 画像アップロードUIを実装する
    - `src/ui/imageUpload.js` を作成する
    - ファイル選択ダイアログとドラッグ&ドロップ、`validateImageFile` による検証、プレビュー表示を実装する
    - 形式不正・サイズ超過・読み込み失敗時のインラインエラー表示（赤テキスト）と再選択維持を実装する
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [x] 15.2 ビーズタイプ選択UIを実装する
    - `src/ui/beadTypeSelector.js` を作成する
    - パーラー／ナノの選択（初期=パーラー）と対応パレットの色選択UI表示を実装する
    - 変更時、図案があれば `remapPattern` で再マッピングし再描画、図案が無ければパレット切替のみ（エラーなし）
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 15.3 プレート構成設定UIを実装する
    - `src/ui/plateConfig.js` を作成する
    - 横・縦の枚数入力（1〜10）と `validatePlateCount` による拒否＋直前値維持を実装する
    - 変更時に既存図案があればクリア確認を求め、確認後に空グリッドを再生成する
    - _Requirements: 3.1, 3.2, 3.4, 3.6, 3.7_

  - [x] 15.4 おすすめサイズ表示・選択UIを実装する
    - `recommendedSizes.js` に表示・選択UIを追加する（`calculateRecommendedSizes` の結果を最大3件表示）
    - 各サイズに総ビーズ数・縮小率を表示し、選択時にプレート構成へ反映する
    - _Requirements: 8.1, 8.2, 8.3_

- [ ] 16. 図案調整系UIコンポーネント
  - [x] 16.1 使用パレット選択UIを実装する
    - `src/ui/paletteSelector.js` を作成する
    - 色スウォッチグリッドで有効/無効トグル（`state.disabledColorIds`）、最大色数入力（`state.maxColors`、初期=制限なし）を実装する
    - `getActivePalette(fullPalette, disabledColorIds)` を実装する
    - 全色無効時は図案生成をブロックし「最低1色を有効にしてください」を表示する
    - 変更時に `onSelectionChange` で図案再生成を促す
    - _Requirements: 11.1, 11.2, 11.3, 11.5, 11.6_

  - [x] 16.2 getActivePalette のユニットテストを書く
    - 全有効・一部無効・全無効（空配列）のケースを検証する
    - _Requirements: 11.1, 11.2_

  - [x] 16.3 背景除外UIを実装する
    - `src/ui/backgroundExclusion.js` を作成する
    - ON/OFFトグル（初期OFF）、ON時の自動検出＋カラースウォッチ、ΔE閾値スライダー（0〜50、初期10）、除外セル数表示を実装する
    - `pickColorFromPreview(previewCanvas, event)` を実装し、クリック位置の生ピクセル色で背景色を上書きする
    - 設定変更時に `onSettingsChange` で図案を再描画する。クリック取得失敗時は現在設定を維持する
    - _Requirements: 9.1, 9.2, 9.4, 9.8, 9.9_

  - [x] 16.4 図案手動編集UIを実装する
    - `src/ui/patternEditor.js` を作成する
    - ツール選択（有効パレットの色＝描画 / 消しゴム＝未配置）を `state.editTool` で管理する
    - `canvasPointToCell(canvas, event, cellSize, zoom)` を実装する（表示/内部解像度比とズームを補正、範囲外はnull）
    - クリックでセルを選択色またはnullに設定し、`onPatternEdit` で使用色一覧・合計を再計算して再描画する
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 6.5_

  - [x] 16.5 手動編集の反映と再カウントのプロパティテストを書く
    - **Property 22: 手動編集の反映と再カウント**（編集後セルが選択色/未配置に一致、合計＝非nullセル数）
    - **検証対象: Requirements 12.2, 12.3, 12.4**

  - [x] 16.6 canvasPointToCell のユニットテストを書く
    - ズーム1.0/2.0、境界セル、グリッド外（null返却）を検証する
    - _Requirements: 12.2, 12.3_

- [ ] 17. アプリ統合（wiring）
  - [x] 17.1 メインエントリポイントと全コンポーネントを結線する
    - `src/main.js` を全コンポーネント結線用に書き換え、`index.html` と `src/style.css` を整備する（Viteテンプレートの初期コードを置き換える）
    - 状態変更 → 図案生成（LocalConversionStrategy）→ Canvas描画 → 使用色一覧更新の一連フローを配線する
    - リサイズ方式・フィットモードの選択UIを配置し、変更時に図案を再生成する
    - 図案セルのホバーで色名ツールチップ表示、図案未生成時のメッセージ表示、生成失敗時のエラー表示（前回図案保持）を実装する
    - エクスポートボタンとズーム操作（スクロール対応）を配線する
    - _Requirements: 4.4, 4.8, 5.3, 5.4, 5.5, 10.1, 10.4, 10.8, 11.6, 7.1_

  - [x] 17.2 変換パイプラインの統合テストを書く
    - アップロード→生成→色一覧→背景除外→手動編集の一連を、エンジン層中心にjsdomで検証する
    - _Requirements: 4.4, 6.5, 9.9, 12.5_

- [x] 18. 最終チェックポイント — 全テスト確認と結線確認
  - すべてのテストが通ることを確認し、孤立した未結線コードが無いことを確認する。疑問があればユーザーに確認する。

- [ ] 19. ドラッグによる連続手動編集（要件12.6〜12.11）
  - [x] 19.1 `src/ui/patternEditor.js` をドラッグ連続編集に対応させる
    - Canvas のイベント結線を `click` 単独から `mousedown`→`mousemove`→`mouseup`（＋ Canvas の `mouseleave`、window/document の `mouseup`）ベースへ変更する
    - `mousedown`: 押下セルを `applyCellEdit` で編集し、`isDragging=true`・`lastCell={row,col}` を記録する（単一クリックの後方互換＝要件12.11もこれで満たす）
    - `mousemove`: `isDragging` のときのみ、`canvasPointToCell` で現在セルを求め、`lastCell` と異なる新規セルなら `applyCellEdit` を適用し `lastCell` を更新する（要件12.6, 12.7）
    - `mouseup`（window/document）でドラッグ終了（要件12.8）、Canvas の `mouseleave` でドラッグ終了（要件12.9）とする
    - 各セル編集後に `state.setPattern` 更新＋`onPatternEdit` 発火で使用色一覧・合計を更新する（要件12.4, 12.10）
    - `isDragging`/`lastCell` は `initPatternEditorUI` のローカル状態（クロージャ）として保持し、`AppState` には持たせない
    - `destroy()` で追加した全リスナー（window の `mouseup` を含む）を確実に解除する
    - `main.js` 側の Canvas 既存イベント（ツールチップ用 `mousemove`・`mouseleave`）と共存・協調するよう必要なら結線を調整する（ドラッグ中のツールチップ表示の扱いも整理する）
    - _Requirements: 12.6, 12.7, 12.8, 12.9, 12.10, 12.11_

  - [x] 19.2 ドラッグ編集の結合テストを書く
    - `tests/patternEditorDrag.test.js` 等に、jsdom で Canvas に対し `mousedown`→複数セルへの `mousemove`→`mouseup` を dispatch する結合テストを実装する
    - (1) 通過した各セルが選択ツールで編集される、(2) 同一セルへの重複 `mousemove` で重複適用・余計な再描画が起きない（要件12.7）、(3) `mouseup`/`mouseleave` 後の `mousemove` では編集されない（要件12.8, 12.9）、(4) 移動を伴わない単一クリックは1セルのみ編集（要件12.11）を検証する
    - `canvasPointToCell`・`applyCellEdit` の純関数テスト（既存16.5/16.6）と重複しない、イベント結線の検証に焦点を当てる
    - _Requirements: 12.6, 12.7, 12.8, 12.9, 12.11_

- [ ] 20. 図案の常時視認レイアウトとレスポンシブ（要件13）
  - [x] 20.1 図案表示領域を常時視認（sticky）・レスポンシブに更新する
    - `src/style.css` を更新し、図案表示領域（`pattern-controls` ＋ `pattern-viewport`、必要なら使用色一覧を含めるか検討する）を `position: sticky; top: …` で画面内に追従させる（要件13.1, 13.2）
    - 必要に応じて `index.html` の図案メイン側のマークアップを調整する（sticky 対象をまとめるラッパー要素の追加など）
    - レスポンシブのブレークポイントを要件13.4 の 768px に統一し、狭幅では縦積みに再構成しつつ図案表示領域を画面内に sticky 維持する（既存の 900px ブレークポイントの扱いも design に沿って整理する）
    - 設定変更が図案へ即時反映され、スクロールせずに確認できること（要件13.3、既存の再生成フロー＋sticky で満たす）を確認する
    - これはCSS中心のUI調整であり手動・レスポンシブテストで確認する（自動テストは不要、design「テスト戦略」に準拠）
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

- [ ] 21. カラーパレットを公式単色ラインナップに正確化（要件2.3, 2.6）
  - [ ] 21.1 `parlerPalette.js`・`nanoPalette.js` を公式単色ラインナップに更新する
    - `src/data/parlerPalette.js`: パーラービーズの単色販売色 全100色を定義する（id `"P01"`〜`"P100"`、色名は公式カラーリスト準拠、RGBは色見本ベースの近似値）。単色販売されていないセット専用色（ネオン・ストライプ系の計8色）は既定パレットに含めない
    - `src/data/nanoPalette.js`: ナノビーズの全55色を定義する（id `"N01"`〜`"N55"`、色名は公式カラーリスト準拠、RGBは色見本ベースの近似値）
    - 各色は `{ id, name, r, g, b }` の独立レコードとして定義し、出典（参照した公式カラーリスト・カラーチャートのURL）と、RGBが近似値である旨をファイル冒頭のコードコメントに明記する
    - 既存の `initializePalette`（labキャッシュ）や、パレットを参照する各モジュール（beadTypeSelector / paletteSelector / patternEditor / colorMatcher 等）のインターフェースは変更しない（色数が増えるだけでデータ構造・呼び出し方は不変）
    - 実際の100色・55色の色名やRGB値はデータファイルで管理し、本計画には列挙しない
    - _Requirements: 2.3, 2.6_

  - [ ] 21.2 色idを決め打ちしている既存テストを色名ベースの検証に更新する
    - パレットの色数・id体系の変更（100色／55色、id `"P01"`〜`"P100"`／`"N01"`〜`"N55"`）により、特定の色を id 直書きで期待しているテスト（例: `tests/colorMatcher.test.js` で黒「くろ」を `P25` と期待する箇所など）は失敗しうる。これらを `id` ではなく `name`（例: 「くろ」）で期待する検証へ更新する
    - パレットを参照する全テスト（colorMatcher / LocalConversionStrategy / integration / backgroundDetector 等）を見直し、id決め打ちがあれば色名ベースへ修正する。プロパティテスト本体のロジックは変更不要（パレット非依存）
    - `npx vitest --run` で全テストが通ること、`npm run build` が成功することを確認する
    - _Requirements: 2.3, 2.6_

## 注記

- `*` 付きのサブタスクは任意（テスト関連）であり、MVPを急ぐ場合はスキップ可能。コア実装タスクには `*` を付けていない。
- 各タスクはトレーサビリティのため具体的な要件番号を参照している。
- チェックポイントで段階的に検証を行う。
- プロパティテストは設計の正当性プロパティ（Property 1〜23）を機械的に検証する。各テストには対応するプロパティ番号と検証要件を明記している。
- ユニットテストは具体的な入力・期待出力とエッジケース（空入力・境界値・透明ピクセル）を検証する。
- Canvas描画そのものはブラウザ環境依存のため手動テストとし、純粋ロジック（座標計算・セルサイズ計算等）を自動テスト対象とする。
- タスク19・20は、UX改善（要件12のドラッグ連続編集、要件13の図案常時視認レイアウト）として後から追加したタスクである。タスク20はCSS中心のレイアウト調整のため自動テスト対象外とし、手動・レスポンシブテストで確認する。
- タスク21は、カラーパレットを公式単色ラインナップ（パーラービーズ100色／ナノビーズ55色）に正確化するために後から追加したデータ修正タスクである。設計の正当性プロパティはパレット非依存のため新規プロパティテストは追加せず、データ更新（21.1）と既存テストの色名ベースへの修正（21.2）で構成する。実際の色名・RGB値はデータファイル（`parlerPalette.js`／`nanoPalette.js`）で管理し、本計画には列挙しない。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "5.1", "6.1", "9.1", "11.1", "12.1"] },
    { "id": 2, "tasks": ["2.2", "3.2", "5.2", "5.3", "5.4", "6.2", "6.3", "11.2", "11.3", "11.4", "12.2"] },
    { "id": 3, "tasks": ["2.3", "2.4", "2.5", "2.6", "4.1", "7.1", "10.1", "13.1", "12.3", "12.4"] },
    { "id": 4, "tasks": ["4.2", "4.3", "4.4", "4.5", "7.2", "10.2", "10.3", "13.2", "13.3"] },
    { "id": 5, "tasks": ["7.3", "7.4", "7.5", "7.6", "7.7", "9.2", "15.1", "15.2", "15.3", "15.4", "16.1", "16.3", "16.4"] },
    { "id": 6, "tasks": ["9.3", "9.4", "9.5", "16.2", "16.5", "16.6", "17.1"] },
    { "id": 7, "tasks": ["17.2"] },
    { "id": 8, "tasks": ["19.1", "20.1"] },
    { "id": 9, "tasks": ["19.2"] },
    { "id": 10, "tasks": ["21.1"] },
    { "id": 11, "tasks": ["21.2"] }
  ]
}
```
