/**
 * @author Claude
 * @description Lets people pick the interface language inside canonical and dialog Settings surfaces; the choice applies immediately and persists on this device.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@octopus/ui/components/card';
import { Field, FieldGroup, FieldLabel } from '@octopus/ui/components/field';
import { ToggleGroup, ToggleGroupItem } from '@octopus/ui/components/toggle-group';
import { languageOptions } from '@/i18n/config';
import { useI18n } from '@/i18n/use-i18n';
import { SettingContainer } from '../layout/SettingContainer';
import type { SupportedLanguage } from '@/i18n/config';

/**
 * Switches the interface language through i18next; the language store persists the choice in localStorage.
 */
export function LanguageSettingsPage() {
  const { t, i18n } = useI18n();
  const current = i18n.resolvedLanguage ?? 'en';

  return (
    <SettingContainer>
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.language.title', 'Language')}</CardTitle>
          <CardDescription>
            {t(
              'settings.language.description',
              'Choose the display language. Changes apply immediately and are remembered on this device.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel id="settings-language-label">
                {t('settings.language.label', 'Display language')}
              </FieldLabel>
              <ToggleGroup
                aria-labelledby="settings-language-label"
                value={[current]}
                onValueChange={(values) => {
                  const next = values[0] as SupportedLanguage | undefined;
                  if (next && next !== current) {
                    void i18n.changeLanguage(next);
                  }
                }}
                variant="outline"
              >
                {languageOptions.map((option) => (
                  <ToggleGroupItem key={option.value} value={option.value}>
                    {option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
    </SettingContainer>
  );
}
