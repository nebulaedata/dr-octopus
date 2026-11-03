/**
 * @author Codex
 * @description Connects native SDK lifecycle and tool execution to the authenticated durable Worker without implementing an agent loop.
 */
import type { ModelMessage, ToolResultPart } from 'ai';
import type { SkillToolCall } from './skill-session';
import type { SkillFinishReason } from './skill-response';
import type { PageAccessIssue } from '../../page-access';

export interface BuiltinAgentRuntime {
  /**
   * Reserves one model request and returns the committed conversation and current tool restrictions.
   */
  prepare(): Promise<{ messages: ModelMessage[]; responseRecovery: boolean; pageAccess?: PageAccessIssue }>;
  /**
   * Persists the entire model batch before SDK tool execution; questions take precedence over effects.
   */
  record(messages: ModelMessage[], calls: SkillToolCall[], finishReason: SkillFinishReason): Promise<void>;
  /**
   * Saves canonical SDK response messages and refreshes the stop state from the committed task budget.
   */
  checkpoint(messages: ModelMessage[]): Promise<void>;
  /**
   * Executes an admitted operation or returns its existing durable result.
   */
  execute(toolCallId: string): Promise<ToolResultPart['output']>;
  /**
   * Reports a committed terminal, waiting, uncertain or exhausted-budget state to the native SDK stop predicate.
   */
  stopped(): boolean;
}
