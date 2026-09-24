/**
 * @author Codex
 * @description Edits an ordered list of additional browser origins without granting access implicitly.
 */
import { useState } from 'react';
import { Button } from '@octopus/ui/components/button';
import { Input } from '@octopus/ui/components/input';
import { FieldDescription } from '@octopus/ui/components/field';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useI18n } from '@/i18n/use-i18n';

/**
 * Retains unfinished rows locally while publishing the exact comma-separated draft.
 */
export function OriginList({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  /**
   * Publishes changes for validation and explicit saving.
   */
  onChange(value: string): void;
}) {
  const { t } = useI18n();
  const [extra, setExtra] = useState(false);
  let rows: string[];
  if (value) {
    rows = value.split(',');
  } else if (extra) {
    rows = [''];
  } else {
    rows = [];
  }
  return (
    <div className="flex flex-col gap-2">
      <FieldDescription>
        {t(
          'settings.server.originListHint',
          'Same-origin access from localhost or an IP address needs no configuration; add trusted origins when using a custom domain, a standalone frontend, or cross-port access.'
        )}
      </FieldDescription>
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            id={index === 0 ? 'SERVER_CORS_ORIGIN' : undefined}
            aria-label={`Extra origin ${index + 1}`}
            value={row}
            placeholder="https://example.com"
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) =>
              onChange(
                rows.map((item, position) => (position === index ? event.target.value : item)).join(',')
              )
            }
          />
          <Button
            type="button"
            variant="destructive"
            size="icon"
            aria-label={`Remove origin ${index + 1}`}
            disabled={disabled}
            onClick={() => {
              setExtra(false);
              onChange(rows.filter((_, position) => position !== index).join(','));
            }}
          >
            <Trash2Icon />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => {
          setExtra(true);
          if (rows.length) {
            onChange([...rows, ''].join(','));
          }
        }}
      >
        <PlusIcon />
        {t('settings.server.addOrigin', 'Add origin')}
      </Button>
    </div>
  );
}
