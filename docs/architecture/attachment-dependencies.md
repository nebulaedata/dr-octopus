# 附件系统直接依赖与许可证

本清单记录附件系统 V1 新增的直接运行时依赖。版本以 `pnpm-lock.yaml` 的已解析版本为准；升级这些依赖时必须重新运行格式白名单、畸形输入、资源上限、Processor 崩溃和恢复测试，且不得绕过 capability rule/policy version。

| 包                | 已解析版本 | 许可证     | 附件系统用途                                                                |
| ----------------- | ---------- | ---------- | --------------------------------------------------------------------------- |
| `@napi-rs/canvas` | 1.0.8      | MIT        | 在受限 Processor 中为 PDF.js 提供页图渲染画布                               |
| `@tus/server`     | 2.4.4      | MIT        | tus 1.0 Server 协议层；offset 与 staging 权威仍由项目 SQLite datastore 持有 |
| `csv-parse`       | 7.0.2      | MIT        | 有界 CSV/TSV 结构化解析                                                     |
| `exceljs`         | 4.4.0      | MIT        | 有界 XLSX 工作簿结构化派生                                                  |
| `fast-xml-parser` | 5.11.1     | MIT        | OOXML 容器内 XML 的受限结构解析                                             |
| `file-type`       | 22.0.2     | MIT        | magic bytes 证据探测，不单独决定准入                                        |
| `pdfjs-dist`      | 6.3.289    | Apache-2.0 | PDF 文本提取与扫描页图渲染，不含 OCR                                        |
| `saxes`           | 6.0.0      | ISC        | 严格、namespace-aware 的流式 WordprocessingML 文本提取                      |
| `sharp`           | 0.35.4     | Apache-2.0 | 图片旋转、元数据清除和受限派生图生成                                        |
| `tus-js-client`   | 4.3.1      | MIT        | Web 断点续传、offset 恢复和上传进度                                         |
| `zod`             | 4.4.3      | MIT        | 共享线协议的唯一运行时 Schema 与 TypeScript 类型推导                        |

本实现没有引入 S3/MinIO、PostgreSQL、Redis、外部队列、向量数据库、ClamAV、OCR、FFmpeg、Whisper 或 LibreOffice 服务。
