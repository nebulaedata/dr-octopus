/**
 * @author Codex
 * @description Detects obvious shell backgrounding without mistaking quoted text or logical AND for escape.
 */

/**
 * Conservative lexical guard for direct bash syntax; not an arbitrary-code sandbox.
 */
export function assertManagedCommand(command: string, powershell = false): void {
  let quote = '';
  let plain = '';
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (((ch === '\\' && !powershell) || (ch === '`' && powershell)) && quote !== "'") {
      i++;
      plain += ' ';
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = '';
      }
      plain += ' ';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      plain += ' ';
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(command[i - 1]!))) {
      while (i < command.length && command[i] !== '\n') {
        i++;
      }
      plain += '\n';
      continue;
    }
    if (ch === '&') {
      if (command[i + 1] === '&') {
        i++;
        plain += ' ';
        continue;
      }
      if (command[i - 1] === '>' || command[i - 1] === '<' || command[i + 1] === '>') {
        plain += ' ';
        continue;
      }
      if (powershell && command.slice(i + 1).trim() !== '') {
        plain += ' ';
        continue;
      }
      throw new Error('Use background_task instead of a shell background operator.');
    }
    plain += ch;
  }
  if (/(^|[\s;|()])(?:nohup|disown|setsid)(?=[\s;|()]|$)/i.test(plain)) {
    throw new Error('Use background_task; nohup/disown/setsid escape task ownership.');
  }
  if (powershell && /\b(?:Start-Process|Start-Job|Start-ThreadJob)\b|(?:^|\s)-AsJob\b/i.test(plain)) {
    throw new Error('Use background_task instead of unmanaged PowerShell process/job launch.');
  }
}
