/**
 * @author Codex
 * @description Adapts named policy IPC and validates safe replies before they enter the Query cache.
 */
import { toolPoliciesResponseSchema, type ToolPolicySettings } from '../../../contracts/tool-policy';

/**
 * Reads the authoritative policy catalog independently of Runtime availability.
 */
export async function readToolPolicies() {
  if (!window.executor) {
    throw new Error('请从执行器应用打开此界面');
  }
  const reply = toolPoliciesResponseSchema.parse(await window.executor.readToolPolicies());
  if (!reply.ok) {
    throw new Error(reply.message);
  }
  return reply.data;
}

/**
 * Publishes one revision-bound policy snapshot without transport retries.
 */
export async function saveToolPolicies(input: ToolPolicySettings) {
  if (!window.executor) {
    throw new Error('请从执行器应用打开此界面');
  }
  const reply = toolPoliciesResponseSchema.parse(await window.executor.saveToolPolicies(input));
  if (!reply.ok) {
    throw new Error(reply.message);
  }
  return reply.data;
}
