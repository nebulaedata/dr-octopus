/**
 * @author Codex
 * @description Builds bounded page links for known totals and forward-only page discovery.
 */
export type PaginationPage = number | 'ellipsis-start' | 'ellipsis-end';

/**
 * Keep at most five slots, including the current page; unknown totals expose only confirmed next pages.
 * @param page Current one-based page.
 * @param lastPage Last reachable page, which may only be the next discovered page.
 * @returns Ordered page numbers and stable, noninteractive gap markers.
 */
export function listPaginationPages(page: number, lastPage: number): PaginationPage[] {
  if (lastPage <= 5) {
    return Array.from({ length: lastPage }, (_, index) => index + 1);
  }
  if (page <= 3) {
    return [1, 2, 3, 'ellipsis-end', lastPage];
  }
  if (page >= lastPage - 2) {
    return [1, 'ellipsis-start', lastPage - 2, lastPage - 1, lastPage];
  }
  return [1, 'ellipsis-start', page, 'ellipsis-end', lastPage];
}
