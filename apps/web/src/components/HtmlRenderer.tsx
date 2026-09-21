/**
 * @author Codex
 * @description Renders standalone HTML content inside a restricted preview boundary.
 */

import { useI18n } from '@/i18n/use-i18n';

export interface HtmlRendererProps {
  children: string;
}

/**
 * Isolates untrusted HTML from the application without granting script or navigation capabilities.
 */
export function HtmlRenderer({ children }: HtmlRendererProps) {
  const { t } = useI18n();
  return (
    <iframe
      title={t('components.htmlRenderer.title', 'HTML preview')}
      className="size-full border-0 bg-white"
      srcDoc={children}
      sandbox=""
      referrerPolicy="no-referrer"
    />
  );
}
