# imagegen：概念验证与验收

架构设计：[原设计](../architecture/imagegen.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## Verification

Tests cover independent keys and activation, revision conflicts, key redaction/removal, unsupported document rejection, strict provider selection, OpenAI generation and multipart edits, Qwen text and reference payloads, key-free downloads, cancellation, bounded diagnostics, fresh configuration reads, file boundaries and durable receipts.
