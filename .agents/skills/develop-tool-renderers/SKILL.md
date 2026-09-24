---
name: develop-tool-renderers
description: Create, refactor, or review Dr.Octopus Web ToolCard renderers, custom Pi tool cards, renderer registrations, fallback behavior, or tool-result browser projections.
---

# Develop Tool Renderers

Before changing a tool renderer or its Session projection, read [`docs/architecture/web-tool-renderers.md`](../../../docs/architecture/web-tool-renderers.md) completely and treat it as the implementation contract.

Preserve these non-obvious invariants:

- normalize live and persisted Pi results into the same `ToolProjection`;
- keep the shared `ToolCard` shell free of tool-specific business logic;
- expose product-specific renderer modules through `CustomToolRenderers/index.ts`;
- keep compile-time registrations and deterministic selection private to `ToolRenderer.tsx`, exposed through its component render callback;
- keep pure parsers and summary helpers in `features/session/utils/`; component entrypoints export components and their Props only;
- keep custom, built-in, and fallback selection deterministic;
- retain the fallback for every unrecognized tool;
- prefer structured `details` over parsing formatted model-facing text.

Follow the guide's file boundaries, extension example, review checklist, and validation commands. If the Pi message or tool schema itself is changing, also use the repository's `pi-agent-sdk` guidance and verify against the installed Pi declarations.
