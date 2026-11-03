# settings-extensions：概念验证与验收

架构设计：[原设计](../architecture/settings-extensions.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 15. 验证矩阵

### 15.1 Pi 契约

- string `PackageSource` 转 object 后 source identity 不变；
- omit、`[]`、plain include、`!`、`+`、`-` 和 `autoload:false` fixture；
- `-path` 胜过 `+path`；
- Web mutation 结果可被 Pi v0.84.3 `resolve()` 正确读取；
- Pi `pi config` 产生的状态能被 Web 正确解释；
- resolve 使用 missing=>skip，不发生安装或网络写入。

### 15.2 字段保留

- skills/prompts/themes/autoload 保持 byte-equivalent JSON value；
- PackageSource unknown fields 保留；
- 非目标 Package 顺序和内容保留；
- 非目标 Extension filter 保留；
- reset 只移除目标精确 `+/-`，保留 structural filters；
- malformed settings 拒绝覆盖。

### 15.3 单项和批量

- default→enabled、default→disabled、enabled↔disabled、override→default；
- default-disabled 与 explicit-disabled 可区分；
- mixed/all enabled/all disabled summary；
- batch 一次写入且与逐项最终状态等价；
- package update 导致资源集合变化时返回 409；
- 相同请求幂等；写后不一致不报告成功。

### 15.4 边界

- missing、invalid、duplicate、empty Package；
- npm、git、local source；
- path traversal、absolute path、separator/case alias；
- 100 Package/1000 Extension 上限；
- top-level、project、temporary 和 hidden inline extension 不进入列表。

### 15.5 生命周期与依赖

- 当前 Runtime 不热变更；
- mutation 响应始终给出 restart effect；
- 唯一提供默认 Provider 的 Extension 禁用被阻止；
- 多来源 Provider 不误阻止；
- provenance 未知返回 warning，不猜测；
- replacement 成功后可重试禁用。

### 15.6 Web

- 搜索、筛选、分页、折叠和移动端 Action Sheet；
- 三种 configuration 与 effective enabled 组合展示正确；
- loading、empty、missing、invalid、conflict、success 状态；
- switch label、keyboard、focus return 和错误关联满足可访问性要求；
- 不出现“已停止运行”等错误生命周期文案。
