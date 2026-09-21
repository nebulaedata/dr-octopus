# Dr.Octopus

English | [简体中文](./README.zh-CN.md)

A local-first, workspace-scoped general-purpose agent system built on Pi, with terminal TUI and Web interfaces.

## Install with an agent

Copy this prompt into an agent that can run terminal commands on your computer:

```text
Install and start Dr.Octopus on my computer. First check that Node.js >= 22.19.0 and npm are available; if either is missing or unsupported, help me set up the prerequisites. Then run npm install -g dr-octopus@latest, dr-octopus deps install, and dr-octopus gateway start --yes in order. Verify the result with dr-octopus --version, dr-octopus gateway status, and dr-octopus doctor. If a step fails, troubleshoot using the actual logs and report unresolved issues instead of claiming success. When finished, give me the actual Web URL (default: http://127.0.0.1:3000) and guide me through configuring my model provider and credentials in the interface. If you cannot run local commands, say so and provide step-by-step instructions.
```

The agent needs permission to execute local commands and access the network. Chat-only agents can provide instructions. You still need to configure your own model credentials after installation.

## Installation

Requires Node.js 22.19.0 or later.

```sh
npm install -g dr-octopus
```

On the first TUI or Gateway launch, you will be asked whether to install runtime dependencies. Installation requires a network connection. Runtimes are stored in `~/.dr-octopus/runtimes` under your home directory. You can also install them in advance:

```sh
dr-octopus deps install
```

Runtime dependencies include native modules. If a compatible prebuilt binary is unavailable, you will need a build toolchain for your platform.

## Quick start

Start the Web interface:

```sh
dr-octopus gateway start
```

The default URL is <http://127.0.0.1:3000>. Configure your model credentials and related settings before use.

Start the TUI in your current terminal:

```sh
dr-octopus tui
```

For scripts or non-interactive environments, install dependencies ahead of time with `dr-octopus deps install`, or explicitly allow installation at startup:

```sh
dr-octopus gateway start --install-deps
```

## Non-interactive installation and mirrors

Agents and scripts can skip the installation confirmation with `--yes` (or `-y`). This only authorizes installation; it does not switch download registries:

```sh
dr-octopus --yes
dr-octopus gateway start --yes
```

If downloads from the default registry time out, you can explicitly select the npmmirror registry:

```sh
dr-octopus deps install --yes --registry https://registry.npmmirror.com
dr-octopus gateway start --yes --registry https://registry.npmmirror.com
dr-octopus tui --yes --registry https://registry.npmmirror.com
```

`deps install` already authorizes installation and requires no additional confirmation. When dependencies are missing in a non-interactive environment, the bare command and startup commands require `--yes` or `--install-deps`; `--registry` alone does not authorize installation. Place TUI installation options before Agent arguments. Everything after `--` is passed unchanged to the Agent.

Registry precedence is: the current `--registry` option, existing npm/pnpm configuration, then the package manager's default registry. The mirror option applies only to this runtime dependency installation. It does not change global configuration or the release lockfile, and preserves scoped registries and their authentication settings. There is no region detection, automatic registry switching, or additional retry behavior.

Non-interactive installation still prints progress and errors, and exits with a nonzero code on failure. Native modules may download binaries from other sites or require local compilation, so switching npm registries may not resolve those failures. Check the network, credentials, download destination, or build toolchain based on the failing step.

This option does not affect the earlier global npm package installation. If that step also needs a mirror, use npm's own option:

```sh
npm install -g dr-octopus --registry https://registry.npmmirror.com
```

## Common commands

```sh
dr-octopus --help
dr-octopus --version
dr-octopus gateway status
dr-octopus gateway restart
dr-octopus gateway stop
dr-octopus doctor
dr-octopus runtimes list
dr-octopus runtimes prune --dry-run
```

`--help`, `--version`, and Gateway `status`/`stop` do not trigger dependency installation. `gateway stop` does not stop a separately running Scheduler.

## Configuration and data

User data is stored in `~/.dr-octopus/server` and `~/.dr-octopus/agent` by default, independently of the npm installation directory and versioned runtimes.

Use the environment variables section in Web settings to manage runtime configuration. You can also set `SERVER_HOST`, `SERVER_PORT`, `SERVER_DATA_DIR`, and `DR_OCTOPUS_CODING_AGENT_DIR` through the process environment. The published entrypoint does not load the source repository's `.env` file.

After changing Server configuration, run `dr-octopus gateway restart` to apply it.

## Updating

```sh
npm install -g dr-octopus@latest
dr-octopus gateway restart
```

Each new version installs its corresponding runtime dependencies on demand when first run. Preview old runtimes with `dr-octopus runtimes prune --dry-run`, then run `dr-octopus runtimes prune` to remove unused old versions.

## License

Original Dr.Octopus code is licensed under the [MIT License](./LICENSE). Third-party components retain their own licenses and rights; see [Third-party notices](./THIRD_PARTY_NOTICES.md).
