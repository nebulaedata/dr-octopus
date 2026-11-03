/**
 * @author Codex
 * @description Presents dismissible semantic Alert feedback above the settings form without moving its layout.
 */
import { useEffect, useState } from 'react';
import { Alert } from '@octopus/custom-ui/components/alert';

export type SettingsNotice = { kind: 'success' | 'error'; message: string; id: number };

/**
 * Auto-dismisses success only; pointer and keyboard interaction keep the message available.
 */
export function SettingsToast({ notice, close }: { notice: SettingsNotice; close: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [focusedNotice, setFocusedNotice] = useState<number | null>(null);
  const focused = focusedNotice === notice.id;
  useEffect(() => {
    if (notice.kind !== 'success' || hovered || focused) {
      return;
    }
    const timer = setTimeout(close, 4000);
    return () => clearTimeout(timer);
  }, [notice.id, notice.kind, hovered, focused, close]);
  const success = notice.kind === 'success';
  return (
    <div
      className="pointer-events-auto rounded-lg bg-background shadow-md"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocusedNotice(notice.id)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocusedNotice(null);
        }
      }}
    >
      <Alert
        key={notice.id}
        variant={success ? 'success' : 'danger'}
        showIcon
        description={notice.message}
        allowClose
        closeLabel="关闭提示"
        onClose={close}
      />
    </div>
  );
}
