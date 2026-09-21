/**
 * @author Codex
 * @description 实现 RPC-compatible Onboarding 对话流程
 */
import { notifyStatus } from './utils.js';
import { getSelectListTheme } from '@earendil-works/pi-coding-agent';
import { Container, SelectList, Spacer, Text } from '@earendil-works/pi-tui';
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionUIDialogOptions,
} from '@earendil-works/pi-coding-agent';
import type { TUI } from '@earendil-works/pi-tui';
import type { AuthInteraction } from '../definitions/port.js';
import type { AuthPrompt } from '../definitions/types.js';
import type { OnboardingStatus } from '../definitions/types.js';
import type { OnboardingService } from '../services/onboarding-service.js';

type SetupContext = ExtensionContext & Partial<Pick<ExtensionCommandContext, 'waitForIdle'>>;
type NativeAuthType = 'api_key' | 'oauth';

const AUTH_TYPE_LABELS: Record<NativeAuthType, string> = {
  oauth: 'OAuth',
  api_key: 'API Key',
};

const SELECTOR_CHROME_HEIGHT = 8;
const SELECTOR_MAX_VISIBLE = 10;
const SELECTOR_MIN_VISIBLE = 3;

/**
 * @description 承载 onboarding 的有界 TUI 选择列表，并在键盘导航后请求重绘。
 */
class OnboardingSelectComponent extends Container {
  private readonly list: SelectList;
  private readonly tui: TUI;
  private readonly signal: AbortSignal | undefined;
  private readonly abortHandler: (() => void) | undefined;

  /**
   * @description 创建一个高亮项始终保持可见的选择列表。
   * @param tui 当前 TUI 实例。
   * @param title 选择器标题。
   * @param options 可选标签。
   * @param dialogOptions 对话框取消选项。
   * @param done 完成当前自定义 UI 的回调。
   */
  constructor(
    tui: TUI,
    title: string,
    options: string[],
    dialogOptions: ExtensionUIDialogOptions | undefined,
    done: (result: string | undefined) => void
  ) {
    super();
    this.tui = tui;
    this.signal = dialogOptions?.signal;
    const maxVisible = Math.max(
      SELECTOR_MIN_VISIBLE,
      Math.min(SELECTOR_MAX_VISIBLE, tui.terminal.rows - SELECTOR_CHROME_HEIGHT)
    );
    this.list = new SelectList(
      options.map((label) => ({ value: label, label })),
      maxVisible,
      getSelectListTheme()
    );
    this.list.onSelect = (item) => done(item.value);
    this.list.onCancel = () => done(undefined);
    this.addChild(new Spacer(1));
    this.addChild(new Text(title, 1, 0));
    this.addChild(new Spacer(1));
    this.addChild(this.list);
    this.addChild(new Spacer(1));
    this.addChild(new Text('  ↑↓ navigate  Enter select  Esc cancel', 1, 0));
    this.addChild(new Spacer(1));
    this.abortHandler = this.signal ? () => done(undefined) : undefined;
    this.signal?.addEventListener('abort', this.abortHandler!, { once: true });
  }

  /**
   * @description 将键盘输入交给 SelectList，并刷新滚动后的可见窗口。
   * @param data 原始终端按键数据。
   */
  handleInput(data: string): void {
    this.list.handleInput(data);
    this.tui.requestRender();
  }

  /**
   * @description 清理对话框取消监听器。
   */
  dispose(): void {
    if (this.abortHandler) {
      this.signal?.removeEventListener('abort', this.abortHandler);
    }
  }
}

/**
 * @description 在 TUI 中显示有界滚动列表，并为 RPC 等模式保留原生 select 协议。
 * @param ctx Extension 上下文。
 * @param title 选择器标题。
 * @param options 可选标签。
 * @param dialogOptions 对话框取消选项。
 * @returns 选中的标签，取消时返回 undefined。
 */
async function selectOption(
  ctx: SetupContext,
  title: string,
  options: string[],
  dialogOptions?: ExtensionUIDialogOptions
): Promise<string | undefined> {
  if (ctx.mode !== 'tui') {
    return ctx.ui.select(title, options, dialogOptions);
  }
  if (dialogOptions?.signal?.aborted) {
    return undefined;
  }
  return ctx.ui.custom<string | undefined>((tui, _theme, _keybindings, done) => {
    return new OnboardingSelectComponent(tui, title, options, dialogOptions, done);
  });
}

/**
 * @description 刷新当前 Pi Session 的模型目录并立即切换到已配置模型。
 * @param ctx 当前命令上下文。
 * @param status 已完成的配置状态。
 */
async function activateConfiguredModel(
  ctx: SetupContext,
  status: OnboardingStatus,
  setModel: ExtensionAPI['setModel']
): Promise<void> {
  if (!status.providerId || !status.modelId) {
    throw new Error('The configured model identity is missing.');
  }
  await ctx.modelRegistry.refresh();
  const model = ctx.modelRegistry.find(status.providerId, status.modelId);
  if (!model) {
    throw new Error('The configured model could not be loaded by the current Pi session.');
  }
  if (ctx.waitForIdle) {
    await ctx.waitForIdle();
  }
  if (!(await setModel(model))) {
    throw new Error(`No authentication is available for ${status.providerId}/${status.modelId}.`);
  }
}

/**
 * @description 将 Extension UI 适配为 Pi AuthInteraction。
 * @param ctx Extension 上下文。
 * @returns Auth 交互。
 */
function createAuthInteraction(ctx: SetupContext): AuthInteraction {
  return {
    async prompt(request: AuthPrompt) {
      const options = request.signal ? { signal: request.signal } : undefined;
      if (request.type === 'select') {
        const labels = (request.options ?? []).map((option) => option.label);
        const selected = await selectOption(ctx, request.message, labels, options);
        const match = (request.options ?? []).find((option) => option.label === selected);
        if (!match) {
          throw new Error('Authentication cancelled.');
        }
        return match.id;
      }
      const value = await ctx.ui.input(request.message, request.placeholder, options);
      if (value === undefined) {
        throw new Error('Authentication cancelled.');
      }
      return value;
    },
    notify(event) {
      if (event.url) {
        ctx.ui.notify(`${event.instructions ?? 'Open this URL to continue'}: ${event.url}`, 'info');
      } else if (event.verificationUri) {
        ctx.ui.notify(`Open ${event.verificationUri} and enter ${event.userCode ?? ''}`, 'info');
      } else if (event.message) {
        ctx.ui.notify(event.message, 'info');
      }
    },
  };
}

/**
 * @description 运行完整交互配置。
 * @param ctx Extension 命令上下文。
 * @param sdk Onboarding SDK。
 * @param setModel 当前 Pi Session 的模型切换能力。
 */
export async function runSetup(
  ctx: SetupContext,
  sdk: OnboardingService,
  setModel: ExtensionAPI['setModel']
): Promise<void> {
  if (!ctx.hasUI) {
    throw new Error(
      'Interactive setup is unavailable in this mode. Configure through the Onboarding SDK or run Octopus in TUI mode.'
    );
  }
  const source = await selectOption(ctx, 'Choose a model source', ['Local models', 'Cloud models']);
  if (!source) {
    return;
  }
  if (source === 'Local models') {
    const runtimes = sdk.getLocalRuntimes();
    const label = await selectOption(
      ctx,
      'Choose a local runtime',
      runtimes.map((runtime) => runtime.name)
    );
    const runtime = runtimes.find((candidate) => candidate.name === label);
    if (!runtime) {
      return;
    }
    const baseUrlInput = await ctx.ui.input(
      `${runtime.name} base URL (press Enter for ${runtime.defaultBaseUrl})`,
      runtime.defaultBaseUrl
    );
    if (baseUrlInput === undefined) {
      return;
    }
    const baseUrl = baseUrlInput.trim() || runtime.defaultBaseUrl;
    const detected = await sdk.detectLocalRuntime({ runtime: runtime.id, baseUrl });
    if (!detected.reachable) {
      throw new Error(`${runtime.name} is not reachable at ${baseUrl}.`);
    }
    if (!detected.models.length) {
      throw new Error(`${runtime.name} returned no models.`);
    }
    const modelId = await selectOption(
      ctx,
      'Choose a model',
      detected.models.map((model) => model.id)
    );
    if (!modelId) {
      return;
    }
    const status = await sdk.completeLocalSetup({ runtime: runtime.id, baseUrl, modelId });
    await activateConfiguredModel(ctx, status, setModel);
    notifyStatus(ctx, status);
    return;
  }
  const providers = await sdk.getNativeProviders();
  const authLabel = await selectOption(ctx, 'Choose an authentication method', [
    AUTH_TYPE_LABELS.oauth,
    AUTH_TYPE_LABELS.api_key,
  ]);
  const authType = (Object.entries(AUTH_TYPE_LABELS) as [NativeAuthType, string][]).find(
    ([, label]) => label === authLabel
  )?.[0];
  if (!authType) {
    return;
  }
  const matchingProviders = providers.filter((provider) => provider.authTypes?.includes(authType));
  if (!matchingProviders.length) {
    throw new Error(`No cloud providers support ${AUTH_TYPE_LABELS[authType]}.`);
  }
  const providerLabel = await selectOption(
    ctx,
    'Choose a provider',
    matchingProviders.map((provider) => `${provider.name} (${provider.id})`)
  );
  const provider = matchingProviders.find(
    (candidate) => `${candidate.name} (${candidate.id})` === providerLabel
  );
  if (!provider) {
    return;
  }
  if (!provider.authenticated) {
    await sdk.startNativeAuth({ providerId: provider.id, authType }, createAuthInteraction(ctx));
  }
  const models = (await sdk.getAvailableModels()).filter((model) => model.providerId === provider.id);
  if (!models.length) {
    throw new Error('No available models were returned after authentication.');
  }
  const modelId = await selectOption(
    ctx,
    'Choose a model',
    models.map((model) => model.modelId)
  );
  if (!modelId) {
    return;
  }
  const status = await sdk.completeNativeSetup({ providerId: provider.id, modelId });
  await activateConfiguredModel(ctx, status, setModel);
  notifyStatus(ctx, status);
}
