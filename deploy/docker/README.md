# Install with Docker Compose

[简体中文](README.zh-CN.md)

Run a prebuilt image from `docker.io/nebulaedata01/dr-octopus`. Requires Docker Engine with Linux containers on AMD64, Docker Compose v2.20+, and network access to Docker Hub and extension download sites. Node.js, pnpm, source code and local image builds are not required. ARM64 is not yet supported.

## Download and install

Open the [GitHub Releases](https://github.com/nebulaedata/dr-octopus/releases) page and download `dr-octopus-docker-<image-tag>.zip` from the desired release. The ZIP appears only after the image is published and verified. If it is missing, that release is not yet ready for Docker installation; do not assume an npm release already has a Docker image.

Extract the ZIP into a dedicated directory, then run there:

```bash
cp .env.example .env
# Edit .env if needed.
docker compose pull
docker compose up -d --wait --wait-timeout 660
```

Only run `cp` on the first installation. The archive pins `IMAGE_TAG` to its tested image. If using files from the source repository instead, explicitly select an existing Docker Hub tag in `.env`; the checked-in version is only an example.

Open `http://SERVER_IP:3000` in your browser, replacing `SERVER_IP` with the Docker host's reachable IP address, and configure your model provider and credentials. Allow inbound TCP 3000 in the host firewall and cloud security group (or the port selected by `HTTP_PORT`). Direct access by IP does not require a reverse proxy. First startup may still download extensions, so this is not an offline installation. Startup can take about ten minutes. Readiness checks the Gateway, not model credentials or external providers.

## Configuration and remote access

| Variable             | Meaning                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `IMAGE_TAG`          | Published image tag, such as `0.0.10` or `0.0.10-r1`; pin an exact tag for repeatable upgrades |
| `BIND_ADDRESS`       | Host interface, default `0.0.0.0` (all interfaces)                                             |
| `HTTP_PORT`          | Host port, default `3000`; container port stays `3000`                                         |
| `SERVER_CORS_ORIGIN` | Actual browser origins, comma-separated, such as `https://octopus.example.com`                 |
| `LOG_LEVEL`          | Default `info`                                                                                 |

For same-origin access by IP, `SERVER_CORS_ORIGIN` can remain empty. When using a domain, set it to the actual browser origin, including non-default ports, with no wildcard, URL path or trailing slash. The installation does not configure a reverse proxy, DNS or certificates.

The service has no built-in login boundary for public deployment, and CORS is not authentication. For untrusted public access, configure authentication and HTTPS covering HTTP, WebSocket and SSE according to the project's [security policy](https://github.com/nebulaedata/dr-octopus/blob/main/SECURITY.md). If using a reverse proxy on the host, you can set `BIND_ADDRESS=127.0.0.1` to prevent direct backend access. `0.0.0.0` is a bind address; visitors use the server's actual IP address or domain.

Compose environment values override persisted settings of the same name. After changing `.env`, run `docker compose up -d --wait --wait-timeout 660`; `restart` alone does not apply changes.

## Data and operations

| Volume        | Container directory             | Contents                                                |
| ------------- | ------------------------------- | ------------------------------------------------------- |
| `server-data` | `/home/node/.dr-octopus/server` | Database, sessions, attachments and Server settings     |
| `agent-data`  | `/home/node/.dr-octopus/agent`  | Agent configuration, credentials and extensions         |
| `workspaces`  | `/workspaces`                   | Workspace files; create workspaces below this directory |

The Compose project remains `dr-octopus`, so volume names start with `dr-octopus_`. The container runs as `node` (UID/GID 1000). New named volumes inherit directory ownership; bind mounts need matching write permissions. Do not mount over all of `/home/node` or `.dr-octopus`: the installed runtime must remain available in the image. Files outside persistent directories are lost on recreation.

```bash
docker compose ps
docker compose logs -f --tail 100
docker compose exec -T dr-octopus dr-octopus gateway health --json
docker compose exec -T dr-octopus dr-octopus --version
docker compose stop
docker compose up -d --wait --wait-timeout 660
```

## Upgrade, recovery and existing deployments

Before upgrading, stop the service, back up all three volumes, and record the image tag and `.env`. Edit `IMAGE_TAG`, then run:

```bash
docker compose pull
# Continue only if pull succeeded.
docker compose up -d --wait --wait-timeout 660
```

Image-only revision tags (for example `0.0.10-r1`) contain the same npm application version with a revised container image. `latest` tracks the newest promoted stable image; exact tags are recommended for production.

Replacement briefly interrupts this single-instance service. A failed pull does not replace the running container. If startup fails, inspect `docker compose ps --all` and `docker compose logs --tail 150`. There is no automatic database rollback. Before selecting an older image, confirm data compatibility or restore its matching backup. `docker compose down` retains volumes; **`down -v` deletes data**.

When switching from the former locally-built Docker deployment, back up first, replace Compose, and add `IMAGE_TAG` to the existing `.env`. Retain your port/origin settings. If the existing `.env` has `BIND_ADDRESS=127.0.0.1`, change it to `0.0.0.0` for direct remote access. `DR_OCTOPUS_VERSION` and `NPM_REGISTRY` are no longer deployment inputs. Keep the original project name (including any custom `-p` / `COMPOSE_PROJECT_NAME`) and volume mappings to reuse data. Do not run both configurations concurrently.

## Maintainers

Images are built on GitHub Actions after the npm package and GitHub Release are published; maintainers do not need local Docker. See the [execution steps and release design](https://github.com/nebulaedata/dr-octopus/blob/main/docs/architecture/docker-distribution.md). Dockerfile, release helpers and tests are kept in Git for reproducibility, but are not included in the user installation ZIP.
