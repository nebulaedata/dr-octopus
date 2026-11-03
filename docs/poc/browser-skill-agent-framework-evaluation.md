# 浏览器整理 Agent 框架成本收益评估

> **当前结论更新（2026-10-31）：** 用户已确认整理和重放统一 ToolLoopAgent，见[设计开发方案](../architecture/browser-skill-unified-agent.md)与 [ADR-0089](../adr/0089-browser-skill-unified-agent.md)。以下是此前仅评估整理框架的历史比较；“重放继续 Page Agent Core”已失效，不是当前选型。公共会话机制收益成立，但浏览器规划/观察/结果核对由应用承担，尚无包体、费用或真实重放成功率提升的实测结论。

> 2026-10-31 · Proposed。仅评估整理 Agent；重放已明确使用 @page-agent/core。本轮没有安装框架、编写技术小样、生成视觉稿或调用真实模型。费用、包体和耗时没有实测数字，以下成本等级是针对当前项目的工程判断。

## 结论

2026-10-31用户明确倾向ToolLoopAgent，本轮选型收敛为：**整理采用AI SDK ToolLoopAgent，重放继续使用Page Agent Core**。优先复用当前SDK、模型适配和有限工具集，减少新的框架/消息体系迁移。不安装LangChain或维持双Organizer生产路径。

此前曾建议优先验证createAgent，以下LangChain能力与成本对比保留为选择依据，不再是当前实施方向。ToolLoopAgent的“较轻”指相对当前项目的增量依赖和迁移范围较小，不是已经实测的bundle或性能结论。

该框架选择不等于完整架构、界面或实施已获批准；下一步仍先收束闭环方案。Agent Session负责过程记录与上下文连续性；应用提供该会话的存储、权限与预算。不能把Host重建包装成独立的业务问卷暂停/恢复流程，也不能假定SDK对象自动持久保存。

## 1. 评估基线

- 本地扩展package.json固定ai@7.0.155和@ai-sdk/openai-compatible@3.0.80。
- 已安装ai的公开声明含ToolLoopAgent、tools、工具并发/停止控制、外部工具结果相关类型；已有compileWorkflow仍是一次结构化结果调用。
- 当前持久数据由Worker/IndexedDB持有，模型在独立Extension Agent Host中运行。
- 本机文件交互计划由Executor承载，Executor不运行模型；重放继续采用Page Agent Core。
- 用户界面不得变为自由聊天，也不因框架存在审批组件就退回固定问卷。

## 2. 官方能力与本项目判断

| 方案                                    | 已核对的相关能力                                                | 本项目收益                                          | 本项目新增成本                                                 | 建议               |
| --------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------- | ------------------ |
| LangChain createAgent + LangGraph持久化 | 工具Agent循环、middleware、checkpointer、人工中断/回复          | 把提问等待与继续纳入框架生命周期，减少自写Agent编排 | 新模型适配与消息类型；本地持久checkpointer；MV3/Host验证       | 比较方案，当前未选 |
| AI SDK ToolLoopAgent                    | 工具循环、停止条件、现有提供商适配；工具execute可省略以外部处理 | 复用当前依赖与模型传输，迁移量最少                  | 继续对接外部问题、tool result和IndexedDB恢复；不是零持久化工作 | 已选整理框架       |
| 直接LangGraph StateGraph                | 状态图、interrupt、checkpoint与恢复                             | 能精确定义多业务分支                                | 首版四个工具不需要自己维护完整业务图和节点                     | 暂不优先           |
| AI SDK WorkflowAgent                    | 基于Workflow运行时的持久Agent                                   | 对服务端持久工作流有价值                            | 另引入Workflow运行环境，不是现有扩展Host直接替换               | 当前不优先         |

表中相对成本：ToolLoopAgent低～中；createAgent中～高；裸LangGraph与迁移Workflow运行环境高。不是报价或工期承诺，不能直接换算成包体MB、开发天数或模型费用。

项目其他Host已有Pi使用经验，但这不等于可把编码Agent移入浏览器。Pi Agent/Harness如进入候选，还需单独核对当前版本的浏览器依赖、持久化和恢复；不因仓库使用Pi就绕过最小依赖判断。

## 3. LangChain对本需求的具体价值（保留比较）

用户需求的难点是“问完问题能够结束本轮Host，并在重新创建后继续”，不只是注册四个函数。

当前官方HITL文档提供respond决定：把用户答案作为提问工具的结果返回，并跳过该工具的普通执行。这比将问题误实现为approve/reject更贴近ask_user_question。锁定版本后须在实际安装包类型中核对respond及对应响应Schema，滚动文档不能代替版本验证。

LangChain方案曾评估的接线：

1. 用createAgent注册四个受限工具，让模型决定是否问人；
2. 仅对ask_user_question配置对应respond中断机制，具体工具权限仍由应用检查；
3. 用持久checkpointer保存thread及中断状态；
4. Worker保存可展示的问题投影，Popup提交带身份/版本的答案；
5. 重建同一任务Agent，从同一thread恢复并返回回答；
6. 模型继续读录制、验证或提交Skill，不由程序指定下一道业务题。

如选定版本没有合适respond能力，可在这个工具中适配LangGraph interrupt/Command.resume，但应只有一套暂停机制，不能同时维护两份独立会话状态。

仅在上述未采用的LangChain方案中，Graph checkpoint为Agent执行状态的权威，应用任务表只保留taskId/threadId、状态投影、预算、文件操作回执等业务数据；不要再复制另一份可独立编辑的messages/工具历史。Skill文件继续是最终技能定义权威。

## 4. 无法由框架省掉的工作

- read_recording、validate_skill、submit_skill的业务逻辑和安全边界；
- 技能两文件的一致性、来源与范围校验；
- 文件保存的幂等回执、同名保护和本机目录权限；
- Popup关闭、Host退出、Worker回收与连接身份管理；
- 密钥只在请求期存在，不能放入checkpoint、图state或追踪metadata；
- 真实模型问题质量、技能质量及Page Agent Core重放验证。

createAgent不要求自由聊天界面；UI只开放任务入口和当前问题回答即可。框架不会自动理解“成功”或减少模型费用；要按真实请求/工具调用计预算，不能拿图递归深度直接替代收费请求数。

## 5. 最大成本：本地持久化与MV3

MemorySaver/InMemorySaver只保存在内存，不能证明浏览器或Host重启后仍能恢复。官方持久化文档中的数据库/Agent Server方案不直接等于我们已有的浏览器IndexedDB集成。

LangChain比较方案需要验证自定义checkpointer能经Worker访问现有IndexedDB。当前已选ToolLoopAgent执行Agent Session；会话记录任务、可展示思考、工具调用/结果和预算，经Worker/IndexedDB保存，下次从该会话继续。对checkpoint、pending writes、序列化、线程身份、版本与清理进行契约测试；不在Host里开第二份有不同生命周期的权威数据库。

MV3要实际检查：

- WXT Chrome/Edge打包及无Node专属导入问题；
- 浏览器CSP内正常执行，不依赖动态eval或远程代码；
- 人工中断后Host完全释放，重建不丢tool call身份；
- API Key/认证头不进入序列化状态或错误日志；
- 关闭/重复回答/取消后没有额外模型请求；
- checkpoint保留上限、内容大小与旧版本状态诊断。

不能凭“JavaScript SDK”断言MV3兼容，也不能未经测量声称LangChain包体太大。小样要报告相同工具集合下的实际打包体积、模块依赖和启动开销，再判断是否接受。

## 6. 中断与副作用

LangGraph interrupt恢复可能从节点开头重新执行，不能把“已有checkpoint”理解为所有副作用自动恰好一次。

ask_user_question所在路径在中断前应只做可重复的验证/状态读取。submit_skill必须保留operationId及文件回执；反复恢复不能再次覆盖文件。对未知网络结果仍采用显式恢复策略，不依赖框架自动重跑推断安全。

AI SDK外部工具结果路径也需要幂等提交和重建测试；框架差异不会取消这些边界。

## 7. 提供商迁移成本

若选createAgent，生成Agent应有一套明确的模型适配：

- 外部配置字段仍复用provider/baseUrl/model/API Key保存方式；
- LangChain适配器负责实际模型调用，验证现有OpenAI兼容服务的工具调用；
- 保留禁自动请求重试、响应体限制、重定向策略、取消和安全错误投影；
- 原AI SDK可继续服务已独立的连接测试，不能在同一Agent循环里来回转换两套消息来“复用”；
- 默认不启用云追踪或引入LangSmith服务依赖，先保留本地脱敏事件。

真实提供商若不支持tool calling，换框架不能修复该能力缺口。额外真实模型验证仍需单独申请次数。

## 8. PoC验收与选择门槛（方案通过后再实施）

对已选ToolLoopAgent使用四个工具、合成录制和受控模型，验证：

1. 模型自主调用read→ask→validate→submit，零问题时直接产出；
2. 提问后关闭Popup、销毁Host，再返回原问题并恢复正确tool result；
3. Worker中断、重复回答、过期回答和取消；
4. 多工具并发返回只按业务约束处理，不重复问题或文件写入；
5. 配置/授权变化、模型超时、非法工具名/参数及调用预算；
6. 恢复前后模型请求数、实际bundle和Node依赖情况；
7. Skill落盘只发生一次，Page Agent Core边界不受影响。

验收通过后采用ToolLoopAgent接入整理；如发现阻塞问题，先评估现有SDK适配，不自动切换框架或把模型迁到Executor。确需改变已选框架时另行讨论，不并行维护两套生产Organizer。

本轮未运行这个PoC，不能报告框架兼容性、性能或节省工期已经实测。界面仍待完整方案确定后再设计。

## 官方核对来源

访问日期：2026-10-31。以下为能力来源，工程取舍为本项目判断：

- LangChain Agents：https://docs.langchain.com/oss/javascript/langchain/agents
- HITL / respond：https://docs.langchain.com/oss/javascript/langchain/human-in-the-loop
- LangGraph interrupts：https://docs.langchain.com/oss/javascript/langgraph/interrupts
- LangGraph persistence：https://docs.langchain.com/oss/javascript/langgraph/persistence
- AI SDK ToolLoopAgent：https://ai-sdk.dev/docs/agents/building-agents
- AI SDK外部工具执行：https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling
- AI SDK WorkflowAgent：https://ai-sdk.dev/docs/agents/workflow-agent
