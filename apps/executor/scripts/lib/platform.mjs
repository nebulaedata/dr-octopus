/**
 * @author Codex
 * @description Selects supported engineering commands explicitly; non-Windows product backends remain unimplemented.
 */
/**
 * Returns Windows x64 build tools, or fails before touching product resources on unsupported platforms.
 */
export function executorTarget(platform = process.platform, architecture = process.arch) {
  if (platform === 'win32') {
    if (architecture !== 'x64') {
      throw new Error('Executor currently supports Windows x64 only.');
    }
    return { platform, architecture, tar: 'tar.exe' };
  } else if (platform === 'darwin') {
    // TODO: implement macOS packaging/native backends before enabling the planned system Bash branch.
    throw new Error('Executor macOS engineering backend is pending implementation.');
  } else if (platform === 'linux') {
    // TODO: implement Linux packaging/native backends before enabling the planned system Bash branch.
    throw new Error('Executor Linux engineering backend is pending implementation.');
  } else {
    throw new Error('Unsupported Executor platform: ' + platform);
  }
}
