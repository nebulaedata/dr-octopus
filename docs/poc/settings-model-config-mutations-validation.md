# settings-model-config-mutations：概念验证与验收

架构设计：[原设计](../architecture/settings-model-config-mutations.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 13. 验证矩阵

### 13.1 文本保留

- BOM、CRLF/LF、tab/space indentation；
- 行注释和尾逗号；
- root、Provider、model、override 未知字段；
- 高级 compat、samplingParams、cost、headers 原样保留；
- 只修改目标 property 的 golden-file diff。

### 13.2 语义

- create/update/delete owned Provider；
- create/update/delete overlay；
- inherited model replacement 和 revert；
- custom model removal；
- override create/update/empty cleanup/delete；
- last custom model guard；
- default model dependency guard；
- literal/env/command `apiKey` 保留且不回显。

### 13.3 并发与原子性

- 缺少 If-Match、stale revision；
- 两个 Settings mutation 串行；
- Onboarding 与 Settings 共用 queue；
- 两个 Octopus 进程 advisory lock；
- 外部编辑发生在读取后、commit 前；
- staged validate/rename/fsync 故障注入；
- transport timeout 后 refetch 判定。

### 13.4 Runtime

- candidate `ModelRuntime.getError()` 报告 models.json schema failure；
- built-in、Extension、models-only composition；
- 无网络 validation；
- control-plane Runtime swap；
- 旧 Agent Session 不变化；
- 新 Agent Session 读取新文件；
- post-commit rebuild failure 的部分成功响应。
