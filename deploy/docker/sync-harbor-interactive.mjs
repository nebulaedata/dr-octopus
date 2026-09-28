/**
 * @author Codex
 * @description Guides Harbor login, destination selection and digest confirmation through Clack prompts.
 */
import { execFileSync } from 'node:child_process';

/**
 * Delegates credential entry and storage to Docker's terminal login, never capturing passwords in Node.
 */
function loginHarbor(registry) {
  execFileSync('docker', ['login', registry], {
    stdio: 'inherit',
    windowsHide: true,
    timeout: 300_000,
  });
}

/**
 * Stops on every cancelled prompt or failed login, and confirms the exact digest that will be copied.
 * Prompt dependencies are loaded only in interactive mode; automation and release tests need no install.
 */
export async function interactiveSync(options, { ui, login = loginHarbor, sync, validateOptions }) {
  const prompts = ui ?? (await import('@clack/prompts'));
  const cancelled = Symbol('cancelled');
  const selected = { ...options };

  /**
   * Converts Clack's cancellation sentinel into one exit path before any subsequent side effect.
   */
  function answer(value) {
    if (prompts.isCancel(value)) throw cancelled;
    return value;
  }

  /**
   * Uses the same CLI validation for terminal fields and returns readable inline validation errors.
   */
  async function field(name, message) {
    selected[name] = answer(
      await prompts.text({
        message,
        initialValue: selected[name],
        validate(value) {
          try {
            validateOptions([
              '--registry',
              selected.registry,
              '--project',
              selected.project,
              '--tag',
              selected.tag,
              `--${name}`,
              value ?? '',
            ]);
          } catch (error) {
            return error.message;
          }
        },
      })
    );
  }

  prompts.intro('Docker Hub → Harbor 镜像同步');
  try {
    await field('registry', 'Harbor 地址（不含 https:// 或路径）');
    const ready = answer(
      await prompts.confirm({
        message: `现在登录 ${selected.registry}？账号密码由 Docker 提示输入。`,
        initialValue: true,
      })
    );
    if (!ready) throw cancelled;
    await login(selected.registry);
    prompts.log.success('Harbor 登录成功');
    await field('project', 'Harbor 项目名称（需已创建，并有推送权限）');
    await field('tag', '需要同步的 Docker Hub 标签');
    const args = ['--registry', selected.registry, '--project', selected.project, '--tag', selected.tag];
    const result = await sync(args, {
      log: (message) => prompts.log.info(message),
      confirm: async ({ source, target, digest }) => {
        prompts.note(
          `源：${source}\n目标：${target}\n摘要：${digest}\n已有目标标签会更新为此镜像。`,
          '确认同步内容'
        );
        return answer(await prompts.confirm({ message: '开始同步？', initialValue: false }));
      },
    });
    if (result.cancelled) throw cancelled;
    prompts.outro(`同步完成，摘要校验通过：${result.target}`);
    return result;
  } catch (error) {
    if (error !== cancelled) throw error;
    prompts.cancel('已取消同步，未推送镜像。');
    return { cancelled: true, copied: false };
  }
}
