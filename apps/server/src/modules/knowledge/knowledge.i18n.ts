/**
 * @author Codex
 * @description Bilingual public message catalog for knowledge-domain error codes.
 * Generic variants keep every code localized; site variants preserve the exact source nuance
 * (their zh-CN text repeats the thrown message verbatim so Chinese users see no change).
 */

import { registerErrorMessages } from '../../lib/i18n/error-catalog.js';
import type { ErrorMessageCatalog } from '../../lib/i18n/error-catalog.js';

/**
 * Knowledge-domain message variants keyed by stable error code, covering agent-core
 * KnowledgeError sites and the Server's own knowledge controllers.
 */
export const knowledgeErrorMessages: ErrorMessageCatalog = {
  ATTACHMENT_REF_EXPIRED: {
    en: 'The attachment import reference expired; attach the file again.',
    'zh-CN': '附件导入引用已过期，请重新附加文件。',
  },
  ATTACHMENT_REF_INVALID: [
    {
      en: 'The attachment import reference is invalid; attach the file again.',
      'zh-CN': '附件导入引用无效，请重新附加文件。',
    },
    { match: '附件导入凭据无效', en: 'The attachment import credential is invalid.', 'zh-CN': '附件导入凭据无效' },
  ],
  AUTH_REQUIRED: [
    { en: 'Valid credentials are required; complete the configuration and try again.', 'zh-CN': '缺少有效凭据，请完成配置后重试。' },
    { match: 'MCP 环境变量未配置', en: 'The MCP environment variables are not configured.', 'zh-CN': 'MCP 环境变量未配置' },
    {
      match: 'MCP 连接配置已变更，请重试',
      en: 'The MCP connection configuration changed; try again.',
      'zh-CN': 'MCP 连接配置已变更，请重试',
    },
    {
      match: '知识库共享未启用或令牌已失效',
      en: 'Knowledge sharing is not enabled or the token expired.',
      'zh-CN': '知识库共享未启用或令牌已失效',
    },
    { match: '远端知识库令牌无效', en: 'The remote knowledge token is invalid.', 'zh-CN': '远端知识库令牌无效' },
  ],
  CANCELLED: { en: 'The operation was cancelled.', 'zh-CN': '操作已取消。' },
  CAPACITY: {
    en: 'At most 20 knowledge base instances can be mounted.',
    'zh-CN': '最多挂载 20 个知识库实例。',
  },
  DOCUMENT_CHANGED: [
    { en: 'The document changed; refresh and try again.', 'zh-CN': '文档已变更，请刷新后重试。' },
    {
      match: '文档已删除或已由新版本替换',
      en: 'The document was deleted or replaced by a newer version.',
      'zh-CN': '文档已删除或已由新版本替换',
    },
    {
      match: '索引生成期间文档已删除或更新',
      en: 'The document was deleted or updated while indexing.',
      'zh-CN': '索引生成期间文档已删除或更新',
    },
    {
      match: '选中文档已删除或无法重新索引，请刷新后重试',
      en: 'The selected documents were deleted or can no longer be reindexed; refresh and try again.',
      'zh-CN': '选中文档已删除或无法重新索引，请刷新后重试',
    },
    {
      match: '集合索引已变更，请重新提交选中文档的索引任务',
      en: 'The collection index changed; resubmit the indexing job for the selected documents.',
      'zh-CN': '集合索引已变更，请重新提交选中文档的索引任务',
    },
  ],
  DOCUMENT_LIMIT: [
    { en: 'The document is empty or exceeds the limit.', 'zh-CN': '文档为空或超过限制。' },
    { match: '文档为空', en: 'The document is empty.', 'zh-CN': '文档为空' },
    {
      match: '文档分块数量超过限制',
      en: 'The document chunk count exceeds the limit.',
      'zh-CN': '文档分块数量超过限制',
    },
  ],
  EMBEDDING_DIMENSION_MISMATCH: {
    en: 'The Embedding index, dimension, or vector values are invalid.',
    'zh-CN': 'Embedding 索引、维度或向量数值无效。',
  },
  EVIDENCE_GONE: [
    { en: 'The citation expired or no longer exists.', 'zh-CN': '引用已过期或不存在。' },
    { match: '引用文档已删除', en: 'The cited document was deleted.', 'zh-CN': '引用文档已删除' },
    { match: '引用正文不可用', en: 'The cited content is unavailable.', 'zh-CN': '引用正文不可用' },
    { match: '远端引用已失效', en: 'The remote citation expired.', 'zh-CN': '远端引用已失效' },
  ],
  FORBIDDEN: [
    { en: 'This operation is not permitted in the current scope.', 'zh-CN': '当前范围不允许此操作。' },
    { match: '不能列举其他工作区', en: 'Listing other workspaces is not permitted.', 'zh-CN': '不能列举其他工作区' },
    {
      match: '只能发布本地全局集合',
      en: 'Only local global collections can be published.',
      'zh-CN': '只能发布本地全局集合',
    },
    { match: '文件不在当前工作区内', en: 'The file is outside the current workspace.', 'zh-CN': '文件不在当前工作区内' },
    {
      match: '未授权在此范围创建集合',
      en: 'Creating collections in this scope is not authorized.',
      'zh-CN': '未授权在此范围创建集合',
    },
    {
      match: '此调用未授权修改全局知识库',
      en: 'This caller is not authorized to modify the global knowledge base.',
      'zh-CN': '此调用未授权修改全局知识库',
    },
    {
      match: '此调用未授权管理知识库连接',
      en: 'This caller is not authorized to manage knowledge connections.',
      'zh-CN': '此调用未授权管理知识库连接',
    },
    {
      match: '附件不属于当前工作区会话',
      en: 'The attachment does not belong to the current workspace session.',
      'zh-CN': '附件不属于当前工作区会话',
    },
  ],
  IDEMPOTENCY_CONFLICT: {
    en: 'The same request identity cannot submit different content.',
    'zh-CN': '相同请求标识不能提交不同内容。',
  },
  INCOMPATIBLE: [
    {
      en: 'The selected connection or target is incompatible with this operation.',
      'zh-CN': '所选连接或目标与此操作不兼容。',
    },
    {
      match: '不能挂载本实例或替换为另一远程实例',
      en: 'This instance cannot be mounted or replaced by another remote instance.',
      'zh-CN': '不能挂载本实例或替换为另一远程实例',
    },
    {
      match: '请选择已启用的全局 Streamable HTTP Bearer 连接',
      en: 'Select an enabled global Streamable HTTP Bearer connection.',
      'zh-CN': '请选择已启用的全局 Streamable HTTP Bearer 连接',
    },
    { match: '远程目录游标循环', en: 'The remote listing cursor loops.', 'zh-CN': '远程目录游标循环' },
    {
      match: '远程目录过大或重复',
      en: 'The remote listing is too large or duplicated.',
      'zh-CN': '远程目录过大或重复',
    },
    {
      match: '远端引用范围不匹配',
      en: 'The remote citation scope does not match.',
      'zh-CN': '远端引用范围不匹配',
    },
    {
      match: '远端知识库返回的协议内容无效',
      en: 'The remote knowledge base returned invalid protocol content.',
      'zh-CN': '远端知识库返回的协议内容无效',
    },
    {
      match: '远端缺少知识库工具契约',
      en: 'The remote lacks the knowledge tool contract.',
      'zh-CN': '远端缺少知识库工具契约',
    },
    {
      match: '远端返回了范围外的集合',
      en: 'The remote returned an out-of-scope collection.',
      'zh-CN': '远端返回了范围外的集合',
    },
  ],
  INDEX_INCOMPLETE: { en: 'Index write verification failed.', 'zh-CN': '索引写入校验失败。' },
  INDEX_UNAVAILABLE: { en: 'The index record is corrupted.', 'zh-CN': '索引记录损坏。' },
  INVALID_ENDPOINT: [
    { en: 'The connection endpoint is invalid or not allowed.', 'zh-CN': '连接地址无效或不被允许。' },
    { match: '目标网络地址不允许', en: 'The target network address is not allowed.', 'zh-CN': '目标网络地址不允许' },
    {
      match: '连接地址必须为无凭据和查询参数的 HTTP(S) 地址',
      en: 'The endpoint must be an HTTP(S) URL without credentials or query parameters.',
      'zh-CN': '连接地址必须为无凭据和查询参数的 HTTP(S) 地址',
    },
  ],
  INVALID_INPUT: [
    { en: 'The request is invalid; check the input and try again.', 'zh-CN': '请求参数无效，请检查后重试。' },
    { match: '文档名称不能为空', en: 'The document title cannot be empty.', 'zh-CN': '文档名称不能为空' },
    {
      match: '集合名称或说明长度无效',
      en: 'The collection name or description length is invalid.',
      'zh-CN': '集合名称或说明长度无效',
    },
    { match: '集合重复', en: 'This collection already exists.', 'zh-CN': '集合重复' },
    {
      match: '集合更新或发布范围无效',
      en: 'The collection update or publishing scope is invalid.',
      'zh-CN': '集合更新或发布范围无效',
    },
    {
      match: '请选择 1 到 100 份不同文档',
      en: 'Select between 1 and 100 distinct documents.',
      'zh-CN': '请选择 1 到 100 份不同文档',
    },
    {
      match: '选中文档尚无可重建的索引，请先完成导入或重试导入任务',
      en: 'The selected documents have no rebuildable index yet; finish the import or retry it first.',
      'zh-CN': '选中文档尚无可重建的索引，请先完成导入或重试导入任务',
    },
    {
      match: '替换文档不能上传压缩包',
      en: 'An archive cannot replace an existing document.',
      'zh-CN': '替换文档不能上传压缩包',
    },
    { match: '导入缺少源文件', en: 'The import is missing its source file.', 'zh-CN': '导入缺少源文件' },
    { match: '分页参数无效', en: 'The pagination parameters are invalid.', 'zh-CN': '分页参数无效' },
    { match: '请求标识无效', en: 'The request identity is invalid.', 'zh-CN': '请求标识无效' },
    {
      match: '文件为空或超过 100 MiB',
      en: 'The file is empty or exceeds 100 MiB.',
      'zh-CN': '文件为空或超过 100 MiB',
    },
    {
      match: '文件无效或超过 100 MiB',
      en: 'The file is invalid or exceeds 100 MiB.',
      'zh-CN': '文件无效或超过 100 MiB',
    },
    {
      match: '知识导入只接受相对工作区路径',
      en: 'Knowledge imports only accept workspace-relative paths.',
      'zh-CN': '知识导入只接受相对工作区路径',
    },
    {
      match: '知识库附件元信息无效',
      en: 'The knowledge attachment metadata is invalid.',
      'zh-CN': '知识库附件元信息无效',
    },
    {
      match: '启用前请选择集合并生成有效令牌',
      en: 'Select a collection and generate a valid token before enabling.',
      'zh-CN': '启用前请选择集合并生成有效令牌',
    },
    {
      match: '检索范围、问题或数量无效',
      en: 'The search scope, question, or count is invalid.',
      'zh-CN': '检索范围、问题或数量无效',
    },
    {
      match: '上传必须为原始文件内容',
      en: 'The upload must be the raw file content.',
      'zh-CN': '上传必须为原始文件内容',
    },
    {
      match: '知识库上传文件或元信息无效',
      en: 'The knowledge upload file or metadata is invalid.',
      'zh-CN': '知识库上传文件或元信息无效',
    },
    { match: '服务命令无效', en: 'The service command is invalid.', 'zh-CN': '服务命令无效' },
  ],
  JOB_CANCELLED: [
    { en: 'The job was cancelled or superseded by a newer run.', 'zh-CN': '任务已取消或由新执行接管。' },
    {
      match: '导入任务已取消或由新执行接管',
      en: 'The import job was cancelled or superseded by a newer run.',
      'zh-CN': '导入任务已取消或由新执行接管',
    },
    { match: '重建任务已失效', en: 'The reindex job is no longer valid.', 'zh-CN': '重建任务已失效' },
  ],
  KNOWLEDGE_METADATA_INVALID: {
    en: 'The knowledge service control file is unreadable.',
    'zh-CN': '知识服务控制文件不可读。',
  },
  KNOWLEDGE_RESPONSE_INVALID: {
    en: 'The knowledge service response exceeds the limit.',
    'zh-CN': '知识服务响应超过限制。',
  },
  KNOWLEDGE_SERVICE_BUSY: [
    { en: 'The knowledge service is busy; try again later.', 'zh-CN': '知识服务正忙，请稍后重试。' },
    {
      match: '请先停止知识服务，再执行离线维护',
      en: 'Stop the knowledge service before running offline maintenance.',
      'zh-CN': '请先停止知识服务，再执行离线维护',
    },
    {
      match: '请先显式停止知识服务',
      en: 'Stop the knowledge service explicitly first.',
      'zh-CN': '请先显式停止知识服务',
    },
  ],
  KNOWLEDGE_SERVICE_STOPPED: [
    { en: 'The knowledge service is stopped.', 'zh-CN': '知识服务已停止。' },
    {
      match: '启动已被较新的停止操作取消',
      en: 'The start was cancelled by a newer stop operation.',
      'zh-CN': '启动已被较新的停止操作取消',
    },
    {
      match: '知识服务已停止，请执行 octopus knowledge start',
      en: 'The knowledge service is stopped; run `octopus knowledge start`.',
      'zh-CN': '知识服务已停止，请执行 octopus knowledge start',
    },
    {
      match: '重启已被较新的启停操作取消',
      en: 'The restart was cancelled by a newer lifecycle operation.',
      'zh-CN': '重启已被较新的启停操作取消',
    },
  ],
  KNOWLEDGE_SERVICE_TIMEOUT: [
    { en: 'The knowledge service timed out; try again later.', 'zh-CN': '知识服务响应超时，请稍后重试。' },
    {
      match: '停止尚未完成，请查询 status；不会强杀进程',
      en: 'The stop is still in progress; check status (processes are not force-killed).',
      'zh-CN': '停止尚未完成，请查询 status；不会强杀进程',
    },
    {
      match: '知识服务未能及时启动，请检查依赖和服务状态',
      en: 'The knowledge service did not start in time; check its dependencies and status.',
      'zh-CN': '知识服务未能及时启动，请检查依赖和服务状态',
    },
  ],
  KNOWLEDGE_UNAVAILABLE: { en: 'The knowledge service has not started yet.', 'zh-CN': '知识服务尚未启动。' },
  KNOWLEDGE_VERSION_CONFLICT: {
    en: 'The knowledge service identity or protocol is incompatible; restart the service.',
    'zh-CN': '知识服务身份或协议不兼容，请重启服务。',
  },
  MODEL_ACCESS_DENIED: {
    en: 'This caller is not permitted to invoke local models.',
    'zh-CN': '当前调用方未获得本地模型调用权限。',
  },
  MODEL_CONFIG_INVALID: [
    { en: 'The model configuration is invalid.', 'zh-CN': '模型配置无效。' },
    {
      match: 'Embedding 维度或批大小无效',
      en: 'The Embedding dimension or batch size is invalid.',
      'zh-CN': 'Embedding 维度或批大小无效',
    },
    {
      match: 'OCR 模式或输出预算无效',
      en: 'The OCR mode or output budget is invalid.',
      'zh-CN': 'OCR 模式或输出预算无效',
    },
    {
      match: 'Reranker 开关或候选数量无效',
      en: 'The Reranker toggle or candidate count is invalid.',
      'zh-CN': 'Reranker 开关或候选数量无效',
    },
    { match: '凭据引用无效', en: 'The credential reference is invalid.', 'zh-CN': '凭据引用无效' },
    { match: '模型名称或超时无效', en: 'The model name or timeout is invalid.', 'zh-CN': '模型名称或超时无效' },
    {
      match: '模型名称或超时配置无效',
      en: 'The model name or timeout configuration is invalid.',
      'zh-CN': '模型名称或超时配置无效',
    },
    { match: '模型地址不是有效 URL', en: 'The model endpoint is not a valid URL.', 'zh-CN': '模型地址不是有效 URL' },
    {
      match: '模型地址必须使用不含凭据的 HTTP(S) 地址',
      en: 'The model endpoint must be a credential-free HTTP(S) URL.',
      'zh-CN': '模型地址必须使用不含凭据的 HTTP(S) 地址',
    },
  ],
  MODEL_CREDENTIAL_UNAVAILABLE: {
    en: 'The model credential was revoked or is unreadable.',
    'zh-CN': '模型凭据已撤销或不可读。',
  },
  MODEL_MANAGEMENT_DENIED: {
    en: 'This caller is not permitted to manage models.',
    'zh-CN': '当前调用方未获得模型管理权限。',
  },
  MODEL_NOT_CONFIGURED: [
    { en: 'Configure the required model first.', 'zh-CN': '请先完成所需模型配置。' },
    {
      match: '请先在知识库模型设置中配置 Embedding',
      en: 'Configure Embedding in the knowledge model settings first.',
      'zh-CN': '请先在知识库模型设置中配置 Embedding',
    },
    {
      match: '请先在知识库模型设置中配置并启用 Reranker',
      en: 'Configure and enable the Reranker in the knowledge model settings first.',
      'zh-CN': '请先在知识库模型设置中配置并启用 Reranker',
    },
    {
      match: '请先配置 Embedding 模型',
      en: 'Configure an Embedding model first.',
      'zh-CN': '请先配置 Embedding 模型',
    },
    {
      match: '请在 Settings - 知识库配置 Embedding 模型',
      en: 'Configure an Embedding model under Settings - Knowledge.',
      'zh-CN': '请在 Settings - 知识库配置 Embedding 模型',
    },
    { match: '请配置 Embedding 模型', en: 'Configure an Embedding model first.', 'zh-CN': '请配置 Embedding 模型' },
  ],
  MODEL_RESPONSE_INVALID: [
    { en: 'The model response is invalid.', 'zh-CN': '模型响应无效。' },
    {
      match: 'Embedding 返回数量不匹配',
      en: 'The Embedding response count does not match.',
      'zh-CN': 'Embedding 返回数量不匹配',
    },
    { match: 'Embedding 返回零向量', en: 'Embedding returned a zero vector.', 'zh-CN': 'Embedding 返回零向量' },
    { match: 'OCR 响应格式无效', en: 'The OCR response format is invalid.', 'zh-CN': 'OCR 响应格式无效' },
    {
      match: 'OCR 未能识别标准测试图片',
      en: 'OCR failed to recognize the standard test image.',
      'zh-CN': 'OCR 未能识别标准测试图片',
    },
    { match: '模型响应格式无效', en: 'The model response format is invalid.', 'zh-CN': '模型响应格式无效' },
    {
      match: '模型响应流格式无效',
      en: 'The model response stream format is invalid.',
      'zh-CN': '模型响应流格式无效',
    },
    {
      match: '模型响应超过大小限制',
      en: 'The model response exceeds the size limit.',
      'zh-CN': '模型响应超过大小限制',
    },
    { match: '模型返回空响应', en: 'The model returned an empty response.', 'zh-CN': '模型返回空响应' },
    { match: '重排结果不完整', en: 'The rerank result is incomplete.', 'zh-CN': '重排结果不完整' },
    {
      match: '重排返回无效的候选索引或分数',
      en: 'The reranker returned invalid candidate indices or scores.',
      'zh-CN': '重排返回无效的候选索引或分数',
    },
  ],
  NOT_FOUND: [
    { en: 'The target no longer exists; refresh and try again.', 'zh-CN': '目标已删除或不存在，请刷新后重试。' },
    { match: '任务不存在', en: 'The job no longer exists.', 'zh-CN': '任务不存在' },
    { match: '挂载不存在', en: 'The mount no longer exists.', 'zh-CN': '挂载不存在' },
    { match: '挂载已移除', en: 'The mount was removed.', 'zh-CN': '挂载已移除' },
    { match: '文档不存在', en: 'The document no longer exists.', 'zh-CN': '文档不存在' },
    {
      match: '知识服务目录不存在',
      en: 'The knowledge service directory does not exist.',
      'zh-CN': '知识服务目录不存在',
    },
    {
      match: '知识集合不存在或无权访问',
      en: 'The collection does not exist or is not accessible.',
      'zh-CN': '知识集合不存在或无权访问',
    },
    { match: '远程集合已移除', en: 'The remote collection was removed.', 'zh-CN': '远程集合已移除' },
    {
      match: '选中的文档不存在或不属于当前集合',
      en: 'The selected documents no longer exist or do not belong to this collection.',
      'zh-CN': '选中的文档不存在或不属于当前集合',
    },
    { match: '集合已删除', en: 'The collection was deleted.', 'zh-CN': '集合已删除' },
  ],
  OCR_IMAGE_PIXEL_LIMIT: {
    en: 'The image exceeds 40 megapixels or its dimensions are unknown; split it into smaller tiles first.',
    'zh-CN': '图片超过 4000 万像素或尺寸未知，请先分块处理。',
  },
  OCR_IMAGE_PREPARATION_FAILED: {
    en: 'Image compression failed or timed out; convert or split the image first.',
    'zh-CN': '图片压缩失败或超时，请先转换或分块处理。',
  },
  OCR_INCOMPLETE: [
    {
      en: 'The OCR output is incomplete; check the page and model output budgets.',
      'zh-CN': 'OCR 输出不完整，请检查页面和模型输出预算。',
    },
    {
      match: 'OCR 输出未完整结束，请检查页面和模型输出预算',
      en: 'The OCR output did not finish; check the page and model output budgets.',
      'zh-CN': 'OCR 输出未完整结束，请检查页面和模型输出预算',
    },
    {
      match: 'OCR 页面文本超过限制',
      en: 'The OCR page text exceeds the limit.',
      'zh-CN': 'OCR 页面文本超过限制',
    },
  ],
  OCR_NOT_CONFIGURED: [
    { en: 'Configure OCR in the knowledge model settings first.', 'zh-CN': '请先在知识库模型设置中配置 OCR。' },
    { match: 'OCR 已关闭', en: 'OCR is disabled.', 'zh-CN': 'OCR 已关闭' },
    {
      match: '请先在知识库模型设置中配置并启用 OCR',
      en: 'Configure and enable OCR in the knowledge model settings first.',
      'zh-CN': '请先在知识库模型设置中配置并启用 OCR',
    },
  ],
  PARSER_FAILED: { en: 'The archive parsing result is invalid.', 'zh-CN': '压缩解析结果无效。' },
  PAYLOAD_TOO_LARGE: { en: 'The request body exceeds the limit.', 'zh-CN': '请求正文超过限制。' },
  REINDEX_BUSY: [
    { en: 'This collection is already reindexing.', 'zh-CN': '此集合正在重建索引。' },
    { match: '集合正在重建', en: 'This collection is already reindexing.', 'zh-CN': '集合正在重建' },
  ],
  RELEASE_IN_USE: [
    { en: 'The runtime directory is being updated; try again later.', 'zh-CN': '运行目录正在更新，请稍后重试。' },
    {
      match: '当前发行目录正在安装依赖',
      en: 'The current release directory is installing dependencies.',
      'zh-CN': '当前发行目录正在安装依赖',
    },
    {
      match: '当前发行目录正在安装依赖，请稍后启动',
      en: 'The current release directory is installing dependencies; start later.',
      'zh-CN': '当前发行目录正在安装依赖，请稍后启动',
    },
    { match: '运行目录正在更新', en: 'The runtime directory is being updated.', 'zh-CN': '运行目录正在更新' },
  ],
  RELEASE_USE_UNVERIFIED: {
    en: 'The knowledge runtime directory could not be confirmed.',
    'zh-CN': '无法确认知识库运行目录。',
  },
  REMOTE_READ_ONLY: {
    en: 'Remote collections do not support local document management.',
    'zh-CN': '远程集合不提供本地文档管理。',
  },
  REMOTE_UNAVAILABLE: {
    en: 'The remote connection is backing off briefly; try again later or refresh the connection.',
    'zh-CN': '远程连接正在短暂退避，请稍后重试或刷新连接。',
  },
  REVISION_CONFLICT: [
    { en: 'The resource changed; refresh and try again.', 'zh-CN': '内容已变更，请刷新后重试。' },
    {
      match: '任务状态已改变，请刷新',
      en: 'The job status changed; refresh and try again.',
      'zh-CN': '任务状态已改变，请刷新',
    },
    {
      match: '发布配置已变更，请刷新',
      en: 'The publishing configuration changed; refresh and try again.',
      'zh-CN': '发布配置已变更，请刷新',
    },
    {
      match: '文档已修改，请刷新后重试',
      en: 'The document changed; refresh and try again.',
      'zh-CN': '文档已修改，请刷新后重试',
    },
    {
      match: '文档已变更，请刷新',
      en: 'The document changed; refresh and try again.',
      'zh-CN': '文档已变更，请刷新',
    },
    {
      match: '文档已变更，请刷新后重试',
      en: 'The document changed; refresh and try again.',
      'zh-CN': '文档已变更，请刷新后重试',
    },
    {
      match: '模型配置已修改，请刷新',
      en: 'The model configuration changed; refresh and try again.',
      'zh-CN': '模型配置已修改，请刷新',
    },
    {
      match: '该知识库实例已经挂载',
      en: 'This knowledge base instance is already mounted.',
      'zh-CN': '该知识库实例已经挂载',
    },
    {
      match: '集合已修改，请刷新后重试',
      en: 'The collection changed; refresh and try again.',
      'zh-CN': '集合已修改，请刷新后重试',
    },
  ],
  REVISION_EXPIRED: [
    { en: 'The listing cursor expired; reload the list.', 'zh-CN': '目录游标已过期，请重新加载。' },
    { match: '远程目录已变更，请重试', en: 'The remote listing changed; try again.', 'zh-CN': '远程目录已变更，请重试' },
  ],
  SOURCE_CORRUPT: [
    { en: 'Source verification failed; upload the file again.', 'zh-CN': '原文校验失败，请重新上传。' },
    { match: '知识原文校验失败', en: 'Source content verification failed.', 'zh-CN': '知识原文校验失败' },
    {
      match: '附件原文大小已变更',
      en: 'The attachment source size changed.',
      'zh-CN': '附件原文大小已变更',
    },
    { match: '附件原文校验失败', en: 'Attachment source verification failed.', 'zh-CN': '附件原文校验失败' },
    {
      match: '附件原文路径已变更',
      en: 'The attachment source path changed.',
      'zh-CN': '附件原文路径已变更',
    },
  ],
  UNAVAILABLE: { en: 'The knowledge base is stopping.', 'zh-CN': '知识库正在停止。' },
  UPLOAD_FAILED: { en: 'Uploading the source content failed.', 'zh-CN': '知识原文上传失败。' },
};

/**
 * Merges the knowledge-domain catalog into the shared error-message registry at Server boot.
 */
export function registerKnowledgeErrorMessages(): void {
  registerErrorMessages('knowledge', knowledgeErrorMessages);
}
