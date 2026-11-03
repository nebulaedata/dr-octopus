/**
 * @author Codex
 * @description Defines bounded page-access refusals without retaining full URLs, page contents or credentials.
 */
import { z } from 'zod';

export const pageAccessSchema = z.strictObject({
  reason: z.enum(['permission', 'origin', 'window', 'private', 'scheme']),
  tabId: z.number().int().nonnegative().optional(),
  origin: z
    .string()
    .max(2048)
    .refine((value) => {
      if (!URL.canParse(value)) {
        return false;
      }
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) && url.origin === value;
    })
    .optional(),
});
export type PageAccessIssue = z.infer<typeof pageAccessSchema>;

export class PageAccessError extends Error {
  readonly access: PageAccessIssue;

  /**
   * Keeps the existing transport code while recording only a finite reason and an optional sanitized origin.
   */
  constructor(reason: PageAccessIssue['reason'], tabId?: number, url?: string) {
    super('FORBIDDEN_PAGE');
    const parsed = url && URL.canParse(url) ? new URL(url) : undefined;
    this.access = pageAccessSchema.parse({
      reason,
      ...(tabId !== undefined ? { tabId } : {}),
      ...(parsed && /^https?:$/.test(parsed.protocol) ? { origin: parsed.origin } : {}),
    });
  }
}

/**
 * Describes a refusal without suggesting that model text or a user answer grants browser permissions.
 */
export function pageAccessMessage(issue: PageAccessIssue): string {
  const messages = {
    permission:
      '浏览器未授予该站点访问权限。请在扩展权限设置中恢复，或结束本次任务；回答后仍会重新检查实际权限。',
    origin: '该站点不在本次技能范围。请选择允许的标签页或打开技能起始页，不能自动扩大站点范围。',
    window: '该标签页不属于本次任务窗口。请在当前窗口选择允许的页面或打开技能起始页。',
    private: '不能操作隐私窗口。请在本次任务的普通窗口打开允许的页面。',
    scheme: '当前页面不是可操作的网页。请在本次任务窗口打开允许的 HTTP/HTTPS 页面。',
  };
  return messages[issue.reason];
}
