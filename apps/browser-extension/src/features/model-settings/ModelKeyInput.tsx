/**
 * @author Codex
 * @description Toggles visibility of the currently entered model key without retrieving persisted credentials.
 */
import { useEffect, useState } from 'react';
import { EyeIcon, EyeOffIcon } from 'lucide-react';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@octopus/ui/components/input-group';

/**
 * Owns reveal state only; the settings form owns the key and remounts this field when the endpoint changes.
 */
export function ModelKeyInput({
  value,
  onChange,
  onBlur,
  invalid,
  disabled,
  visible,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  invalid: boolean;
  disabled: boolean;
  visible: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!visible) {
      setRevealed(false);
    }
  }, [visible]);
  const label = revealed ? '隐藏密钥' : '显示密钥';
  const Icon = revealed ? EyeOffIcon : EyeIcon;
  return (
    <InputGroup className="min-w-0 flex-1">
      <InputGroupInput
        id="model-key"
        name="apiKey"
        type={revealed ? 'text' : 'password'}
        value={value}
        disabled={disabled}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        aria-invalid={invalid}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          type="button"
          size="icon-xs"
          disabled={disabled}
          aria-label={label}
          title={label}
          aria-pressed={revealed}
          aria-controls="model-key"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setRevealed((current) => !current)}
        >
          <Icon aria-hidden="true" />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
