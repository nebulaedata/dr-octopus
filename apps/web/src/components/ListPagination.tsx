/**
 * @author Codex
 * @description Unifies right-aligned list pagination across numbered, offset, and cursor-backed lists.
 */
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@octopus/ui/components/pagination';
import { cn } from '@octopus/ui/lib/utils';
import { useI18n } from '@/i18n/use-i18n';
import { listPaginationPages } from './list-pagination-pages';
import type { ComponentProps } from 'react';

interface ListPaginationProps {
  page: number;
  /**
   * Omit when the API does not provide an exact total; hasNextPage then controls forward navigation.
   */
  pageCount?: number;
  hasNextPage?: boolean;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  'aria-label'?: string;
  previousLabel?: string;
  nextLabel?: string;
  /**
   * Request a reachable one-based page; callers retain ownership of offsets and cursor history.
   */
  onPageChange(page: number): void;
}

/**
 * Render bounded page links without assuming totals for cursor lists or navigating away from the current route.
 */
export function ListPagination({
  page,
  pageCount,
  hasNextPage = false,
  disabled = false,
  compact = false,
  className,
  'aria-label': ariaLabel = '列表分页',
  previousLabel: previousLabelProp,
  nextLabel: nextLabelProp,
  onPageChange,
}: ListPaginationProps) {
  const { t } = useI18n();
  const previousLabel = previousLabelProp ?? t('components.listPagination.previous', 'Previous');
  const nextLabel = nextLabelProp ?? t('components.listPagination.next', 'Next');
  const lastPage = Math.max(page, pageCount ?? page + Number(hasNextPage), 1);
  const canGoNext = pageCount === undefined ? hasNextPage : page < pageCount;
  const pages = listPaginationPages(page, lastPage);
  /**
   * Give the link-based primitive button semantics and block mouse and keyboard activation while unavailable.
   */
  function linkProps(target: number, unavailable = false): ComponentProps<typeof PaginationLink> {
    const blocked = disabled || unavailable;
    return {
      role: 'button',
      tabIndex: blocked ? -1 : 0,
      'aria-disabled': blocked || undefined,
      className: cn(blocked && 'pointer-events-none opacity-50'),
      onClick: (event) => {
        event.preventDefault();
        if (!blocked && target !== page) {
          onPageChange(target);
        }
      },
    };
  }
  const previous = linkProps(page - 1, page <= 1);
  const next = linkProps(page + 1, !canGoNext);
  return (
    <Pagination
      aria-label={ariaLabel}
      aria-busy={disabled}
      className={cn('mx-0 ml-auto min-w-0 shrink-0 justify-end', className)}
    >
      <PaginationContent className="flex-wrap justify-end">
        <PaginationItem>
          <PaginationPrevious
            {...previous}
            aria-label={previousLabel}
            text={previousLabel}
            size={compact ? 'icon' : 'default'}
            className={cn(previous.className, compact && '[&>span]:hidden')}
          />
        </PaginationItem>
        {pages.map((item) => (
          <PaginationItem key={item}>
            {typeof item === 'number' ? (
              <PaginationLink {...linkProps(item)} aria-label={`Page ${item}`} isActive={item === page}>
                {item}
              </PaginationLink>
            ) : (
              <PaginationEllipsis />
            )}
          </PaginationItem>
        ))}
        <PaginationItem>
          <PaginationNext
            {...next}
            aria-label={nextLabel}
            text={nextLabel}
            size={compact ? 'icon' : 'default'}
            className={cn(next.className, compact && '[&>span]:hidden')}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
