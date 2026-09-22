/**
 * @author Codex
 * @description Loads the production knowledge extension in an isolated Pi test process without starting a daemon.
 */
import { createKnowledgeExtension } from '../../../../packages/agent/dist/extensions/knowledge/index.js';

export default createKnowledgeExtension({
  agentDir: process.env.PI_CODING_AGENT_DIR,
  workspaceId: 'w',
  cwd: process.cwd(),
});
