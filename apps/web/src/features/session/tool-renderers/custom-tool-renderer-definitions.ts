/**
 * @author Codex
 * @description Declares product-specific tool card registrations separately from Pi built-in renderers.
 */

import {
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
  KnowledgeToolRenderer,
  MemoryToolRenderer,
  summarizeMemoryTool,
  summarizeKnowledgeTool,
  GoalToolRenderer,
  PlanModeToolRenderer,
  SchedulerToolRenderer,
  SubagentToolRenderer,
  summarizeGoalTool,
  summarizePlanModeTool,
  summarizeSchedulerTool,
  summarizeSubagent,
} from './CustomToolRenderers';
import type { Translate } from '@/i18n/use-i18n';
import type { ToolRendererDefinition } from './types';

/**
 * Resolves the localized display label for custom tools whose renderer covers several names.
 */
export function customToolLabel(t: Translate, toolName: string): string | undefined {
  switch (toolName) {
    case 'memory_recall':
      return t('session.toolCard.labels.memoryRecall', 'Recall memory');
    case 'memory_read':
      return t('session.toolCard.labels.memoryRead', 'Read memory');
    default:
      return undefined;
  }
}

/**
 * Add custom tool renderers here; entries take precedence over Pi built-ins and the fallback renderer.
 */
export const CUSTOM_TOOL_RENDERERS: readonly ToolRendererDefinition[] = [
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
