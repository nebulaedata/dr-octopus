/**
 * @author Codex
 * @description Extracts route declarations and raw SQL literals through TypeScript syntax for refactor parity checks.
 */
import ts from 'typescript';

/**
 * Normalizes syntax without depending on quote style, indentation, or file location.
 */
function expression(node, source) {
  if (ts.isStringLiteralLike(node)) {
    return JSON.stringify(node.text);
  }
  if (ts.isArrayLiteralExpression(node)) {
    return `[${node.elements.map((item) => expression(item, source)).join(',')}]`;
  }
  return node.getText(source).replace(/\s+/g, ' ').replaceAll('"', "'");
}

/**
 * Compares unique SQL statements and route declarations while runtime tests verify ordering and effects.
 */
export function sourceContracts(files) {
  const routes = new Set();
  const sql = new Set();
  for (const { path, text } of files) {
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    /**
     * Visits calls without executing application code or connecting to resources.
     */
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const first = node.arguments[0];
        if (
          method === 'prepare' &&
          first &&
          (ts.isStringLiteralLike(first) || ts.isTemplateExpression(first))
        ) {
          const value = ts.isStringLiteralLike(first) ? first.text : first.getText(source).slice(1, -1);
          if (/^(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|PRAGMA)\b/i.test(value.trim())) {
            sql.add(value.replace(/\s+/g, ' ').trim());
          }
        }
        if (path.endsWith('.controller.ts') && first) {
          if (
            ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method) &&
            ts.isStringLiteralLike(first) &&
            first.text.startsWith('/')
          ) {
            routes.add(`${method.toUpperCase()} ${first.text}`);
          }
          if (method === 'route' && ts.isObjectLiteralExpression(first)) {
            const properties = first.properties.filter(ts.isPropertyAssignment);
            const url = properties.find((property) => property.name.getText(source) === 'url');
            const methods = properties.find((property) => property.name.getText(source) === 'method');
            if (url && methods) {
              routes.add(`${expression(methods.initializer, source)} ${expression(url.initializer, source)}`);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return { routes: [...routes].sort(), sql: [...sql].sort() };
}
