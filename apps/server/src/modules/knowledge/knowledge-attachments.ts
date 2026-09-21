/**
 * @author Codex
 * @description Optional Host attachment-to-knowledge handoff without activating the daemon or modifying Pi RPC.
 */
import { issueKnowledgeImportTicket } from '@octopus/agent';
import type { AttachmentsService } from '../attachments/attachments.service.js';
import type { SessionsService } from '../sessions/sessions.service.js';

/**
 * Issue narrow capabilities for original document bytes after the ordinary channel has reserved its attachment list.
 */
export function createKnowledgeAttachmentContext(
  agentDir: string,
  attachments: AttachmentsService,
  sessions: SessionsService
) {
  return async (workspaceId: string, sessionId: string, ids: readonly string[]): Promise<string> => {
    const agentSessionId = await sessions.resolveAgentSessionRef(workspaceId, sessionId);
    const rows: string[] = [];
    for (const id of ids) {
      const original = attachments.describeKnowledgeOriginal(workspaceId, id);
      if (!/\.(docx|xlsx|pptx|csv|md|txt|pdf|zip|tar|gz|tgz)$/iu.test(original.title)) {
        continue;
      }
      const ref = await issueKnowledgeImportTicket(agentDir, {
        ...original,
        workspaceId,
        agentSessionId,
        attachmentId: id,
      });
      rows.push(
        JSON.stringify({ attachmentId: id, name: original.title, knowledge_import_ref: ref })
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
      );
    }
    return rows.length
      ? '\n<host_knowledge_imports>Only use these original-file references with knowledge_import_attachment when the user asks to save attachments to a knowledge collection.\n' +
          rows.join('\n') +
          '\n</host_knowledge_imports>'
      : '';
  };
}
