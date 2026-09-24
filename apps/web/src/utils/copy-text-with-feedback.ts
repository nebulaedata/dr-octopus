/**
 * @author Codex
 * @description Reports clipboard failures for browser copy actions without unhandled rejections.
 */
import { toast } from '@octopus/ui/components/toast';
import { t } from '@/i18n/translate';
import { copyText } from '@/utils/clipboard';

/**
 * Returns true only after copying succeeds; otherwise presents manual-copy guidance.
 */
export async function copyTextWithFeedback(text: string): Promise<boolean> {
  try {
    await copyText(text);
    return true;
  } catch {
    toast.add({
      title: t('common.copyFailedTitle', 'Copy failed'),
      description: t('common.copyFailedDescription', 'Select the text and copy it manually'),
      type: 'error',
    });
    return false;
  }
}
