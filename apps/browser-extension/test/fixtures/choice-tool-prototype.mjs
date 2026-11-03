/**
 * @author Codex
 * @description Test-only requirement-owned choice execution; the adapter must provide trusted semantic bindings, which production PageController does not yet expose.
 */
import { z } from 'zod';
import { tool } from 'ai';

/**
 * Keeps the model's input limited to a saved requirement identity and shares admission across exposed effects.
 * This prototype denies all raw mutations, so it proves a bounded choice phase, not a general replay replacement.
 */
export function choiceToolPrototype(requirements, adapter) {
  const owned = z
    .array(
      z.strictObject({
        id: z.string().min(1),
        group: z.string().min(1),
        option: z.string().min(1),
        role: z.enum(['radio', 'checkbox', 'switch']),
        checked: z.boolean(),
      })
    )
    .min(1)
    .max(20)
    .parse(requirements);
  if (
    new Set(owned.map((item) => item.id)).size !== owned.length ||
    new Set(owned.map((item) => JSON.stringify([item.group, item.option, item.role]))).size !== owned.length
  ) {
    throw Error('AMBIGUOUS_REQUIREMENTS');
  }
  let uncertain = false;
  let effects = 0;
  let calls = 0;
  let waitingForAnswer = false;
  const trace = [];
  /**
   * Resolves exactly one current control; names alone never select across groups or roles.
   */
  async function resolve(requirement) {
    const controls = await adapter.observe();
    const matches = controls.filter(
      (control) =>
        control.group === requirement.group &&
        control.option === requirement.option &&
        control.role === requirement.role
    );
    if (!matches.length) {
      return { status: 'unavailable', action: 'ask_user_question' };
    }
    if (matches.length !== 1) {
      return { status: 'ambiguous', action: 'ask_user_question' };
    }
    const control = matches[0];
    if (!control.enabled || typeof control.checked !== 'boolean') {
      return { status: 'unknown', action: 'ask_user_question' };
    }
    return { status: 'resolved', control };
  }
  /**
   * Applies at most one action, never toggles an already correct state, and preserves unknown effects.
   */
  async function apply({ requirementId }) {
    if (waitingForAnswer) {
      return { status: 'user_answer_required' };
    }
    const requirement = owned.find((item) => item.id === requirementId);
    if (!requirement) {
      return { status: 'invalid_requirement' };
    }
    if (uncertain) {
      return { status: 'outcome_unknown', action: 'ask_user_question' };
    }
    const before = await resolve(requirement);
    if (before.status !== 'resolved') {
      return before;
    }
    if (before.control.checked === requirement.checked) {
      return { status: 'satisfied', changed: false };
    }
    if (requirement.role === 'radio' && requirement.checked === false) {
      return { status: 'unsupported', action: 'ask_user_question' };
    }
    if (++effects > 8) {
      return { status: 'limit' };
    }
    let result;
    try {
      result = await adapter.apply(before.control);
    } catch {
      uncertain = true;
      return { status: 'outcome_unknown', action: 'ask_user_question' };
    }
    if (result === 'changed') {
      return { status: 'page_changed', action: 'observe_page' };
    }
    if (result !== 'applied') {
      uncertain = true;
      return { status: 'outcome_unknown', action: 'ask_user_question' };
    }
    let after;
    try {
      after = await resolve(requirement);
    } catch {
      uncertain = true;
      return { status: 'outcome_unknown', action: 'ask_user_question' };
    }
    if (after.status !== 'resolved' || after.control.checked !== requirement.checked) {
      uncertain = true;
      return { status: 'outcome_unknown', action: 'ask_user_question' };
    }
    return { status: 'satisfied', changed: true };
  }
  /**
   * Wraps execution with an inspectable finite ledger; no application state or user files are touched.
   */
  function tracked(name, execute) {
    return async (input) => {
      if (++calls > 24) {
        throw Error('PROTOTYPE_CALL_LIMIT');
      }
      const result = await execute(input);
      trace.push({ name, input, result });
      return result;
    };
  }
  const tools = {
    apply_choice: tool({
      description:
        '按已保存的requirementId应用选择。目标缺失、歧义或结果未知时询问用户，不得用其他选项替代。',
      inputSchema: z.strictObject({ requirementId: z.string() }),
      execute: tracked('apply_choice', apply),
    }),
    observe_page: tool({
      description: '读取当前控件及真实状态。',
      inputSchema: z.strictObject({}),
      execute: tracked('observe_page', () => adapter.observe()),
    }),
    browser_click: tool({
      description: '原始点击入口；本选择阶段禁用，必须使用apply_choice。',
      inputSchema: z.strictObject({ elementIndex: z.number().int() }),
      execute: tracked('browser_click', async () => ({
        status: 'raw_mutation_forbidden',
        action: 'apply_choice',
      })),
    }),
    browser_fill: tool({
      description: '原始填写入口；本选择阶段禁用。',
      inputSchema: z.strictObject({ text: z.string() }),
      execute: tracked('browser_fill', async () => ({ status: 'raw_mutation_forbidden' })),
    }),
    ask_user_question: tool({
      description: '缺少目标、状态未知或需要替代方案时向用户提问，等待用户决策。',
      inputSchema: z.strictObject({ question: z.string().min(1).max(400) }),
    }),
    finish_run: tool({
      description: '检查要求是否真的满足后结束当前选择阶段，不表示业务提交或支付完成。',
      inputSchema: z.strictObject({}),
      execute: tracked('finish_run', async () => {
        if (waitingForAnswer) {
          return { finished: false, status: 'user_answer_required' };
        }
        if (uncertain) {
          return { finished: false, status: 'outcome_unknown' };
        }
        for (const requirement of owned) {
          const result = await resolve(requirement);
          if (result.status !== 'resolved' || result.control.checked !== requirement.checked) {
            return { finished: false, status: 'unmet_requirement' };
          }
        }
        return { finished: true };
      }),
    }),
  };
  return {
    tools,
    trace,
    requirements: structuredClone(owned),
    onLanguageModelCallEnd: ({ content }) => {
      if (content.some((part) => part.type === 'tool-call' && part.toolName === 'ask_user_question')) {
        waitingForAnswer = true;
      }
    },
    finished: () => trace.at(-1)?.name === 'finish_run' && trace.at(-1).result.finished === true,
  };
}
