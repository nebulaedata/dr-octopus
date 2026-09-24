/**
 * @author Codex
 * @description Formats only reported document positions, preserving gaps and format-specific locator meaning.
 */
import type { Translate } from '@/i18n/use-i18n';
import type { CoverageLocator } from '@octopus/shared/protocol/attachments';

/**
 * Compacts page-only or slide-only positions; mixed locators retain all supplied dimensions.
 */
export function coverageLocationsLabel(t: Translate, locations: CoverageLocator[]): string {
  if (locations.length === 0) {
    return t('session.coverageLocations.none', 'No specific locations provided');
  }
  if (locations.every((location) => location.page !== undefined && Object.keys(location).length === 1)) {
    return t('session.coverageLocations.pagesOnly', 'Pages {{ranges}}', {
      ranges: numberRanges(
        t,
        locations.map((location) => location.page!)
      ),
    });
  }
  if (locations.every((location) => location.slide !== undefined && Object.keys(location).length === 1)) {
    return t('session.coverageLocations.slidesOnly', 'Slides {{ranges}}', {
      ranges: numberRanges(
        t,
        locations.map((location) => location.slide!)
      ),
    });
  }
  return locations
    .map((location) => locationLabel(t, location))
    .join(t('session.coverageLocations.listSeparator', '; '));
}

/**
 * Joins only consecutive reported numbers, never filling an unreported gap from the total count.
 */
function numberRanges(t: Translate, values: number[]): string {
  const sorted = [...new Set(values)].sort((left, right) => left - right);
  const ranges: string[] = [];
  let start = sorted[0]!;
  let end = start;
  for (const value of sorted.slice(1)) {
    if (value === end + 1) {
      end = value;
    } else {
      ranges.push(start === end ? String(start) : `${start}–${end}`);
      start = end = value;
    }
  }
  ranges.push(start === end ? String(start) : `${start}–${end}`);
  return ranges.join(t('session.coverageLocations.rangeSeparator', ', '));
}

/**
 * Leaves Office part paths explicit rather than deriving fictional page or slide numbers from filenames.
 */
function locationLabel(t: Translate, location: CoverageLocator): string {
  const parts = [
    location.page === undefined
      ? undefined
      : t('session.coverageLocations.pageLabel', 'Page {{page}}', { page: location.page }),
    location.slide === undefined
      ? undefined
      : t('session.coverageLocations.slideLabel', 'Slide {{slide}}', { slide: location.slide }),
    location.sheet === undefined
      ? undefined
      : t('session.coverageLocations.sheetLabel', 'Sheet "{{sheet}}"', { sheet: location.sheet }),
    location.part === undefined
      ? undefined
      : t('session.coverageLocations.partLabel', 'Part {{part}}', { part: location.part }),
    location.region === undefined
      ? undefined
      : t('session.coverageLocations.regionLabel', 'Region {{region}}', { region: location.region }),
  ].filter((part) => part !== undefined);
  return parts.length
    ? parts.join(t('session.coverageLocations.itemSeparator', ', '))
    : t('session.coverageLocations.none', 'No specific locations provided');
}
