# attachment-agent-system：概念验证与验收

架构设计：[原设计](../architecture/attachment-agent-system.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 15. 验收矩阵

- JPEG/PNG/WebP、PDF、DOCX、XLSX、PPTX、允许的 UTF-8 文本/源码、manifest-only 音视频、零字节和超限文件。
- SVG/GIF/HTML/XML、归档、宏 Office、旧 Office、可执行文件、扩展名/MIME/magic/container 冲突全部拒绝。
- 上传中断、重复 finish event/finalize、offset 冲突、服务端 checksum 错误、孤儿 staging、原子发布中崩溃和上传会话过期。
- REST/tus metadata、幂等 key 冲突、revision CAS、HTTP 错误 envelope、retry/delete 和单 Range 契约。
- polling 退避、乱序 revision、多标签页、focus/network 恢复、终态停轮询与 ACK 前 Tray 保留。
- Prompt preflight 失败、ACK 后进程崩溃、重试同一 requestId、双 Tab 同时提交。
- Session 刷新、WebSocket 重连、fork、clone、export、附件删除和墓碑回显。
- Composer 六种状态、上传进度、重试/移除、非 ready 提交门禁、ACK 前不清空和多附件横向滚动。
- Message 四种 `presentationKind`、固定宽度、图片键盘/Dialog 预览、音视频播放/Range、codec 失败降级和普通文件下载。
- Web 不根据扩展名选择 renderer；`unavailable/deleted` 不提供失效操作，历史删除始终保留墓碑卡片。
- vision/非 vision 模型、图片超预算、多图片、解析失败和 processor 超时。
- 四类 capability、MIME 冲突、处理器/工具缺失、策略覆盖、规则版本重放和 deny 优先级。
- 越权附件 ID、跨 Workspace 绑定、伪造 MIME、文件名注入、SVG XSS、ZIP bomb、宏、外部 relationship、嵌入对象和 Prompt Injection。
- 100 MiB 上传期间 Server RSS 不随文件大小线性增长；WebSocket 和 RPC 帧均不包含原件。
- 仅使用 SQLite 和本地数据目录完成安装、启动、上传、处理、恢复与备份演练；无 S3/MinIO、PostgreSQL、
  Redis、外部队列或向量数据库时全部核心功能可用。
- 大 PDF/Office/表格通过 manifest、按需读取和 FTS5 检索，不把全文 JSON 注入 Prompt；禁用 FTS5 后仍可读取。
- 扫描型 PDF 只按需渲染有界页图；非 vision 模型得到明确降级。音视频 manifest 的模型可见性标志始终为 false。
- 发布物不包含 ClamAV、Tesseract、FFmpeg、Whisper 或病毒库，完全离线运行不需要这些资产。
- Worker IPC 未知版本、重复终态、路径穿越、符号链接、输出超限、超时/RSS、lease 到期和三次重试耗尽。
- 默认配额、80/90% 磁盘水位、各类保留期、Blob 零引用删除、RPO/RTO 和季度恢复演练。
