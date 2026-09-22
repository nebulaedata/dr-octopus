/**
 * @author Codex
 * @description Selects a publication action from verified npm and GitHub states without mutating the release.
 */
import { confirm, isCancel, select } from '@clack/prompts';

/**
 * Offers continuation only for incomplete publication; automation must explicitly choose its action.
 * npm publication is immutable, so its continuation only completes the GitHub Release.
 * @returns {Promise<'resume' | 'github-only' | 'bump' | 'done' | 'cancel'>}
 */
export async function choosePublicationAction(
  version,
  state,
  options,
  { prompt = select, interactive = Boolean(process.stdin.isTTY) } = {}
) {
  const complete = state.npm === 'published' && state.github === 'published';
  const continuation = state.npm === 'published' ? 'github-only' : 'resume';
  if (options.githubOnly) {
    if (state.npm !== 'published')
      throw new Error('Publish the current version to npm before --github-only.');
    return complete ? 'done' : 'github-only';
  }
  if (options.bump) return 'bump';
  if (options.resume) {
    if (complete) throw new Error(`${version} is already fully published. Use --bump for the next version.`);
    return continuation;
  }
  if (!interactive) {
    throw new Error('Choose --resume to continue an incomplete publication or --bump for the next version.');
  }
  const actions = [
    ...(!complete
      ? [
          {
            value: continuation,
            label: `继续发布当前版本 ${version}`,
            hint:
              continuation === 'github-only'
                ? 'npm 已成功，仅补发 GitHub Release'
                : '使用当前代码，必要时重建未发布的标签',
          },
        ]
      : []),
    { value: 'bump', label: '发布下一版本', hint: '选择新版本并发布' },
    { value: 'cancel', label: '取消' },
  ];
  const action = await prompt({ message: '请选择发布操作', options: actions });
  return isCancel(action) ? 'cancel' : action;
}

/**
 * Confirms the selected destination; cancellation and rejection both leave publication unapproved.
 * Noninteractive publication requires --yes rather than attempting to read a terminal.
 */
export async function confirmPublication(
  manifest,
  options,
  { githubOnly = false, prompt = confirm, interactive = Boolean(process.stdin.isTTY) } = {}
) {
  if (options.yes || options.dryRun) return true;
  if (!interactive) throw new Error('Noninteractive publication requires --yes.');
  const approved = await prompt({
    message: githubOnly
      ? `Create GitHub Release v${manifest.version} (npm already published)?`
      : `Publish ${manifest.name}@${manifest.version} to ${options.registry} and GitHub Release?`,
    initialValue: false,
  });
  return !isCancel(approved) && approved;
}
