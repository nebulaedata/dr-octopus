/**
 * @author Codex
 * @description 调用已构建的公共 API，将内置 Infra 工具安装到 Dr.Octopus Agent 全局目录。
 */
import { parseArgs } from 'node:util';

import { installBundledInfra, runInteractiveInstall } from '../dist/index.js';

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

await runInteractiveInstall(() => installBundledInfra({ force: values.force }), {
  cancelText: '已取消内置工具安装。',
  confirmText: '是否安装 Dr.Octopus 内置工具？',
  errorText: '内置工具离线安装失败',
  force: values.force,
  progressText: '正在离线安装内置工具…',
  silent: values.silent,
  successText: '内置工具离线安装完成',
  warnText: '已跳过内置工具安装。',
});
