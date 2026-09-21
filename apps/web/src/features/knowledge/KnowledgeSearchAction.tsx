/**
 * @author Codex
 * @description Opens collection-scoped search from local collection actions and remote read-only headers.
 */
import { useState } from 'react';
import { SearchIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { Dialog, DialogTrigger } from '@octopus/ui/components/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@octopus/ui/components/tooltip';
import { KnowledgeSearchDialog } from './KnowledgeSearchDialog';
import { useI18n } from '@/i18n/use-i18n';
import type { KnowledgeCollection } from '@octopus/shared/protocol/knowledge';

/**
 * Starts a fresh search on each opening and restores focus to the collection action on close.
 */
export function KnowledgeSearchAction({
  workspaceId,
  collection,
}: {
  workspaceId?: string;
  collection: KnowledgeCollection;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={<DialogTrigger render={<Button variant="ghost" size="icon-sm" />} />}
          aria-label="Search collection"
        >
          <SearchIcon />
        </TooltipTrigger>
        <TooltipContent>
          {t('knowledge.searchAction.tooltip', 'Search knowledge in this collection and view the source text')}
        </TooltipContent>
      </Tooltip>
      {open ? <KnowledgeSearchDialog workspaceId={workspaceId} collection={collection} /> : null}
    </Dialog>
  );
}
