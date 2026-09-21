/**
 * @author Codex
 * @description Provides a consistent search field with a leading icon and optional result count.
 */
import { SearchIcon } from 'lucide-react';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@octopus/ui/components/input-group';
import { useI18n } from '@/i18n/use-i18n';
import type { ComponentProps } from 'react';

interface SearchInputProps extends Omit<ComponentProps<typeof InputGroupInput>, 'type'> {
  resultCount?: number;
}

/**
 * Pass input behavior through unchanged; className sizes the group and omitted counts remain hidden.
 */
export function SearchInput({ className, resultCount, ...props }: SearchInputProps) {
  const { t } = useI18n();
  return (
    <InputGroup className={className}>
      <InputGroupInput
        type="search"
        aria-label={props.placeholder ?? 'Search'}
        {...props}
      />
      <InputGroupAddon>
        <SearchIcon aria-hidden="true" />
      </InputGroupAddon>
      {resultCount !== undefined && (
        <InputGroupAddon align="inline-end">
          <InputGroupText className="whitespace-nowrap" role="status">
            {t('components.searchInput.resultCount', '{{count}} results', { count: resultCount })}
          </InputGroupText>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}
