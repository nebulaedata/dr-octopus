# browser-extension-recorder：概念验证与验收

> 历史计划与验证语境；原日期、结果和未执行项保留，不作为当前 Skill Agent 的完整验收要求。当前契约见[统一方案](../architecture/browser-skill-unified-agent.md)，当前进度见[验证矩阵](executor-validation.md)。
历史来源索引：[原设计](../architecture/browser-extension-recorder.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

### 核心测试矩阵（计划验收，当前均未验证）

| 测试                     | 期望                                                     |
| ------------------------ | -------------------------------------------------------- |
| Popup 关闭，用户继续录制 | 录制持续；状态条可停；已 ACK 事件可恢复，尾批次缺口可见  |
| Chrome SW 空闲后被回收   | 事件 listener 恢复，存储状态正确                         |
| 网页打开新 Tab 进行查询  | 关联为相关新 Tab，不误录两个独立打开动作                 |
| 用户切换到无关 Tab       | 根据录制范围决定是否纳入，禁止默默抓取其他窗口           |
| 输入密码、验证码         | 不持久化原值，不发送编译模型；执行前人工处理，运行中遇到则结束本次run               |
| 模型漏掉订单号参数       | 审阅/Schema 与来源一致性检查阻止静默发布                 |
| Page Agent 遇到未提供的必需信息 | 结束本次运行，不调用问答工具                      |
| 页面结构/按钮文字变化    | Page Agent 按语义寻找，有限重试，后置结果再校验          |
| Host 被用户关闭          | 标记 interrupted，不能谎称继续运行                       |
| 订单提交后网络断开       | 先验收或查重，禁止自动无条件再次提交                     |
| 浏览器地址栏导航         | 记录最终导航（可附来源 qualifier），不宣称能记录逐键输入 |
| 受限 Chrome 原生界面     | 提示不支持，而不是编造操作步骤                           |


## 恢复录制与批次游标回归（2026-11-04）

本次修复两项已通过源码方法探针确认的问题：从 Popup/其他页面恢复时，本页可恢复 error 未清除而阻止采集；尾批次已提交但 ACK 未收到时，恢复后新事件复用旧批次号而被当作重复确认。

- 恢复到 recording 的新 epoch 先通过 recorder.hello 获取当前文档的 lastBatch，握手完成前保持采集停止。游标在启动监听前写入，只在已确认的新录制 epoch 清除可恢复错误。
- epoch 切换废弃旧 pending、发送计时器和旧缓冲，并更新发送 generation；旧 ACK、失败和 finally 均不得清理新 epoch 的事件或发送 Promise。Worker 保留原有事务提交后 ACK 和去重契约，不重置持久批次号。
- 新增三项确定性 Content 回归：Popup 恢复清除 delivery/overflow 错误；丢 ACK 后恢复从已提交游标的下一批发送且旧完成不清理新数据；握手完成之前监听不启动。
- 聚焦 Content/Worker 回归 38/38 通过；补充握手等待用例后扩展全量 171/171 通过。扩展 lint、typecheck 和 Chrome/Edge build 均通过，git diff --check 通过。
- 回归调用真实生产 Content/Worker 代码；Content 测试替换 UI 渲染和消息完成时序。未执行真实浏览器 ACK 丢失故障注入或商店发行验收，不能将构建与确定性测试解释为这些验收完成。
- 本地原始日志：.cache/recorder-resume-tests.log、.cache/recorder-resume-final-tests.log、.cache/recorder-resume-build.log；日志不提交。
