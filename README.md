<p align="center">
  <img src="https://raw.githubusercontent.com/nebulaedata/dr-octopus/main/apps/web/public/brand/logo-256.png" alt="Dr.Octopus logo" width="144" height="144" />
</p>

<h1 align="center">Dr.Octopus</h1>

<p align="center">
  <strong>Local-first · Workspace-scoped · TUI &amp; Web · Knowledge-base · Cron · Memory</strong><br />
  A general-purpose agent system built on Pi.
</p>

<p align="center">
  <a href="https://github.com/nebulaedata/dr-octopus/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-3b82f6" alt="License: MIT" /></a>
  <a href="https://github.com/earendil-works/pi"><img src="https://img.shields.io/badge/built_with-Pi-ef4444" alt="Built with Pi" /></a>
  <a href="https://pnpm.io/"><img src="https://img.shields.io/badge/pnpm-11.18.0-f69220?logo=pnpm&amp;logoColor=white" alt="pnpm 11.18.0" /></a>
</p>

<p align="center">
  <strong>English</strong> · <a href="https://github.com/nebulaedata/dr-octopus/blob/main/README.zh-CN.md">简体中文</a> · <a href="https://github.com/nebulaedata/dr-octopus/blob/main/README.dev.md">Development guide</a>
</p>

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

## Docker installation

Deploy the prebuilt [Docker Hub image](https://hub.docker.com/r/nebulaedata01/dr-octopus) on a Linux AMD64 server with Docker Engine and Docker Compose v2.20 or later. No local Node.js, pnpm, source checkout or image build is required. ARM64 is not currently supported.

1. Open [GitHub Releases](https://github.com/nebulaedata/dr-octopus/releases) and download `dr-octopus-docker-<image-tag>.zip` from the chosen release's **Assets**. Choose the Docker ZIP, not the source code archive. The ZIP contains Compose configuration and a pinned image version; a release without it is not yet ready for Docker installation.
2. Extract the ZIP into a dedicated directory on your server and open a terminal in that directory.
3. Create the configuration and start the service:

   ```sh
   cp .env.example .env
   # Edit .env if you need a different host port or binding address.
   docker compose pull
   docker compose up -d --wait --wait-timeout 660
   ```

Copy `.env.example` only on first installation to avoid overwriting your settings. Continue to startup only after the image pull succeeds. Initial startup may download extensions and take several minutes; the server needs outbound network access.

Open **`http://SERVER_IP:3000`** in your browser, replacing `SERVER_IP` with your server's reachable IP address. Configure your model provider and credentials in the Web interface. Allow TCP port `3000` through the server firewall and cloud security group. When Docker runs on your own computer, use <http://localhost:3000>.

| Setting in `.env`     | Default                        | Purpose                                         |
| --------------------- | ------------------------------ | ----------------------------------------------- |
| `IMAGE_TAG`           | Pinned by the installation ZIP | Image tag; `latest` is also supported           |
| `BIND_ADDRESS`        | `0.0.0.0`                      | Listen on all host interfaces for remote access |
| `HTTP_PORT`           | `3000`                         | Host port used in the browser URL               |
| `NPM_CONFIG_REGISTRY` | `https://registry.npmjs.org`   | Runtime npm downloads, including extensions     |

For deployments in China, set `NPM_CONFIG_REGISTRY=https://registry.npmmirror.com` in `.env`, then run `docker compose up -d --wait --wait-timeout 660`. This changes runtime npm downloads without rebuilding the image; Docker Hub pulls and the release build still use their existing sources. See the [npm mirror setup](https://github.com/nebulaedata/dr-octopus/blob/main/deploy/docker/README.md#optional-npm-mirror-for-china) for existing installations.

Direct IP access does not require a reverse proxy. For public access, configure authentication and HTTPS through a reverse proxy as described in the [Docker Compose guide](https://github.com/nebulaedata/dr-octopus/blob/main/deploy/docker/README.md#configuration-and-remote-access); the application has no built-in public login boundary. The installation ZIP does not include a reverse proxy or certificates.

Check status and logs from the installation directory:

```sh
docker compose ps
docker compose logs -f --tail 100
```

Server data, Agent configuration and workspaces are stored in three persistent Docker volumes. Create workspaces under `/workspaces` inside the container. `docker compose down` preserves these volumes; **`docker compose down -v` deletes their data**.

To upgrade, stop the service and back up the three volumes and `.env`, then set `IMAGE_TAG` to an existing Docker Hub version (or keep `latest` to follow stable releases) and run `docker compose pull` followed by `docker compose up -d --wait --wait-timeout 660`. Use these Compose commands for Docker deployments; the npm commands below apply to native installations. See the [full Docker Compose guide](https://github.com/nebulaedata/dr-octopus/blob/main/deploy/docker/README.md) for domain access, backups and troubleshooting.

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

Registry precedence is: the current `--registry` option, the official `NPM_CONFIG_REGISTRY` environment variable, existing npm/pnpm configuration, then the package manager's default registry. The mirror option applies only to this runtime dependency installation. It does not change global configuration or the release lockfile, and preserves scoped registries and their authentication settings. There is no region detection, automatic registry switching, or additional retry behavior.

The project uses npm’s official `NPM_CONFIG_REGISTRY` variable for runtime dependency and Pi extension downloads. For source development, set `NPM_CONFIG_REGISTRY=https://registry.npmmirror.com` in the root `.env` and restart the development process; for Docker, use the same variable in the installation directory’s `.env`. When running standalone npm or CLI commands, export this variable in your shell; npm does not automatically load the project `.env`.

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

## Development

For source setup, development commands, and architecture documentation, see the [development guide](https://github.com/nebulaedata/dr-octopus/blob/main/README.dev.md).

## License

Original Dr.Octopus code is licensed under the [MIT License](https://github.com/nebulaedata/dr-octopus/blob/main/LICENSE). Third-party components retain their own licenses and rights; see [Third-party notices](https://github.com/nebulaedata/dr-octopus/blob/main/THIRD_PARTY_NOTICES.md).
