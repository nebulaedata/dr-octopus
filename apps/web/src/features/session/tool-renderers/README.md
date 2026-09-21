# Tool Renderer Development

This directory owns the presentation of Pi tool executions in the Web conversation. It keeps the stable Session projection, renderer selection, and business-specific UI separate so a custom card cannot change transport or transcript behavior accidentally.

## Data flow

```text
Pi runtime or persisted ToolResultMessage
  -> stores/session/tool-result-projection.ts
  -> ToolProjection
  -> tool-renderers/registry.ts
     -> custom renderer
     -> Pi built-in renderer
     -> fallback renderer
  -> ToolCard shell
```

`ToolCard.tsx` owns only the shared shell: icon, name, summary, status, and collapse behavior. A renderer owns the expanded result body and may provide its collapsed summary and icon through `ToolRendererDefinition`.

Registrations may provide an optional `label: Record<string, string>` mapping exact tool names to readable titles. The shell reads `label?.[tool.name]` and falls back to the original tool name when no mapping exists; the exact tool name remains in the trigger tooltip. All tools retain the existing status badge logic. The shell never branches on a business tool name.

## File responsibilities

| File                                       | Responsibility                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| `types.ts`                                 | Renderer component props and registration contract.                          |
| `registry.ts`                              | Deterministic custom -> built-in -> fallback selection.                      |
| `custom-tool-renderer-definitions.ts`      | The only registration entry for product-specific and extension tools.        |
| `CustomToolRenderers/index.ts`             | Public export boundary for product-specific renderer components and helpers. |
| `builtin-tool-renderer-definitions.ts`     | Pi built-in tool registrations.                                              |
| `BuiltinToolRenderers.tsx`                 | Presentation for `bash`, `read`, `edit`, `write`, `grep`, `find`, and `ls`.  |
| `ToolRendererParts.tsx`                    | Shared visual sections, content blocks, and the safe fallback.               |
| `tool-renderer-utils.ts`                   | Safe serialization, field readers, and collapsed-summary helpers.            |
| `stores/session/tool-result-projection.ts` | Live and persisted Pi result normalization; it is not a React module.        |

Keep component files limited to React components so Fast Refresh remains valid. Keep registration arrays, parsers, and summary functions in ordinary `.ts` modules.

## Result contract

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
import type { ToolRendererProps } from '../types';

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

Register it in `custom-tool-renderer-definitions.ts`:

```ts
import { BriefcaseBusinessIcon } from 'lucide-react';
import { WorkspaceCurrentToolRenderer } from './CustomToolRenderers';
import type { ToolRendererDefinition } from './types';

export const CUSTOM_TOOL_RENDERERS: readonly ToolRendererDefinition[] = [
  {
    names: ['workspace_current'],
    component: WorkspaceCurrentToolRenderer,
    icon: BriefcaseBusinessIcon,
  },
];
```

Add a named, documented `summarize` function only when the collapsed card benefits from a short stable label.

Registrations match exact Pi tool names. Custom registrations are evaluated before built-ins, which allows a product-specific renderer to intentionally replace a built-in presentation. Avoid overlapping names unless that override is deliberate.

Do not add runtime registration or mutate the registry during module loading. The compile-time list keeps ordering deterministic and avoids duplicate registrations during HMR.

## Fallback guarantee

Every tool must remain renderable without a custom component. `FallbackToolRenderer` safely handles:

- unknown arguments as bounded JSON;
- Pi text and image content blocks;
- arbitrary structured `details`;
- empty results.

Error results must keep their `content` visible even when the renderer shows a structured result or an argument preview.

Never remove or bypass this fallback when adding a renderer. A specialized renderer may reuse `ToolContent`, `ToolSection`, `formatToolValue`, `isRecord`, and `readString` instead of duplicating defensive parsing.

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

Committed saves arrive separately as `custom` messages with `customType: octopus-memory-operation`, not tool results. The shared message normalizer preserves this identity for live events and history. `MessageRow` uses `memory-save-projection.ts` and `MemorySaveCard` for the existing exact `已保存 N 条长期记忆。` receipt (positive safe integer). The card shows the historical operation count, available timestamp and management link; it does not invent saved content or fetch current memory as a historical snapshot. Assistant text, unknown custom formats and failed/interrupted messages retain ordinary message rendering; `display: false` stays hidden. Cover live/history equivalence, duplicate events, hidden receipts and fallback behavior when changing this contract.
