# ADR-0035: 使用流式 ZIP 与严格 SAX 提取 DOCX 智能体文本

## Status

Accepted

## Context

附件处理只需要为智能体生成 `StructuredDocumentV1` 文本与表格单元，不需要 HTML 或 Word 版式还原。原实现先把完整 DOCX 读入 `Buffer`，再由 Mammoth 构建文档模型。一个压缩后约 600 KiB、但 `word/document.xml` 约 12 MiB 且包含 334 个高格式密度表格的有效文件，会让子进程达到约 602 MiB V8 heap 和 792 MiB RSS，并在原 384 MiB heap 限制下崩溃。

单纯提高子进程 heap 与服务 RSS 上限可以缓解当前事故，但内存复杂度仍随 OOXML 节点数增长，不能作为长期解析边界。附件内容同时是不可信输入，替换方案必须保留 ZIP expansion、宏、嵌入对象和外部 relationship 拒绝策略。

## Decision

1. DOCX 原件的 SHA-256 使用文件流计算，不再先读取完整文件。
2. 使用已有 `fflate` 的 streaming `Unzip` 逐条发现 ZIP entry；不构建完整 entry map，也不物化 `word/document.xml`。
3. 使用 `saxes` 的 namespace-aware 严格 XML parser 增量解析 Transitional 与 Strict WordprocessingML namespace；禁止正则表达式解析 XML。
4. 只接收 `w:t` 中的可见文本；保留 `xml:space` 产生的空格，支持 tab、换行和不换行连字符；接受插入内容，排除删除与 `moveFrom` 内容，并忽略 field instruction。
5. 正文段落输出 `paragraph` unit；表格每行输出一个制表符分隔的 `table` unit。此表示服务于 LLM 上下文，不承诺 Word 版式或合并单元格复原。
6. 最大输出字符与最大 unit 数在解析过程中执行。达到上限后继续验证 XML 完整性，但停止积累文本，并设置 `truncated` 与稳定 diagnostic。
7. 继续拒绝超过 10,000 entries、512 MiB expanded bytes 或 100 倍 expansion ratio 的容器，拒绝宏、`.bin`、embedded entry、路径穿越、重复主文档和 external relationships。relationship metadata 单独限制为 8 MiB。
8. V1 只提取 `word/document.xml`。检测到脚注、尾注、页眉页脚或媒体时不解码这些 part，并在 `StructuredDocumentV1.diagnostics` 明确报告遗漏。
9. 保留独立子进程、wall timeout、V8 heap 与 RSS 双重资源边界；流式解析是降低正常峰值，不替代进程隔离。

## Consequences

### Positive

- DOCX 解析内存由完整 OOXML 对象图变为“ZIP 输入窗口 + SAX token + 当前段落/表格行 + 有界输出”。
- 事故文件实测从 Mammoth 路径约 792 MiB RSS 降至完成前采样约 100 MiB RSS，并在约 3 秒内完成；采样值包含子进程与协议运行时基线。
- 对高格式密度、低压缩体积文件的内存使用不再与 XML 节点数线性放大。
- 输出直接适配 embedding 与 agent context，避免 HTML 标签和样式属性消耗 token。
- ZIP 与 OOXML 安全策略仍在子进程内独立执行，失败继续投影为稳定 processor error code。

### Negative

- 不再提供 Mammoth 的样式、标题和列表语义推断。
- 合并单元格、嵌套表格等复杂版式会降级为紧凑 TSV 文本。
- 脚注、尾注、页眉页脚和图片文字在 V1 中不进入上下文，只通过 diagnostics 暴露。

### Neutral

- `StructuredDocumentV1`、manifest、chunks JSONL 和上层 Agent adapter 契约不变。
- XLSX 与 PPTX 仍沿用各自现有处理器；本决策只改变 DOCX 路径。
- 已提高的 heap/RSS 限制继续作为异常输入和其他格式的安全余量。

## Alternatives Considered

- **继续 Mammoth 并只提高内存上限**：拒绝作为长期方案。无法改变对象模型带来的放大系数。
- **使用正则表达式扫描 XML**：拒绝。不能可靠处理 namespace、entity、跨 chunk token、修订内容和恶意 XML。
- **使用 `htmlparser2` 收集全部 text event**：拒绝。若不限定 Word namespace 与 `w:t`，会混入 field、属性相关 part 或不可见修订内容；示例式 Buffer-to-string 写入也可能破坏跨 chunk UTF-8。
- **使用 LibreOffice sidecar 转文本**：暂不采用。格式覆盖更广，但引入重量级进程、部署与沙箱维护成本，不符合当前纯文本 DOCX 范围。
- **使用云文档转换服务**：拒绝。增加数据外传、可用性、成本与合规边界。

## Verification Requirements

1. 段落、保留空格、tab、表格行、插入、删除和 field instruction 必须有确定性回归测试。
2. external relationship、宏/embedded entry、畸形 XML 与 expansion 限制必须返回稳定的非重试错误。
3. 字符上限必须截断输出并保留 well-formedness 验证。
4. 事故 DOCX 必须在隔离子进程中成功处理，并记录峰值 RSS 与原实现对比。
5. Server build、lint、typecheck 与 test 必须通过。
