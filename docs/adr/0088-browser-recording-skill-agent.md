# ADR-0088：录制整理采用受限工具Agent与本地Skill产物

## Status

Superseded · 2026-10-31，由 [ADR-0089](0089-browser-skill-unified-agent.md) 替代双引擎及重放无问答决定。以下保留此前接受记录；当前实施以新 ADR 和[统一方案](../architecture/browser-skill-unified-agent.md)为准。

Accepted · 2026-10-31。用户明确“方案确定了，开始设计和开发”，已授权按本ADR推进；整理使用ToolLoopAgent、重放只用Page Agent Core原生execute且不接onAskUser。新界面仍需按视觉审阅规则确认后接入。技术验收与实际交付独立记录，此前固定问卷实现不代表本ADR已完成。

## Context

用户需要自主解析录制并生成可重放技能的智能体，以及可打开文件夹直接编辑的本地维护方式。已有questions数组、程序固定补完成判断题及复杂工作流编辑/发布，不能满足该交互与维护模型。

扩展当前使用AI SDK、独立Host和Worker；Native v3只有有限Browser协议。项目有Skills发现机制，但没有浏览器本地技能文件服务；通用Agent核心保持受保护边界。

## Decisions

1. 组织者是模型自主选工具的有限Agent。只开放read_recording、ask_user_question、validate_skill、submit_skill；没有网页执行、Shell或任意文件权限。
2. ask_user_question采用assistant tool call与匹配tool result，允许对当前问题的受限自定义回答；不提供自由聊天，也不固定预设题目驱动任务。
3. 整理框架已明确采用 **AI SDK ToolLoopAgent**，复用现有依赖与模型适配。工具循环交给SDK，Agent Session保存任务消息、模型可展示思考、tool call/result、预算与产物；Worker/IndexedDB只承担会话存储和生命周期实现，下一次从原会话继续；不新增LangChain或自写通用Agent Loop。重放仍由Page Agent Core负责。依据见[成本收益评估](../poc/browser-skill-agent-framework-evaluation.md)，MV3会话继续及提供商兼容仍须在实施小样中验证。
4. Skill包包含SKILL.md（语义权威）和轻量workflow.json（输入/站点/运行契约）。不生成重复步骤DAG，不提供可独立维护的第二份工作流。
5. 文件库为定义权威；浏览器数据库保存受限任务、问题与缓存。打开目录和读写由受限本机服务承担，运行前重读文件，执行中固定快照。
6. 建议Executor承载文件服务、Main打开目录；模型与浏览器智能执行仍属于扩展。需拟定Native v4独立skills命令域，不能假定现有连接已有任意文件能力。
7. 用户已明确：重放不接入onAskUser或替代提问工具，一次运行只调用Page Agent Core原生execute，输入在执行前准备。中断后记录终态，不恢复原Core执行；明确再次运行时新建run。Organizer不执行录制中的业务动作；Browser Skill Runner作为业务适配层，使用 **@page-agent/core（Page Agent Core）** 驱动重放。模型推理与浏览器工具循环归Page Agent Core，不由整理侧AI SDK循环取代。具体页面控制继续使用PageController。生成通过不代表重放通过。
8. 可以共用模型配置、状态投影与日志；ask_user_question仅属于整理Agent，不在重放侧复用；框架适配、原始SDK会话和执行循环各自独立。用户2026-10-31明确重申Page Agent Core重放边界，“统一运行时”不作为本ADR的决定。

## Alternatives

| 方案                     | 优点                     | 未选原因                                                                   |
| ------------------------ | ------------------------ | -------------------------------------------------------------------------- |
| 纯Markdown Skill         | 维护最简单、易阅读       | 输入和站点硬边界不宜只靠文字                                               |
| 完整JSON工作流           | 容易形式校验             | 用户维护成本高，偏离技能维护目标                                           |
| 固定问题数组/问卷        | 接线简单                 | 问题顺序和业务分支由程序固定，缺少真正工具Agent闭环                        |
| 完整Pi coding-agent迁移  | 可提供更多通用Agent设施  | 首版不需要编码工具/插件生态，迁移与浏览器恢复成本较大                      |
| 扩展直接维护任意本地目录 | 降低Executor依赖的可能性 | 目录选择/授权持久化/系统文件夹打开需单独浏览器可行性验证，当前不宣称已支持 |

## Consequences and trade-offs

- 用户维护本地技能文件，产品不再要求逐步编辑/审批复杂工作流。
- 机器可校验输入与站点，但不能形式证明任意自然语言业务语义或真实执行成功。
- 本机组件使可靠读写和打开目录可控，同时首版保存/读取/运行依赖该组件；纯录制和分析仍可独立。
- 需要跨应用协议、保存回执与幂等恢复，不能把生成和落盘成功混为一谈。
- 模型工具调用、隐藏推理消息恢复和Page Agent版本兼容仍需技术小样与测试，不能用已有JSON编译实测代替。
- 原用户数据保留，新旧运行模型不长期并行；不自动覆盖手改Skill，不自动迁移/删除旧工作流。

## Validation and approval gate

详见[完整闭环方案](../architecture/browser-recording-skill-agent.md)。依次验收工具Agent、生成与文件提交、手工编辑加载、跨Tab重放与结果；真实提供商测试另获次数授权。本ADR已获批准并进入设计/开发；重大UI变更按根AGENTS的既有规则先出稿并审阅，独立后台工作已获实施授权。

## 会话模型澄清（2026-10-31）

用户明确要求完整的有限Agent会话：记录模型实际返回的可展示思考、主动工具调用、用户对工具问题的回答和产物，下次基于原会话继续。等待用户只是尚未取得tool result的会话状态；不另造独立的问卷暂停/恢复模型。限制工具与自由输入，不限制自主工具选择。整理会话由ToolLoopAgent执行并支持基于记录继续。重放按用户后续收敛使用Page Agent Core单次execute，仅保存运行记录，不提供运行中提问或原执行恢复；二者不混用原始SDK消息。
