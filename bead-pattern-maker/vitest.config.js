import { defineConfig } from 'vitest/config';

// Vitest 設定（設計「テスト戦略」セクションに対応）
// - jsdom 環境で DOM / Canvas API を扱えるようにする
// - Canvas API は tests/setup.js 経由でモックを注入する
// - プロパティベーステスト（fast-check）とユニットテストを同一スイートで実行する
export default defineConfig({
  test: {
    // jsdom 環境を使用（Canvas / DOM API のモックに必要）
    environment: 'jsdom',
    // describe / it / expect / vi をグローバルに利用可能にする
    globals: true,
    // 各テスト前に Canvas API モックなどを注入するセットアップファイル
    setupFiles: ['./tests/setup.js'],
    // テスト対象ファイル（tests/ 配下と src/ 配下の co-located テスト）
    include: ['tests/**/*.{test,spec}.js', 'src/**/*.{test,spec}.js'],
    // テストファイルが0件でも正常終了させる（基盤構築段階で空実行を許容）
    passWithNoTests: true,
    // カバレッジ設定（npx vitest --run --coverage で利用）
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
      // カバレッジ計測対象はビジネスロジック中心
      include: ['src/**/*.js'],
      exclude: [
        'src/main.js',
        'src/**/*.{test,spec}.js',
        'src/assets/**',
      ],
    },
  },
});
