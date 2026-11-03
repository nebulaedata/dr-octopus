/**
 * @author Codex
 * @description Projects bounded, terminal recording evidence for the organization agent without exposing runtime identities or input values.
 */
import type { RecordedEvent, RecordingSession } from './recording-contract';
import { safeRecordingText, safeRecordingUrl } from './recording-privacy';
import { normalizeRecordingActions } from './recording-actions';
import { browserChoiceControlSchema } from '@octopus/shared/protocol/browser-skills';
import { requiresNewControlCapture } from './recording-choices';

const recordingEvidenceLimits = { events: 1000, inputBytes: 256 * 1024, steps: 200, inputs: 50 };

/**
 * Requires the complete committed event range; oversize or incomplete input fails instead of silently truncating.
 */
export function prepareRecordingEvidence(session: RecordingSession, events: RecordedEvent[]) {
  if (!['stopped', 'interrupted'].includes(session.status)) {
    throw new Error('WORKFLOW_RECORDING_ACTIVE');
  }
  if (!events.length) {
    throw new Error('WORKFLOW_EMPTY');
  }
  if (events.some(requiresNewControlCapture)) {
    throw Error('SKILL_RECORDING_SEMANTICS_REQUIRED');
  }
  if (events.length > recordingEvidenceLimits.events) {
    throw new Error('WORKFLOW_LIMIT');
  }
  if (
    events.length !== session.count ||
    new Set(events.map((event) => event.id)).size !== events.length ||
    events.some(
      (event, index) =>
        event.sessionId !== session.id ||
        event.seq !== index + 1 ||
        !session.pages.some((page) => page.tabRef === event.tabRef)
    )
  ) {
    throw new Error('WORKFLOW_EVIDENCE_INCOMPLETE');
  }
  const documents = new Map<string, string>();
  const ranks = new Map(
    [...events]
      .sort(
        (a, b) =>
          a.at - b.at || Number(a.source === 'browser') - Number(b.source === 'browser') || a.seq - b.seq
      )
      .map((event, index) => [event.id, index])
  );
  const projected = events.map((event) => {
    const key = `${event.tabRef}:${event.documentId}`;
    if (!documents.has(key)) {
      documents.set(key, `document-${documents.size + 1}`);
    }
    return {
      id: event.id,
      seq: event.seq,
      tabRef: event.tabRef,
      action: event.action,
      source: event.source,
      order: ranks.get(event.id)!,
      documentRef: documents.get(key)!,
      ...(event.targetRef ? { targetRef: event.targetRef } : {}),
      ...(event.editRef ? { editRef: event.editRef } : {}),
      ...(event.causationId ? { causationId: event.causationId } : {}),
      label: safeRecordingText(event.label),
      url: safeRecordingUrl(event.url),
      ...(event.targetUrl ? { targetUrl: safeRecordingUrl(event.targetUrl) } : {}),
      ...(event.role ? { role: safeRecordingText(event.role) } : {}),
      ...(event.key ? { key: event.key } : {}),
      ...(event.inputType ? { inputType: event.inputType } : {}),
      ...(event.control
        ? {
            control: browserChoiceControlSchema.parse({
              ...event.control,
              group: safeRecordingText(event.control.group),
              label: safeRecordingText(event.control.label),
              state: Array.isArray(event.control.state)
                ? event.control.state.map(safeRecordingText)
                : event.control.state,
            }),
          }
        : {}),
      redacted: event.redacted === true || ['input', 'select'].includes(event.action),
    };
  });
  const evidence = {
    recordingId: session.id,
    name: safeRecordingText(session.name),
    gaps: session.gaps.map(safeRecordingText),
    siteScopes: [...new Set(session.origins.map((origin) => new URL(origin).origin))],
    tabs: session.pages.map((page) => {
      // Committed sequence can put navigation before its delayed DOM batch. Derive the first observed URL
      // from capture time locally, without sending absolute user activity timestamps to the provider.
      const first = events
        .filter((event) => event.tabRef === page.tabRef && safeRecordingUrl(event.url))
        .sort(
          (left, right) =>
            left.at - right.at ||
            Number(left.source === 'browser') - Number(right.source === 'browser') ||
            left.seq - right.seq
        )[0];
      return {
        ref: page.tabRef,
        origin: new URL(page.origin).origin,
        startUrl: first ? safeRecordingUrl(first.url) : '',
      };
    }),
    events: projected,
    normalizationVersion: 3 as const,
    actions: normalizeRecordingActions(projected),
  };
  if (
    evidence.actions.length > recordingEvidenceLimits.steps ||
    evidence.actions.filter((action) => action.parameterId).length > recordingEvidenceLimits.inputs ||
    new TextEncoder().encode(JSON.stringify(evidence)).length > recordingEvidenceLimits.inputBytes
  ) {
    throw new Error('WORKFLOW_LIMIT');
  }
  return evidence;
}
export type RecordingEvidence = ReturnType<typeof prepareRecordingEvidence>;

/**
 * Projects a validated recording page for the model without exposing internal editing/document identities.
 * Offset and limit are validated by the owning read_recording tool boundary.
 */
export function recordingToolPage(evidence: RecordingEvidence, offset: number, limit: number) {
  return {
    name: evidence.name,
    allowedOrigins: evidence.siteScopes,
    pages: evidence.tabs,
    gaps: evidence.gaps,
    total: evidence.actions.length,
    actions: evidence.actions
      .slice(offset, offset + limit)
      .map((action, index) => ({ ...action, ref: 'action-' + (offset + index + 1) })),
  };
}
