---
name: ahooks
description: 'Design and implement production-grade React custom Hooks following alibaba/ahooks (https://github.com/alibaba/hooks) conventions. Use when creating, reviewing, or refactoring React Hooks — state hooks, effect/lifecycle hooks, DOM/browser hooks, async data hooks (useRequest-style), or advanced utility hooks (useLatest, useMemoizedFn, useSafeState). Covers closure-safety, SSR compatibility, cleanup/unmount safety, plugin architecture for async hooks, TypeScript typing rules, and file/test layout. Trigger keywords: custom hook, useXxx, ahooks, hook 设计, hook 开发, 自定义 hook, useRequest, useLatest, useMemoizedFn, useSafeState, useDebounceFn, plugin hook.'
---

# React Hooks Development (ahooks conventions)

Guides an agent through designing and implementing a React custom Hook the way
[alibaba/hooks (ahooks)](https://github.com/alibaba/hooks) does: closure-safe, SSR-safe,
unmount-safe, strongly typed, and testable. Use this whenever asked to add a new `useXxx`
hook or to review/refactor an existing one.

## When to Use

- Creating a new custom hook (state, effect, DOM, async-data, or advanced/utility).
- Reviewing a hook PR for closure bugs, missing cleanup, or unstable references.
- Porting/adapting an ahooks hook, or building one with the same guarantees without
  adding the `ahooks` dependency.
- Deciding which category a new hook belongs to and which existing pattern to reuse.

## Core Design Principles (non-negotiable)

1. **Avoid the closure trap.** Callbacks captured in `useEffect`/`setTimeout`/event
   listeners close over stale state. Use the `useLatest` ref pattern (see
   [patterns.md](./references/patterns.md#uselatest)) instead of adding everything to
   dependency arrays.
2. **Unmount safety.** Never call `setState` after unmount (async callbacks, timers,
   listeners). Guard with an `unmountedRef` — see `useSafeState` /
   `useUnmountedRef` pattern.
3. **SSR compatibility.** Never touch `window`/`document`/`navigator` at module scope
   or during render. Access DOM only inside `useEffect`/`useLayoutEffect`, and use
   `useIsomorphicLayoutEffect` (falls back to `useEffect` when `window` is undefined)
   for hooks that must run a layout effect but may also run on the server.
4. **Stable function identity without deps arrays.** Prefer the `useMemoizedFn`
   pattern (ref-backed proxy function) over `useCallback(fn, deps)` when the hook's
   public API exposes callbacks (`run`, `cancel`, `toggle`, etc.) — callers should not
   need to memoize deps to get a stable reference.
5. **No breaking changes, minimal deps.** Keep the public API backward compatible;
   avoid adding new runtime dependencies for something a ~20-line utility can do.
6. **Full type safety.** No `any` in public signatures; prefer `unknown` + narrowing.
   Export every public type/interface. Use generics with sensible defaults and
   constraints (e.g. `<T extends (...args: any[]) => any>`). Use interfaces for object
   shapes, `type` for unions/intersections, `as const`/literal unions instead of
   `enum`.
7. **JSDoc on every exported hook, param, and return field** explaining contracts
   (when it fires, what triggers re-render, side effects), not restating the name.
8. **Cleanup everything you subscribe.** Every `addEventListener`, `setInterval`,
   `ResizeObserver`, subscription, etc. must be removed in the effect's cleanup
   function and again on unmount.

## Hook Taxonomy — pick the right category

Match the new hook to an ahooks category to reuse its conventions and know what
"complete" looks like. The table below shows representative examples only — see
[hooks-catalog.md](./references/hooks-catalog.md) for the full enumeration of every
hook in ahooks by category:

| Category | Purpose | Examples | Key convention |
|---|---|---|---|
| **State** | Encapsulate `useState`/`useReducer` variants | `useBoolean`, `useToggle`, `useSetState`, `useMap`, `useSet`, `usePrevious`, `useSafeState` | Return `[state, actions]` tuple or `[state, setState]`; actions object should be stable (memoized) |
| **Effect** | Wrap `useEffect` with a condition or timing change | `useUpdateEffect` (skip first run), `useDebounceEffect`, `useThrottleEffect`, `useDeepCompareEffect`, `useAsyncEffect` | Same signature as `useEffect` plus extra options; must still return/run cleanup |
| **LifeCycle** | Mount/unmount only | `useMount`, `useUnmount`, `useUnmountedRef` | `useMount(fn)` = `useEffect(fn, [])`; warn in dev if `fn` isn't stable/changes |
| **DOM** | Bind to DOM nodes/browser APIs | `useEventListener`, `useClickAway`, `useHover`, `useSize`, `useScroll`, `useKeyPress` | Accept a *target* as element, ref, or `() => element` (see [patterns.md](./references/patterns.md#target-resolution)); resolve lazily inside the effect |
| **Async / Data** | Manage async function lifecycle | `useRequest`, `useDebounceFn`, `useThrottleFn`, `useLockFn` | Use the **plugin architecture** (below) for anything beyond trivial wrapping |
| **Advanced/Utility** | Cross-cutting helpers other hooks build on | `useLatest`, `useMemoizedFn`, `useCreation`, `useEventEmitter`, `useControllableValue` | Usually a single ref; zero UI concerns; heavily reused by other hooks |
| **Scene** | Compose several hooks for a business scenario | `usePagination`, `useAntdTable`, `useInfiniteScroll`, `useDynamicList` | Compose from primitive hooks above rather than reimplementing; keep options additive |
| **Dev** | Development-time diagnostics only | `useWhyDidYouUpdate`, `useTrackedEffect` | Must be a no-op / tree-shakeable in production builds |

## Async Hook Plugin Architecture (useRequest pattern)

When a hook needs to support many optional, independently toggle-able behaviors
(debounce, throttle, polling, cache, retry, refresh-on-focus, ready-gate), do **not**
grow one hook with a wall of `if` branches. Follow the `useRequest` plugin model:

1. A small **core hook** (`useRequestImplement`) holds the actual fetch state machine
   and exposes lifecycle hook points: `onBefore`, `onRequest`, `onSuccess`, `onError`,
   `onFinally`, `onCancel`.
2. Each optional feature is an isolated **plugin function** `(fetchInstance, options) =>
   ({ onBefore, onSuccess, ... })` that only wires into the lifecycle points it needs.
3. The public hook composes `core + plugins[]`, so features can be added/removed
   without touching each other's code and can be tested in isolation.
4. Plugins communicate through the shared mutable `fetchInstance.state`, never by
   calling each other directly.

See [patterns.md](./references/patterns.md#plugin-architecture) for a minimal skeleton.

## File & Folder Layout

Mirror ahooks' per-hook module layout (adapt the root to this repo's `packages/ui` or
`apps/web/src/hooks`):

```
useXxx/
├── index.ts              # public export: re-export type + implementation
├── src/
│   ├── index.ts           # hook implementation (or split into index.ts + utils.ts + Plugins/*.ts for async hooks)
│   └── types.ts           # exported Options/Result interfaces
├── __tests__/
│   └── index.test.ts      # unit tests (or index.spec.ts)
└── doc/
    └── index.md           # usage doc: description, examples, API table
```

Rules:
- One hook per folder; folder name matches the exported hook name in kebab or camel
  case consistent with the sibling hooks already in the target directory.
- Split implementation once a file nears ~300 lines (repo-wide rule) — extract
  `utils.ts`, `types.ts`, or a `plugins/` subfolder, matching this repo's file-splitting
  requirement in [AGENTS.md](../../../AGENTS.md).
- Keep the barrel `index.ts` a thin re-export; no logic there.

## TypeScript Rules (from ahooks project conventions)

- Public option/result objects: `interface`, not `type`.
- Export every public interface/type: `export interface UseXxxOptions { ... }`.
- Generics get defaults and constraints: `<TData = any>`, `<T extends HTMLElement =
  HTMLElement>`.
- Prefer `Partial<T>` / `Pick<T, K>` / `Omit<T, K>` over redeclaring shapes.
- No `enum` — use string literal unions or `as const` objects.
- Avoid non-null assertions (`!`); use type guards or optional chaining.
- Rely on inference; only assert (`as`) when TypeScript truly cannot infer it.

## Testing Requirements

- Framework: `vitest` + `@testing-library/react`'s `renderHook`/`act`.
- File name: `__tests__/index.test.ts` (or `.spec.ts`) colocated with the hook.
- Cover: initial state, every option flag, cleanup on unmount (no act warnings, no
  state-after-unmount errors), and timer-based behavior using
  `vi.useFakeTimers()`/`vi.advanceTimersByTime()`.
- Aim for full branch coverage of the options surface — every `if (options.xxx)`
  branch needs at least one test.

## Step-by-Step Procedure

1. **Classify** the hook using the taxonomy table above; identify the closest existing
   ahooks equivalent to model the API after.
2. **Design the signature** first: `useXxx(target?, options?) => Result`. Keep options
   additive and optional; never require a breaking change to add a new option.
3. **Identify closure/unmount/SSR risks** up front — decide whether you need
   `useLatest`, `useMemoizedFn`, `useUnmountedRef`, or `useIsomorphicLayoutEffect`.
4. **Implement** using existing repo primitives first (check `packages/ui`/`apps/web/src/hooks`
   for an existing `useLatest`/`useMemoizedFn` before writing a new one).
5. **Type** all public exports per the TypeScript Rules above; add JSDoc.
6. **Write tests** covering options and cleanup per Testing Requirements.
7. **Write the doc** (`doc/index.md`): one-line description, when to use, minimal
   example, API table (params/result with types and defaults).
8. **Self-review against the Anti-Patterns checklist** below before finishing.

## Anti-Patterns Checklist

- ❌ Reading `window`/`document` outside an effect or event handler.
- ❌ `setState` inside an async callback without checking an unmounted ref.
- ❌ Returning a new object/array/function identity every render for values callers
  are expected to pass into `useEffect` deps (breaks consumers' memoization).
- ❌ Missing cleanup for `addEventListener`/`setInterval`/observers.
- ❌ `any` in exported types; un-exported public option/result interfaces.
- ❌ One hook handling many unrelated optional features via nested `if` instead of
  the plugin pattern.
- ❌ Hook file(s) exceeding ~300 lines instead of being split (`types.ts`, `utils.ts`,
  `plugins/`).
- ❌ Adding a new npm dependency for logic a small utility hook already covers.

## Reference

- [patterns.md](./references/patterns.md) — copyable skeletons for `useLatest`,
  `useMemoizedFn`, `useSafeState`, target resolution (`useEventListener`-style), and
  the plugin architecture.
- [hooks-catalog.md](./references/hooks-catalog.md) — full enumeration of every hook in
  ahooks by category with a one-line purpose each; check here before designing a new
  hook from scratch to see if an equivalent already exists to model after (or reuse via
  the `ahooks` package).
- Upstream source & docs: https://github.com/alibaba/hooks , https://ahooks.js.org/
