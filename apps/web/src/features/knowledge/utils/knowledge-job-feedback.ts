/**
 * @author Codex
 * @description Projects all durable knowledge job states into Toast notifications per execution attempt.
 */
import type { getKnowledgeJob } from '@/api/knowledge';
import type { Translate } from '@/i18n/use-i18n';

export type KnowledgeJobResult = Awaited<ReturnType<typeof getKnowledgeJob>>;

/**
 * Keeps progress, completion, cancellation, and failure feedback on the same notification surface.
 */
export function getKnowledgeJobNotification(t: Translate, result: KnowledgeJobResult) {
  const { job } = result;
  const failure = getKnowledgeJobFailure(t, result);
  if (failure) {
    return {
      ...failure,
      type: 'error',
      action: failure.retryable ? ('retry' as const) : ('cancel' as const),
      timeout: undefined,
    };
  }
  const operation =
    job.kind === 'reindex'
      ? t('knowledge.jobFeedback.operationReindex', 'Index rebuild')
      : t('knowledge.jobFeedback.operationImport', 'Document import');
  const pending = job.state === 'queued' || job.state === 'running';
  let status: string;
  if (job.state === 'queued') {
    status = t('knowledge.jobFeedback.statusQueued', 'Queued');
  } else if (job.state === 'running') {
    status = t('knowledge.jobFeedback.statusRunning', 'Processing');
  } else if (job.state === 'succeeded') {
    status = t('knowledge.jobFeedback.statusSucceeded', 'Completed');
  } else {
    status = t('knowledge.jobFeedback.statusCancelled', 'Cancelled');
  }
  /**
   * Selects action in the existing condition order.
   */
  function selectAction() {
    if (pending) {
      return 'cancel' as const;
    } else if (job.state === 'cancelled') {
      return 'retry' as const;
    } else {
      return undefined;
    }
  }
  /**
   * Selects type in the existing condition order.
   */
  function selectType() {
    if (pending) {
      return 'loading' as const;
    } else if (job.state === 'succeeded') {
      return 'success' as const;
    } else {
      return 'info' as const;
    }
  }
  return {
    key: `${job.id}:${job.attempt}:${job.state}`,
    title: t('knowledge.jobFeedback.progressTitle', '{{operation}}: {{status}}', { operation, status }),
    description: undefined,
    type: selectType(),
    action: selectAction(),
    timeout: pending ? 0 : undefined,
  };
}

/**
 * Includes leaf failures and dependency blocks even when the snapshot request itself succeeded.
 */
export function getKnowledgeJobFailure(t: Translate, { job, leaves }: KnowledgeJobResult) {
  if (!['failed', 'partial', 'waiting_dependency'].includes(job.state)) {
    return undefined;
  }
  const reasons = [job.error, job.blockedReason, ...leaves.map((leaf) => leaf.reason)].filter(
    (reason): reason is string => !!reason
  );
  const description = [...new Set(reasons)]
    .filter((reason) => reason !== 'DOCUMENT_FAILED' || !leaves.some((leaf) => leaf.reason))
    .map((reason) => {
      if (reason === 'DOCUMENT_DUPLICATE_CONFLICT') {
        return t(
          'knowledge.jobFeedback.reason.documentDuplicateConflict',
          'This document already exists or is being imported; do not upload it again.'
        );
      }
      if (reason === 'OFFICE_CONTENT_REJECTED') {
        return t(
          'knowledge.jobFeedback.reason.officeContentRejected',
          'The Office document contains unsupported active content, embedded objects, or external references, or its structure is invalid; remove them and upload again.'
        );
      }
      if (reason === 'OCR_INCOMPLETE') {
        return t(
          'knowledge.jobFeedback.reason.ocrIncomplete',
          'OCR output did not finish completely; the output limit may have been reached or content was generated repeatedly. Check the model output and retry.'
        );
      }
      if (reason === 'OCR_NOT_CONFIGURED') {
        return t(
          'knowledge.jobFeedback.reason.ocrNotConfigured',
          'Configure an OCR model in Settings - Knowledge.'
        );
      }
      if (reason === 'MODEL_NOT_CONFIGURED') {
        return t(
          'knowledge.jobFeedback.reason.modelNotConfigured',
          'Configure an Embedding model in Settings - Knowledge.'
        );
      }
      return reason;
    })
    .join(t('knowledge.common.listSeparator', '; '));
  const operation =
    job.kind === 'reindex'
      ? t('knowledge.jobFeedback.failureOperationReindex', 'Reindexing')
      : t('knowledge.jobFeedback.operationImport', 'Document import');
  /**
   * Selects title in the existing condition order.
   */
  function selectTitle() {
    if (job.state === 'waiting_dependency') {
      return t(
        'knowledge.jobFeedback.failureTitleModelNeeded',
        '{{operation}} requires model configuration',
        {
          operation,
        }
      );
    } else if (job.state === 'partial') {
      return t('knowledge.jobFeedback.failureTitlePartial', '{{operation}} partially failed', { operation });
    } else {
      return t('knowledge.jobFeedback.failureTitle', '{{operation}} failed', { operation });
    }
  }
  return {
    key: `${job.id}:${job.attempt}:${job.state}`,
    title: selectTitle(),
    description:
      description ||
      t(
        'knowledge.jobFeedback.failureFallback',
        'The task could not complete. Check the model service and retry.'
      ),
    retryable: job.state !== 'waiting_dependency',
  };
}
