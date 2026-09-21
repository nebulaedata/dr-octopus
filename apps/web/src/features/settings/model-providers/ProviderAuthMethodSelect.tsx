/**
 * @author Codex
 * @description Selects the Provider authentication flow controlled by the owning form or dialog.
 */

import { Field, FieldLabel } from '@octopus/ui/components/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@octopus/ui/components/select';
import { useI18n } from '@/i18n/use-i18n';
import type { ModelProviderAuthMethod } from '@octopus/shared/protocol';

export interface ProviderAuthMethodSelectProps {
  methods: ModelProviderAuthMethod[];
  value: ModelProviderAuthMethod | null;
  /**
   * Reports the selected Provider authentication method.
   */
  onChange(method: ModelProviderAuthMethod): void;
  disabled?: boolean;
}

/**
 * Keeps the pending UI choice separate from the effective Runtime authentication method.
 */
export function ProviderAuthMethodSelect(props: ProviderAuthMethodSelectProps) {
  const { t } = useI18n();
  const authMethodItems = props.methods.map((method) => ({
    value: method,
    label: method === 'api_key' ? 'API Key' : 'OAuth',
  }));

  return (
    <Field>
      <FieldLabel htmlFor="provider-auth-method" className="text-xs text-muted-foreground">
        {t('settings.providers.auth.methodLabel', 'Authentication method')}
      </FieldLabel>
      <div className="w-48">
        <Select
          items={authMethodItems}
          value={props.value}
          onValueChange={(value) => {
            const method = props.methods.find((candidate) => candidate === value);
            if (method !== undefined) {
              props.onChange(method);
            }
          }}
          disabled={props.disabled || authMethodItems.length === 0}
        >
          <SelectTrigger id="provider-auth-method" className="w-full">
            <SelectValue placeholder={t('settings.providers.auth.noMethods', 'No authentication methods available')} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {authMethodItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </Field>
  );
}
