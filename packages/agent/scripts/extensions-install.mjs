/**
 * @author Codex
 * @description 调用已构建的公共工具，将项目约定的 Pi 扩展安装到 Dr.Octopus Agent 全局目录。
 * @link https://pi.dev/packages
 */
import { parseArgs } from 'node:util';

import { installExtensions } from '../dist/utils/index.js';

const { values } = parseArgs({
  options: {
    force: {
      type: 'boolean',
      default: false,
    },
    silent: {
      type: 'boolean',
      default: false,
    },
  },
});

await installExtensions({ force: values.force, silent: values.silent });
