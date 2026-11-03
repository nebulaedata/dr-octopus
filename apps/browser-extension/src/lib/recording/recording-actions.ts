/**
 * @author Codex
 * @description Derives versioned actions and causal order without rewriting raw facts or inferring missing control identities.
 */
import type { RecordedEvent } from '../recording/recording-contract';

type Fact = Pick<
  RecordedEvent,
  | 'id'
  | 'seq'
  | 'tabRef'
  | 'action'
  | 'source'
  | 'label'
  | 'url'
  | 'role'
  | 'key'
  | 'targetUrl'
  | 'causationId'
  | 'targetRef'
  | 'editRef'
  | 'control'
  | 'inputType'
> & { documentRef?: string; order?: number };
type RecordedAction = {
  id: string;
  action:
    | 'click'
    | 'fill'
    | 'select'
    | 'choice'
    | 'key'
    | 'scroll'
    | 'navigate'
    | 'tab_open'
    | 'tab_activate'
    | 'tab_close'
    | 'manual';
  control?: RecordedEvent['control'];
  inputType?: string;
  tabRef: string;
  sourceEventIds: string[];
  label: string;
  role?: string;
  key?: RecordedEvent['key'];
  url: string;
  targetUrl?: string;
  parameterId?: string;
  observation?: 'submit';
};
const kinds: Record<Fact['action'], RecordedAction['action']> = {
  click: 'click',
  input: 'fill',
  select: 'select',
  key: 'key',
  scroll: 'scroll',
  submit: 'manual',
  navigate: 'navigate',
  tab_open: 'tab_open',
  tab_activate: 'tab_activate',
  tab_close: 'tab_close',
  tab_move: 'manual',
  unsupported: 'manual',
};

/**
 * Merges adjacent edits only with explicit same-document target and edit identities; facts without those identities remain independent.
 * Topological constraints preserve per-tab DOM order, creation and explicit causation despite delayed batch commits.
 */
export function normalizeRecordingActions(events: Fact[]): RecordedAction[] {
  const groups: { facts: Fact[]; action: RecordedAction }[] = [];
  for (const event of events) {
    if (!['dom', 'browser'].includes(event.source)) {
      throw new Error('WORKFLOW_EVIDENCE_INCOMPLETE');
    }
    const previous = groups.at(-1);
    const last = previous?.facts.at(-1);
    if (
      last &&
      ['input', 'select'].includes(event.action) &&
      last.action === event.action &&
      event.source === 'dom' &&
      last.source === 'dom' &&
      event.tabRef === last.tabRef &&
      event.documentRef &&
      event.documentRef === last.documentRef &&
      event.targetRef &&
      event.targetRef === last.targetRef &&
      event.editRef &&
      event.editRef === last.editRef
    ) {
      previous!.facts.push(event);
      previous!.action.sourceEventIds.push(event.id);
      if (event.control) {
        previous!.action.control = event.control;
      }
    } else {
      groups.push({
        facts: [event],
        action: {
          id: '',
          action: event.control ? 'choice' : kinds[event.action],
          tabRef: event.tabRef,
          sourceEventIds: [event.id],
          label: event.label,
          url: event.url,
          ...(event.action === 'submit' ? { observation: 'submit' as const } : {}),
          ...(event.role ? { role: event.role } : {}),
          ...(event.key ? { key: event.key } : {}),
          ...(event.targetUrl ? { targetUrl: event.targetUrl } : {}),
          ...(event.control ? { control: event.control } : {}),
          ...(event.inputType ? { inputType: event.inputType } : {}),
        },
      });
    }
  }
  const owners = new Map(
    groups.flatMap((group, index) => group.facts.map((fact) => [fact.id, index] as const))
  );
  const dependencies = groups.map(() => new Set<number>());
  const lastDom = new Map<string, number>();
  const openings = new Map<string, number>();
  groups.forEach((group, index) => {
    if (group.action.action === 'tab_open') {
      if (openings.has(group.action.tabRef)) {
        throw new Error('WORKFLOW_EVIDENCE_INCOMPLETE');
      }
      openings.set(group.action.tabRef, index);
    }
  });
  groups.forEach((group, index) => {
    for (const event of group.facts) {
      if (event.source === 'dom') {
        const prior = lastDom.get(event.tabRef);
        if (prior !== undefined && prior !== index) {
          dependencies[index]!.add(prior);
        }
        lastDom.set(event.tabRef, index);
      }
      if (event.causationId) {
        const cause = owners.get(event.causationId);
        if (cause === undefined || cause === index) {
          throw new Error('WORKFLOW_EVIDENCE_INCOMPLETE');
        }
        dependencies[index]!.add(cause);
      }
    }
    const opening = openings.get(group.action.tabRef);
    if (opening !== undefined && opening !== index) {
      dependencies[index]!.add(opening);
    }
  });
  const result: RecordedAction[] = [];
  const done = new Set<number>();
  while (done.size < groups.length) {
    const ready = groups
      .map((group, index) => ({ group, index }))
      .filter(({ index }) => !done.has(index) && [...dependencies[index]!].every((id) => done.has(id)))
      .sort(
        (a, b) =>
          (a.group.facts[0]!.order ?? a.group.facts[0]!.seq) -
            (b.group.facts[0]!.order ?? b.group.facts[0]!.seq) || a.index - b.index
      )[0];
    if (!ready) {
      throw new Error('WORKFLOW_EVIDENCE_INCOMPLETE');
    }
    done.add(ready.index);
    const id = `action-${result.length + 1}`;
    result.push({
      ...ready.group.action,
      id,
      ...(['fill', 'select'].includes(ready.group.action.action) && !ready.group.action.control
        ? { parameterId: `input-${result.length + 1}` }
        : {}),
    });
  }
  return result;
}
