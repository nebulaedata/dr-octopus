/**
 * @author Codex
 * @description Normalizes Pi Extension UI wire strings into concise Questionnaire presentation models.
 */

export interface ExtensionRequestPayload {
  id: string;
  method?: string;
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  hostQuestionnaire?: unknown;
}

export interface DisplayOption {
  description?: string;
  label: string;
  value: string;
}

export interface RpivMultipleQuestionnaire {
  adapter: 'rpiv-ask-user-question';
  package: '@juicesharp/rpiv-ask-user-question';
  version: '2.7.1';
  toolCallId: string;
  questionIndex: number;
  multiple: true;
  header: string;
  title: string;
  options: Array<{ id: string; label: string; description: string }>;
  responseEncoding: 'rpiv-rpc-v1';
}

export interface PlanModeQuestionnaire {
  adapter: 'pi-plan-mode';
  package: '@narumitw/pi-plan-mode';
  version: '0.55.3';
  toolCallId: string;
  questionIndex: number;
  multiple: false;
  header: string;
  title: string;
  options: Array<{ id: string; label: string; description: string }>;
  responseEncoding: 'pi-tui-kit-select-v1';
}

const READY_PLAN_TITLE = 'Proposed plan ready. What next?';
const READY_PLAN_DESCRIPTION = 'Choose how to continue with this plan.';

/**
 * Accepts only the complete versioned Host projection for the pinned Plan select contract.
 */
export function getPlanModeQuestionnaire(
  payload: ExtensionRequestPayload
): PlanModeQuestionnaire | undefined {
  if (payload.method !== 'select' || !isRecord(payload.hostQuestionnaire)) {
    return undefined;
  }
  const projection = payload.hostQuestionnaire;
  const options = projection['options'];
  if (
    projection['adapter'] !== 'pi-plan-mode' ||
    projection['package'] !== '@narumitw/pi-plan-mode' ||
    projection['version'] !== '0.55.3' ||
    projection['responseEncoding'] !== 'pi-tui-kit-select-v1' ||
    projection['multiple'] !== false ||
    typeof projection['toolCallId'] !== 'string' ||
    !Number.isInteger(projection['questionIndex']) ||
    typeof projection['header'] !== 'string' ||
    typeof projection['title'] !== 'string' ||
    !Array.isArray(options) ||
    options.length < 2 ||
    options.length > 4
  ) {
    return undefined;
  }
  const parsedOptions = parseQuestionnaireOptions(options);
  if (parsedOptions === undefined) {
    return undefined;
  }
  return {
    adapter: 'pi-plan-mode',
    package: '@narumitw/pi-plan-mode',
    version: '0.55.3',
    toolCallId: projection['toolCallId'],
    questionIndex: projection['questionIndex'] as number,
    multiple: false,
    header: projection['header'],
    title: projection['title'],
    options: parsedOptions,
    responseEncoding: 'pi-tui-kit-select-v1',
  };
}

/**
 * Accepts only the complete versioned Host projection for the pinned rpiv multi-select contract.
 */
export function getRpivMultipleQuestionnaire(
  payload: ExtensionRequestPayload
): RpivMultipleQuestionnaire | undefined {
  if (payload.method !== 'input' || !isRecord(payload.hostQuestionnaire)) {
    return undefined;
  }
  const projection = payload.hostQuestionnaire;
  const options = projection['options'];
  if (
    projection['adapter'] !== 'rpiv-ask-user-question' ||
    projection['package'] !== '@juicesharp/rpiv-ask-user-question' ||
    projection['version'] !== '2.7.1' ||
    projection['responseEncoding'] !== 'rpiv-rpc-v1' ||
    projection['multiple'] !== true ||
    typeof projection['toolCallId'] !== 'string' ||
    !Number.isInteger(projection['questionIndex']) ||
    typeof projection['header'] !== 'string' ||
    typeof projection['title'] !== 'string' ||
    !Array.isArray(options) ||
    options.length < 2 ||
    options.length > 4
  ) {
    return undefined;
  }
  const parsedOptions = options.flatMap((value, index) => {
    if (!isRecord(value)) {
      return [];
    }
    return value['id'] === String(index) &&
      typeof value['label'] === 'string' &&
      typeof value['description'] === 'string'
      ? [{ id: value['id'], label: value['label'], description: value['description'] }]
      : [];
  });
  if (parsedOptions.length !== options.length) {
    return undefined;
  }
  return {
    adapter: 'rpiv-ask-user-question',
    package: '@juicesharp/rpiv-ask-user-question',
    version: '2.7.1',
    toolCallId: projection['toolCallId'],
    questionIndex: projection['questionIndex'] as number,
    multiple: true,
    header: projection['header'],
    title: projection['title'],
    options: parsedOptions,
    responseEncoding: 'rpiv-rpc-v1',
  };
}

/**
 * Produces Questionnaire choices while retaining the exact original option by numeric value.
 */
export function getDisplayOptions(payload: ExtensionRequestPayload): DisplayOption[] {
  const planQuestionnaire = getPlanModeQuestionnaire(payload);
  if (planQuestionnaire !== undefined) {
    return [
      ...planQuestionnaire.options.map((option) => ({
        label: option.label,
        description: option.description,
        value: option.id,
      })),
      {
        label: 'Other',
        description: 'Write a custom answer.',
        value: String(planQuestionnaire.options.length),
      },
    ];
  }
  const questionnaire = getRpivMultipleQuestionnaire(payload);
  if (questionnaire !== undefined) {
    return questionnaire.options.map((option) => ({
      label: option.label,
      description: option.description,
      value: option.id,
    }));
  }
  if (payload.method === 'confirm') {
    return [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ];
  }
  return (payload.options ?? []).map((option, index) => {
    const match = option.match(/^\s*\d+\.\s*(.*?)\s+—\s+(.+)$/s);
    const label = match?.[1] ?? option;
    return {
      label,
      ...(match?.[2] === undefined ? {} : { description: match[2] }),
      value: String(index),
    };
  });
}

/**
 * Resolves any selected Pi option index to its exact wire value for immediate submission.
 */
export function getImmediateSelectValue(
  payload: ExtensionRequestPayload,
  optionValue: string
): string | undefined {
  if (payload.method !== 'select') {
    return undefined;
  }
  const index = Number(optionValue);
  if (!Number.isInteger(index) || index < 0) {
    return undefined;
  }
  return payload.options?.[index];
}

/**
 * Extracts only the permission subject while preserving user-facing instructions on later input requests.
 */
export function getDisplayCopy(payload: ExtensionRequestPayload): { description: string; title: string } {
  const planQuestionnaire = getPlanModeQuestionnaire(payload);
  if (planQuestionnaire !== undefined) {
    return {
      title:
        planQuestionnaire.header.trim() === ''
          ? planQuestionnaire.title
          : `[${planQuestionnaire.header}] ${planQuestionnaire.title}`,
      description: 'Choose one option. Select Other to write a custom answer.',
    };
  }
  const questionnaire = getRpivMultipleQuestionnaire(payload);
  if (questionnaire !== undefined) {
    return {
      title:
        questionnaire.header.trim() === ''
          ? questionnaire.title
          : `[${questionnaire.header}] ${questionnaire.title}`,
      description: 'Select all that apply, or provide a custom answer.',
    };
  }
  const fallback = 'This extension needs your input before it can continue.';
  const rawTitle = payload.title?.trim() || 'Extension request';
  if (isReadyPlanActionMenu(payload, rawTitle)) {
    return { title: READY_PLAN_TITLE, description: READY_PLAN_DESCRIPTION };
  }
  const permissionHeading = rawTitle.match(/^(Permission Required(?: \(Subagent\))?)/i)?.[1];
  if (permissionHeading !== undefined) {
    const tool = rawTitle.match(/(?:^|\n)\s*tool\s*:\s*([^\s\n]+)/i)?.[1];
    const instruction = tool === undefined ? rawTitle.split('\n').slice(1).join('\n').trim() : '';
    return {
      title: tool === undefined ? permissionHeading : `${permissionHeading} tool: ${tool}`,
      description: payload.message?.trim() || instruction || fallback,
    };
  }
  const [title, ...detailLines] = rawTitle.split(/\r?\n/);
  const details = detailLines.join('\n').trim();
  return {
    title: title || 'Extension request',
    description: [payload.message?.trim(), details].filter(Boolean).join('\n\n') || fallback,
  };
}

/**
 * Recognizes the pinned pi-plan-mode completion menu without relying on its verbose setting-dependent detail lines.
 *
 * @param payload Candidate Extension UI request.
 * @param rawTitle Normalized wire title and supporting lines.
 * @returns Whether the request is the ready-plan action menu owned by pi-plan-mode 0.55.3.
 */
function isReadyPlanActionMenu(payload: ExtensionRequestPayload, rawTitle: string): boolean {
  const options = payload.options;
  return (
    payload.method === 'select' &&
    rawTitle.split(/\r?\n/, 1)[0] === READY_PLAN_TITLE &&
    options?.length === 6 &&
    options[0] === 'Implement here' &&
    options[1] === 'Start fresh and implement' &&
    options[3] === 'Save for later' &&
    options[4] === 'Stay in Plan mode' &&
    options[5] === 'Discard plan and exit'
  );
}

/**
 * Encodes checkbox identities back into rpiv 2.7.1's one-based RPC input protocol.
 */
export function encodeRpivMultipleResponse(
  questionnaire: RpivMultipleQuestionnaire,
  selectedOptionIds: Iterable<string>,
  customAnswer: string
): string | undefined {
  const custom = customAnswer.trim();
  if (custom !== '') {
    return custom;
  }
  const selected = new Set(selectedOptionIds);
  if ([...selected].some((id) => !questionnaire.options.some((option) => option.id === id))) {
    return undefined;
  }
  return questionnaire.options
    .filter((option) => selected.has(option.id))
    .map((option) => String(Number(option.id) + 1))
    .join(',');
}

/**
 * Narrows an unknown value to a JSON object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Validates stable numeric option identities shared by Host questionnaire projections.
 */
function parseQuestionnaireOptions(
  options: unknown[]
): Array<{ id: string; label: string; description: string }> | undefined {
  const parsed = options.flatMap((value, index) => {
    if (!isRecord(value)) {
      return [];
    }
    return value['id'] === String(index) &&
      typeof value['label'] === 'string' &&
      typeof value['description'] === 'string'
      ? [{ id: value['id'], label: value['label'], description: value['description'] }]
      : [];
  });
  return parsed.length === options.length ? parsed : undefined;
}
