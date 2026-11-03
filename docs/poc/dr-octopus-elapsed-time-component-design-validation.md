# dr-octopus-elapsed-time-component-design：概念验证与验收

架构设计：[原设计](../architecture/dr-octopus-elapsed-time-component-design.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 17. 测试要求

遵循仓库惯例：`node:test` + `node:assert/strict`，文件命名
`test/*.test.mjs`，经 `node --import tsx --test` 直接引
`../src/**/*.ts`。测试文件同样带 JSDoc 头（`@author` + `@description`）。

### PreciseClock（注入 now，不依赖真实时间）

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { PreciseClock } from '../src/components/elapsed-time/precise-clock.ts';

// 基础：start(500) 后推进 500ms → 1000
// 卡顿不漂移：两次回调间隔 5000ms，elapsedMs 仍 = 5100
// sync 重锚定：start(1000) → +500 → sync(1600) → +200 → 1800
// stop 冻结：stop(1520) 后推进任意时间仍为 1520
```

### formatDuration

至少覆盖边界：`0ms`、`999ms`、`1000ms`、`59.9s`、`60s`、`1h+`，
以及 `compact` 与 `clock` 两种格式的既有行为快照（防迁移回归）。

---
