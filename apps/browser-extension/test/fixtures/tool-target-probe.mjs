/**
 * @author Codex
 * @description Experimental admission for controlled snapshot fixtures only; textual snapshots are not a trusted production capability map.
 */

/**
 * Rejects positively identified tool/element mismatches before the existing Worker dispatch ledger.
 * Unknown, stale, paginated or ambiguous targets remain the responsibility of existing production guards.
 */
export function preflightFixtureCalls(session, calls) {
  if (session.observationRequired) {
    return calls;
  }
  const observation = session.ledger[session.lastObservationCallId];
  if (observation?.result?.output?.type !== 'json') {
    return calls;
  }
  const snapshot = observation.result.output.value;
  return calls.map((call) => {
    if (!['browser_select', 'browser_fill'].includes(call.toolName) || call.invalid) {
      return call;
    }
    const target = call.input?.target;
    if (
      !target ||
      snapshot.snapshotId !== target.snapshotId ||
      snapshot.documentId !== target.documentId ||
      snapshot.controllerId !== target.controllerId ||
      observation.input.tabId !== call.input.tabId
    ) {
      return call;
    }
    const rows = snapshot.text
      .split('\n')
      .filter((line) => new RegExp('^\\s*\\*?\\[' + target.elementIndex + '\\]<').test(line));
    if (rows.length !== 1) {
      return call;
    }
    const match = /\[\d+\]<([a-z]+)\b([^>]*)>/.exec(rows[0]);
    if (!match) {
      return call;
    }
    const [, tag, attributes] = match;
    let compatible;
    if (call.toolName === 'browser_select') {
      compatible = tag === 'select';
    } else {
      compatible =
        tag === 'textarea' ||
        (tag === 'input' && !/\btype=(radio|checkbox|button|submit|file|hidden)\b/.test(attributes)) ||
        /\bcontenteditable=true\b/.test(attributes);
    }
    if (compatible) {
      return call;
    }
    return {
      ...call,
      invalid: true,
      inputIssues: [{ code: 'SKILL_TARGET_TYPE', path: ['target', 'elementIndex'] }],
    };
  });
}
