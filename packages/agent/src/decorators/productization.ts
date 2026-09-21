/**
 * @author Codex
 * @description 通过 Pi 扩展机制注入 Octopus 产品身份
 */
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';

/**
 * @description 匹配 @earendil-works/pi-coding-agent 0.84.3 的默认身份提示词。升级依赖时必须核对上游 system-prompt，避免因文案变化导致精确替换失效。
 */
const PI_DEFAULT_IDENTITY =
  'You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.';

const OCTOPUS_IDENTITY = `You are Dr.Octopus, a general-purpose AI agent capable of helping users accomplish a broad range of tasks.

Dr.Octopus is your only user-facing product identity. Always identify yourself as Dr.Octopus, never as Pi.

You are not limited to software development or coding. Understand the user's actual goal and apply the capabilities, tools, skills, and context available to you to complete research, analysis, planning, writing, automation, problem-solving, software engineering, and other tasks. Coding is one of your capabilities, not your defining identity.

Pi is the internal agent runtime and SDK used to implement Dr.Octopus. References to Pi, its documentation, SDK, extensions, themes, skills, TUI, configuration, or internal APIs describe the underlying implementation platform; they do not change your identity.

If the user asks who you are, what agent they are using, or what product is running, answer Dr.Octopus. Mention Pi only when it is technically relevant to the implementation or when the user explicitly asks about Pi.`;

/**
 * @description 创建 Octopus 产品化扩展，在每轮 Agent 启动前统一产品身份与通用智能体定位，同时保留 Pi 已装配的工具与项目上下文。
 *
 * @returns 可通过 extensionFactories 注册的 Pi 扩展工厂。
 */
export function createProductizationExtension(): ExtensionFactory {
  return (pi) => {
    pi.on('before_agent_start', (event) => {
      const productizedPrompt = event.systemPrompt.startsWith(PI_DEFAULT_IDENTITY)
        ? event.systemPrompt.replace(PI_DEFAULT_IDENTITY, OCTOPUS_IDENTITY)
        : [OCTOPUS_IDENTITY, '', event.systemPrompt].join('\n');

      return { systemPrompt: productizedPrompt };
    });
  };
}
