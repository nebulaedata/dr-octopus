/**
 * @author Codex
 * @description Presents workspace and global knowledge catalogs as Tabs within Workspace and Session Workbench routes.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { FolderIcon, FolderPlusIcon, GlobeIcon, Settings2Icon } from 'lucide-react';
import { Button, buttonVariants } from '@octopus/ui/components/button';
import { Tabs, TabsContent } from '@octopus/ui/components/tabs';
import { Page } from '@/components/Page';
import { PageHero } from '@/components/PageHero';
import { PageTabList } from '@/components/PageTabList';
import { KnowledgeDirectory } from './KnowledgeDirectory';
import { Tooltip, TooltipContent, TooltipTrigger } from '@octopus/ui/components/tooltip';
import { useI18n } from '@/i18n/use-i18n';

/**
 * Resets catalog state when the route's Workspace changes.
 */
export function KnowledgePage() {
  const { workspaceId } = useParams({ strict: false });
  return workspaceId === undefined ? null : <KnowledgeCatalog key={workspaceId} workspaceId={workspaceId} />;
}

/**
 * Keeps tab controls mounted while the catalog scope lives in the shareable URL.
 */
function KnowledgeCatalog({ workspaceId }: { workspaceId: string }) {
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const { t } = useI18n();
  const scope = useSearch({ strict: false }).scope === 'global' ? 'global' : 'workspace';

  /**
   * Closes scope-bound creation before switching the catalog through the URL.
   */
  function handleScopeChange(value: 'workspace' | 'global') {
    setCreating(false);
    void navigate({
      to: '.',
      search: (previous) => ({
        ...previous,
        scope: value === 'workspace' ? undefined : value,
        collection: undefined,
      }),
      replace: true,
      resetScroll: false,
    });
  }
  return (
    <Page
      classNames={{
        container: 'lg:overflow-hidden',
        content: 'h-auto min-h-full max-w-7xl lg:h-full',
      }}
    >
      <PageHero
        title={t('knowledge.page.title', 'Knowledge base')}
        description={t(
          'knowledge.page.description',
          'Add materials to the knowledge base to make the agent more knowledgeable.'
        )}
        extra={
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Link
                    to="."
                    search={(previous) => ({
                      ...previous,
                      settings: { path: '/settings/knowledge' },
                    })}
                    mask={{ to: '/settings/knowledge', unmaskOnReload: true }}
                    className={buttonVariants({ variant: 'ghost', size: 'icon' })}
                    aria-label="Model service configuration"
                  />
                }
              >
                <Settings2Icon />
              </TooltipTrigger>
              <TooltipContent>{t('knowledge.page.modelSettings', 'Model service configuration')}</TooltipContent>
            </Tooltip>
            <Button onClick={() => setCreating(true)}>
              <FolderPlusIcon />
              {t('knowledge.page.newCollection', 'New collection')}
            </Button>
          </>
        }
      />
      <Tabs value={scope} onValueChange={handleScopeChange} className="min-h-0 flex-1 gap-5">
        <PageTabList
          items={[
            { value: 'workspace', label: t('knowledge.page.scopeWorkspace', 'Workspace'), icon: FolderIcon },
            { value: 'global', label: t('knowledge.page.scopeGlobal', 'Global'), icon: GlobeIcon },
          ]}
        />
        {(['workspace', 'global'] as const).map((kind) => (
          <TabsContent key={kind} value={kind} className="min-h-0 flex-1 lg:overflow-hidden">
            {scope === kind && (
              <KnowledgeDirectory
                workspaceId={kind === 'workspace' ? workspaceId : undefined}
                creating={creating}
                onCreatingChange={setCreating}
              />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </Page>
  );
}
