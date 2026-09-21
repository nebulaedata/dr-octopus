/**
 * @author Codex
 * @description 使用官方 RpcClient 驱动独立 Pi Coding Agent 子进程
 */
import { join } from 'node:path';
import {
  getPackageDir,
  RpcClient,
} from '@earendil-works/pi-coding-agent';

/**
 * 启动 RPC Agent，流式打印文本，并在 Agent 完全 settled 后读取最终结果。
 */
async function main(): Promise<void> {
  const client = new RpcClient({
    cliPath: join(getPackageDir(), 'dist', 'cli.js'),
    cwd: process.cwd(),
    args: ['--no-session'],
  });

  const unsubscribe = client.onEvent((event) => {
    if (
      event.type === 'message_update' &&
      event.assistantMessageEvent.type === 'text_delta'
    ) {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });

  try {
    await client.start();
    const state = await client.getState();
    process.stderr.write(
      `RPC ready: session=${state.sessionId}, model=${state.model?.provider}/${state.model?.id}\n`,
    );

    await client.promptAndWait(
      '概括当前项目结构，并指出一个最值得优先处理的风险。',
      undefined,
      120_000,
    );

    const finalText = await client.getLastAssistantText();
    process.stderr.write(`\nFinal text length: ${finalText?.length ?? 0}\n`);
  } finally {
    unsubscribe();
    await client.stop();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`RPC demo failed: ${String(error)}\n`);
  process.exitCode = 1;
});
