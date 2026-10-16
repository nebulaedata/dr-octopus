# ADR-0077：Executor 使用设备级能力授权

- 状态：Implemented
- 日期：2026-10-09
- 决策来源：用户要求不限工作区、只授权本设备，并明确未发布版本无需兼容旧逻辑。

## 问题

原授权流程要求选择目录，为所有 MCP 身份记录 workspaceId/root。Browser 和 Computer 因此也依赖文件目录，文件工具被限制在授权目录内，偏离设备执行器目标。

## 决定

授权单位为本设备上的客户端身份和明确选定的能力。Runtime 创建 `scope: device` 授权；Renderer 不接触凭据。HTTP、内网 HTTP、stdio 复用同一授权和任务服务。2026-10-11 用户确认创建授权与客户端配置分离：Main 加密保存凭据，用户随后直接复制配置或按需下载，不强制选择保存位置，见 [设备授权与凭据](../architecture/executor.md#设备授权与凭据)。

删除 workspaceId、授权目录 roots 和目录选择对话框，不提供旧数据、旧 stdio 配置或旧 task_start 参数兼容。既有未发布测试数据保持原样，不自动迁移、重置或删除。

任务 cwd 为执行上下文，可使用本机绝对路径或相对 Windows 用户主目录；省略时使用主目录。cwd 创建时固定，不限制文件访问范围。纯 Browser/Computer 任务不要求文件目录存在。Basic 目录及目标仍需通过普通本机路径、操作系统权限和各后端检查。

files.write 包含 files.read，Shell 单独授权；Browser 与 Computer 仍分别授权。保留任务所有权、全局互斥、凭据撤销、版本检查与备份、输入防护和未知结果处理。Computer 生产门禁保持关闭。

## 影响与验证

同一文件授权可以访问多个本机目录；不宣称目录沙箱，也不增加通用脚本执行接口。搜索结果必须处于本次查询目录，恢复目录/特殊命名空间/链接路径限制继续生效。

HTTP/stdio 私有配置需重新导出。旧控制日志拒绝读取并保留原件；使用独立新测试数据目录启动新版源码。既有验收包不会自动更新。

当前授权与任务契约见 [Executor](../architecture/executor.md#设备授权与凭据)，回归与原始证据见 [验证矩阵](../architecture/executor-validation.md)。
