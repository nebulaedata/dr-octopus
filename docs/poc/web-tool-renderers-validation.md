# web-tool-renderers：概念验证与验收

架构设计：[原设计](../architecture/web-tool-renderers.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

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
