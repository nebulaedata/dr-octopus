/**
 * @author Codex
 * @description Owns deterministic custom, built-in and fallback rendering behind a component selection contract.
 */
import {
  ImageIcon,
  BookOpenIcon,
  BrainIcon,
  CalendarClockIcon,
  CalendarDaysIcon,
  CalendarPlusIcon,
  CircleStopIcon,
  HistoryIcon,
  NetworkIcon,
  NotebookPenIcon,
  PencilLineIcon,
  PlayIcon,
  TargetIcon,
  Trash2Icon,
} from 'lucide-react';
import {
  ImagegenToolRenderer,
  KnowledgeToolRenderer,
  MemoryToolRenderer,
  GoalToolRenderer,
  PlanModeToolRenderer,
  SchedulerToolRenderer,
  SubagentToolRenderer,
} from './CustomToolRenderers';
import { summarizeMemoryTool } from '@/features/session/utils/memory-tool-projection';
import { summarizeKnowledgeTool } from '@/features/session/utils/knowledge-projection';
import { summarizeGoalTool } from '@/features/session/utils/goal-projection';
import { summarizePlanModeTool } from '@/features/session/utils/plan-mode-projection';
import { summarizeSchedulerTool } from '@/features/session/utils/scheduler-projection';
import { summarizeSubagent } from '@/features/session/utils/subagent-projection';
import {
  FilePenLineIcon,
  FileSearchIcon,
  FileTextIcon,
  FileUpIcon,
  FolderSearchIcon,
  ListTreeIcon,
  TerminalIcon,
} from 'lucide-react';
import {
  BashToolRenderer,
  EditToolRenderer,
  ReadToolRenderer,
  SearchToolRenderer,
  WriteToolRenderer,
} from './BuiltinToolRenderers';
import { FallbackToolRenderer } from './ToolRendererParts';
import {
  summarizeCommand,
  summarizePath,
  summarizeSearch,
} from '@/features/session/utils/tool-renderer-utils';
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Translate } from '@/i18n/use-i18n';
import type { ToolProjection } from '@/stores/session';
import type { ReactNode } from 'react';
import type { ToolRendererProps } from './ToolRendererParts';

interface ToolRendererDefinition {
  names: readonly string[];
  component: ComponentType<ToolRendererProps>;
  label?: Record<string, string>;
  icon?: LucideIcon;
  /**
   * Collapsed-card summary callback; the tool stays first so existing `(tool)` implementations
   * remain assignable, with the active translator supplied as the second argument.
   */
  summarize?: (tool: ToolProjection, t: Translate) => string | undefined;
}

/**
 * Add custom tool renderers here; entries take precedence over Pi built-ins and the fallback renderer.
 */
const CUSTOM_TOOL_RENDERERS: readonly ToolRendererDefinition[] = [
  { names: ['image_generate'], component: ImagegenToolRenderer, icon: ImageIcon },
  {
    names: ['memory_recall'],
    component: MemoryToolRenderer,
    icon: BrainIcon,
    summarize: summarizeMemoryTool,
  },
  {
    names: ['memory_read'],
    component: MemoryToolRenderer,
    icon: BookOpenIcon,
    summarize: summarizeMemoryTool,
  },
  {
    names: ['knowledge_search', 'knowledge_read', 'knowledge_list_collections'],
    component: KnowledgeToolRenderer,
    summarize: summarizeKnowledgeTool,
    icon: BookOpenIcon,
  },
  {
    names: ['scheduler_create'],
    component: SchedulerToolRenderer,
    icon: CalendarPlusIcon,
    summarize: summarizeSchedulerTool,
  },
  {
    names: ['scheduler_list'],
    component: SchedulerToolRenderer,
    icon: CalendarDaysIcon,
    summarize: summarizeSchedulerTool,
  },
  {
    names: ['scheduler_get'],
    component: SchedulerToolRenderer,
    icon: CalendarClockIcon,
    summarize: summarizeSchedulerTool,
  },
  {
    names: ['scheduler_update'],
    component: SchedulerToolRenderer,
    icon: PencilLineIcon,
    summarize: summarizeSchedulerTool,
  },
  {
    names: ['scheduler_delete'],
    component: SchedulerToolRenderer,
    icon: Trash2Icon,
    summarize: summarizeSchedulerTool,
  },
  {
    names: ['scheduler_run_now'],
    component: SchedulerToolRenderer,
    icon: PlayIcon,
    summarize: summarizeSchedulerTool,
  },
  {
    names: ['scheduler_cancel'],
    component: SchedulerToolRenderer,
    icon: CircleStopIcon,
    summarize: summarizeSchedulerTool,
  },
  {
    names: ['scheduler_history'],
    component: SchedulerToolRenderer,
    icon: HistoryIcon,
    summarize: summarizeSchedulerTool,
  },
  {
    names: ['plan_mode_question', 'plan_mode_complete'],
    component: PlanModeToolRenderer,
    icon: NotebookPenIcon,
    summarize: summarizePlanModeTool,
  },
  {
    names: ['subagent', 'bg_wait'],
    component: SubagentToolRenderer,
    icon: NetworkIcon,
    summarize: summarizeSubagent,
  },
  {
    names: ['goal_complete', 'goal_blocked', 'goal_wait'],
    component: GoalToolRenderer,
    icon: TargetIcon,
    summarize: summarizeGoalTool,
  },
];

const BUILTIN_TOOL_RENDERERS: readonly ToolRendererDefinition[] = [
  { names: ['bash'], component: BashToolRenderer, icon: TerminalIcon, summarize: summarizeCommand },
  { names: ['read'], component: ReadToolRenderer, icon: FileTextIcon, summarize: summarizePath },
  { names: ['edit'], component: EditToolRenderer, icon: FilePenLineIcon, summarize: summarizePath },
  { names: ['write'], component: WriteToolRenderer, icon: FileUpIcon, summarize: summarizePath },
  { names: ['grep'], component: SearchToolRenderer, icon: FileSearchIcon, summarize: summarizeSearch },
  { names: ['find'], component: SearchToolRenderer, icon: FolderSearchIcon, summarize: summarizeSearch },
  { names: ['ls'], component: SearchToolRenderer, icon: ListTreeIcon, summarize: summarizePath },
];

const FALLBACK_TOOL_RENDERER: ToolRendererDefinition = {
  names: [],
  component: FallbackToolRenderer,
  icon: TerminalIcon,
};

const TOOL_RENDERERS = [...CUSTOM_TOOL_RENDERERS, ...BUILTIN_TOOL_RENDERERS];

/**
 * Resolves the first explicitly registered renderer and otherwise returns the safe fallback.
 *
 * @param toolName - Exact Pi tool name.
 * @returns Renderer definition for the tool.
 */
function resolveToolRenderer(toolName: string): ToolRendererDefinition {
  return TOOL_RENDERERS.find((renderer) => renderer.names.includes(toolName)) ?? FALLBACK_TOOL_RENDERER;
}

export type ToolRendererSelection = Omit<ToolRendererDefinition, 'names'>;
/**
 * Supplies the selected presentation to the generic tool-card shell without publishing the registry.
 */
export function ToolRenderer({
  toolName,
  children,
}: {
  toolName: string;
  children: (renderer: ToolRendererSelection) => ReactNode;
}) {
  return children(resolveToolRenderer(toolName));
}
