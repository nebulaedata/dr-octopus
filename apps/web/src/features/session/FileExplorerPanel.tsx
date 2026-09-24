/**
 * @author Codex
 * @description Presents a session-scoped file browser as a non-route right-side panel.
 */

import { copyTextWithFeedback } from '@/utils/copy-text-with-feedback';
import { CopyIcon } from 'lucide-react';
import { SideRightPanel } from '@/components/SideRightPanel';
import { useWorkspaces } from '@/queries/workbench-queries';
import { ExplorerFileTree } from './ExplorerFileTree';
import { Tooltip, TooltipContent, TooltipTrigger } from '@octopus/ui/components/tooltip';
import { Button } from '@octopus/ui/components/button';
import { useI18n } from '@/i18n/use-i18n';

export interface FileExplorerPanelProps {
  workspaceId: string;
  onClose?(): void;
}

/**
 * Renders the File Explorer panel for a workspace without depending on an active Session.
 */
export function FileExplorerPanel({ workspaceId, onClose }: FileExplorerPanelProps) {
  const { t } = useI18n();
  const { data: workspaces } = useWorkspaces();
  const workspace = workspaces?.find((candidate) => candidate.id === workspaceId);
  const cwd = workspace?.cwd ?? workspaceId;

  return (
    <SideRightPanel
      title={t('session.filesPanel.title', 'File Explorer')}
      classNames={{ content: 'px-0' }}
      onClose={onClose}
      extraHeaderContent={
        <Tooltip>
          <TooltipTrigger
            render={<span className="text-muted-foreground text-xs truncate ml-2">{cwd}</span>}
          />
          <TooltipContent>
            <p>
              {cwd}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Copy agent session path"
                title={t('session.filesPanel.copyPathTitle', 'Copy path')}
                className="ml-1"
                onClick={() => copyTextWithFeedback(cwd)}
              >
                <CopyIcon className="size-3" />
              </Button>
            </p>
          </TooltipContent>
        </Tooltip>
      }
    >
      {workspace && <ExplorerFileTree workspaceId={workspace.id} />}
    </SideRightPanel>
  );
}
