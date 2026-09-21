# Agent Core Guidelines

`packages/agent` is the shared, general-purpose Pi CLI and RPC Agent core. The repository root requires explicit user confirmation before any change under this directory. If that confirmation has not been given for the proposed Agent change, stop after read-only analysis and ask the user before editing, creating, moving, or deleting content.

## Agent Process Environment

When launching an Agent or tool-provider subprocess for a selected `agentDir`, explicitly set both `DR_OCTOPUS_CODING_AGENT_DIR` and `PI_CODING_AGENT_DIR` to the same resolved absolute path, overriding inherited values. Octopus and upstream Pi extensions may read different variable names. Authorization inspection and execution must use the same directory. Cover missing and conflicting inherited values in subprocess tests.

## Inline Extensions

Before creating or modifying a built-in Pi `InlineExtension` under `src/extensions`, read and follow the [Agent Inline Extension Development Guide](src/extensions/README.md) for directory layout, dependency boundaries, factory composition, Pi surface selection, lifecycle, safety, and testing requirements.

## Subagent Tool Delegation

When adding built-in tools intended for subagents, reuse shared tool registration and execution code rather than duplicating child implementations. For tools already registered by a child-compatible shared entry, add their names to `CHILD_TOOLS` in `src/extensions/subagent-bridge/contracts.ts`; parent snapshots, child filtering and the managed explorer derive from this list. A new module must first provide a child-compatible entry with explicit context and lifecycle boundaries. Preserve parent capability checks and child tool restrictions, and test foreground/background execution and unauthorized calls. Custom agents with explicit tool allowlists must also include the delegated names. See [ADR-0060](../../docs/adr/0060-shared-delegated-model-tools.md) for the design.
