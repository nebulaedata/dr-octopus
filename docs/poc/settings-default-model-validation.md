# settings-default-model：概念验证与验收

架构设计：[原设计](../architecture/settings-default-model.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 14. 验证矩阵

### 14.1 Repository 与 Pi 契约

- `projectTrusted:false` 时 project default 不覆盖 global default；
- `setDefaultModelAndProvider()` + `flush()` 成对持久化；
- 其他 user settings 字段和未知字段保留；
- `drainErrors()` 被检查并转换为领域错误；
- settings.json malformed 时拒绝覆盖；
- 相同 PUT 幂等；并发写后返回实际 pair。

### 14.2 状态

- unset、ready、provider missing、model missing、auth required、runtime degraded；
- 动态 catalog 暂时缺失后恢复为 ready；
- credential 移除不清空 configured pair；
- Provider 恢复后不需要重新保存默认项。

### 14.3 Session 语义

- 当前 Session 不切换；
- 新 Session 优先全局默认；
- 默认项不可用时 Pi 临时 fallback 且不改写 settings.json；
- 恢复 Session 优先自己的模型；
- Session 手工切换不修改全局默认。

### 14.4 依赖保护

- 删除默认 Provider/Model 被 409 阻止；
- reset overlay 只在候选配置仍有默认 Model 时允许；
- 禁用唯一提供者 Extension 被阻止；
- logout 允许但返回影响警告；
- replacement PUT 失败时不执行删除；
- replacement 成功、删除失败时返回安全部分成功且不回滚默认项。

### 14.5 Web

- ready 以外候选不可保存并显示修复动作；
- 缺失默认项仍展示原始 pair；
- 搜索、分页、Provider 分组和移动端 Sheet；
- 保存反馈准确说明“新 Session 生效”；
- 键盘、焦点、加载、空态、错误和 retry 状态完整。
