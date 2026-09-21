# 附件系统实施契约 V1

> 本文是 [企业级附件—智能体架构](./attachment-agent-system.md) 的规范性实施补充。
> V1 开发必须遵守本文的线协议、数据约束、Worker 协议、默认参数和恢复目标；实现不得以局部便利改变这些语义。

## 1. 契约范围与权威边界

本文冻结六项实施契约：

1. Composer 附件状态同步；
2. REST/tus 请求、响应与稳定错误；
3. SQLite DDL 语义、并发和任务租约；
4. Processor 子进程 IPC 与派生物 Schema；
5. 音视频 Message DTO 与浏览器播放边界；
6. 默认配额、保留、磁盘水位、备份和 RPO/RTO。

权威来源固定如下：

| 数据                 | 权威来源                                   |
| -------------------- | ------------------------------------------ |
| 上传字节 offset      | tus `HEAD` 返回的 SQLite offset            |
| 浏览器上传进度       | `tus-js-client` 当前请求进度，仅作瞬时 UI  |
| 附件状态、分类和错误 | SQLite `attachments` 行及其递增 `revision` |
| 原件与派生物字节     | `LocalFileBlobStore`                       |
| Message 与附件关系   | SQLite `message_attachments`               |
| Agent 对话内容       | Pi Session entry                           |
| Message 附件展示     | Host `MessageAttachmentDto`                |
| Worker 任务状态      | SQLite `attachment_jobs`                   |
| 能力分类与安全决策   | 冻结的 evidence + policy/rule version      |

本文使用“必须”表示 V1 不可变约束，“默认”表示部署可在产品安全上限内收紧的初始值。

## 2. Composer 状态同步契约

### 2.1 同步模型

V1 不新增 Workspace 级 WebSocket 订阅。附件在绑定消息前不属于某个 Pi runtime，把处理状态塞入现有 Session
`sequence` 会错误耦合两个生命周期。同步采用以下组合：

1. `uploading` 的字节进度由 `tus-js-client` `onProgress(bytesUploaded, bytesTotal)` 驱动；页面刷新后通过 tus
   `HEAD` 恢复权威 offset。
2. tus finish 后立即通过批量 projection endpoint 查询当前 Tray，存在非终态附件时由一个 TanStack Query 轮询。
3. 轮询间隔为 1 秒、2 秒、5 秒，之后保持 5 秒；状态或 `revision` 前进时重置为 1 秒。
4. `ready/failed/rejected/deleted` 是终态，停止轮询。`failed` 只有错误码标记 `retryable: true` 且用户触发重试时
   才重新进入处理链路。
5. 页面重新聚焦、网络恢复、tus finish、重试和删除完成后立即 refetch，不等待下一个 interval。
6. Server 返回 `Cache-Control: no-store`；Web 不把浏览器缓存或本地 Zustand 当作状态权威。
7. Composer draft 只持久化 staged attachment ID 和 tus upload fingerprint，不保存文件字节。刷新后先恢复 ID 并 batch
   refetch；若上传未完成且浏览器已经丢失 `File` handle，卡片进入本地 `failed/UPLOAD_SOURCE_REQUIRED`，提示用户重新选择
   同一文件，再根据 Server `HEAD` offset 续传。不得假装可以跨刷新自动恢复浏览器未授权的本地文件句柄。

轮询只携带当前 Composer 中最多 10 个附件 ID，不允许无条件扫描全 Workspace。未来若确有规模需求，
可以在新 ADR 中增加 Workspace attachment event stream，但 REST projection 和 `revision` 仍是恢复权威。

### 2.2 Revision 与乱序处理

`attachments.revision` 是从 1 开始的单附件单调递增整数。任何可观察字段变化——状态、进度阶段、分类、失败、派生物
可用性、删除——都必须在同一 SQLite 事务中 `revision = revision + 1`。

Web 合并规则：

```text
incoming.revision < current.revision  -> 丢弃
incoming.revision = current.revision  -> 幂等覆盖或忽略
incoming.revision > current.revision  -> 替换权威字段，保留纯本地 UI 状态
```

纯本地 UI 状态仅包括当前 tus bytes、卡片焦点和 Dialog 开关。文件名、检测类型、状态、错误和 capability 不能被本地
状态覆盖。多标签页各自轮询同一 projection，最终按相同 revision 收敛。

### 2.3 Composer 状态映射

| Server/tus 状态                                     | Composer 状态 | 提交门禁 | 说明                                        |
| --------------------------------------------------- | ------------- | -------- | ------------------------------------------- |
| `initiated/uploading` 或 tus 未达到 `Upload-Length` | `uploading`   | 禁止     | 进度来自 tus，offset 来自 Server            |
| `verifying`、`processing`                           | `processing`  | 禁止     | 显示阶段，不展示 parser 原始异常            |
| `ready`                                             | `ready`       | 允许     | Prompt 时仍执行第二次授权和 capability 求值 |
| `failed`                                            | `failed`      | 禁止     | 按稳定错误决定是否可重试                    |
| `rejected`                                          | `rejected`    | 禁止     | 相同字节不可重试，只能移除或重新选文件      |
| DELETE 已发出、响应返回前                           | `deleted`     | 禁止     | 本地瞬时状态；成功后移出 Tray               |

发送按钮的条件必须是“文本满足原有规则，且所有 staged attachment 均为 `ready`”。发送请求得到 Pi command ACK 前保留
Tray；ACK 成功后清空，ACK 失败则保留以便重试。

## 3. REST 与 tus 线协议

### 3.1 通用约束

- 所有 REST 路由位于 `/api/workspaces/:workspaceId/attachments`，每次请求重新校验用户与 Workspace 权限。
- 线协议 Schema 位于 `packages/shared/src/protocol/attachments/`，使用工作区现有 Zod 4 作为唯一运行时定义并由 `z.infer`
  导出 TypeScript 类型；Server 通过 Zod JSON Schema 接入 Fastify，Web 和 Worker 不再手写平行 DTO。
- JSON 响应使用 UTF-8，时间使用 UTC ISO-8601，ID 使用服务端生成的 UUID。
- JSON 控制面请求体上限 64 KiB；原始附件字节只能走 tus/streaming endpoint。
- `Idempotency-Key` 使用 UUID，create、retry、delete 和 Prompt reservation 必须支持；相同 key + 不同 fingerprint 返回
  `409 IDEMPOTENCY_KEY_REUSED`。
- 附件 ID 与 tus upload ID 在 V1 使用同一个服务端 ID，一条 `attachments` 对应至多一条 `tus_uploads`。
- 所有错误都使用统一 envelope，不暴露绝对路径、SQL、parser 堆栈或 Blob key。
- retry/delete 必须发送当前资源 `ETag` 作为 `If-Match`；不匹配返回 `409 ATTACHMENT_STATE_CONFLICT`。同一
  `Idempotency-Key` 的已完成结果先于 `If-Match` 校验返回，保证网络重放得到原结果。WebSocket Prompt 使用 `requestId`
  作为 reservation 幂等键。

```ts
type AttachmentErrorCode =
  | 'ATTACHMENT_REQUEST_INVALID'
  | 'AUTHENTICATION_REQUIRED'
  | 'ATTACHMENT_NOT_FOUND'
  | 'UPLOAD_EXPIRED'
  | 'UPLOAD_OFFSET_CONFLICT'
  | 'UPLOAD_ALREADY_FINALIZED'
  | 'ATTACHMENT_STATE_CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'ATTACHMENT_SIZE_LIMIT_EXCEEDED'
  | 'ATTACHMENT_TYPE_UNSUPPORTED'
  | 'ATTACHMENT_FORMAT_EVIDENCE_MISMATCH'
  | 'ATTACHMENT_STRUCTURE_LIMIT_EXCEEDED'
  | 'ATTACHMENT_PROCESSING_FAILED'
  | 'ATTACHMENT_NOT_READY'
  | 'ATTACHMENT_QUOTA_EXCEEDED'
  | 'ATTACHMENT_STORAGE_PRESSURE';

interface AttachmentErrorResponse {
  error: {
    code: AttachmentErrorCode;
    message: string;
    retryable: boolean;
    requestId: string;
    details?: Record<string, string | number | boolean>;
  };
}
```

### 3.2 tus 创建与续传

`POST /api/workspaces/:workspaceId/attachments/uploads` 必须包含：

```text
Tus-Resumable: 1.0.0
Upload-Length: <integer>
Upload-Metadata: filename <base64>,declaredMediaType <base64>
Idempotency-Key: <uuid>
```

- `filename` 必需；UTF-8 解码后执行 Unicode NFC、控制字符清理，最大 255 code points。
- `declaredMediaType` 可选且最大 127 字符，只作证据，不作准入权威。
- 不接受未知 metadata key、`Upload-Defer-Length`、`Upload-Concat` 或超过 8 KiB 的 metadata header。
- `Upload-Length` 必须在创建时满足有效产品策略；创建成功即写入 `attachments`、`tus_uploads` 和 operation journal。

成功响应：

```text
HTTP/1.1 201 Created
Location: /api/workspaces/{workspaceId}/attachments/uploads/{attachmentId}
Tus-Resumable: 1.0.0
Upload-Expires: <HTTP-date>
Upload-Attachment-Id: <attachmentId>
Access-Control-Expose-Headers: Location,Tus-Resumable,Upload-Expires,Upload-Offset,Upload-Attachment-Id
```

`HEAD` 返回 `Upload-Length`、`Upload-Offset`、`Upload-Expires`。`PATCH` 只接受
`Content-Type: application/offset+octet-stream` 和精确 `Upload-Offset`；offset 不符返回 `409 UPLOAD_OFFSET_CONFLICT`
并携带权威 `Upload-Offset`。单个 PATCH body 默认最多 16 MiB。

offset 达到 length 时，由 finish event 触发一次幂等 finalize。Client 不调用业务 `complete`。finalize 重新流式读取
staging，验证 size/SHA-256、`fsync`、原子发布，再进入 `verifying`。finish event 可以重复，结果必须相同。

`DELETE .../uploads/:id` 仅终止未发布上传，成功返回 `204`；已 finalize 返回 `409 UPLOAD_ALREADY_FINALIZED`，调用方
如需删除资源必须使用附件 DELETE。

### 3.3 附件资源 DTO

```ts
interface AttachmentResourceDto {
  id: string;
  workspaceId: string;
  name: string;
  declaredMediaType?: string;
  detectedMediaType?: string;
  byteSize: number;
  sha256?: string;
  status:
    'initiated' | 'uploading' | 'verifying' | 'processing' | 'ready' | 'failed' | 'rejected' | 'deleted';
  revision: number;
  classification?: 'direct-image' | 'extractable-document' | 'manifest-only-binary' | 'rejected';
  presentationKind?: 'image' | 'audio' | 'video' | 'file';
  error?: { code: AttachmentErrorCode; message: string; retryable: boolean };
  capabilities: { canPreview: boolean; canPlay: boolean; canDownload: boolean };
  createdAt: string;
  updatedAt: string;
  readyAt?: string;
}
```

`GET /attachments/:id` 返回该 DTO 和 `ETag: "attachment-{id}-r{revision}"`，但同时使用 `Cache-Control: no-store`。
`GET /attachments?ids=<id1,id2,...>` 最多接受 10 个去重 ID，按请求顺序返回 `{ items: AttachmentResourceDto[] }`，
Composer 以此作为唯一 polling query；未登录返回 401，已经认证但任一 ID 不存在或无权访问时整批返回 404，
避免通过差集枚举资源。

### 3.4 内容、派生物与删除

```text
GET    /attachments/:id/content?disposition=inline|attachment
GET    /attachments/:id/derivatives/:derivativeId/content
POST   /attachments/:id/retry
DELETE /attachments/:id
```

- 原件 content 只对 `ready` 且 `canPreview/canPlay/canDownload` 对应操作为真时开放；派生物必须属于同一附件。
- Range 只支持单一 byte range。完整响应为 200，合法 Range 为 206，无效 Range 为 416，并返回 `Accept-Ranges: bytes`
  和正确 `Content-Range`。
- `Content-Type` 使用检测/派生类型，始终返回 `X-Content-Type-Options: nosniff`。inline 响应使用严格 sandbox CSP；
  文件名只进入 RFC 5987 `filename*`，不能拼接未转义 header。
- retry 仅允许 `failed` 且错误可重试；请求体为 `{ expectedRevision: number }`，使用新 job，但附件 ID 不变并递增
  revision，成功返回 `202` 和更新 DTO。`rejected` 不允许 retry。
- 附件 DELETE 在事务内立即把资源标记为 `deleted`、撤销 capability 并创建物理清理 job，返回 `202` 和更新后的 DTO。
  重复 DELETE 返回相同墓碑。已绑定消息关系不删除，只保留 projection tombstone。

### 3.5 稳定错误码

| HTTP | Code                                  | Retryable  | 使用场景                            |
| ---- | ------------------------------------- | ---------- | ----------------------------------- |
| 400  | `ATTACHMENT_REQUEST_INVALID`          | false      | header、metadata 或 JSON 不合法     |
| 401  | `AUTHENTICATION_REQUIRED`             | false      | 未建立有效登录态                    |
| 404  | `ATTACHMENT_NOT_FOUND`                | false      | 不存在或无权限                      |
| 410  | `UPLOAD_EXPIRED`                      | true       | tus session 已清理，需创建新 upload |
| 409  | `UPLOAD_OFFSET_CONFLICT`              | true       | tus offset 不一致                   |
| 409  | `UPLOAD_ALREADY_FINALIZED`            | false      | 终止已发布上传                      |
| 409  | `ATTACHMENT_STATE_CONFLICT`           | true       | revision/CAS 或状态前置条件不满足   |
| 409  | `IDEMPOTENCY_KEY_REUSED`              | false      | 同 key 不同 fingerprint             |
| 413  | `ATTACHMENT_SIZE_LIMIT_EXCEEDED`      | false      | 单文件、chunk 或消息总量超限        |
| 415  | `ATTACHMENT_TYPE_UNSUPPORTED`         | false      | 不在固定格式白名单                  |
| 422  | `ATTACHMENT_FORMAT_EVIDENCE_MISMATCH` | false      | 扩展名/MIME/magic/container 冲突    |
| 422  | `ATTACHMENT_STRUCTURE_LIMIT_EXCEEDED` | false      | 页、像素、条目、解压比等超限        |
| 422  | `ATTACHMENT_PROCESSING_FAILED`        | 由诊断决定 | parser/派生失败                     |
| 423  | `ATTACHMENT_NOT_READY`                | true       | Prompt、预览或播放早于 ready        |
| 429  | `ATTACHMENT_QUOTA_EXCEEDED`           | true       | 并发、队列或租户容量限制            |
| 507  | `ATTACHMENT_STORAGE_PRESSURE`         | true       | 磁盘达到拒绝水位                    |

Capability Lib 的稳定诊断码保留更细的内部决策原因；Controller 将其映射到上述有限外部错误，不把内部实现细节变成 API。

## 4. SQLite Schema 与并发契约

### 4.1 数据库运行参数

启动必须设置并验证：

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;
```

生产写操作只通过单个 Server 进程的 repository 层进入 SQLite。Worker 子进程不得打开数据库；它只通过 IPC 返回结果。
所有 migration 由 Drizzle 按版本顺序执行，FTS5 virtual table/trigger 使用同一 migration 中的原生 SQL。启动在 migration、
foreign key check 或 FTS5 probe 失败时 fail closed。

### 4.2 表与关键约束

V1 至少包含以下表；实现字段可增加，但不能弱化约束：

```text
attachments
  id PK
  workspace_id, owner_id, original_name
  declared_mime NULL, detected_mime NULL
  byte_size CHECK >= 0, sha256 NULL, blob_sha256 NULL FK blobs.sha256
  status CHECK IN initiated/uploading/verifying/processing/ready/failed/rejected/deleted
  classification NULL CHECK IN direct-image/extractable-document/manifest-only-binary/rejected
  presentation_kind NULL CHECK IN image/audio/video/file
  failure_code NULL, failure_retryable NOT NULL DEFAULT 0
  policy_version NULL, rule_version NULL
  revision NOT NULL CHECK >= 1
  created_at, updated_at, ready_at NULL, expires_at NULL, deleted_at NULL

blobs
  sha256 PK CHECK length = 64
  storage_key UNIQUE NOT NULL
  byte_size NOT NULL CHECK >= 0
  state CHECK IN publishing/published/deleting
  created_at

tus_uploads
  upload_id PK FK attachments.id ON DELETE CASCADE
  upload_length NOT NULL CHECK >= 0
  upload_offset NOT NULL CHECK between 0 and upload_length
  metadata_json NOT NULL, staging_key UNIQUE NOT NULL
  expires_at NOT NULL, updated_at NOT NULL

attachment_derivatives
  id PK, attachment_id FK attachments.id ON DELETE RESTRICT
  kind, processor_id, processor_version, source_sha256
  mime_type, byte_size CHECK >= 0, sha256, storage_key UNIQUE
  metadata_json, created_at
  UNIQUE(attachment_id, kind, processor_id, processor_version, source_sha256)

message_attachments
  session_id, entry_id, attachment_id FK attachments.id ON DELETE RESTRICT
  ordinal CHECK >= 0, request_id, presentation_json, created_at
  PK(session_id, entry_id, attachment_id)
  UNIQUE(session_id, entry_id, ordinal)

attachment_operations
  id PK, idempotency_key UNIQUE, fingerprint, attachment_id NULL
  operation, phase, staging_key NULL, target_storage_key NULL
  expected_size NULL, expected_sha256 NULL, result_json NULL
  created_at, updated_at, expires_at

attachment_jobs
  id PK, attachment_id FK attachments.id ON DELETE RESTRICT
  job_type, processor_id NULL, processor_version NULL, input_json
  status CHECK IN pending/running/succeeded/failed/cancelled
  attempts NOT NULL DEFAULT 0, max_attempts NOT NULL DEFAULT 3
  available_at, lease_owner NULL, lease_expires_at NULL
  last_error_code NULL, result_json NULL, created_at, updated_at

attachment_chunks
  id INTEGER PK, attachment_id FK attachments.id ON DELETE RESTRICT
  derivative_id FK attachment_derivatives.id ON DELETE CASCADE
  ordinal CHECK >= 0, source_locator_json, text, character_count, token_estimate
  UNIQUE(derivative_id, ordinal)

backup_runs
  id PK, status CHECK IN preparing/copying/verified/failed
  database_snapshot_key, manifest_key, created_at, completed_at NULL

backup_blob_pins
  backup_id FK backup_runs.id ON DELETE CASCADE
  blob_sha256 FK blobs.sha256 ON DELETE RESTRICT
  PK(backup_id, blob_sha256)
```

必要索引：

- `attachments(workspace_id, status, updated_at)`；
- `attachments(workspace_id, expires_at)`；
- `tus_uploads(expires_at)`；
- `attachment_jobs(status, available_at, lease_expires_at)`；
- `message_attachments(session_id, entry_id, ordinal)`；
- `message_attachments(attachment_id)`；
- `attachment_chunks(attachment_id, derivative_id, ordinal)`。

Blob 不保存可漂移的手工 `ref_count`。删除器在事务中查询 `attachments.blob_sha256`、derivatives 和
`backup_blob_pins`，只为零引用且未被备份固定的 Blob 创建删除 operation；启动对账再次验证后才删除字节。

### 4.3 状态迁移与 CAS

状态更新必须使用 `id + expected revision + allowed source status` 条件写并递增 revision：

```sql
UPDATE attachments
SET status = ?, revision = revision + 1, updated_at = ?
WHERE id = ? AND revision = ? AND status IN (...);
```

受影响行数为 0 时返回 `ATTACHMENT_STATE_CONFLICT` 并重新读取，不得无条件覆盖。合法主路径固定为：

```text
initiated -> uploading -> verifying -> processing
verifying -> rejected | failed
processing -> ready | rejected | failed
failed -> processing            # 仅显式 retry
任意非 deleted -> deleted       # 受授权与 legal hold 约束
```

`ready` 不能回退为 processing；processor 版本升级创建新 derivative job，不让已绑定消息附件暂时失效。新派生物验证完成后
以事务切换 presentation/manifest 引用。

### 4.4 Job lease 与重试

- Parent 进程默认同时运行 2 个 processor job；有效配置可按 7.1 调整，领取使用 `BEGIN IMMEDIATE` 和条件更新。
- lease 默认 30 秒，running job 每 10 秒 heartbeat；进程崩溃后 lease 到期可由同一实例重领。
- 默认 `max_attempts=3`，退避为 1 分钟、5 分钟；确定性格式/结构错误不重试。
- job 超时、子进程异常退出、输出校验失败分别记录稳定错误码；达到最大次数后 job `failed`，附件按处理策略进入
  `failed`，不能无限循环。
- 取消或删除附件时，pending job 置 `cancelled`；running child 收到终止请求，2 秒后仍未退出则 kill process tree。
- job result、attachment 状态和 derivative 发布必须通过 operation journal 协调，任何崩溃点都能重放或清理。

## 5. Processor 子进程与派生物契约

### 5.1 执行模型

V1 使用应用监督的**一次一任务 Node 子进程**，通过 `child_process.fork()` 启动已构建的 worker entry。Worker：

- 不打开 SQLite，不启动 HTTP，不读取环境密钥，不接受用户提供的命令或参数；
- 只获得一个只读输入文件和一个本任务专用输出目录；
- IPC 不传原始文件字节或大派生内容，只传 ID、相对文件名、限制和结果 manifest；
- 父进程对 wall time、RSS、输出目录总字节和文件数实施 watchdog；超限即终止；
- 父进程重新验证输出相对路径、Schema、大小、MIME、SHA-256 后才发布到 BlobStore。

Node 子进程是故障隔离和资源治理边界，不宣称等同强安全沙箱。默认处理器不包含网络客户端，也不获得代理、凭据或
Workspace 路径；部署可用 OS 防火墙/容器进一步限制网络和文件系统，但它们不是独立部署必需项。解析器必须持续升级，
所有输入仍视为不可信。

### 5.2 IPC V1

Parent 只发送一次：

```ts
interface ProcessorStartV1 {
  protocol: 1;
  type: 'start';
  jobId: string;
  attachmentId: string;
  processor: { id: string; version: string };
  input: { relativePath: string; sha256: string; detectedMediaType: string };
  outputDirectory: string;
  limits: ProcessorLimitsV1;
}
```

Worker 只返回以下消息，单条 IPC JSON 上限 256 KiB：

```ts
type ProcessorMessageV1 =
  | { protocol: 1; type: 'heartbeat'; jobId: string; rssBytes: number }
  | { protocol: 1; type: 'progress'; jobId: string; completed: number; total?: number; phase: string }
  | { protocol: 1; type: 'result'; jobId: string; manifest: ArtifactManifestV1 }
  | { protocol: 1; type: 'error'; jobId: string; code: string; retryable: boolean; message: string };
```

未知 protocol/message、重复终态、绝对输出路径、路径穿越、符号链接、超出 output directory 的文件均视为
`PROCESSOR_PROTOCOL_VIOLATION`，终止并丢弃本次输出。

Worker 每秒发送 heartbeat；连续 5 秒缺失即视为失联。Parent 使用 `--max-old-space-size=384` 限制 V8 heap，并在 heartbeat
报告 RSS 超过 512 MiB 时终止子进程。RSS 监测和 Node heap 限制是独立部署基线；需要更强硬的 OS 内存/网络边界时可
增加 Job Object、cgroup 或容器 Adapter，但不能改变 IPC 和 artifact 契约。

### 5.3 Artifact Manifest

```ts
interface ArtifactManifestV1 {
  schemaVersion: 1;
  attachmentId: string;
  sourceSha256: string;
  processor: { id: string; version: string };
  outputs: Array<{
    localId: string;
    kind: 'model-image' | 'preview-image' | 'document-json' | 'chunks-jsonl';
    relativePath: string;
    mimeType: string;
    byteSize: number;
    sha256: string;
    metadata: Record<string, string | number | boolean>;
  }>;
  summary: {
    pageCount?: number;
    sheetCount?: number;
    slideCount?: number;
    sectionCount?: number;
    extractedCharacters?: number;
  };
}
```

`relativePath` 只能是输出目录内的普通文件。Worker 提供的 size/hash 只是待验证声明；父进程必须重新流式计算。

结构化文档统一输出 UTF-8 `document-json`：

```ts
interface StructuredDocumentV1 {
  schemaVersion: 1;
  kind: 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'text' | 'source';
  title?: string;
  units: Array<{
    locator: {
      page?: number;
      sheet?: string;
      slide?: number;
      section?: string;
      lineFrom?: number;
      lineTo?: number;
    };
    type: 'heading' | 'paragraph' | 'table' | 'code' | 'note';
    text: string;
  }>;
  truncated: boolean;
  diagnostics: string[];
}
```

用于 FTS5 的 `chunks-jsonl` 每行一个 `NormalizedChunkV1`，不得把整份文档作为一行：

```ts
interface NormalizedChunkV1 {
  schemaVersion: 1;
  ordinal: number;
  locator: StructuredDocumentV1['units'][number]['locator'];
  text: string;
  characterCount: number;
  tokenEstimate: number;
}
```

文本和 JSON 中的附件内容始终是 untrusted data，不允许包含可被 Host 解释为工具调用、路径授权或系统指令的控制字段。

### 5.4 默认 Processor 限制

| 限制                      | 默认值                                       |
| ------------------------- | -------------------------------------------- |
| 单 job wall time          | 60 秒；PDF/Office 可提高到 120 秒            |
| 单 job RSS                | 512 MiB                                      |
| 输出总字节                | min(原件 2 倍, 256 MiB)                      |
| 输出文件数                | 1,000                                        |
| 图片总像素                | 40 megapixels；单边最大 16,384               |
| 模型图片                  | 单张 4 MiB；每消息 4 张；总解码字节 8 MiB    |
| PDF                       | 500 页；仅提取文字与覆盖信息，不自动渲染页图 |
| OOXML ZIP entries         | 10,000                                       |
| OOXML 解压后总字节/解压比 | 512 MiB / 100:1                              |
| DOCX/PDF/文本抽取字符     | 每附件 2,000,000                             |
| XLSX                      | 100 sheets、200,000 rows、2,000,000 cells    |
| PPTX                      | 500 slides                                   |
| 单 chunk 字符             | 4,000，重叠最多 400                          |

部署只能收紧这些安全上限。达到结构上限时默认 `rejected`；达到文本输出预算但结构仍合法时允许生成
`truncated: true` 的派生物和诊断，不能静默丢弃。

### 5.5 Worker 稳定错误

| Worker code                         | Retryable | 外部映射                              |
| ----------------------------------- | --------- | ------------------------------------- |
| `PROCESSOR_START_FAILED`            | true      | `ATTACHMENT_PROCESSING_FAILED`        |
| `PROCESSOR_CRASHED`                 | true      | `ATTACHMENT_PROCESSING_FAILED`        |
| `PROCESSOR_HEARTBEAT_LOST`          | true      | `ATTACHMENT_PROCESSING_FAILED`        |
| `PROCESSOR_TIMEOUT`                 | false     | `ATTACHMENT_PROCESSING_FAILED`        |
| `PROCESSOR_RESOURCE_LIMIT_EXCEEDED` | false     | `ATTACHMENT_STRUCTURE_LIMIT_EXCEEDED` |
| `PROCESSOR_PROTOCOL_VIOLATION`      | false     | `ATTACHMENT_PROCESSING_FAILED`        |
| `PROCESSOR_OUTPUT_INVALID`          | false     | `ATTACHMENT_PROCESSING_FAILED`        |
| `PROCESSOR_PARSE_FAILED`            | false     | `ATTACHMENT_PROCESSING_FAILED`        |

只对 retryable code 使用 job 退避；同一 source sha + processor version 的确定性失败不能通过重新排队无限消耗资源。

## 6. 音视频 Message 契约

### 6.1 DTO 收敛

V1 不探测音视频时长、不生成 poster 或关键帧，因此 Host `MessageAttachmentDto` **不得**包含 `durationMs` 或
`posterUrl`。稳定 DTO 为：

```ts
interface MessageAttachmentDto {
  id: string;
  name: string;
  detectedMediaType: string;
  byteSize: number;
  presentationKind: 'image' | 'audio' | 'video' | 'file';
  availability: 'available' | 'unavailable' | 'deleted';
  previewUrl?: string;
  contentUrl?: string;
  capabilities: { canPreview: boolean; canPlay: boolean; canDownload: boolean };
}
```

- `previewUrl` 只用于已验证图片派生物；音视频 V1 不返回 poster。
- `contentUrl` 是同源、带权限检查的稳定相对 endpoint，不是本地路径或预签名 URL。
- `canPlay=true` 表示 Server 允许流式读取，不保证当前浏览器支持 codec。
- `<audio>/<video>` 在浏览器加载 metadata 后得到的 duration 只存在组件本地，不写回 Host，也不进入 Conversation DTO。
- 视频加载前显示通用视频占位；解码首帧后由浏览器自身绘制。失败时回退为文件信息和允许的下载。

### 6.2 播放与 Agent 的隔离

浏览器使用原件鉴权 Range endpoint 播放，不触发转码、转录或关键帧任务。无论用户是否播放，Pi manifest 始终为：

```text
delivery = manifest-only
contentAvailableToModel = false
```

播放事件不改变 attachment classification、revision 或 Agent session；产品文案不能把“用户可播放”表达为“模型可理解”。

## 7. 默认配置与运维契约

### 7.1 配额和背压

| 配置                         | V1 默认值                 | 覆盖规则             |
| ---------------------------- | ------------------------- | -------------------- |
| 单附件                       | 100 MiB                   | 租户只能收紧         |
| manifest-only 音视频         | 100 MiB                   | 可独立收紧           |
| 单消息附件数                 | 10                        | 只能收紧             |
| 单消息附件原件总字节         | 200 MiB                   | 只能收紧             |
| 单消息 Pi 图片               | 4 张 / 8 MiB 总解码字节   | 与模型能力取最小值   |
| 单用户并发 tus upload        | 3                         | 可收紧               |
| 单 Workspace 并发 tus upload | 10                        | 可收紧               |
| 单 Workspace pending jobs    | 100                       | 超限返回 429         |
| 全局 processor 并发          | 2                         | 可按主机资源显式调整 |
| tus PATCH chunk              | 8 MiB 推荐，16 MiB 硬上限 | 硬上限只能收紧       |

Web 从 `/api/health` 的附件 capability 读取有效限制，不能用构建期环境变量覆盖 Server 权威值。

### 7.2 磁盘水位

- `warning`：已用空间达到 80% 或可用空间低于 5 GiB；继续服务但记录告警，暂停非必要派生重建。
- `critical`：已用空间达到 90% 或可用空间低于 2 GiB，任一满足即拒绝新 upload/create 和 retry，返回
  `507 ATTACHMENT_STORAGE_PRESSURE`；已发布内容仍允许读取和删除。
- 恢复水位：降至 85% 以下且可用空间高于 3 GiB 后恢复写入，避免抖动。
- 上传创建时按声明 `Upload-Length` 做容量 reservation；reservation 在终止、过期或 finalize 后释放。

### 7.3 保留与删除

| 资源                       | 默认保留                                        |
| -------------------------- | ----------------------------------------------- |
| 未完成 staging/tus session | 24 小时                                         |
| 未绑定且 ready             | 7 天                                            |
| failed 原件                | 7 天，供显式重试                                |
| rejected 字节              | 最迟 1 小时物理删除；只保留诊断元数据           |
| rejected/failed 审计元数据 | 30 天                                           |
| 已绑定附件                 | 跟随 Message/Workspace 保留策略，默认不自动过期 |
| 可重建派生物               | 原件存在时可按 LRU 清理；缺失时按需重建         |
| operation/job 终态记录     | 30 天                                           |
| Message 删除墓碑           | 与 Message 元数据同寿命                         |

legal hold 优先于用户/会话/期限删除；附件立即变为不可访问，但物理字节在 hold 解除前保留。无 hold 时，删除任务默认在
15 分钟内完成。失败采用 1 分钟、5 分钟、30 分钟、6 小时退避并告警，不得恢复用户访问权限。

### 7.4 备份、恢复与目标

- 内置备份先通过应用 backup gate 暂停 finalize/delete，在同一冻结点创建 `backup_run`、SQLite online backup、
  published Blob manifest 和对应 `backup_blob_pins`，然后释放 gate。备份进程按 manifest 复制并校验 Blob；完成后标记
  `verified` 并释放 pins。这样无需长时间阻塞上传，删除器也不能在复制期间移除备份需要的字节。
- 默认每天生成一次本地备份，保留 7 份；管理员必须把备份目录复制到独立磁盘/主机才能覆盖整机磁盘故障。
- 默认 **RPO 24 小时、RTO 4 小时**。单进程崩溃重启与 operation replay 的目标恢复时间为 5 分钟以内。
- 恢复顺序固定为：停止写入 → 恢复 DB → 恢复 Blob → 校验 manifest → foreign key check → operation/job 对账 →
  FTS5 rebuild/probe → 开放写流量。
- Blob 缺失时附件投影为 `unavailable`，不得伪造 ready 内容；孤儿 Blob 经过宽限期和零引用复核后删除。
- 恢复演练至少每季度一次，记录耗时、缺失字节、checksum 失败和最终 RPO/RTO。

### 7.5 可观测性与配置

必须提供结构化指标或日志：

- upload create/bytes/finalize duration 和失败码；
- 各状态附件数量、状态停留时间和 revision 冲突；
- pending/running/expired lease、重试次数和 processor 资源峰值；
- staging/orphan/rejected 清理数量；
- Blob/DB 大小、磁盘水位、容量 reservation；
- preview/download/Range 的 401/404/416/5xx；
- Prompt 附件数量、交付方式和 provider/model，绝不记录内容。

默认参数由 Server 配置解析并在启动时验证。无效、互相矛盾或放宽产品硬上限的配置必须启动失败；有效 capability 和
限制通过 `/api/health` 发布。敏感信息、绝对路径和抽取文本不得出现在 health、metrics 或普通日志中。

## 8. 实施顺序与完成定义

1. 先提交 shared DTO、错误码、Drizzle migration 和 repository CAS 测试；
2. 再实现 LocalFileBlobStore、tus datastore、operation replay 和容量 reservation；
3. 接入 TanStack Query 轮询与 Composer 状态门禁；
4. 接入 one-job child processor、artifact schema validator 和派生物发布；
5. 接入 Agent Adapter、Message attachment projection 与四种 renderer；
6. 最后启用 FTS5、保留/备份、磁盘水位和恢复演练。

每个阶段完成必须同时具备：正常路径、并发/CAS、进程崩溃、越权、超限、幂等重放和恢复测试。只完成 UI 或 parser 而
没有持久状态、错误映射和清理路径，不视为附件能力完成。
