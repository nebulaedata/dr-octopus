/**
 * @author Codex
 * @description Exposes the home-drafts state domain through one explicit public entrypoint.
 */

export { createHomeDraftStore, useHomeDrafts, emptyHomeDraft } from './store';
export type { HomeDraft } from './store';
