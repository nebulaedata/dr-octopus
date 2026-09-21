---
name: pi-packages
description: Design, create, refactor, review, publish, install, and troubleshoot standard Pi extension packages using the public @earendil-works Pi APIs. Use for Pi extensions, ExtensionAPI factories, extension events, tools, commands, custom UI, package.json pi manifests, Pi package resources, dependency isolation, pi install/update/config, package filtering, lifecycle cleanup, session replacement, or distributable extension architecture. Use pi-agent-sdk instead when the task is programmatic Pi SDK integration rather than an extension or Pi package.
---

# Pi Packages

Build portable Pi extensions and distributable Pi packages from the official Pi contracts. Keep product-specific architecture out of the solution unless the user's repository explicitly requires it.

## Source of truth

1. Inspect the target repository's instructions, package manager, TypeScript settings, locked Pi versions, and nearby extension conventions.
2. Consult the current official [Extensions documentation](https://pi.dev/docs/latest/extensions) and [Pi Packages documentation](https://pi.dev/docs/latest/packages) before relying on API signatures or package-manager behavior.
3. Treat the installed public type declarations as the exact contract when the repository pins a Pi version. Never import `src/**` or other package internals.
4. Apply repository-specific rules only to that repository. Do not turn local folder layouts, host adapters, protocols, dependency-injection patterns, or product terminology into general Pi requirements.

## Select the artifact

- Use a single `.ts` extension for small personal or project-local behavior.
- Use an extension directory with `index.ts` when helpers or tests justify multiple files.
- Use a Pi package when distributing extensions, skills, prompts, or themes through npm, git, or a shared local directory.
- Add a host-neutral service layer only when behavior is substantial or must be tested independently. Keep a simple extension simple.
- Add SDK, RPC, server, or application-host adapters only when the user explicitly needs them; they are not part of the standard Pi extension contract.

## Required reading by task

- Read [references/extension-development.md](references/extension-development.md) completely before creating, refactoring, or reviewing extension code. It defines factory design, event selection, state, cancellation, UI, errors, and session lifecycle.
- Read [references/package-contract.md](references/package-contract.md) completely before packaging, publishing, installing, updating, filtering, or diagnosing package resolution.
- Read both references for a distributable extension package.

## Development workflow

1. Define the smallest user-visible behavior and decide whether it belongs in a tool, command, event hook, renderer, provider, or resource bundle.
2. Choose the simplest artifact shape that satisfies distribution and dependency needs.
3. Implement a default-exported extension factory receiving `ExtensionAPI`. Register capabilities synchronously unless awaited startup discovery is genuinely required.
4. Keep validation and reusable behavior outside thin Pi adapters when complexity warrants it. Pass `AbortSignal` into cancellable nested work.
5. Start long-lived resources at `session_start` or first use, never in a factory that may run without a session. Dispose them idempotently at `session_shutdown`.
6. Persist state deliberately: use custom session entries for session state, files or external storage for cross-session state, and closures only for disposable instance state.
7. Declare package resources and dependencies according to the package contract. Include every runtime-loaded path in the published artifact.
8. Validate types, behavior, lifecycle, packed contents, and a clean Pi load. Review extension code as trusted executable code before installation.

## Design constraints

- Export a default factory; Pi loads TypeScript and JavaScript extensions through its supported loader.
- Use only public exports from the Pi packages locked by the target repository.
- Register LLM-facing tools with precise TypeBox schemas, useful descriptions, abort handling, bounded output, and stable result shapes.
- Use commands for explicit user actions and events for observation, interception, or lifecycle behavior.
- Check `ctx.hasUI` before interactive UI flows and degrade safely in print, JSON, or RPC modes.
- Do not retain a `pi`, context, session manager, or other session-bound object across session replacement. In `withSession`, use only the replacement context.
- Assume parallel tool execution unless the API contract guarantees serialization. Protect shared mutable state accordingly.
- Keep renderers synchronous and inexpensive; keep display-only transformations out of stored messages and model context.
- Never log secrets or expose system-prompt inputs, credentials, or sensitive context through UI metadata.
- Avoid speculative abstraction. A domain layer, injected factory, or adapter suite is optional engineering, not a Pi requirement.

## Verification

Run the checks supported by the target project, then verify the distribution boundary:

1. Typecheck and build when the package publishes built output.
2. Run focused unit and integration tests, including abort and cleanup paths.
3. Inspect `npm pack --dry-run` for manifest targets and runtime files.
4. Smoke-test with `pi -e <file-or-package>` or an isolated local install.
5. Exercise at least one registered capability and one relevant lifecycle transition.
6. Test non-interactive behavior when the extension uses `ctx.ui`.
7. Confirm shutdown is idempotent and leaves no process, socket, watcher, or timer alive.
8. For package changes, verify install, list/config behavior, filters, and scope precedence as applicable.

Do not write to the user's normal Pi settings during validation unless requested. Prefer an ephemeral run or isolated settings/home directory.

## Completion report

Report:

- the artifact shape and public Pi surfaces used;
- package resources and dependency decisions;
- lifecycle, cancellation, persistence, and non-interactive behavior;
- commands/tests run and any checks not run;
- any repository-specific constraints kept separate from the reusable Pi design.
