/**
 * @author Codex
 * @description Host-issued, session-bound attachment capabilities without exposing local paths to models.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { link, open, readFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { KnowledgeError } from '../definitions/error.js';
import { knowledgeProfile } from '../lib/profile.js';

export interface KnowledgeImportTicketInput {
  workspaceId: string;
  agentSessionId: string;
  attachmentId: string;
  path: string;
  sha256: string;
  byteSize: number;
  title: string;
}

/**
 * Issue only from a Host-authorized original; this capability does not start the daemon or ingest the document.
 */
export async function issueKnowledgeImportTicket(
  agentDir: string,
  input: KnowledgeImportTicketInput
): Promise<string> {
  if (
    !/^[a-f0-9]{64}$/u.test(input.sha256) ||
    input.byteSize < 1 ||
    input.byteSize > 100 * 1024 * 1024 ||
    input.title.length > 240
  ) {
    throw new KnowledgeError('INVALID_INPUT', '知识库附件元信息无效');
  }
  const secret = await ticketKey(agentDir, true);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secret, nonce);
  const payload = { ...input, path: await realpath(input.path), expiresAt: Date.now() + 3600_000 };
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return 'kbi1.' + Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url');
}

/**
 * Validate the capability, current Pi Session and source hash before copying any original bytes.
 */
export async function inspectKnowledgeImportTicket(
  agentDir: string,
  ticket: string,
  workspaceId?: string,
  agentSessionId?: string
): Promise<KnowledgeImportTicketInput & { expiresAt: number }> {
  let payload: KnowledgeImportTicketInput & { expiresAt: number };
  try {
    if (!ticket.startsWith('kbi1.') || ticket.length > 8192) {
      throw new Error('Invalid ticket');
    }
    const bytes = Buffer.from(ticket.slice(5), 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', await ticketKey(agentDir, false), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    payload = JSON.parse(
      Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString()
    ) as typeof payload;
  } catch {
    throw new KnowledgeError('ATTACHMENT_REF_INVALID', '附件导入引用无效，请重新附加文件');
  }
  if (payload.workspaceId !== workspaceId || payload.agentSessionId !== agentSessionId || !agentSessionId) {
    throw new KnowledgeError('FORBIDDEN', '附件不属于当前工作区会话');
  }
  return payload;
}

/**
 * Read an unexpired original only for first admission; accepted replays need only authenticated ticket identity.
 */
export async function readKnowledgeImportTicket(
  agentDir: string,
  ticket: string,
  workspaceId?: string,
  agentSessionId?: string
): Promise<{ bytes: Buffer; title: string }> {
  const payload = await inspectKnowledgeImportTicket(agentDir, ticket, workspaceId, agentSessionId);
  if (payload.expiresAt <= Date.now()) {
    throw new KnowledgeError('ATTACHMENT_REF_EXPIRED', '附件导入引用已过期，请重新附加文件');
  }
  const path = await realpath(payload.path);
  if (path !== payload.path) {
    throw new KnowledgeError('SOURCE_CORRUPT', '附件原文路径已变更');
  }
  const file = await open(path, 'r');
  try {
    const details = await file.stat();
    if (!details.isFile() || details.size !== payload.byteSize || details.size > 100 * 1024 * 1024) {
      throw new KnowledgeError('SOURCE_CORRUPT', '附件原文大小已变更');
    }
    const bytes = await file.readFile();
    if (createHash('sha256').update(bytes).digest('hex') !== payload.sha256) {
      throw new KnowledgeError('SOURCE_CORRUPT', '附件原文校验失败');
    }
    return { bytes, title: payload.title };
  } finally {
    await file.close();
  }
}

/**
 * Atomically publish a private shared signing key; concurrent Hosts cannot observe a partially written secret.
 */
async function ticketKey(agentDir: string, create: boolean): Promise<Buffer> {
  const profile = await knowledgeProfile(agentDir, create);
  if (!profile) {
    throw new KnowledgeError('ATTACHMENT_REF_INVALID', '附件导入凭据无效');
  }
  const path = join(profile.directory, 'attachment-ticket-key');
  if (create) {
    const temporary = path + '.' + randomUUID();
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(randomBytes(32));
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await link(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    } finally {
      await rm(temporary, { force: true });
    }
  }
  const secret = await readFile(path);
  if (secret.length !== 32) {
    throw new KnowledgeError('ATTACHMENT_REF_INVALID', '附件导入凭据无效');
  }
  return secret;
}
