# Pi Agent SDK Demo

This package contains minimal runnable demos for secondary development with the Pi Agent SDK.

## Setup

```bash
pnpm install
```

Set your provider API key as an environment variable, for example:

```bash
# PowerShell
$env:DEEPSEEK_API_KEY="sk-..."

# Bash
export DEEPSEEK_API_KEY="sk-..."
```

## Demos

### 1. Pi AI low-level loop

- **Faux provider (`demo:ai:faux`)** — no API key required. Shows a hand-rolled agent loop with `@earendil-works/pi-ai`, a custom tool, and scripted LLM responses.

  ```bash
  pnpm demo:ai:faux
  ```

- **DeepSeek provider (`demo:ai:deepseek`)** — uses a real DeepSeek API key.

  ```bash
  pnpm demo:ai:deepseek
  ```

### 2. Pi Coding Agent session (`session-demo.ts`)

Shows `createAgentSession` from `@earendil-works/pi-coding-agent` with a custom tool.

```bash
pnpm demo:session
```

### 3. Pi extension (`extension-demo.ts`)

Loads a custom extension file and verifies the registered tool is available.

```bash
pnpm demo:extension
```

### 4. Pi RPC subprocess (`rpc-client-demo.ts`)

Uses the official typed `RpcClient`, streams JSON/RPC events from a child process,
waits for `agent_settled`, and reads the final assistant text.

```bash
pnpm demo:rpc
```

## Notes

- The API key is never committed; keep it in environment variables or `~/.dr-octopus/agent/auth.json`.
- If no API key is available, the demos will exit with a clear error instead of hanging.
