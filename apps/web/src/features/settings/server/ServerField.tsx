/**
 * @author Codex
 * @description Renders a typed Server setting with explicit inheritance and runtime source details.
 */
import { Field, FieldDescription, FieldError, FieldLabel } from '@octopus/ui/components/field';
import { Input } from '@octopus/ui/components/input';
import { Button } from '@octopus/ui/components/button';
import { Switch } from '@octopus/ui/components/switch';
import { Badge } from '@octopus/ui/components/badge';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@octopus/ui/components/select';
import { getServerFieldLabels, numericLimits } from '@/features/settings/utils/server-fields';
import { useI18n } from '@/i18n/use-i18n';
import { OriginList } from './OriginList';
import type { ServerSettingKey, ServerSettingsDto } from '@octopus/shared/protocol';

/**
 * Edits only this field; an inherited value remains absent until deliberately changed.
 */
export function ServerField({
  name,
  value,
  snapshot,
  disabled,
  error,
  onChange,
}: {
  name: ServerSettingKey;
  value: string | null;
  snapshot: ServerSettingsDto;
  disabled: boolean;
  error?: string;
  /**
   * Updates the draft; null removes the file override.
   */
  onChange(value: string | null): void;
}) {
  const { t } = useI18n();
  const fieldLabels = getServerFieldLabels(t);
  const state = snapshot.fields[name];
  const restoring = value === null && state.stored.configured;
  const effective = value ?? String(state.next.value ?? state.current.value ?? '');
  const host = name === 'SERVER_HOST';
  const boolean = host || name === 'SERVER_FILE_LOG_ENABLED' || name === 'SERVER_FILE_LOG_REQUIRED';
  const exposed = !['127.0.0.1', '::1'].includes(effective);
  /**
   * Selects field content in the existing condition order.
   */
  function renderFieldContent() {
    if (restoring) {
      return (
        <div className="flex flex-col items-start gap-2">
          <FieldDescription>
            {t(
              'settings.server.restoreInheritHint',
              'Inheritance resumes after saving; the inherited value will be shown then.'
            )}
          </FieldDescription>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onChange(state.stored.value)}
          >
            {t('settings.server.undoRestoreInherit', 'Undo restore inheritance')}
          </Button>
        </div>
      );
    } else if (host) {
      return (
        <FieldDescription>
          {t(
            'settings.server.hostExposureHint',
            'When enabled, the service is exposed to the network and others can control your computer resources through the agent (dangerous) - Current: {{value}}',
            { value: effective }
          )}
          {!['127.0.0.1', '0.0.0.0'].includes(effective)
            ? t('settings.server.customSuffix', ' (custom)')
            : ''}
        </FieldDescription>
      );
    } else if (name === 'SERVER_CORS_ORIGIN') {
      return <OriginList value={effective} disabled={disabled} onChange={onChange} />;
    } else if (name === 'SERVER_FILE_LOG_LEVEL') {
      return (
        <Select
          value={effective || 'inherit'}
          onValueChange={(next) => onChange(next === 'inherit' ? '' : String(next))}
          disabled={disabled}
        >
          <SelectTrigger id={name}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {['inherit', 'fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].map((level) => (
                <SelectItem key={level} value={level}>
                  {level === 'inherit' ? t('settings.server.inheritLogLevel', 'Inherit LOG_LEVEL') : level}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      );
    } else if (!boolean) {
      return (
        <Input
          id={name}
          name={name}
          type="number"
          inputMode="numeric"
          min={numericLimits[name]?.[0]}
          max={numericLimits[name]?.[1]}
          value={effective}
          aria-invalid={!!error}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    } else {
      return null;
    }
  }
  return (
    <Field data-invalid={!!error} data-disabled={disabled}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FieldLabel htmlFor={name}>
          {fieldLabels[name]}{' '}
          {host && exposed && !restoring ? (
            <Badge variant="destructive">{t('settings.server.dangerousBadge', 'Danger')}</Badge>
          ) : null}
        </FieldLabel>
        {boolean && !restoring ? (
          <Switch
            id={name}
            name={name}
            disabled={disabled}
            checked={host ? exposed : ['true', '1'].includes(effective)}
            onCheckedChange={(checked) => {
              if (host) {
                onChange(checked ? '0.0.0.0' : '127.0.0.1');
                return;
              }
              onChange(String(checked));
            }}
          />
        ) : null}
      </div>
      {renderFieldContent()}
      <FieldError errors={error ? [{ message: error }] : []} />
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">
          {value === null
            ? t('settings.server.inheritedSourceSummary', 'Inherited · Source and runtime values')
            : t('settings.server.overrideSourceSummary', 'File override · Source and runtime values')}
        </summary>
        <div className="mt-2 flex flex-col gap-1 break-all">
          <code>{name}</code>
          <span>
            {t('settings.server.storedCurrentLine', 'Stored: {{stored}} · Current: {{current}}', {
              stored: state.stored.configured
                ? JSON.stringify(state.stored.value)
                : t('settings.server.notConfigured', 'Not configured'),
              current: String(state.current.value),
            })}
          </span>
          <span>
            {t(
              'settings.server.nextValueLine',
              'Next load value of the stored configuration: {{next}} · Source: {{source}}',
              {
                next:
                  snapshot.prediction === 'known'
                    ? String(state.next.value)
                    : t('settings.server.hostManagedValue', 'Managed by host'),
                source: state.source,
              }
            )}
          </span>
          {state.overridden ? (
            <span>
              {t(
                'settings.server.stillOverridden',
                'The stored configuration is still overridden by the launch configuration.'
              )}
            </span>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || value === null}
            onClick={() => onChange(null)}
          >
            {t('settings.server.restoreInherit', 'Restore inheritance')}
          </Button>
        </div>
      </details>
    </Field>
  );
}
