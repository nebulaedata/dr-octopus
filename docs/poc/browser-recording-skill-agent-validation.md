# browser-recording-skill-agent：概念验证与验收

架构设计：[原设计](../architecture/browser-recording-skill-agent.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 15. 实施拆解与验证门槛

方案已于2026-10-31获用户确认并授权开发；实施顺序与当前状态：

1. 已完成：用户确认本方案及开发方向；
2. 设计Skill目录、生成进度、按需提问、结果/运行入口的交互与视觉稿；
3. 独立后台开发已开始：先验证真实SDK工具调用/会话消息契约；新UI按视觉审阅规则确认后接入，完整Worker/Host与文件提交继续实现；
4. 接入完整整理Agent、Skill文件协议与库加载，再接入运行引擎和结果验证；
5. 通过生成→保存→手改→重读→重放全链路，才宣称本次Skill重放可用。

建议模块边界：

- 扩展lib/skill-organization：有界Agent、工具注册、会话与候选校验；
- 扩展lib/skill-library：目录投影、文件快照与Native桥接；
- 扩展lib/skill-run：Page Agent Core适配、本次输入、运行门禁与结果，不实现另一套浏览器Agent Loop；
- 扩展features：按确认视觉接入，不让任一业务feature成为外壳；
- Executor：受限文件服务与Main打开目录；
- shared：新Native skills契约，不把模型/Skill业务移入通用Agent核心。

既有录制、脱敏、事实引用、模型配置、Native来源校验、Host生命周期和页面共同准入可复用。旧固定问卷、单次JSON编译、复杂工作流编辑/发布不再作为新增主路径；按实际替换范围删除旧运行逻辑，不长期并行两套维护模型。保留原数据库，不自动迁移/删除用户内容；原录制可重新生成新Skill。

必要测试：

- 真SDK工具调用与外部tool result恢复，零问题/一个问题/多次必要问题；
- 供应商不支持工具调用、非法参数、重复调用、未知工具、预算耗尽；
- 问题关闭后重开、Worker回收、旧回答/旧Host结果拒绝、取消；
- 不完整/越权候选、参数/站点引用、模型伪造权限、提示词注入；
- 两文件首次提交、同名保护、junction/越界路径拒绝、磁盘失败、回执丢失恢复；
- 用户手改Markdown/JSON后的刷新、语法错误不运行、运行快照与下次编辑隔离；
- 跨Tab单次execute、必填输入预检、未配置onAskUser时工具集中不含ask_user、Host中断不自动续跑、权限门禁、未知提交不重试、真实结果不充分；
- 原有连接和录制回归，Chrome/Edge隔离验收。

真实模型测试要单独申请次数，且分开统计“工具链路正确”“技能内容质量”“真实重放成功”；不能拿合成提供商通过代替真实模型理解，也不能拿文件生成代替重放验收。


## 开发进度：ToolLoopAgent工具适配层

2026-10-31已新增lib/skill-organization/skill-organizer.ts：四工具注册、两种外部工具的整轮准入、模型调用上限、只读工具输出限额和错误投影。ask与submit都不提供自动execute；同轮多ask只接纳一个，问答与提交并存时不返回可保存候选。服务回调为下一步Session Repository留出原子模型/工具准入接线点，当前未实现完整存储所有权。

真实SDK回归发现，ai@7.0.155的result.response.messages只有最后一步。恢复上下文必须使用公开累计字段responseMessages；测试已确认此前read_recording的tool result和原ask调用均能跨序列化/新Agent实例保留，而不是只保留末尾问题。无需自写消息累计替代SDK能力。

当前通过8项SDK/工具契约测试，以及Chrome/Edge两项受限CSP、IndexedDB存取、刷新后重建Agent的专项。浏览器专项使用普通隔离测试页与真实SDK、假模型，不能当作MV3 Worker/Host生命周期完成。没有连接真实提供商，没有写本地Skill库，也没有接入Page Agent Core重放。

当前UI稿仅为会话方向探索，尚未批准。接下来的实际工作：会话权威存储/执行世代与宿主接线、完整Skill包语义校验、Native文件协议与服务、原生execute适配、选择后的完整界面及端到端验证。旧界面未切换到新框架，不宣称完整闭环已交付。
