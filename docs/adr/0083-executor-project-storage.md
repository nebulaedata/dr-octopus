# ADR-0083：Executor 持久目录与系统临时目录

状态：Accepted（2026-10-15，用户确认实施）。替代 ADR-0081 中业务数据保留 AppData 的安排。

## 决定

默认业务根目录为 `~/.dr-octopus/executor`。显式独立实例及测试仍使用其 `userData/project`，不访问默认用户数据。AppData 只由 Electron 管理自身缓存，不承担 Executor 业务持久化职责。

| 位置 | 用途 |
| --- | --- |
| settings.json | 正式设置 |
| device/ | 设备身份与名称 |
| connections/ | 加密凭据与私有 stdio 配置 |
| tasks/ | 授权、任务与幂等结果 |
| browser/ | 桥接启用及 Native Host 引导记录 |
| file-operations/ | 文件提交与恢复记录 |
| shell/ | Bash 记录及有效期内可查询的输出 |
| transfers/ | 传输记录及尚需保留的快照/恢复材料 |
| settings-recovery/ | 设置初始化标记与提交恢复证据 |

可丢弃搜索快照使用 `os.tmpdir()/octopus-executor-<随机 UUID>/`，目录以当前用户私有 ACL 原子创建，每次 Runtime 独立持有。正常结束清理空根目录，不扫描或删除其他实例的临时目录。预览/diff 如后续增加，遵守相同规则，不预建空目录。

用于原子替换的暂存仍在目标卷，保留可识别的 `.octopus-executor-recovery-*` 前缀及现有原生提交校验。需要跨重启判断结果的材料不能放到可丢弃临时目录。

统一向 Main、Runtime、Native Host 传递同一 projectRoot。Native Host locator 与注册参数明确命名为 projectRoot / ProjectRoot。Basic 文件和搜索工具拒绝业务根及其子路径；系统临时根同样排除，不能因改成普通目录名泄露内部数据。Bash 仍按已授权的当前 Windows 用户权限运行，不宣称目录沙箱。

应用未发布，不提供旧路径自动导入、回退或旧字段兼容。已有本机当前数据可在停机后一次性搬迁并核对；目录冲突或结果未知时保留证据，不能覆盖。旧 stdio 路径需重新复制，浏览器 Host 需更新定位。

## 验证

验证新目录持久化、删除系统临时材料后重启、设备身份/授权/设置保持、stdio 及 Native Host、文件恢复/传输、内部目录拒绝访问、备份恢复与独立实例隔离。迁移脚本不成为启动兼容逻辑。
