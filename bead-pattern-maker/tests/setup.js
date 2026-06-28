import { beforeEach, afterEach } from 'vitest';
import {
  installCanvasMock,
  uninstallCanvasMock,
  ensureImageData,
} from './helpers/canvasMock.js';

// すべてのテストで ImageData / Canvas API が利用可能になるよう準備する。
// vitest.config.js の test.setupFiles から読み込まれる。
ensureImageData();

beforeEach(() => {
  installCanvasMock();
});

afterEach(() => {
  uninstallCanvasMock();
});
