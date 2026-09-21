/**
 * @author Codex
 * @description Presents bounded twenty-row schedule navigation without assuming an approximate total.
 */
import { ListPagination } from '@/components/ListPagination';

/**
 * Advance by twenty rows; the caller requests one additional row to determine whether a next page exists.
 */
export function SchedulePagination({
  offset,
  hasMore,
  pending,
  onChange,
}: {
  offset: number;
  hasMore: boolean;
  pending: boolean;
  /**
   * Request the zero-based offset of a reachable page.
   */
  onChange(offset: number): void;
}) {
  return (
    <ListPagination
      aria-label="Record pagination"
      className="pt-3"
      page={offset / 20 + 1}
      hasNextPage={hasMore && offset < 999980}
      disabled={pending}
      onPageChange={(page) => onChange((page - 1) * 20)}
    />
  );
}
