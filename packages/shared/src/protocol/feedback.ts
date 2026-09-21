/**
 * @author Codex
 * @description Defines user feedback records projected alongside conversation messages.
 */

export interface MessageFeedbackDto {
  entryId: string;
  rating: 'up' | 'down';
  createdAt?: string;
}
