/**
 * @author Claude
 * @description Provides the settings page search predicate matching both localized command labels and combo text.
 */

export interface ShortcutSearchTarget {
  label: string;
  combo: string | null;
}

/**
 * Matches a shortcut row against a search query.
 *
 * The label match is a plain case-insensitive contains; the combo match also compares separator-stripped
 * forms so `ctrl b` and `ctrlb` both hit `Ctrl+B`.
 *
 * @param target Localized label plus effective combo (null when unbound).
 * @param query Raw search input.
 * @returns True when the row should stay visible; empty queries match everything.
 */
export function matchesShortcutQuery(target: ShortcutSearchTarget, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (normalized === '') {
    return true;
  }
  if (target.label.toLowerCase().includes(normalized)) {
    return true;
  }
  if (target.combo === null) {
    return false;
  }
  const combo = target.combo.toLowerCase();
  if (combo.includes(normalized)) {
    return true;
  }
  const squeezed = normalized.replace(/[\s+]+/g, '');
  return squeezed !== '' && combo.replace(/\+/g, '').includes(squeezed);
}
