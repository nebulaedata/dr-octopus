/**
 * @author Codex
 * @description Exposes product-specific ToolRenderer components and their presentation projections through one boundary.
 */

export { SubagentToolRenderer } from './SubagentToolRenderer';
export { GoalToolRenderer } from './GoalToolRenderer';
export { PlanModeToolRenderer } from './PlanModeToolRenderer';
export { SchedulerToolRenderer } from './SchedulerToolRenderer';
export { projectGoalToolDetails, summarizeGoalTool } from './goal-projection';
export { projectSubagentDetails, summarizeSubagent } from './subagent-projection';
export { projectPlanModeTool, summarizePlanModeTool } from './plan-mode-projection';
export { projectSchedulerTool, summarizeSchedulerTool } from './scheduler-projection';
export type { SubagentChildProjection, SubagentDetailsProjection } from './subagent-projection';
export type { GoalToolDetailsProjection } from './goal-projection';
export type {
  PlanModeOptionProjection,
  PlanModeQuestionProjection,
  PlanModeToolProjection,
} from './plan-mode-projection';
export type {
  SchedulerRunProjection,
  SchedulerScheduleProjection,
  SchedulerTaskProjection,
  SchedulerToolProjection,
} from './scheduler-projection';

export { KnowledgeToolRenderer } from './KnowledgeToolRenderer';
export { summarizeKnowledgeTool } from './knowledge-projection';

export { MemoryToolRenderer } from './MemoryToolRenderer';
export { summarizeMemoryTool } from './memory-tool-projection';
