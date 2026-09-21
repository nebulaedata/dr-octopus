/**
 * @author Codex
 * @description Orchestrates the dual-scope Skill catalog page with search, sections, and lifecycle dialogs.
 */

import { useState } from 'react';
import { Page } from '@/components/Page';
import { PageHero } from '@/components/PageHero';
import { useParams } from '@tanstack/react-router';
import {
  ChevronDownIcon,
  FolderOpenIcon,
  GlobeIcon,
  LaptopMinimalIcon,
  PlusIcon,
  UploadIcon,
} from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@octopus/ui/components/dropdown-menu';
import { SearchInput } from '@/components/SearchInput';
import { Tabs, TabsContent } from '@octopus/ui/components/tabs';
import { PageTabList } from '@/components/PageTabList';
import { useEffectiveSkills, useSkills } from '@/queries/skills-queries';
import { useSessions, useWorkspaces } from '@/queries/workbench-queries';
import { EffectiveSkillSection } from './EffectiveSkillSection';
import { SkillDeleteDialog } from './SkillDeleteDialog';
import { SkillDetailDialog } from './SkillDetailDialog';
import { SkillEditDialog } from './SkillEditDialog';
import { SkillSection } from './SkillSection';
import { SkillUploadDialog } from './SkillUploadDialog';
import { ScrollArea } from '@octopus/ui/components/scroll-area';
import { useI18n } from '@/i18n/use-i18n';
import { workspaceDisplayName } from '@/utils/workspace';
import type { SkillScope } from '@/api/skills';
import type { PageTabItem } from '@/components/PageTabList';
import type { EffectiveSkillDto, SkillDto } from '@octopus/shared/protocol';

type SkillScopeKind = SkillScope['kind'];

interface SkillTarget {
  kind: SkillScopeKind;
  name: string;
}

/**
 * Renders the Workspace-scoped Skill management page inside the Workbench layout.
 */
export function SkillsPage() {
  const params = useParams({ strict: false }) as { workspaceId?: string; sessionId?: string };
  const workspaceId = params.workspaceId ?? '';
  const { t } = useI18n();
  const workspaces = useWorkspaces();
  const sessions = useSessions(workspaceId || undefined);
  const currentWorkspace = workspaces.data?.find((workspace) => workspace.id === workspaceId);
  const workspaceName =
    currentWorkspace === undefined ? undefined : workspaceDisplayName(t, currentWorkspace);
  const runtimeId = sessions.data?.find((session) => session.id === params.sessionId)?.runtime?.runtimeId;

  const workspaceScope: SkillScope = { kind: 'workspace', workspaceId };
  const globalScope: SkillScope = { kind: 'global' };
  const scopeOf = (kind: SkillScopeKind): SkillScope => (kind === 'global' ? globalScope : workspaceScope);

  const workspaceSkills = useSkills(workspaceScope);
  const globalSkills = useSkills(globalScope);
  const effectiveSkills = useEffectiveSkills(workspaceId, runtimeId);

  const [search, setSearch] = useState('');
  const [createState, setCreateState] = useState<{ open: boolean; kind: SkillScopeKind }>({
    open: false,
    kind: 'workspace',
  });
  const [uploadState, setUploadState] = useState<{ open: boolean; kind: SkillScopeKind }>({
    open: false,
    kind: 'workspace',
  });
  const [detailTarget, setDetailTarget] = useState<SkillTarget | null>(null);
  const [editTarget, setEditTarget] = useState<SkillTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SkillTarget | null>(null);

  const keyword = search.trim().toLowerCase();
  const filterByKeyword = (catalog: SkillDto[]): SkillDto[] =>
    keyword
      ? catalog.filter(
          (skill) =>
            skill.name.toLowerCase().includes(keyword) || skill.description.toLowerCase().includes(keyword)
        )
      : catalog;
  const filteredWorkspaceSkills = filterByKeyword(workspaceSkills.data?.skills ?? []);
  const filteredGlobalSkills = filterByKeyword(globalSkills.data?.skills ?? []);
  const filteredEffectiveSkills = (effectiveSkills.data?.skills ?? []).filter(
    (skill: EffectiveSkillDto) =>
      keyword.length === 0 ||
      skill.name.toLowerCase().includes(keyword) ||
      skill.description.toLowerCase().includes(keyword)
  );
  const tabItems: PageTabItem[] = [
    {
      value: 'system',
      label: t('skills.page.tabSystem', 'System'),
      icon: LaptopMinimalIcon,
      count: effectiveSkills.isSuccess ? filteredEffectiveSkills.length : undefined,
    },
    {
      value: 'workspace',
      label: t('skills.page.tabWorkspace', 'Workspace'),
      icon: FolderOpenIcon,
      count: workspaceSkills.isSuccess ? filteredWorkspaceSkills.length : undefined,
    },
    {
      value: 'global',
      label: t('skills.page.tabGlobal', 'Global'),
      icon: GlobeIcon,
      count: globalSkills.isSuccess ? filteredGlobalSkills.length : undefined,
    },
  ];
  const deleteSkill =
    deleteTarget === null
      ? null
      : ((deleteTarget.kind === 'global' ? globalSkills.data?.skills : workspaceSkills.data?.skills)?.find(
          (skill) => skill.name === deleteTarget.name
        ) ?? null);

  return (
    <>
      <Page classNames={{ container: 'overflow-hidden', content: 'gap-6' }}>
        <PageHero
          title={t('skills.page.title', 'Skills')}
          description={t('skills.page.description', 'View loaded skills and manage workspace and global skills.')}
          extra={
            <>
              <SearchInput
                className="w-full sm:w-64"
                aria-label="Search skills"
                placeholder={t('skills.page.searchPlaceholder', 'Search all skills by name or description…')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button />}>
                  <PlusIcon data-icon="inline-start" />
                  {t('skills.page.add', 'Add')}
                  <ChevronDownIcon data-icon="inline-end" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => setCreateState({ open: true, kind: 'workspace' })}>
                      <PlusIcon />
                      {t('skills.page.newSkill', 'New skill')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setUploadState({ open: true, kind: 'workspace' })}>
                      <UploadIcon />
                      {t('skills.common.uploadSkill', 'Upload skill')}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />

        <Tabs defaultValue="system" className="min-h-0 flex-1 overflow-hidden">
          <PageTabList items={tabItems} className="w-full shrink-0 sm:w-fit" itemClassName="w-24" />

          <ScrollArea className="min-h-0 pt-3 pr-2 overflow-y-auto">
            <TabsContent value="system">
              <EffectiveSkillSection
                query={effectiveSkills}
                skills={filteredEffectiveSkills}
                searching={keyword.length > 0}
              />
            </TabsContent>

            <TabsContent value="workspace">
              <SkillSection
                title={t('skills.page.workspaceSectionTitle', 'Workspace skills')}
                description={
                  workspaceName === undefined
                    ? t('skills.page.workspaceDescription', 'Only used by new sessions in the current workspace.')
                    : t('skills.page.workspaceDescriptionNamed', 'Only used by new sessions in workspace "{{name}}".', {
                        name: workspaceName,
                      })
                }
                path={workspaceSkills.data?.root}
                icon={<FolderOpenIcon className="size-4.5" />}
                query={workspaceSkills}
                skills={filteredWorkspaceSkills}
                searching={keyword.length > 0}
                emptyTitle={t('skills.page.workspaceEmptyTitle', 'No skills in the current workspace yet')}
                emptyDescription={t(
                  'skills.page.workspaceEmptyDescription',
                  'Create project-specific conventions, workflows, or domain knowledge.'
                )}
                onCreate={() => setCreateState({ open: true, kind: 'workspace' })}
                onUpload={() => setUploadState({ open: true, kind: 'workspace' })}
                onView={(name) => setDetailTarget({ kind: 'workspace', name })}
                onEdit={(name) => setEditTarget({ kind: 'workspace', name })}
                onDelete={(name) => setDeleteTarget({ kind: 'workspace', name })}
              />
            </TabsContent>

            <TabsContent value="global">
              <SkillSection
                title={t('skills.page.globalSectionTitle', 'Global skills')}
                description={t('skills.page.globalDescription', 'Reused by new sessions across all workspaces.')}
                path={globalSkills.data?.root}
                icon={<GlobeIcon className="size-4.5" />}
                query={globalSkills}
                skills={filteredGlobalSkills}
                searching={keyword.length > 0}
                emptyTitle={t('skills.page.globalEmptyTitle', 'No global skills yet')}
                emptyDescription={t(
                  'skills.page.globalEmptyDescription',
                  'Create general-purpose capabilities reusable across projects.'
                )}
                onCreate={() => setCreateState({ open: true, kind: 'global' })}
                onUpload={() => setUploadState({ open: true, kind: 'global' })}
                onView={(name) => setDetailTarget({ kind: 'global', name })}
                onEdit={(name) => setEditTarget({ kind: 'global', name })}
                onDelete={(name) => setDeleteTarget({ kind: 'global', name })}
              />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </Page>

      <SkillEditDialog
        mode="create"
        scope={scopeOf(createState.kind)}
        workspaceName={workspaceName}
        open={createState.open}
        onOpenChange={(open) => setCreateState((state) => ({ ...state, open }))}
        onScopeKindChange={(kind) => setCreateState((state) => ({ ...state, kind }))}
      />
      <SkillUploadDialog
        scope={scopeOf(uploadState.kind)}
        workspaceName={workspaceName}
        open={uploadState.open}
        onOpenChange={(open) => setUploadState((state) => ({ ...state, open }))}
        onScopeKindChange={(kind) => setUploadState((state) => ({ ...state, kind }))}
      />
      <SkillDetailDialog
        scope={scopeOf(detailTarget?.kind ?? 'workspace')}
        name={detailTarget?.name ?? null}
        open={detailTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetailTarget(null);
          }
        }}
        onEdit={(name) => {
          const kind = detailTarget?.kind ?? 'workspace';
          setDetailTarget(null);
          setEditTarget({ kind, name });
        }}
        onDelete={(name) => {
          const kind = detailTarget?.kind ?? 'workspace';
          setDetailTarget(null);
          setDeleteTarget({ kind, name });
        }}
      />
      {editTarget !== null && (
        <SkillEditDialog
          mode="edit"
          scope={scopeOf(editTarget.kind)}
          name={editTarget.name}
          workspaceName={workspaceName}
          open
          onOpenChange={(open) => {
            if (!open) {
              setEditTarget(null);
            }
          }}
        />
      )}
      <SkillDeleteDialog
        scope={scopeOf(deleteTarget?.kind ?? 'workspace')}
        skill={deleteSkill}
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      />
    </>
  );
}
