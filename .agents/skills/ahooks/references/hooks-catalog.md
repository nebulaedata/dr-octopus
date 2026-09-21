# ahooks Full Hook Catalog

Complete enumeration of every hook in [alibaba/hooks](https://github.com/alibaba/hooks)
(ahooks v3.9.x), grouped exactly as the official navigation
(https://ahooks.js.org/hooks). Use this to look up "does ahooks already solve this?"
or to find the closest reference implementation for a category — see
[../SKILL.md](../SKILL.md) for the design principles and patterns to apply once you've
found the closest match.

Each entry: `useXxx` — one-line purpose. Full docs: `https://ahooks.js.org/hooks/<kebab-name>`.

## Request / Async Data

- `useRequest` — full-featured async data fetching hook (manual/auto trigger, plugin
  architecture: polling, debounce, throttle, refresh-on-focus, retry, loading-delay,
  cache/SWR, refreshDeps, ready-gate).

## Scene (business scenario compositions)

- `useAntdTable` — antd `Table` + `Form` pairing: pagination, sorting, filtering via `useRequest`.
- `useFusionTable` — same as `useAntdTable` but for Fusion Design `Table`/`Form`.
- `useInfiniteScroll` — infinite-scroll list loading with `loadMore`/`noMore` state.
- `usePagination` — pagination state + data fetching built on `useRequest`.
- `useDynamicList` — manage a list with insert/remove/replace by stable key, for dynamic form rows.
- `useVirtualList` — render only visible rows/columns of a large list for performance.
- `useHistoryTravel` — undo/redo state history (back/forward/reset).
- `useNetwork` — reactive `navigator.onLine`/connection-type state.
- `useSelections` — manage (multi-)selection state over a list (select/unselect/toggle/all/none/partial).
- `useCountDown` — countdown timer to a target date, with formatted remaining time.
- `useCounter` — numeric counter with `inc`/`dec`/`set`/`reset` and min/max bounds.
- `useTextSelection` — reactive selected-text + bounding rect on the page.
- `useWebSocket` — WebSocket connection lifecycle with readyState, message handlers, reconnect.
- `useTheme` — light/dark/system theme detection and switching.

## LifeCycle

- `useMount` — run a callback once after the component mounts (`useEffect(fn, [])`).
- `useUnmount` — run a callback once right before the component unmounts.
- `useUnmountedRef` — ref that becomes `true` after unmount; used to guard async state updates.

## State

- `useSetState` — class-component-like partial-object state merging on top of `useState`.
- `useBoolean` — boolean state with `toggle`/`setTrue`/`setFalse` actions (built on `useToggle`).
- `useToggle` — toggle between two (or more) values.
- `useUrlState` — state synced to URL query string (requires a router, e.g. react-router).
- `useCookieState` — state persisted to a cookie.
- `useLocalStorageState` — state persisted to `localStorage`, synced across tabs.
- `useSessionStorageState` — state persisted to `sessionStorage`.
- `useDebounce` — debounced value derived from a fast-changing value.
- `useThrottle` — throttled value derived from a fast-changing value.
- `useMap` — reactive wrapper around a native `Map`.
- `useSet` — reactive wrapper around a native `Set`.
- `usePrevious` — returns the value from the previous render.
- `useRafState` — like `useState` but batches updates via `requestAnimationFrame` (avoids layout thrashing).
- `useSafeState` — like `useState` but ignores `setState` calls after unmount.
- `useGetState` — like `useState` but also returns a `getState()` to read the latest value without a stale closure.
- `useResetState` — like `useState` but adds a `resetState()` to restore the initial value.

## Effect

- `useUpdateEffect` — like `useEffect` but skips the run on initial mount.
- `useUpdateLayoutEffect` — like `useLayoutEffect` but skips the run on initial mount.
- `useAsyncEffect` — allows the effect callback to be an async function / generator.
- `useDebounceEffect` — runs `useEffect` with debounced deps.
- `useDebounceFn` — returns a debounced version of a function plus `run`/`cancel`/`flush`.
- `useThrottleFn` — returns a throttled version of a function plus `run`/`cancel`/`flush`.
- `useThrottleEffect` — runs `useEffect` with throttled deps.
- `useDeepCompareEffect` — like `useEffect` but deps are compared deeply instead of by reference.
- `useDeepCompareLayoutEffect` — like `useLayoutEffect` with deep-compared deps.
- `useInterval` — declarative `setInterval` with automatic cleanup and dynamic delay.
- `useRafInterval` — `requestAnimationFrame`-based interval, more accurate under throttled tabs.
- `useTimeout` — declarative `setTimeout` with automatic cleanup.
- `useRafTimeout` — `requestAnimationFrame`-based timeout.
- `useLockFn` — wraps an async function so concurrent invocations are serialized (no overlap).
- `useUpdate` — returns a function that forces a re-render.

## Dom

- `useEventListener` — declarative `addEventListener` targeting an element/ref/`window`/`document`.
- `useClickAway` — fires a callback when a click happens outside the target element(s).
- `useDocumentVisibility` — reactive `document.visibilityState`.
- `useDrop` / `useDrag` — native drag-and-drop event bindings.
- `useEventTarget` — simplifies controlled `<input>` `onChange`/`value` boilerplate.
- `useExternal` — dynamically loads an external script/link/stylesheet resource.
- `useTitle` — sets `document.title`.
- `useFavicon` — sets the page favicon.
- `useFullscreen` — toggles fullscreen mode for an element.
- `useHover` — reactive hover state for an element.
- `useMutationObserver` — declarative `MutationObserver` on a target element.
- `useInViewport` — reactive intersection/visibility of an element in the viewport.
- `useKeyPress` — declarative keyboard shortcut/key-combo binding.
- `useLongPress` — fires a callback on long-press (mouse/touch) of an element.
- `useMouse` — reactive mouse position relative to page/element.
- `useResponsive` — reactive breakpoint matching (responsive design) based on configured breakpoints.
- `useScroll` — reactive scroll position of an element/window.
- `useSize` — reactive width/height of an element via `ResizeObserver`.
- `useFocusWithin` — reactive focus state for an element or any of its descendants.

## Advanced

- `useControllableValue` — implements the controlled/uncontrolled component value pattern (`value`/`defaultValue`/`onChange`).
- `useCreation` — like `useMemo` but guarantees the value is never recomputed unless deps truly change (safer than `useMemo`, which is not guaranteed to be stable across React versions).
- `useEventEmitter` — a typed pub/sub event emitter scoped to component trees (cross-component communication without prop drilling).
- `useIsomorphicLayoutEffect` — `useLayoutEffect` on the client, `useEffect` on the server (SSR-safe layout effect).
- `useLatest` — ref that always holds the latest value, avoiding stale closures.
- `useMemoizedFn` — function with a stable reference that always invokes the latest implementation (alternative to `useCallback` without a deps array).
- `useReactive` — Vue-like reactive object state (mutate properties directly, triggers re-render via Proxy).

## Dev (development-time diagnostics only)

- `useTrackedEffect` — like `useEffect` but also reports which dependency changed and triggered the run (debugging aid).
- `useWhyDidYouUpdate` — logs which props changed between renders (debugging aid, akin to `why-did-you-render`).

## Notes

- This list mirrors ahooks 3.9.x navigation; check https://ahooks.js.org/hooks for new
  additions before relying on it for exhaustiveness on a specific ahooks version.
- `use-url-state` has moved to the separate `@ahooks.js/use-url-state` package upstream —
  confirm current install target before depending on it.
