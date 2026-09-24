---
name: zustand-workflow
description: Build React state stores with Zustand using create + combine. Use this skill whenever the user asks for Zustand, client-side state management, lifting React state into a store, combine middleware, or wants to organize actions and state in a single store. Applies to new stores, refactoring local useState/useReducer into Zustand, and teaching the pattern from the official Zustand tic-tac-toe tutorial.
---

# Zustand `create + combine` Workflow

This skill teaches the Zustand store pattern used in the official [tic-tac-toe tutorial](https://zustand.docs.pmnd.rs/learn/guides/tutorial-tic-tac-toe): a single store created with `create`, state shaped by `combine`, and selectors read with fine-grained hooks.

## When to use this workflow

- You need client-only React state that multiple components share.
- You are lifting state up from `useState` / `useReducer` into a store.
- You want type inference without hand-writing a large interface.
- You want state and actions colocated in one file.

Avoid this workflow when:
- The state is server state (use TanStack Query instead).
- The store must live outside React lifecycle (see the `createStore` vanilla variant below).

## Installation

```bash
npm install zustand
```

For this workflow you only need the React import:

```ts
import { create } from 'zustand'
import { combine } from 'zustand/middleware'
```

## File structure

Create one store per cohesive domain under `apps/web/src/stores/<domain>/`. Follow the repository Code Development Standards for layout and ownership; do not define stores inside features.

```text
src/
  stores/
    game/
      index.ts          # explicit public exports
      store.ts          # store definition + actions
      type.ts           # optional public contracts
      utils.ts          # optional domain helpers, or utils/
  components/
    Game.tsx
    Board.tsx
    Square.tsx
```

Treat 300 lines only as a prompt to review cohesion, never as a size limit. Keep state and resource ownership intact. Types and utilities are optional. Keep instance management in registry.ts and related state transitions in reducers/. Store utilities may group related helpers such as utils/attachments/; persistence and task helpers must name their side effects, instance scope and cleanup ownership. Internal groups have no extra entrypoints. Feature hooks/utils remain flat. Application consumers use the domain index; internal files never import their own index.

## The `create + combine` pattern

`combine(initialState, actionsCreator)` merges plain state with action methods into one flat store object. `create` then turns that into a React hook.

```ts
import { create } from 'zustand'
import { combine } from 'zustand/middleware'

export const useGameStore = create(
  combine(
    { history: [Array(9).fill(null)], currentMove: 0 },
    (set, get) => ({
      setHistory: (nextHistory) => {
        set((state) => ({
          history:
            typeof nextHistory === 'function'
              ? nextHistory(state.history)
              : nextHistory,
        }))
      },
      setCurrentMove: (nextCurrentMove) => {
        set((state) => ({
          currentMove:
            typeof nextCurrentMove === 'function'
              ? nextCurrentMove(state.currentMove)
              : nextCurrentMove,
        }))
      },
      handlePlay: (nextSquares) => {
        const { history, currentMove } = get()
        const nextHistory = history.slice(0, currentMove + 1).concat([nextSquares])
        set({ history: nextHistory, currentMove: nextHistory.length - 1 })
      },
      jumpTo: (nextMove) => {
        set({ currentMove: nextMove })
      },
    }),
  ),
)
```

Key points:
- Put data fields in `initialState`.
- Put action methods in the second argument.
- Use `set` to update state and `get` to read current state inside actions.
- Keep state updates immutable (`slice`, `concat`, spread).

## Reading from the store with selectors

Always select only the slices you need. This prevents unnecessary re-renders.

```tsx
export default function Game() {
  const history = useGameStore((state) => state.history)
  const currentMove = useGameStore((state) => state.currentMove)
  const handlePlay = useGameStore((state) => state.handlePlay)
  const jumpTo = useGameStore((state) => state.jumpTo)

  const currentSquares = history[currentMove]
  const xIsNext = currentMove % 2 === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'row' }}>
      <Board xIsNext={xIsNext} squares={currentSquares} onPlay={handlePlay} />
      <ol>
        {history.map((_, index) => (
          <li key={index}>
            <button onClick={() => jumpTo(index)}>
              {index > 0 ? `Go to move #${index}` : 'Go to game start'}
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
```

Do not destructure the whole store in one hook call:

```tsx
// Avoid
const { history, currentMove, handlePlay } = useGameStore()
```

This causes the component to re-render on every store change.

## Auto-generating selectors

Hand-writing selectors for every key is repetitive. You can wrap the store to expose `use.<key>()` helpers.

```ts
import { create } from 'zustand'
import { combine } from 'zustand/middleware'
import type { StoreApi, UseBoundStore } from 'zustand'

type WithSelectors<S> = S extends { getState: () => infer T }
  ? S & { use: { [K in keyof T]: () => T[K] } }
  : never

const createSelectors = <S extends UseBoundStore<StoreApi<object>>>(_store: S) => {
  const store = _store as WithSelectors<typeof _store>
  store.use = {}
  for (const k of Object.keys(store.getState())) {
    ;(store.use as Record<string, () => unknown>)[k] = () =>
      store((s) => s[k as keyof typeof s])
  }
  return store
}

const useGameStoreBase = create(
  combine({ history: [Array(9).fill(null)], currentMove: 0 }, (set, get) => ({
    setHistory: (nextHistory) => { /* ... */ },
    handlePlay: (nextSquares) => { /* ... */ },
  })),
)

export const useGameStore = createSelectors(useGameStoreBase)

// Usage
const history = useGameStore.use.history()
const handlePlay = useGameStore.use.handlePlay()
```

Only keys present in the initial state receive auto-generated selectors.

## Deriving state instead of storing it

If a value can be computed from existing state, do not store it. This eliminates sync bugs.

```tsx
// Good: derived during render
const xIsNext = currentMove % 2 === 0

// Avoid: storing xIsNext separately
const [xIsNext, setXIsNext] = useState(true)
```

## Common pitfalls

1. **Mutating state directly.** Always return a new object or array.
2. **Selecting the entire store.** Destructuring `useGameStore()` subscribes the component to every change.
3. **Storing derived state.** Compute it from existing state instead.
4. **Calling actions in render.** Actions that update state should run in event handlers or effects, not during render.
5. **Forgetting that actions overwrite state keys.** If an action name matches a state key, the action wins.

## TypeScript notes

`combine` infers types automatically. You can still export the store type when needed:

```ts
export type GameStore = typeof useGameStore
```

If you need the state shape elsewhere, derive it:

```ts
import type { ExtractState } from 'zustand'

type GameState = ExtractState<typeof useGameStore>
```

## Vanilla alternative: `createStore`

If the store must exist outside React (for example, in a non-React module or a long-lived service), use the vanilla API:

```ts
import { createStore } from 'zustand/vanilla'
import { combine } from 'zustand/middleware'

export const gameStore = createStore(
  combine({ history: [Array(9).fill(null)], currentMove: 0 }, (set, get) => ({
    handlePlay: (nextSquares) => { /* ... */ },
  })),
)

// In React components, bind it with useStore
import { useStore } from 'zustand'

export function useGameStore() {
  return useStore(gameStore)
}
```

This project already uses `createStore` in `apps/web/src/stores/session/store.ts` for session state that is tied to a non-React runtime. Prefer `create` for ordinary React component state.

## Quick checklist

- [ ] `import { create } from 'zustand'` and `import { combine } from 'zustand/middleware'`
- [ ] Data fields live in `combine`'s first argument
- [ ] Actions live in the second argument and use `set` / `get`
- [ ] Components select only the slices they need
- [ ] State updates are immutable
- [ ] Derived values are computed, not stored

## Further reading

- [Zustand tutorial: Tic-Tac-Toe](https://zustand.docs.pmnd.rs/learn/guides/tutorial-tic-tac-toe)
- [combine middleware reference](https://zustand.docs.pmnd.rs/reference/middlewares/combine)
- [Auto-generating selectors](https://zustand.docs.pmnd.rs/learn/guides/auto-generating-selectors)
