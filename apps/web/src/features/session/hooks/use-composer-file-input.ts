/**
 * @author Codex
 * @description Admits clipboard images and file drops without disturbing ordinary Lexical text input.
 */

import { useRef } from 'react';
import { useEventListener, useMemoizedFn, useSafeState } from 'ahooks';
import { clipboardImageFiles } from '../utils/composer-images';
import type { ClipboardEvent, DragEvent } from 'react';

/**
 * Keeps file-event ownership on the Composer while native text paste and text dragging retain their handlers.
 *
 * @param disabled Prevents new file staging while publication owns the input.
 * @param onFiles Reuses the existing asynchronous attachment admission flow.
 * @param onText Preserves accompanying plain text from mixed clipboard data.
 */
export function useComposerFileInput(
  disabled: boolean,
  onFiles: (files: File[]) => Promise<void>,
  onText: (text: string) => void
) {
  const depth = useRef(0);
  const [dragging, setDragging] = useSafeState(false);
  const resetDrag = useMemoizedFn(() => {
    depth.current = 0;
    setDragging(false);
  });
  useEventListener('dragend', resetDrag);
  const onPaste = useMemoizedFn((event: ClipboardEvent<HTMLDivElement>) => {
    const files = clipboardImageFiles(event.clipboardData);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (disabled) {
      return;
    }
    const text = event.clipboardData.getData('text/plain');
    if (text.trim() !== '') {
      onText(text);
    }
    void onFiles(files);
  });
  const onDragEnter = useMemoizedFn((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) {
      return;
    }
    event.preventDefault();
    depth.current += 1;
    if (!disabled) {
      setDragging(true);
    }
  });
  const onDragOver = useMemoizedFn((event: DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes('Files')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
    }
  });
  const onDragLeave = useMemoizedFn((event: DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes('Files')) {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) {
        setDragging(false);
      }
    }
  });
  const onDrop = useMemoizedFn((event: DragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer.files);
    resetDrag();
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!disabled) {
      void onFiles(files);
    }
  });
  return { dragging, onPaste, onDragEnter, onDragOver, onDragLeave, onDrop };
}
