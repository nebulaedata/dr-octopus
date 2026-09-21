# pi-tui v0.84.3

Use this reference for terminal applications built with
`@earendil-works/pi-tui`. Confirm exact signatures against the installed
`dist/*.d.ts`; use the matching upstream tag when declarations are unavailable.

## Contents

- [Renderer selection](#renderer-selection)
- [Lifecycle](#lifecycle)
- [Built-in components](#built-in-components)
- [Loader pattern](#loader-pattern)
- [Custom components](#custom-components)
- [Input and focus](#input-and-focus)
- [Overlays and fullscreen layout](#overlays-and-fullscreen-layout)
- [Terminal boundaries](#terminal-boundaries)
- [Testing](#testing)
- [Failure modes](#failure-modes)

## Renderer selection

Program against the `TUI` interface and select a renderer only at the
composition root.

- Use `TuiMainScreen` for short-lived CLI feedback, prompts, loaders, and
  applications that should preserve native terminal scrollback.
- Use `TuiAltScreen` for fixed-height fullscreen applications that own
  scrolling, mouse interaction, and viewport layout.
- Use `isViewportTUI(tui)` before calling `setLayoutRoot()`. Main-screen TUIs do
  not expose viewport layout semantics.

```ts
import {
  ProcessTerminal,
  type TUI,
  TuiAltScreen,
  TuiMainScreen,
} from '@earendil-works/pi-tui';

const terminal = new ProcessTerminal();
const tui: TUI = fullscreen
  ? new TuiAltScreen(terminal)
  : new TuiMainScreen(terminal);
```

## Lifecycle

1. Construct the terminal and renderer.
2. Add components and configure focus/input listeners.
3. Call `tui.start()` once.
4. Request redraws with `tui.requestRender()` after mutable state changes.
5. Stop component timers, unsubscribe external listeners, then call
   `tui.stop()` in `finally`.

`ProcessTerminal.start()` owns raw terminal input. In raw mode, Ctrl+C does not
necessarily arrive as `SIGINT`; handle it through `addInputListener()` or the
focused component. Do not initialize `ProcessTerminal` when stdin/stdout are not
TTYs. Provide a plain-text fallback for redirected output and CI.

Use `tui.stop({ preserveScreen: true })` only when another TUI immediately takes
over the same terminal output. Normal short-lived main-screen UI should call
`stop()` so the cursor and terminal state are restored.

## Built-in components

Prefer public components over reimplementing terminal mechanics:

- `Text`, `TruncatedText`, `Markdown`: static and formatted output.
- `Input`, `Editor`: single- and multi-line input with built-in cursor handling.
- `Loader`, `CancellableLoader`: animated asynchronous feedback.
- `Container`, `Box`, `VStack`, `HStack`, `Spacer`: composition and layout.
- `SelectList`, `SettingsList`: selectable lists.
- `ScrollView`: constrained scrolling in viewport layouts.
- `Image`: terminal image rendering with protocol-aware fallback.

Pass color and theme functions into components. Keep terminal styling at this
host boundary instead of leaking it into business services.

## Loader pattern

Use `Loader` with `TuiMainScreen` for a bounded operation. Always stop its timer
and the TUI, including on failure.

```ts
import {
  Loader,
  ProcessTerminal,
  TuiMainScreen,
} from '@earendil-works/pi-tui';

const tui = new TuiMainScreen(new ProcessTerminal(), false);
const loader = new Loader(tui, cyan, dim, 'Installing…');
tui.addChild(loader);
tui.start();

try {
  const result = await operation();
  loader.stop();
  loader.setIndicator({ frames: ['✓'] });
  loader.setMessage('Installed');
  tui.renderNow();
  return result;
} finally {
  loader.stop();
  tui.stop();
}
```

The constructor initializes the indicator animation; calling `start()` is only
needed after an explicit `stop()` or when restarting it. `setIndicator()` also
restarts animation. Use a single-frame indicator for a stable final state.

## Custom components

Implement the public `Component` contract:

```ts
import {
  truncateToWidth,
  type Component,
} from '@earendil-works/pi-tui';

class Status implements Component {
  constructor(private value: string) {}

  render(width: number): string[] {
    return [truncateToWidth(this.value, width)];
  }

  invalidate(): void {}
}
```

Every line returned by `render(width)` must have visible width at most `width`.
Use `visibleWidth()`, `truncateToWidth()`, `sliceByColumn()`, or
`wrapTextWithAnsi()` because JavaScript string length is incorrect for ANSI
sequences and wide Unicode characters. Reapply styles across lines; the renderer
resets SGR and OSC 8 state at each line boundary.

Cache render results only when profiling justifies it. Clear caches from
`invalidate()` and whenever component state changes.

## Input and focus

Use `matchesKey()` and `Key` instead of matching raw escape sequences. Filter
key-release events unless the component explicitly sets `wantsKeyRelease`.

Set focus with `tui.setFocus(component)`. A custom text-entry component should
implement `Focusable` and emit `CURSOR_MARKER` immediately before its visual
cursor. A container wrapping `Input` or `Editor` must propagate its `focused`
state to that child so IME candidate windows are positioned correctly.

Register global shortcuts with `addInputListener()` and retain the returned
unsubscribe function. Remove listeners during teardown.

## Overlays and fullscreen layout

Use `showOverlay(component, options)` for dialogs or transient UI. Retain the
returned handle to hide, focus, unfocus, or temporarily suppress the overlay.
Use `nonCapturing: true` for overlays that must not steal keyboard focus.

For `TuiAltScreen`, compose `VStack`/`HStack` entries with `basis`, `grow`,
`shrink`, `minSize`, and `maxSize`. Put long content in `ScrollView`; mark the
primary scroll view explicitly when it should receive viewport navigation.
Guard layout installation with `isViewportTUI()`.

## Terminal boundaries

Keep Pi TUI imports in CLI/terminal packages. Do not make web, Electron renderer,
or shared business packages depend on terminal state. Those layers should
consume structured events and render through their native UI framework.

Use `ProcessTerminal` for production. For tests, inject a small implementation
of the public `Terminal` interface that records writes and exposes fixed columns
and rows. Avoid writing escape sequences directly unless implementing a terminal
adapter.

## Testing

Test at least these contracts:

1. Every component line fits narrow and wide render widths.
2. Non-TTY execution uses the plain fallback without initializing raw mode.
3. Async success, failure, and cancellation all stop timers and restore terminal
   state.
4. Resize invokes a redraw without corrupting cached layout.
5. Focused inputs handle Ctrl+C/Escape intentionally and place IME markers.
6. Fullscreen scroll views retain manual scroll position while content grows.

Prefer deterministic fake terminals over snapshots of platform-specific ANSI
streams. Use `PI_TUI_WRITE_LOG` only for diagnosing real-terminal rendering.

## Failure modes

- Do not import `src/**`; use package root exports.
- Do not use `TuiAltScreen` for a one-line loader; it needlessly replaces the
  user's screen.
- Do not start a TUI on redirected stdin/stdout.
- Do not leave `Loader` intervals running after the operation settles.
- Do not assume `process.on('SIGINT')` handles Ctrl+C in raw mode.
- Do not return over-width lines or measure ANSI text with `.length`.
- Do not call viewport-only APIs on `TuiMainScreen`.
- Do not let terminal components own agent/session business state.
