/**
 * @author Codex
 * @description Defines request data contracts accepted by Attachment HTTP endpoints.
 */

export interface CreateAttachmentBody {
  name: string;
  mimeType: string;
  data: string;
}
