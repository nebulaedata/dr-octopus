/**
 * @author Codex
 * @description Builds literal PowerShell fixture commands while keeping JavaScript arguments intact under Windows PowerShell 5.1 native argument rules.
 */
/**
 * Quotes a value as one PowerShell literal without interpolation or executable substitutions.
 */
export function psLiteral(value) {
  return "'" + value.replaceAll("'", "''") + "'";
}

/**
 * Encodes only test JavaScript to avoid Windows PowerShell 5.1 stripping nested native-argument quotes.
 */
export function nodeCommand(script, executable = 'node') {
  const expression = `eval(Buffer.from('${Buffer.from(script).toString('base64')}','base64').toString())`;
  return `& ${psLiteral(executable)} -e ${psLiteral(expression)}`;
}
