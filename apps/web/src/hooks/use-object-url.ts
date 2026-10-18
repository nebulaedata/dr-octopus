/**
 * @author Codex
 * @description Owns one browser object URL for a Blob and revokes it on replacement or unmount.
 */

import { useEffect } from 'react';
import { useSafeState } from 'ahooks';

/**
 * Bridges a transient Blob into an image source without allocating or persisting a Base64 copy.
 *
 * @param blob Browser-owned source; undefined releases the previous URL.
 * @returns Only the URL belonging to the current Blob, once mounted in a browser.
 */
export function useObjectUrl(blob?: Blob): string | undefined {
  const [resource, setResource] = useSafeState<{ blob: Blob; url: string }>();
  useEffect(() => {
    if (blob === undefined) {
      setResource(undefined);
      return;
    }
    const url = URL.createObjectURL(blob);
    setResource({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob, setResource]);
  return resource?.blob === blob ? resource?.url : undefined;
}
