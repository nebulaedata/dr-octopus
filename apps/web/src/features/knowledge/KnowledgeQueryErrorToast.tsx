/**
 * @author Codex
 * @description Reports query failures once per continuous error while keeping polling from repeating toasts.
 */
import { useEffect, useRef } from 'react';
import { toast } from '@octopus/ui/components/toast';

/**
 * Allows the same error to notify again after recovery; callers key this component by query scope.
 */
export function KnowledgeQueryErrorToast({ title, error }: { title: string; error: Error | null }) {
  const previous = useRef<string | undefined>(undefined);
  const message = error?.message;
  useEffect(() => {
    if (message !== undefined && previous.current !== message) {
      toast.add({ title, description: message, type: 'error' });
    }
    previous.current = message;
  }, [message, title]);
  return null;
}
