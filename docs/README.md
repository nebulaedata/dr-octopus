# Dr.Octopus 文档

## 目录定位

| 目录 | 定位与内容 |
| --- | --- |
| [architecture/](./architecture/) | 架构设计：系统分层、模块职责、接口与生命周期契约。 |
| [adr/](./adr/README.md) | 架构决策：背景、备选方案、取舍与决定。 |
| [poc/](./poc/README.md) | 概念验证：架构评估与审查、测试计划、验收矩阵、实测结果与证据索引。 |
| [design/](./design/) | 产品与界面设计：视觉稿、交互、提示记录及审阅状态。 |
| [guides/](./guides/) | 开发规范与技术指南；应用专属安装、发布流程仍归对应应用。 |
| [product/](./product/) | 产品与宣传材料：定位、推广文案、演示及技术分享，含 `Further-Learning.md`。 |
| [diagnostics/](./diagnostics/) | 故障与性能诊断：复现、环境、排查过程与根因。 |
| [refactoring/](./refactoring/) | 重构与迁移：范围、映射、替换清单及进度。 |
| [reviews/](./reviews/) | 代码专项审查：具体实现的缺陷、风险与修复建议；架构审查归 `poc/`。 |

## 归档规则

- 根目录只保留 `README.md`，其他文档和附件归入合适的现有子目录。
- **新增任何目录（含子目录）须先获用户同意**：说明名称、用途及现有目录为何不适合；无合适目录时可提议通用分类，等待批准期间不得新建或暂存到根目录。
- 调整目录后更新上表；移动文件同步修正链接与索引，保留历史证据、失败记录和审阅状态。
- 架构设计与验证记录分开维护；测试计划、局部通过不等于完整验收通过。

## 常用入口

- 开发：[代码规范](./guides/code-development-standards.md) · [Electron 规范](./guides/electron-development-standards.md) · [构建指南](../README.dev.zh-CN.md)
- 架构：[系统概览](./architecture/overview.md) · [Executor 与浏览器扩展](./architecture/executor.md)
- 产品：[发布产物总览（中文）](./product/release-artifacts.zh-CN.md) · [Release artifacts (English)](./product/release-artifacts.md) · [产品素材库](./product/product-materials.zh-CN.md) · [技术分享材料](./product/Further-Learning.md)
