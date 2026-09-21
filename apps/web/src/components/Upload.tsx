/**
 * @author Codex
 * @description Provides a reusable file-input trigger while keeping the native input visually hidden.
 */

import { useRef } from 'react';
import type { ChangeEvent, ChangeEventHandler, MouseEvent, ReactNode } from 'react';

export interface UploadProps {
  accept?: string;
  disabled?: boolean;
  multiple?: boolean;
  children: ReactNode;
  onChange?: ChangeEventHandler<HTMLInputElement>;
}

/**
 * Opens a native file picker when its child trigger is activated.
 */
export function Upload({ accept, disabled = false, multiple = false, children, onChange }: UploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Forwards the selection and clears the native value so choosing the same file again emits a change.
   */
  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    onChange?.(event);
    event.currentTarget.value = '';
  }

  /**
   * Preserves the child's click behavior before opening the file picker.
   */
  function handleClick(event: MouseEvent<HTMLSpanElement>): void {
    if (!disabled && !event.defaultPrevented) {
      inputRef.current?.click();
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        accept={accept}
        disabled={disabled}
        multiple={multiple}
        onChange={handleChange}
      />
      <span className="contents" onClick={handleClick}>
        {children}
      </span>
    </>
  );
}
