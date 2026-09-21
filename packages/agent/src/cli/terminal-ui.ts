/**
 * @author Codex
 * @description 统一封装 Octopus CLI 终端 UI 相关功能
 */

import { renderFilled } from 'oh-my-logo';
import { cancel, confirm, isCancel, log, spinner } from '@clack/prompts';
import { isInteractiveTuiLaunch } from './launch-mode.js';
import type { TerminalCapabilities } from './launch-mode.js';

export { isInteractiveTuiLaunch } from './launch-mode.js';
export type { TerminalCapabilities } from './launch-mode.js';

export interface InteractiveInstallOptions {
  /**
   * 跳过确认并直接执行安装，同时保留安装动画。
   */
  force?: boolean;
  /**
   * 跳过确认与安装动画，直接执行安装。
   */
  silent?: boolean;
  /**
   * 安装前展示的确认文案。
   */
  confirmText?: string;
  /**
   * 用户取消交互时展示的文案。
   */
  cancelText?: string;
  /**
   * 用户拒绝安装时展示的警告文案。
   */
  warnText?: string;
  /**
   * 安装进行中展示的文案。
   */
  progressText?: string;
  /**
   * 安装成功时展示的文案。
   */
  successText?: string;
  /**
   * 安装失败时展示的文案。
   */
  errorText?: string;
}

/**
 * @description 在交互式 Agent TUI 启动前渲染 Dr.Octopus 渐变艺术字
 */
export async function renderStartupLogo(args: readonly string[]): Promise<boolean> {
  if (!isInteractiveTuiLaunch(args)) {
    return false;
  }
  await renderFilled('Dr.Octopus', {
    palette: 'sunset',
    direction: 'horizontal',
    font: 'block',
  });
  return true;
}

/**
 * 在交互式终端中用 Clack 展示安装确认与进度。
 *
 * @param install 实际执行安装的异步操作
 * @param options 交互、静默及强制安装选项
 * @param terminal 可注入的终端能力；非 TTY 场景直接执行安装
 * @returns 安装结果；用户拒绝或取消时返回 undefined
 * @throws 原样抛出安装过程产生的异常
 */
export async function runInteractiveInstall<T>(
  install: () => Promise<T>,
  options: InteractiveInstallOptions = {},
  terminal: TerminalCapabilities = {
    stdinIsTTY: process.stdin.isTTY === true,
    stdoutIsTTY: process.stdout.isTTY === true,
  }
): Promise<T | undefined> {
  if (options.silent) {
    return install();
  }

  if (!terminal.stdinIsTTY || !terminal.stdoutIsTTY) {
    return install();
  }

  if (!options.force) {
    const shouldInstall = await confirm({
      message: options.confirmText ?? 'confirm install?',
      active: 'yes',
      inactive: 'no',
      initialValue: true,
    });

    if (isCancel(shouldInstall)) {
      cancel(options.cancelText ?? 'installation cancelled.');
      return undefined;
    }

    if (!shouldInstall) {
      log.warn(options.warnText ?? 'installation skipped.');
      return undefined;
    }
  }

  const installSpinner = spinner();
  installSpinner.start(options.progressText ?? 'installing...');

  try {
    const result = await install();
    installSpinner.stop(options.successText ?? 'installation complete.');
    return result;
  } catch (error) {
    installSpinner.error(options.errorText ?? 'installation failed.');
    throw error;
  }
}
