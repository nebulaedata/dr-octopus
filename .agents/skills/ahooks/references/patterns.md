# Hook Pattern Skeletons

Copyable, minimal implementations of the core ahooks patterns referenced from
[SKILL.md](../SKILL.md). Adapt names/types to the target hook; keep the same guarantees.

## useLatest

Avoids stale closures without adding values to dependency arrays.

```ts
import { useRef } from 'react';

/**
 * Returns a ref that always holds the latest value, safe to read inside
 * timers, event listeners, or async callbacks without re-subscribing.
 */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
```

Use inside any callback that must read fresh state/props but must not change
identity (e.g. a `setInterval` tick handler):

```ts
const latestOnTick = useLatest(onTick);
useEffect(() => {
  const id = setInterval(() => latestOnTick.current(), delay);
  return () => clearInterval(id);
}, [delay]); // onTick intentionally omitted — always reads latest via ref
```

## useMemoizedFn

Stable function identity, no deps array, always calls the latest implementation.

```ts
import { useRef, useCallback } from 'react';

type AnyFn = (...args: any[]) => any;

/**
 * Returns a function whose reference never changes across renders while
 * always invoking the most recently passed-in implementation.
 */
function useMemoizedFn<T extends AnyFn>(fn: T): T {
  const fnRef = useRef<T>(fn);
  fnRef.current = fn;

  const memoizedFn = useRef<T>();
  if (!memoizedFn.current) {
    memoizedFn.current = function (this: unknown, ...args: any[]) {
      return fnRef.current.apply(this, args);
    } as T;
  }

  return memoizedFn.current;
}
```

## useUnmountedRef + useSafeState

Prevents "state update on an unmounted component" bugs from async work.

```ts
import { useEffect, useRef, useState, useCallback } from 'react';

function useUnmountedRef() {
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);
  return unmountedRef;
}

function useSafeState<T>(initialState: T | (() => T)) {
  const unmountedRef = useUnmountedRef();
  const [state, setState] = useState(initialState);

  const setSafeState = useCallback(
    (value: React.SetStateAction<T>) => {
      if (unmountedRef.current) return;
      setState(value);
    },
    [unmountedRef],
  );

  return [state, setSafeState] as const;
}
```

## Target Resolution (useEventListener-style DOM hooks)

DOM hooks must accept an element, a `RefObject`, or a function returning either
(or `window`/`document`), and resolve it lazily inside the effect — never during
render (breaks SSR).

```ts
type BasicTarget<T extends Element = Element> =
  | T
  | React.RefObject<T>
  | (() => T | null)
  | null;

function getTargetElement<T extends Element>(target: BasicTarget<T>): T | null {
  if (!target) return null;
  if (typeof target === 'function') return target();
  if ('current' in target) return target.current;
  return target as T;
}

function useEventListener<K extends keyof WindowEventMap>(
  eventName: K,
  handler: (ev: WindowEventMap[K]) => void,
  target: BasicTarget<HTMLElement | Window | Document> = () => window,
) {
  const handlerRef = useLatest(handler);

  useEffect(() => {
    const el = getTargetElement(target) as EventTarget | null;
    if (!el) return;
    const listener = (ev: Event) => handlerRef.current(ev as WindowEventMap[K]);
    el.addEventListener(eventName, listener);
    return () => el.removeEventListener(eventName, listener);
  }, [eventName, target]);
}
```

## Plugin Architecture (useRequest-style async hooks)

Skeleton for composing independent optional behaviors around one async core
instead of branching inside a single hook.

```ts
type Plugin<TData, TParams extends any[]> = (
  fetchInstance: FetchInstance<TData, TParams>,
  options: Record<string, unknown>,
) => Partial<{
  onBefore: (params: TParams) => void | { stopNow?: boolean };
  onRequest: (service: (...args: TParams) => Promise<TData>, params: TParams) => { servicePromise: Promise<TData> };
  onSuccess: (data: TData, params: TParams) => void;
  onError: (error: unknown, params: TParams) => void;
  onFinally: (params: TParams, data?: TData, error?: unknown) => void;
  onCancel: () => void;
}>;

interface FetchInstance<TData, TParams extends any[]> {
  state: { loading: boolean; data?: TData; error?: unknown; params?: TParams };
  run: (...params: TParams) => Promise<TData>;
  cancel: () => void;
}

/**
 * Composes a core async state machine with independent plugins (debounce,
 * throttle, cache, polling, retry, ...). Each plugin only wires the lifecycle
 * hooks it needs; plugins never call each other directly — they communicate
 * only through `fetchInstance.state`.
 */
function useRequestImplement<TData, TParams extends any[]>(
  service: (...params: TParams) => Promise<TData>,
  options: Record<string, unknown>,
  plugins: Array<(fetchInstance: FetchInstance<TData, TParams>, options: Record<string, unknown>) => ReturnType<Plugin<TData, TParams>>>,
) {
  // 1. build fetchInstance holding state + run/cancel
  // 2. const pluginImpls = plugins.map((p) => p(fetchInstance, options))
  // 3. run() calls each pluginImpls[].onBefore/onRequest/onSuccess/onError/onFinally
  //    in order, short-circuiting when a plugin returns { stopNow: true }
  // 4. return { ...fetchInstance.state, run, cancel, ...extra plugin-exposed fields }
}
```

Each feature (e.g. debounce) becomes a standalone file exporting a `Plugin`:

```ts
const useDebouncePlugin: Plugin<any, any[]> = (fetchInstance, { debounceWait }) => {
  if (!debounceWait) return {};
  const debounced = debounce((callback: () => void) => callback(), debounceWait);
  return {
    onBefore: () => {
      debounced(() => fetchInstance.run());
      return { stopNow: true };
    },
  };
};
```

This keeps every optional behavior independently testable and lets consumers
opt in/out without touching the core state machine.
