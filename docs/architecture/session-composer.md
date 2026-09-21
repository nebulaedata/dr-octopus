# Session Composer architecture

## Intent

The Session Composer is a feature-owned input surface for drafting and routing Pi requests. It keeps the existing model, thinking, attachment, running-message, and submission behaviors while adding three interaction contracts:

- work modes: `agent`, `plan`, and `knowledge`;
- permission defaults: `allow`, `deny`, and `ask`;
- structured Workspace references inserted through `@`, plus slash-command discovery through `/`.

Plan mode is runtime-backed through `@narumitw/pi-plan-mode`; permission values remain browser-only presentation state until their extension has a server-owned configuration surface.

## Product contracts

### Work modes

| Value       | Label     | Current behavior                                                                 |
| ----------- | --------- | -------------------------------------------------------------------------------- |
| `agent`     | Agent     | Pi default behavior; leaving Plan dispatches the extension's `/plan exit` command |
| `plan`      | Plan      | Dispatches `/plan start`; the extension owns restrictions, questions, and state   |
| `knowledge` | Knowledge | Disabled placeholder until a knowledge-only runtime extension exists              |

The selector sends `agent.set-work-mode` through the realtime control plane. Server commands are runtime-generation fenced, discover the extension through `get_commands`, and invoke its public `/plan start` or `/plan exit` command. React never duplicates the extension's tool restrictions. The Session snapshot and relevant event envelopes carry only the bounded `PlanModeStateDto` projection (`available`, `workMode`, `phase`, and `awaitingAction`); the plan body remains in Pi Session entries and tool output.

`plan_mode_question` Extension UI requests are correlated with their originating tool call and projected as versioned Host questionnaire metadata. Display labels come from structured tool arguments, while responses use the untouched Pi RPC option strings. `plan_mode_complete` and completed question calls have dedicated tool renderers. Leaving a decision-ready Plan requires confirmation because `/plan exit` discards the ready state.

### Permission policy

The UI uses the same stable values as `@gotgenes/pi-permission-system`:

- `allow`: permit silently. This is intentionally rendered as a warning-colored choice because it removes the human gate.
- `deny`: block and surface an error.
- `ask`: request a human decision through extension UI.

The default is `ask`. The selector is browser-only until the permission extension is installed and a server-owned configuration endpoint exists. React never enforces tool permissions.

### Context usage

The context control presents `used tokens / model context window` when both values are authoritative. The selected model already exposes `contextWindow`; used-token projection is not currently part of the Octopus protocol, so the initial control renders an unknown state instead of inventing a percentage. It also explains that Pi's enabled auto-compaction owns recovery near the limit.

## Editor choice

Use Lexical core and `@lexical/react`, specifically one `LexicalComposer` with two `LexicalTypeaheadMenuPlugin` instances. Do not add `lexical-beautiful-mentions`:

- both `@` and `/` need the same keyboard, anchoring, and menu behavior;
- slash selection performs an action (insert the existing command text) rather than persisting a mention;
- the Workspace file catalog is local state and does not need a second asynchronous mention framework.

The typeahead menus render shadcn `Command` content inside a shadcn `Popover`. Lexical owns trigger matching, highlighted index, Enter/Escape, and IME boundaries; shadcn owns the visible surface and semantic styling.

## Data model

`FileMentionNode` extends `TextNode` and is registered in `LexicalComposer.initialConfig.nodes`. It stores:

```ts
interface WorkspaceReference {
  path: string;
  kind: 'file' | 'directory';
  label: string;
}
```

The node is a segmented text entity, cannot accept text at either boundary, and implements `clone`, `importJSON`, and `exportJSON`. Its visible fallback text is `@<path>`, so existing prompt submission remains compatible with Pi tools that can resolve Workspace-relative paths.

Submission produces both forms at the feature boundary:

```ts
interface ComposerDraft {
  text: string;
  references: WorkspaceReference[];
}
```

Only `text` is sent through the current realtime protocol. `references` is retained as the future structured payload contract; no backend behavior is inferred from it yet.

## Component boundaries

```text
Composer
├── ComposerAttachments
├── AgentComposerEditor
│   ├── FileMentionNode
│   ├── ComposerStatePlugin
│   ├── SubmitShortcutPlugin
│   ├── WorkspaceMentionsPlugin
│   └── SlashCommandsPlugin
└── ComposerToolbar
    ├── attachment trigger
    ├── WorkModeSelect
    ├── AgentControls (model and thinking only)
    ├── PermissionSelect
    ├── ContextUsageIndicator
    └── running/send controls
```

`AgentComposerEditor` is domain-agnostic: references, commands, placeholder, and callbacks arrive through props. Session queries, Zustand stores, realtime commands, upload mutations, and Workspace identity stay in `features/session` orchestration.

## Workspace mention lookup

The Session feature loads the existing Workspace file-tree cache and projects its normalized nodes into mention options. It includes both files and directories, filters case-insensitively by path/name, sorts exact/prefix matches first, and caps visible results. Selecting an option replaces the complete trigger query with one atomic mention followed by a space.

The first lookup uses the file explorer's existing two-level root preload. Directories already expanded elsewhere contribute their lazily loaded descendants. A future server search endpoint can replace this source without changing the generic editor contract.

## Slash command behavior

Typing `/` at a valid text boundary opens the inline Popover. `apps/server` exposes one command catalog that combines Web-supported Host commands with Pi's `get_commands` response. Host names are reserved so a runtime extension cannot shadow Web behavior.

| Command source        | Commands                                                              | Execution owner                                                                                         |
| --------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Pi runtime            | `extension`, `prompt`, and `skill` entries returned by `get_commands` | Insert `/<name> ` into the draft and submit through the existing `agent.prompt` RPC path (`rpc-prompt`) |
| Realtime              | `/compact`                                                            | Existing `agent.compact` RPC command                                                                    |
| Web UI                | `/model`, `/name`                                                     | Open the existing model selector or rename dialog                                                       |
| Server HTTP           | `/new`, `/fork`, `/clone`, `/export`                                  | Existing Session create/derive/export endpoints and client mutations                                    |
| Disabled placeholders | `/settings`, `/hotkeys`                                               | Visible but non-selectable until the corresponding Web dialogs exist                                    |

`/copy` is intentionally not registered because copying an unspecified target is ambiguous in a Composer command. Pi TUI-only commands including `/quit`, `/login`, `/logout`, `/trust`, `/share`, `/import`, `/resume`, and `/reload` are also omitted because the browser does not own equivalent behavior. The disabled `/settings` and `/hotkeys` registry entries include implementation TODOs at their server-owned declaration.

The empty-query menu displays every command from every source in one scrollable Popover; it never truncates `extension`, `prompt`, `skill`, or future Pi sources. A pinned summary shows each source as `source(count)` and its focus-preserving buttons jump to visible groups without changing the active filter. While the user continues typing in Lexical, the same summary shows matched/total counts and local search ranks exact command names first, followed by name prefixes, name substrings, and description matches. Group headings remain visible while their command rows scroll, and disabled placeholders remain visible without entering Lexical's keyboard-selectable option list.

Slash commands use a specialized renderer rather than the generic Workspace mention renderer. This keeps the all-source catalog, count summaries, and command-specific descriptions isolated from `@` mention behavior. Selecting a Pi runtime command preserves the old editable prompt flow; selecting an enabled Host command removes the trigger text and dispatches directly to its owner. The old toolbar command dialog remains removed to avoid two competing interaction forms.

The slash trigger accepts Pi's `-` and `:` command-name characters, including names such as `/review-loop` and `/skill:architecture-designer`. Typeahead Popovers do not move focus away from Lexical, so filtering remains continuous while the menu rerenders. Workspace mention triggers similarly allow path punctuation and spaces.

The `@` trigger rejects a currently matching slash query, and the slash trigger rejects a currently matching mention query. Native composition events are left to Lexical. When either menu is open, Lexical consumes Enter before the Composer submit shortcut.

Because shadcn Popover portals its content outside Lexical's `#typeahead-menu` anchor, the slash renderer synchronizes the highlighted option with its own scroll container. Arrow-up and Arrow-down navigation therefore keep the active command visible without scrolling the Composer page or transferring editor focus.

## Attachments

The browser picker accepts every file type and the attachment row uses a generic file icon for non-images. The staging service accepts all MIME types and preserves its opaque, one-time attachment IDs. At prompt conversion time, supported PNG, JPEG, WebP, and GIF files become Pi `ImageContent`; every other file follows Pi CLI's `@file` behavior and becomes an escaped `<file name="…">…</file>` UTF-8 text block appended to the user prompt.

This keeps binary images on Pi's native image path while giving text-oriented files deterministic prompt semantics. A future ingestion extension can add richer parsing for binary document formats without changing the browser attachment contract.

## State and lifecycle

- Lexical is the live editing source; plain text is mirrored to the Session store so drafts survive snapshot hydration.
- External draft changes are synchronized into Lexical without rebuilding the editor.
- Successful optimistic submission clears both the store draft and Lexical document.
- Editor nodes and command/reference registries are module-level or prop-driven; no components are defined inside render functions.
- Plan mode is hydrated from the authoritative Session snapshot and reconciled from server events; an in-flight request disables conflicting Composer controls until an acknowledgement or authoritative event arrives. Permission selection remains local presentation state.
- Transcript rows carry explicit `turnId` ownership. User messages start Turns, Agent messages/tools and in-run notifications inherit the active Turn, and Pi's authoritative `agent_settled` event completes it. Standalone control notifications have no `turnId`, so they cannot move or extend the preceding Turn's `Processed` marker. Hydration reconstructs the same ownership from durable user-message boundaries.
- Installing or changing effective skills invalidates the Session command catalog because Pi's `skill` commands are runtime resources.

## Accessibility and validation

- The editor is a multiline textbox with an accessible label and keyboard-shortcut description.
- Menus expose listbox/option semantics through the shadcn Command composition and retain Lexical keyboard selection.
- Icon buttons have labels and tooltips.
- Select content always contains `SelectGroup`; Base UI selectors receive explicit `items` collections.
- Server regressions cover attachment conversion, prompt correlation, context-usage snapshot projection, Host command registration, Pi command projection, disabled placeholders, and reserved-name collision behavior.
- Browser verification covers mention insertion, slash filtering, mode/permission/context controls, runtime logs, and responsive layout.
- Verification runs focused checks, Web and Server typechecks/lint, repository tests, then browser keyboard and responsive checks.
