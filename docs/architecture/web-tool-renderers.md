# Tool Renderer Development

The `apps/web/src/features/session/ToolRenderers/` component group owns the presentation of Pi tool executions in the Web conversation. It keeps the stable Session projection, renderer selection, and business-specific UI separate so a custom card cannot change transport or transcript behavior accidentally.

## Data flow

```text
Pi runtime or persisted ToolResultMessage
  -> stores/session/utils/tool-result-projection.ts
  -> ToolProjection
  -> tool-renderers/ToolRenderer.tsx
     -> custom renderer
     -> Pi built-in renderer
     -> fallback renderer
  -> ToolCard shell
```

`ToolCard.tsx` owns only the shared tool-row shell: name, summary, status node, recorded duration, and collapse behavior. A renderer owns the expanded result body and may provide its collapsed summary and icon through `ToolRendererDefinition`.

Registrations may provide an optional `label: Record<string, string>` mapping exact tool names to readable titles. The shell reads `label?.[tool.name]` and falls back to the original tool name when no mapping exists; the exact tool name remains in the trigger tooltip. Status uses a small timeline node; running and error states also retain visible localized text, while success remains in the accessible trigger name. Registrations can also provide `getLabel(tool)` for a title derived from validated structured arguments; the tooltip retains the outer invocation name. The shell never branches on a business tool name.

## File responsibilities

| File                                             | Responsibility                                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `ToolRenderer.tsx`                               | Owns private custom/built-in registrations, their selection order and the public component render callback. |
| `ToolRendererParts.tsx`                          | Renderer Props, shared visual sections, content blocks and safe fallback.                                   |
| `CustomToolRenderers/index.ts`                   | Component-only exports for product-specific renderers.                                                      |
| `BuiltinToolRenderers.tsx`                       | Presentation for Pi built-in tools.                                                                         |
| `session/utils/*-projection.ts`                  | Pure structured-data projections and collapsed summaries, without component imports.                        |
| `session/utils/tool-renderer-utils.ts`           | Bounded serialization and field readers.                                                                    |
| `stores/session/utils/tool-result-projection.ts` | Shared live and persisted Pi result normalization.                                                          |

Only components and their types are exported from component files, preserving Fast Refresh. Registration arrays and selection stay private inside `ToolRenderer.tsx`; parsers and summaries belong to `session/utils/`. Do not export a runtime registration function or a resolver for callers to bypass the component contract.

## Result contract

The `image_generate` renderer reads a versioned image receipt from `details`: actual provider/model, workspace-relative and absolute paths, MIME types and dimensions. Images load through the workspace image preview endpoint; downloading uses the existing file endpoint. Live and restored receipts share the same parser. Unknown versions, malformed receipts and tool failures retain `ToolContent`; missing files show an explicit unavailable state. Generated-image cards share a responsive width capped at 448px. Images fill that width and use their original aspect ratio to determine height, without cropping or a letterboxed preview area. Missing-image states retain a compact fixed-height placeholder. The image itself uses a zoom-in cursor and opens the original; no overlay preview button is shown. Model, dimensions, download and optional file paths remain below the preview. No raw image base64 is stored in receipt metadata. See [image generation](imagegen.md).

Pi `0.84.3` tool content contains only text and image blocks. The browser projection separates model-facing content from UI-oriented structured data:

```ts
interface ToolProjection {
  arguments?: unknown;
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  details?: unknown;
  // status, timing, usage, and runtime metadata omitted
}
```

Use `details` as the stable contract for a structured UI. Use `content` for model-facing text or images and as the human-readable fallback. Do not make a first-party renderer depend on parsing formatted `content.text` when the tool can return the same information in `details`.

If the Pi result schema changes, update `tool-result-projection.ts` and its regression tests first. Do not teach individual renderers to understand runtime event envelopes. Live events and restored history must produce the same `ToolProjection` shape.

## Add a custom renderer

Create a PascalCase component under `tool-renderers/CustomToolRenderers/`, then expose it from that folder's `index.ts`:

```tsx
/**
 * @author DeveloperName
 * @description Renders the current Workspace returned by the Octopus extension tool.
 */

import { ToolContent, ToolSection } from '../ToolRendererParts';
import type { ToolRendererProps } from '../ToolRendererParts';

/**
 * Renders the Workspace result while retaining model-facing content.
 */
export function WorkspaceCurrentToolRenderer({ tool }: ToolRendererProps) {
  return (
    <ToolSection title="Workspace">
      <ToolContent blocks={tool.content} />
    </ToolSection>
  );
}
```

Export it from `CustomToolRenderers/index.ts`:

```ts
export { WorkspaceCurrentToolRenderer } from './WorkspaceCurrentToolRenderer';
```

Register it in `ToolRenderer.tsx`:

```ts
import { BriefcaseBusinessIcon } from 'lucide-react';
import { WorkspaceCurrentToolRenderer } from './CustomToolRenderers';

// ToolRendererDefinition is private to this file; add an entry to its existing array.

const CUSTOM_TOOL_RENDERERS: readonly ToolRendererDefinition[] = [
  {
    names: ['workspace_current'],
    component: WorkspaceCurrentToolRenderer,
    icon: BriefcaseBusinessIcon,
  },
];
```

Keep projection and summary helpers under `features/session/utils/`, with no component imports. Add a named, documented `summarize` function only when the collapsed card benefits from a short stable label.

Registrations match exact Pi tool names. Custom registrations are evaluated before built-ins, which allows a product-specific renderer to intentionally replace a built-in presentation. Avoid overlapping names unless that override is deliberate.

Do not add runtime registration or mutate the registry during module loading. The compile-time list keeps ordering deterministic and avoids duplicate registrations during HMR.

## Fallback guarantee

Every tool must remain renderable without a custom component. `FallbackToolRenderer` safely handles:

- unknown arguments as bounded JSON;
- Pi text and image content blocks;
- arbitrary structured `details`;
- empty results.

Error results must keep their `content` visible even when the renderer shows a structured result or an argument preview. Only optional raw details are collapsed; the outer tool row retains the error status.

Never remove or bypass this fallback when adding a renderer. A specialized renderer may reuse `ToolContent`, `ToolSection`, `formatToolValue`, `isRecord`, and `readString` instead of duplicating defensive parsing.

## Highlighted text and scrolling

Raw MCP and fallback renderers keep arguments outside a shared `ToolOutputSection`. Images and text output are immediately visible when the tool row opens. Arguments and Output headings use Braces and Terminal icons aligned with the Details trigger. Optional details sit below the output without a divider, in a shadcn `Collapsible` with a `ChevronRight` trigger labelled Details; only this details disclosure starts closed. Details-only results still offer the disclosure; empty results show the normal empty output message without a toggle. The details panel stays mounted while its enclosing tool row is open to preserve scroll state; closing the outer tool row still unmounts the renderer. This presentation state is local and is not reset by streamed tool updates. Specialized structured result cards retain their existing layout.

Raw arguments and details use JSON `ToolCodeBlock`; textual output uses the same component with a known code language or `plaintext` for logs. Built-in file reads and diffs retain their language, while images and specialized structured result layouts keep their own renderers.

The built-in `write` row summarizes the input path and character count in muted header text, without implying success. Its input `content` is available in an initially closed Write content disclosure, highlighted according to the path extension and bounded by the shared code-block viewport. The input preview unmounts when closed; actual tool output stays visible independently, including failures. Empty string inputs show a zero count and an empty preview; missing or malformed content omits both. Streaming and oversized inputs follow the shared Highlight policy.

`ToolCodeBlock` owns the Web `Highlight` language and streaming policy. The business-agnostic `@octopus/custom-ui/components/code-block` owns the shadcn `ScrollArea`, semantic theme surface and compact `text-xs` typography. Its child renderer supplies `pre/code`. The viewport is the sole overflow owner; long lines wrap, short blocks keep their natural height and tall blocks scroll. Vertical scroll chaining remains enabled: once a block reaches its top or bottom, further scrolling continues in the enclosing conversation. Default limits are 192px for arguments/commands, 384px for output, 288px for details and 512px for diffs. Feature-specific compact previews can supply a lower limit.

`Highlight` skips syntax parsing for plain text, ongoing tool streams and inputs exceeding 100,000 characters. It safely renders source text in those cases and resumes syntax highlighting when a bounded stream completes. This policy does not truncate text or virtualize large DOM output; existing `formatToolValue` bounds for serialized arguments/details remain in force. Collapsed tool bodies stay unmounted.

## Review checklist

- The renderer lives in the Session feature and contains only presentation logic.
- Business data comes from `ToolProjection`; the component does not query server state or inspect runtime envelopes.
- Structured UI reads validated fields from `details` or `arguments` defensively.
- Large file bodies, terminal output, and raw JSON remain bounded and scrollable.
- Image output uses the existing attachment renderer and MIME safeguards.
- Unknown tools still resolve to `FallbackToolRenderer`.
- Realtime and hydrated Session tests cover any projection contract change.
- Registry tests cover new selection or override behavior when it is non-obvious.

## Validation

Run focused checks while iterating:

```bash
pnpm --filter @octopus/web test
pnpm --filter @octopus/web lint
pnpm --filter @octopus/web exec tsc -b --pretty false
```

For a visible renderer change, open a Session containing the target tool, expand the card, and verify desktop rendering, console health, collapse interaction, and the fallback state. Finish with the repository-level `pnpm test`, `pnpm lint`, and `pnpm typecheck` when the projection contract or shared types changed.

Knowledge cards render the existing structured snapshots for `knowledge_search.details.hits`, `knowledge_list_collections.details.items`, and `knowledge_read.details` (its citation ID comes from arguments). `knowledge-projection.ts` bounds display values and provides collapsed summaries. Collection cards show scope and remote availability; evidence cards show ordinal positions, locators and optional OCR labels, with a reading dialog for the snapshot. Counts describe evidence items, not unique documents or confidence. They do not fetch fresh source content or claim historical citations are still accessible. Malformed or error results retain native tool content; loading, empty results and unavailable sources have distinct states. Validate light/dark themes, narrow containers, long metadata, dialog keyboard interaction and fallback content.

Memory cards register `memory_recall` and `memory_read` with `MemoryToolRenderer`, tool-name label mappings and `summarizeMemoryTool`. `memory-tool-projection.ts` accepts only version 1 metadata with a known action, boolean completeness and readable entries. Cards show at most 20 ordered entries with bounded topics, translated categories, summaries, supplied body text and expandable source excerpts. Search candidates, pagination and budget stops have distinct coverage copy; missing references remain visible and do not count as successfully read facts. Source excerpts describe only the returned snapshot, never an exhaustive provenance count. Original text/image output remains expandable; errors, unknown versions and malformed entries retain `ToolContent` fallback. Cards never fetch current memory or infer a save from assistant text. Runtime memory status is validated separately by Server and cleared on runtime replacement. Validate light/dark and narrow layouts, long metadata, pending/empty/partial/unavailable states, nested disclosures, keyboard navigation and fallback output.

Committed saves arrive separately as `custom` messages with `customType: octopus-memory-operation`, not tool results. The shared message normalizer preserves this identity for live events and history. `MessageView` uses `memory-save-projection.ts` and `MemorySaveCard` for the existing exact `已保存 N 条长期记忆。` receipt (positive safe integer). The card shows the historical operation count, available timestamp and management link; it does not invent saved content or fetch current memory as a historical snapshot. Assistant text, unknown custom formats and failed/interrupted messages retain ordinary message rendering; `display: false` stays hidden. Cover live/history equivalence, duplicate events, hidden receipts and fallback behavior when changing this contract.

Explicit save requests with no new commit, unavailable capability or failed curation emit `octopus-memory-outcome`. These are durable ordinary custom messages, never success cards or tool results. Ordinary automatic curation with no changes updates runtime status without adding a transcript message. Both result types use `triggerTurn: false`; they do not start another Agent run. See [ADR-0067](../adr/0067-memory-run-lifecycle.md) for the trigger and lifecycle contract.

## Feature entry and selection contract

External consumers import Session components from `features/session`. `ToolRenderer.tsx` keeps its ordered registration arrays and resolver private, and exposes the `ToolRenderer` component with a render callback. `ToolCard` owns only common chrome and collapse state. Registry selection tests exercise the component callback, not a production resolver export. `CustomToolRenderers/index.ts` exports components only; parser and summary helpers live directly in `features/session/utils/`. Renderer Props belong to `ToolRendererParts.tsx`; registration types stay with `ToolRenderer.tsx`.

## MCP proxy presentation

The `mcp` registration reads the exact invoked remote tool name from `arguments.tool` through `mcp-tool-projection.ts`; incomplete arguments and discovery calls retain the `mcp` title. The MCP renderer shows bounded arguments, then visible image and text output, with initially collapsed structured details below. Image blocks remain accessible on errors and are never duplicated in the text output. `ImageAttachment` uses the existing image viewer for keyboard-accessible previews, zoom and rotation; inline MCP previews preserve the complete image aspect ratio. Unsupported MIME types keep the attachment fallback. This is a Web presentation change; live/history normalization and native tool contracts remain unchanged.

MCP images use the `ImageAttachment` preview variant as a responsive shadcn Attachment card capped at 448px within Output, without an extra Images section heading. The card places its title, format, decoded payload size and decoded pixel dimensions in a footer below the image; its keyboard-accessible preview trigger covers only the image. Dimensions come from the loaded image and are tied to its source, never inferred from textual tool logs; they stay absent until available. Metadata wraps on narrow screens. The image fills the card width with natural height, no image padding, letterboxing or cropping. The image-only trigger uses a zoom-in cursor without an expand icon; clicking or keyboard activation opens the original image in the shared preview dialog. The metadata footer remains selectable and does not open the preview. Compact image attachments, including read-tool thumbnails, use one Attachment border with no padding or overlay expand icon. The full thumbnail remains a keyboard-accessible preview trigger.

## Consecutive tool timelines

`Conversation` groups tools through `session/utils/transcript-layout.ts` using explicit Turn ownership. Visible messages (including reasoning), notifications, compactions, and Turn boundaries break groups. Empty persisted assistant envelopes are skipped using the same visibility contract as `MessageRow`. Hidden final messages still retain the Turn retry and duration markers. Tools without known Turn ownership remain separate.

`ToolTimeline` renders a localized group heading and an ordered list inside a compact shadcn Card, including one-tool groups. The subtle card boundary owns the whole group, without per-row card borders. Tool names stay on one line; long summaries yield width and truncate before squeezing names, with stacked summaries on narrow screens. Status and duration remain unbroken. Each row subscribes only to its own tool projection. The group subscribes to aggregate status, not streamed arguments or output. Group keys use the first tool ID and row keys use tool IDs, so appending a tool preserves existing disclosures. A one-tool group uses the same component tree as a growing group.

The business-agnostic `Timeline` and `TimelineItem` live in `@octopus/custom-ui/components/timeline`. They own list semantics, density, node slots and theme-token rails only. `TimelineItem` accepts `extendLine` so expanded tool rows retain a rail through their content even for a single-node group or the final node. Collapsed final nodes hide that trailing rail; connections between adjacent nodes remain visible. The Web `components/Timeline` wrapper retains its existing general-purpose disclosures and default spacing for schedule and retained-execution views. Shared shadcn source components are not modified.

Running tool titles use shadcn `Marker` and `MarkerContent` with the existing `shimmer` utility; terminal titles stop shimmering. Title triggers omit left padding to sit closer to timeline status nodes, while expanded result padding stays unchanged.

Tool rows compose shadcn `Collapsible` with `ChevronRightIcon` (right when closed, down when open). Results mount only when expanded and reuse the existing registered renderer and fallback. Metadata summaries appear only when supplied by the renderer. Completed durations use positive finite recorded timestamp differences; missing or invalid timings stay hidden. These projected timings are not guaranteed precise runtime telemetry for restored history. Timeline position expresses transcript order, not a claim that parallel tools executed sequentially.

Regression coverage includes hidden assistant messages, visible boundaries, Turn marker placement, stable append identities, live/history grouping, local streaming subscriptions, shared list semantics, independent disclosures, image previews, narrow layouts, keyboard focus, and existing renderer fallbacks.

## Skill invocation presentation

Pi persists automatic skill loads as ordinary `read` invocations and explicit `/skill:name` commands as user messages containing `<skill name="…" location="…">` envelopes. The Web derives presentation from these existing records without adding Agent events or changing stored tool names. Canonical `skills/<name>/SKILL.md` reads select `SkillToolRenderer` before the built-in read renderer through an argument predicate; supporting files, incomplete arguments and unrelated Markdown files retain the ordinary renderer. The row says Load skill, summarizes the directory name and preserves read errors, instructions and truncation diagnostics. A successful read means instructions loaded, not successful completion of the skill task.

Expanded user skill commands show the recorded skill name with instructions and location in a collapsed disclosure, followed by the original prompt. Assistant text and malformed envelopes retain normal Markdown rendering. Live and restored tool records use the same selector; transcript identities, ordering and status are unchanged.
