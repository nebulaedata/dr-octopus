# 通用精确计时组件设计与开发指南

> 修订版 v2：与 Dr.Octopus 现有代码现状对齐。
> v1 为独立设计，未考虑本项目既有的服务端时钟域投影模型；本版以现状审计为起点。

## 1. 目标

在 Dr.Octopus 中封装一套业务无关的精确计时能力，覆盖：

- Turn 总运行时间（`TurnDurationMarker`）
- Thinking 时间（`MessageProjection.thinkingStartedAt/EndedAt`）
- Tool Call 时间（`ToolProjection.startedAt/endedAt`）
- Compaction / AutoRetry 时间
- Subagent Fleet 节点时间（`SubagentFleetNodeDto`）
- 后台任务时间（`BackgroundTaskDto.createdAt/endedAt`）
- 纯客户端计时（重连等待、Server 重启倒计时等）

统一使用公共组件：

```tsx
<ElapsedTime elapsedMs={elapsedMs} running={running} />
```

核心原则：

```text
Server 时钟域 = 权威时间源
performance.now() = 前端插值时间源
Timer = 纯 UI 刷新器，不参与计时
ElapsedTime = 通用展示组件，只认 elapsedMs + running
```

---

## 2. 现状审计（修订依据）

### 2.1 现有计时数据模型：服务端时钟域

本项目所有运行时投影的时间字段均来自服务端事件信封
`HostEventEnvelope.timestamp`（ISO 字符串，服务端盖戳，见
`packages/shared/src/protocol/realtime.ts`），经
`apps/web/src/stores/session/reducers/session-reducer.ts` 的 `resolveTimestamp()` 解析：

| 投影 | 时间字段 | 时钟域 |
| ---- | -------- | ------ |
| `TurnProjection` | `startedAt` / `endedAt` | Server |
| `ToolProjection` | `startedAt` / `endedAt` | Server |
| `CompactionProjection` | `startedAt` / `endedAt` | Server |
| `AutoRetryProjection` | `scheduledAt` / `endedAt` | Server |
| `MessageProjection` | `thinkingStartedAt` / `thinkingEndedAt` | Server |
| `SubagentFleetNodeDto` | `startedAt` / `updatedAt` / `endedAt`（+ 快照 `generatedAt`） | Server |
| `BackgroundTaskDto` | `createdAt` / `endedAt` | Server |

**关键结论：所有 startedAt/endedAt 同属服务端一个时钟域，域内减法
（`endedAt - startedAt`）天然合法。** v1 文档第 23 节"不要把 startedAt
从 Server 发给 Browser"对本项目不适用，予以修正（见第 9 节）。

### 2.2 现有计时 UI 审计

| 组件 | 机制 | 问题 |
| ---- | ---- | ---- |
| `TurnDurationMarker` | ahooks `useInterval` 每秒重渲染，`endedAt - startedAt` 重算 | **不漂移**（v1 误判，予以更正）；但 running 时 `Date.now() - startedAt` 混用了客户端 wall clock 与服务端时钟域 |
| `ReconnectingStatus` | `useInterval` 每秒 `current + 1` 累积 | **真漂移源**：后台标签页节流时少计；纯客户端计时，无 Server 权威 |
| `SubagentFleetPanel` | `resolveNodeDuration` 从快照时间戳静态计算 | 无 ticking；快照 revision 刷新时已天然重同步 |
| `ServerRestart` | 一次性 `Date.now() - startedAt` | 纯客户端场景，低优先级 |

### 2.3 现有格式化函数

- `apps/web/src/utils/duration.ts`：`formatDuration` 输出 `1h 2m 3s`（compact 风格）
- `ReconnectingStatus` 内部：`formatElapsedTime` 输出 `hh:mm:ss`（clock 风格）

两套实现需收敛到公共包（见第 8 节）。

---

## 3. 包与目录

新增独立包 `packages/custom-ui`，专放自定义公共组件（shadcn 官方组件仍装
入 `packages/ui`，本包不受其"禁止直接编辑 components/"约束）：

```text
packages/custom-ui/
├── package.json            # name: @octopus/custom-ui
├── tsconfig.json           # 镜像 packages/ui 配置
├── eslint.config.js        # 镜像 packages/ui 配置
├── src/
│   └── components/
│       └── elapsed-time/
│           ├── elapsed-time.tsx
│           ├── use-precise-elapsed-time.ts
│           ├── use-elapsed-motion-value.ts
│           ├── precise-clock.ts
│           ├── format-duration.ts
│           ├── types.ts
│           └── index.ts
└── test/
    ├── precise-clock.test.mjs
    └── format-duration.test.mjs
```

`package.json` 要点（源码直出、无构建步骤，对齐 `packages/ui`）：

```jsonc
{
  "name": "@octopus/custom-ui",
  "type": "module",
  "private": true,
  "exports": {
    "./components/elapsed-time": "./src/components/elapsed-time/index.ts"
  },
  "scripts": {
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test test/*.test.mjs",
    "format": "prettier --write \"**/*.{ts,tsx}\""
  },
  "dependencies": {
    "@octopus/ui": "workspace:*",
    "motion": "^12",
    "react": "^19.2.6",
    "react-dom": "^19.2.6"
  },
  "devDependencies": {
    "tsx": "^4"
  }
}
```

说明：

- 依赖 `@octopus/ui` 仅为复用 `cn`（`@octopus/ui/lib/utils`）；依赖方向
  `custom-ui → ui` 单向，无环。
- `motion` 为新增共享依赖，仅 `use-elapsed-motion-value.ts` 使用；
  `ElapsedTime` 本体不依赖它。
- 测试用 `node --import tsx --test` 直接引 `../src/**/*.ts`（对齐
  `apps/cli` 模式），免构建。
- 根 `AGENTS.md` 的项目索引表需新增 `packages/custom-ui/` 一行。

业务代码使用：

```tsx
import { ElapsedTime } from '@octopus/custom-ui/components/elapsed-time';
```

---

## 4. Props 设计

```ts
export interface ElapsedTimeProps {
  /**
   * 权威耗时快照（毫秒）。
   * Server 时钟域场景：最近一次同步点的耗时；
   * 客户端权威场景：起始偏移（通常为 0）。
   */
  elapsedMs: number;

  /**
   * 当前是否仍在运行。false 时冻结并精确显示 elapsedMs。
   */
  running: boolean;

  /**
   * UI 文本刷新周期，默认 100ms。
   * 只控制刷新频率，不影响计时精度。
   * 秒级粒度展示（如 compact 格式）应传 1000。
   */
  refreshMs?: number;

  /**
   * 输出格式，默认 "auto"。
   */
  format?: 'auto' | 'seconds' | 'milliseconds' | 'clock' | 'compact';

  className?: string;

  /**
   * 自定义渲染。提供时接管全部输出。
   */
  children?: (elapsedMs: number) => React.ReactNode;
}
```

不提供名为 `interval` 的 API，避免误导开发者认为 interval 决定计时精度。

---

## 5. 核心 PreciseClock

```ts
export type ClockNow = () => number;

export class PreciseClock {
  private baseElapsedMs = 0;
  private anchorMs = 0;
  private running = false;

  constructor(private readonly now: ClockNow = () => performance.now()) {}

  start(elapsedMs = 0): void {
    this.baseElapsedMs = elapsedMs;
    this.anchorMs = this.now();
    this.running = true;
  }

  sync(elapsedMs: number): void {
    this.baseElapsedMs = elapsedMs;
    this.anchorMs = this.now();
  }

  stop(elapsedMs?: number): void {
    if (elapsedMs !== undefined) {
      this.baseElapsedMs = elapsedMs;
    } else if (this.running) {
      this.baseElapsedMs = this.elapsedMs;
    }
    this.running = false;
  }

  reset(): void {
    this.baseElapsedMs = 0;
    this.anchorMs = 0;
    this.running = false;
  }

  get elapsedMs(): number {
    if (!this.running) {
      return this.baseElapsedMs;
    }
    return this.baseElapsedMs + this.now() - this.anchorMs;
  }
}
```

- `baseElapsedMs`：最近一次同步点的权威耗时。
- `anchorMs`：收到同步值时本地的 `performance.now()`。
- 当前值永远通过 `baseElapsedMs + performance.now() - anchorMs` 计算，
  **绝对禁止** `elapsed += refreshMs` 式累积。
- constructor 注入 `now`，单元测试不依赖真实系统时间。
- 仅在 effect / 事件 / 方法内读取 `performance.now()`，模块顶层禁止
  （SSR 安全）。

---

## 6. usePreciseElapsedTime

业务层主要复用的 Hook。相对 v1 增加**运行期显示单调性钳制**（防止
Server 重同步或乱序事件导致文本倒退跳变）：

```ts
export function usePreciseElapsedTime({
  elapsedMs,
  running,
  refreshMs = 100,
}: UsePreciseElapsedTimeOptions): number {
  const clockRef = useRef<PreciseClock | null>(null);
  if (!clockRef.current) {
    clockRef.current = new PreciseClock();
  }
  const clock = clockRef.current;

  const [displayElapsed, setDisplayElapsed] = useState(elapsedMs);
  const lastDisplayRef = useRef(elapsedMs);

  useEffect(() => {
    if (!running) {
      // 终值服从 Server，允许回退（权威性优先于单调性）。
      clock.stop(elapsedMs);
      lastDisplayRef.current = elapsedMs;
      setDisplayElapsed(elapsedMs);
      return;
    }

    if (!wasRunningRef.current) {
      wasRunningRef.current = true;
      lastDisplayRef.current = elapsedMs;
      clock.start(elapsedMs); // 上升沿必须 start：sync 只重锚定，不置 running
    } else {
      clock.sync(elapsedMs);
    }

    let timeout: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const update = () => {
      if (cancelled) {
        return;
      }
      // 运行期单调钳制：重同步回拨不向前倒退显示。
      const next = Math.max(lastDisplayRef.current, clock.elapsedMs);
      lastDisplayRef.current = next;
      setDisplayElapsed(next);
      timeout = setTimeout(update, refreshMs);
    };

    update();

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [clock, elapsedMs, running, refreshMs]);

  return displayElapsed;
}
```

要点：

- `setTimeout` 只决定"什么时候刷新 UI"，不决定"过去了多长时间"，
  执行抖动（100ms / 280ms / 100ms）不会造成时间漂移。
- `elapsedMs` 变化（Server 重同步）时 effect 重跑并重新锚定。
- 可选优化：重同步时若 `|新 base - 当前插值| < 250ms` 可忽略本次 sync，
  避免可见抖动（实现时评估，非必须）。
- React Compiler 负责性能记忆化，不为性能手写 `useMemo`/`useCallback`。

---

## 7. ElapsedTime 组件

```tsx
export function ElapsedTime({
  elapsedMs,
  running,
  refreshMs = 100,
  format = 'auto',
  className,
  children,
}: ElapsedTimeProps) {
  const current = usePreciseElapsedTime({ elapsedMs, running, refreshMs });

  if (children) {
    return <>{children(current)}</>;
  }

  return (
    <span className={cn('tabular-nums', className)}>
      {formatDuration(current, format)}
    </span>
  );
}
```

必须使用 `tabular-nums`，避免 `9.9s → 10.0s` 数字宽度变化导致布局抖动。

---

## 8. formatDuration（收敛现有两套实现）

统一为公共包内单一实现，吸收 `apps/web/src/utils/duration.ts` 与
`ReconnectingStatus.formatElapsedTime`：

```ts
export type DurationFormat =
  | 'auto'
  | 'seconds'
  | 'milliseconds'
  | 'clock'
  | 'compact';

export function formatDuration(
  elapsedMs: number,
  format: DurationFormat = 'auto',
): string {
  const value = Math.max(0, elapsedMs);

  switch (format) {
    case 'milliseconds':
      return `${Math.round(value)}ms`;
    case 'seconds':
      return `${(value / 1000).toFixed(1)}s`;
    case 'clock':
      return formatClock(value); // m:ss，超 1h 为 h:mm:ss，宽度固定
    case 'compact':
      return formatCompact(value); // 现有 "1h 2m 3s" 行为原样保留
    case 'auto':
    default:
      break;
  }

  if (value < 1000) {
    return `${Math.round(value)}ms`;
  }
  if (value < 60_000) {
    return `${(value / 1000).toFixed(1)}s`;
  }
  return formatClock(value);
}
```

- `compact` = 现有 `apps/web/src/utils/duration.ts` 行为（至少 1s、
  `1h 2m 3s`），迁移后 `TurnDurationMarker` 视觉不变。
- `clock` 固定宽度（`m:ss` / `h:mm:ss`），供 `ReconnectingStatus` 迁移。
- `auto` 示例：`683 → 683ms`，`2384 → 2.4s`，`18243 → 18.2s`，
  `73480 → 1:13`。
- 迁移完成后删除 `apps/web/src/utils/duration.ts`，调用方改从
  `@octopus/custom-ui/components/elapsed-time` 导入。

---

## 9. Server 时钟域同步模型（对 v1 第 17–23 节的修正）

### 9.1 修正：startedAt 可以发，禁止的是跨时钟域混算

本项目所有 startedAt/endedAt 同属 Server 时钟域，域内减法合法，且
startedAt 对持久化转录（刷新后重建）是必需的。真正必须禁止的只有：

```ts
// 禁止：客户端 wall clock 减服务端时间戳（跨时钟域）
elapsed = Date.now() - serverStartedAt;
```

`TurnDurationMarker` 当前 running 分支正是这个错误，本次修复。

### 9.2 核心洞察：事件流时间戳即天然同步信号

现有事件流中每个 `HostEventEnvelope` 都带服务端 `timestamp`，
**这就是现成的 `timing.sync`，无需新增高频推送通道，也无需 Server
周期性发送 elapsed**。

约定（需要 reducer 小幅改动）：

1. Session Store 增加 `lastServerTimestamp: number`，reducer 每处理一个
   事件信封即更新（所有事件路径已有 `resolveTimestamp(eventTimestamp)`，
   改动集中）。
2. Selector 推导各 running 投影的权威耗时快照：

   ```ts
   // running：最近一次服务端事件时间 - 起点
   selectTurnElapsedMs(state, turnId) =>
     (turn.endedAt ?? state.lastServerTimestamp) - turn.startedAt;
   ```

   Store 只在事件到达时更新（started / 各事件 / completed），
   **绝不每 100ms 写入**。
3. UI 把该快照交给 `<ElapsedTime>`，组件内部用 `performance.now()`
   前推插值。下一个事件到达 → store 更新 → `elapsedMs` prop 变化 →
   Clock 重新锚定。

### 9.3 静默期不影响精度

长 Tool Call 期间可能数分钟无事件、无重锚定。这**不是问题**：插值误
差只取决于两端晶振速率差（ppm 量级，分钟级误差 < 1ms），远小于
100ms 显示粒度。重锚定的意义是修正偶发偏差，不是维持精度。

### 9.4 Server 侧职责

- 继续以现有事件信封 `timestamp` 提供时钟域基准，无需新增机制。
- 终值权威性：completed/failed/cancelled 事件的 `timestamp` 决定
  `endedAt`，进而决定最终 `elapsedMs = endedAt - startedAt`。
  **运行期间前端插值，结束之后必须精确显示 Server 终值**（允许从
  插值回退到终值，见第 6 节）。
- Server 内部如需测量耗时，使用 `process.hrtime.bigint()`；但这是
  Server 实现细节，协议层只暴露时钟域时间戳，本方案不绑定具体实现。

---

## 10. 刷新 / 重连恢复协议（新增）

问题：页面刷新或断线重连后，客户端通过 `SessionSnapshotDto` 水合投影。
running 中的投影只有 `startedAt`，而快照 DTO 目前**没有**顶层服务端
时间，`lastServerTimestamp` 无从 seed，插值会停滞或退化为跨域混算。

约定：

1. **协议补充**：`SessionSnapshotDto` 增加 `generatedAt: number`
   （Server epoch ms，快照生成时刻）。`SubagentFleetSnapshotDto.generatedAt`
   已有同名字段，是现成范本；apps/server 水合出口填充。
2. **水合规则**：`lastServerTimestamp` 初始值 =
   `snapshot.generatedAt`，缺省时（旧 Server）回退为
   `max(messages[*].timestamp ?? persistedAt)`。
3. **自愈**：重连后第一条实时事件到达即重新锚定，回退值的偏差自动
   消除。
4. 后台标签页场景无需特殊处理：timer 被节流期间 UI 暂停刷新，但
   恢复后按 `base + performance.now() - anchor` 一次算清，显示直接
   跳到正确值（如 3.2s → 23.2s），不需要 `worker-timers`。

---

## 11. 客户端权威模式

`ReconnectingStatus`、`ServerRestart` 等场景没有 Server 参与，权威即
客户端自身。同一 Hook 直接覆盖：

```tsx
const elapsed = usePreciseElapsedTime({
  elapsedMs: 0,
  running: true,
  refreshMs: 1000,
});
// formatDuration(elapsed, 'clock') → 0:07
```

挂载即锚定 `performance.now()`，从 0 前推。即使回调被节流（后台标
签页），显示值仍然准确——这同时修掉了 `ReconnectingStatus` 现有
`current + 1` 累积在节流时少计的缺陷。

---

## 12. 平滑动画：useElapsedMotionValue

文本刷新（约 10 FPS）与高频动画（rAF）职责分离，不合并成 60 FPS
React Timer。动画场景不要 `usePreciseElapsedTime` 驱动 React State，
改用 MotionValue 直写 DOM。

**对 v1 的修正：必须复用 `PreciseClock`，不内联重写插值逻辑**
（v1 第 28 节架构图画了两条路径共用 Clock，第 11 节实现却另写一套，
本版统一）：

```ts
export function useElapsedMotionValue({
  elapsedMs,
  running,
}: UseElapsedMotionValueOptions): MotionValue<number> {
  const value = useMotionValue(elapsedMs);
  const clockRef = useRef<PreciseClock | null>(null);
  if (!clockRef.current) {
    clockRef.current = new PreciseClock();
  }
  const clock = clockRef.current;

  useEffect(() => {
    if (!running) {
      clock.stop(elapsedMs);
      value.set(elapsedMs);
      return;
    }

    if (!wasRunningRef.current) {
      wasRunningRef.current = true;
      clock.start(elapsedMs); // 同上：上升沿 start，后续 sync
    } else {
      clock.sync(elapsedMs);
    }
    value.set(clock.elapsedMs);

    let raf = 0;
    const frame = () => {
      value.set(clock.elapsedMs);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => cancelAnimationFrame(raf);
  }, [clock, elapsedMs, running, value]);

  return value;
}
```

```text
performance.now() → PreciseClock → rAF → MotionValue → DOM
（不触发 React render）
```

运行中对流式值做单调钳制（与 `usePreciseElapsedTime` 同一契约）：过期的
权威重同步不会让动画倒转；新鲜运行起点重置基线，`running` 翻 false 时
精确采纳最终权威值，即使这意味着回退。

依赖 `motion`（`useMotionValue` 来自 `motion/react`），已在第 3 节
`package.json` 中声明为 `@octopus/custom-ui` 的 dependency。

### 12.1 ElapsedOdometer（里程表）

`useElapsedMotionValue` 的首个消费方：以整秒格式（`42s`）把耗时渲染为机
械里程表。所有数字列采用阶梯滚动——统一在每个进位前最后 200ms（单位秒
周期的 20%）同步滚动，像机械进位齿轮一样同进同停，其余时间清晰停在数
字上（`odometer-math.ts` 纯函数，可单测），所有位移在 `useTransform`
内计算，React 零重渲染。数字条为 0-9 加末尾重复的 0，进位回绕无视觉跳
变。

约束：

- 里程表只支持等宽数字列，因此绑定整秒显示；`compact` 的稀疏结构
  （`3s` → `1m 5s`）不适用。
- 不做亚秒轮：十分位每秒滚动 10 格只剩残影，无视觉意义（初版教训）。
- 停止时按整秒取整冻结，每位数字精确落在字形上。
- 秒位数列在进位滚动窗口开始时预增长（`odometerDigitCount`），新轮随
  进位同步滚入，不会出现 9.9s 显示 `0s` 的空窗；`useMotionValueEvent`
  仅在跨数量级时触发一次 React state 更新。
- 动画数字条 `aria-hidden`；无障碍值由离屏 `ElapsedTime`（1s 节拍）承
  载，`role="timer"` 不会读到冻结时间。
- `prefers-reduced-motion` 时降级为静态 `<ElapsedTime format="compact">`。
- 带 shimmer 的计时（如 `TurnDurationMarker` running 态）不使用动画，
  避免与渐变扫过动效冲突。

---

## 13. 现有组件迁移映射

| 现有组件 | 迁移方式 | refreshMs | format |
| -------- | -------- | --------- | ------ |
| `TurnDurationMarker` | `elapsedMs = selectTurnElapsedMs(...)`，`running = status === 'running'`；删除 `useInterval` 与 `now` state；Spinner/shimmer/token 用量展示不变 | 1000 | `compact` |
| `ReconnectingStatus` | 客户端权威模式（第 11 节），`ElapsedOdometer` 里程表；无 shimmer | rAF | 整秒（odometer 内置） |
| `SubagentFleetPanel` | `elapsedMs = resolveNodeDuration(node, snapshot.generatedAt)`，`running = ACTIVE_STATES.has(node.state)`；快照 revision 更新即重同步；`ElapsedOdometer` 里程表 | rAF | 整秒（odometer 内置） |
| `SubagentToolRenderer` | 子代理行：`elapsedMs = child.durationMs`，`running = status === 'running'`；进度事件到达即重锚定；`ElapsedOdometer` 里程表 | rAF | 整秒（odometer 内置） |
| `ServerRestart` | 一次性文案场景，优先级最低；如迁移用客户端权威模式 | — | — |

**动画计时排除清单**（保持静态 `ElapsedTime` / `formatDuration` 文本）：

- 带 shimmer 的计时：`TurnDurationMarker`（active）、`ThoughtDisclosureMarker`
  （thinking），里程表滚动与渐变扫过动效冲突；
- 配额/统计语义的长时长：`GoalPanel.timeUsedSeconds` 可达小时级，
  `seconds` 格式可读性差，保持 `compact` 文本；
- 一次性结果展示（如 `KnowledgeModelCard` 探测耗时）与阈值文案
  （`ServerRestart`）不是计时器，不迁移。

Tool / Thinking / Compaction / AutoRetry 新计时展示一律直接复用
`<ElapsedTime>`，selector 模式同 `selectTurnElapsedMs`。

---

## 14. Zustand 约束

- Store 只在事件到达（started / 任意事件重锚 / completed / failed /
  cancelled）时更新投影与 `lastServerTimestamp`。
- **禁止**把插值中的当前耗时写回 Store，禁止每帧/每 100ms 更新。
- 插值状态完全封闭在 `ElapsedTime` 组件内部（ref + state）。
- `<ElapsedTime>` 为独立小组件，自身 100ms render 不会波及
  Message List。

---

## 15. Session / Run 切换

为不同运行实体使用稳定 `key`，切换时组件生命周期干净重建：

```tsx
<ElapsedTime key={turn.id} elapsedMs={...} running={...} />
```

Session A 切到 Session B 时，A 的 UI Timer 随组件卸载停止；A 的真
实时间由 Server 时钟域继续推进，切回时由 `lastServerTimestamp` 恢复
插值。

---

## 16. 组件设计红线

`@octopus/custom-ui` 的 elapsed-time 模块禁止依赖：

```text
AgentRun / ToolCall / TurnProjection / Session / Message
RPC / WebSocket / Zustand / @octopus/shared
```

只认识 `elapsedMs` 与 `running`。投影 → props 的换算发生在 apps/web
的 selector 层。

基础组件必须叫 `ElapsedTime`，禁止命名 `AgentTimer`（否则会繁殖出
ToolTimer / ThinkingTimer / BuildTimer 等重复实现）。允许基于它封装
极薄的业务组件，核心逻辑全部留在 `ElapsedTime`。

---

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

## 18. 代码规范检查单（实现时逐项核对）

- 每个源文件以 JSDoc 头开始：`@author`（实际开发者）+ `@description`
  （职责描述）。
- 函数/方法/构造器/interface 方法均有多行 JSDoc，`@param`/`@returns`
  分行书写。
- 两空格缩进，Prettier 格式化，kebab-case 文件名。
- 不为性能手写 `useMemo`/`useCallback`/`React.memo`（React Compiler
  负责）。
- `packages/ui/src/components/` 一律不动；本方案全部落在
  `packages/custom-ui` 与 `apps/web`。
- 完成后按范围执行 `pnpm test`、`pnpm lint`、`pnpm typecheck`
  （优先 `--filter @octopus/custom-ui` 等聚焦过滤）。
- 根 `AGENTS.md` 项目索引表登记 `packages/custom-ui/`。

---

## 19. 开发任务清单

1. 创建 `packages/custom-ui` 包骨架（package.json / tsconfig /
   eslint 配置，镜像 `packages/ui`），声明 `motion`、`@octopus/ui`
   依赖；根 `AGENTS.md` 登记新包。
2. 实现 `PreciseClock` + 完整单元测试（第 17 节）。
3. 实现 `formatDuration`（含 `compact`，吸收现有两套实现）+ 测试。
4. 实现 `usePreciseElapsedTime`（含运行期单调钳制）。
5. 实现 `ElapsedTime`（默认 100ms 刷新、`tabular-nums`）。
6. 实现 `useElapsedMotionValue`（复用 `PreciseClock`）。
7. 从 `@octopus/custom-ui/components/elapsed-time` 统一导出
   （`ElapsedTime`、`usePreciseElapsedTime`、`useElapsedMotionValue`
   及类型；`PreciseClock` 默认不公开）。
8. 【协议】`SessionSnapshotDto` 增加 `generatedAt: number`，
   apps/server 水合出口填充（第 10 节）。
9. 【Store】Session reducer 维护 `lastServerTimestamp`；新增
   `selectTurnElapsedMs` 等 selector（第 9.2 节）。
10. 【迁移】`TurnDurationMarker` 改用 `<ElapsedTime refreshMs={1000}
    format="compact">`，删除 `useInterval`（第 13 节）。
11. 【迁移】`ReconnectingStatus` 改用客户端权威模式，删除累积
    state 与内部格式化函数。
12. 【清理】删除 `apps/web/src/utils/duration.ts`，调用方改导入公共
    包；全局排查并清除残留的 `elapsed += interval` 式实现。
13. Tool / Thinking 等后续计时场景一律复用 `<ElapsedTime>`；
    `SubagentFleetPanel` 按需后续迭代。
14. 【动画】实现 `ElapsedOdometer`（整秒里程表）+ `odometer-math.ts`
    单测，接入 `SubagentToolRenderer` 子代理行、`SubagentFleetPanel`
    节点行与 `ReconnectingStatus`（第 12.1 节）；shimmer 计时场景保持
    静态文本。

---

## 20. 最终架构

```text
                 Server（唯一时钟域）
                   │
        HostEventEnvelope.timestamp / snapshot.generatedAt
                   │ WebSocket / 水合
                   ▼
        Session Store（Zustand）
        lastServerTimestamp + 投影 startedAt/endedAt
                   │ selector: elapsedMs = (endedAt ?? lastServerTimestamp) - startedAt
                   ▼
            ┌─────────────┐
            │ ElapsedTime │  ← 只认 elapsedMs + running
            └──────┬──────┘
                   ▼
            PreciseClock（performance.now() 插值）
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
usePreciseElapsedTime   useElapsedMotionValue
     10 FPS 文本              rAF Motion
```

达成：

```text
精确时间（锚点插值，无累积漂移）
+ 单一时钟域（禁止跨域混算）
+ 事件流即同步信号（无新增高频通道）
+ 刷新/重连可恢复（snapshot.generatedAt seed + 事件自愈）
+ 低 React 开销（文本 10 FPS 组件内闭环）
+ 平滑动画（MotionValue 旁路 React）
+ 多业务复用（业务无关契约）
```
