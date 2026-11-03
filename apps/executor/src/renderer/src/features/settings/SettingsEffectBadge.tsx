/**
 * @author Codex
 * @description Maps each settings section to one of the two supported save-effect descriptions.
 */
import { CheckCircle2Icon, ClockIcon } from 'lucide-react';
import { Badge } from '@octopus/ui/components/badge';

const effects = {
  immediate: { label: '保存后立即生效', Icon: CheckCircle2Icon },
  restart: { label: '保存并重启后生效', Icon: ClockIcon },
} as const;

const settingsEffects = {
  window: 'immediate',
  device: 'restart',
  toolPolicy: 'restart',
  service: 'restart',
  transfer: 'restart',
} as const satisfies Record<string, keyof typeof effects>;

/**
 * Keeps effect icons and wording consistent with the owning section's configured behavior.
 */
export function SettingsEffectBadge({ setting, id }: { setting: keyof typeof settingsEffects; id?: string }) {
  const { label, Icon } = effects[settingsEffects[setting]];
  return (
    <Badge id={id} variant="secondary">
      <Icon />
      {label}
    </Badge>
  );
}
