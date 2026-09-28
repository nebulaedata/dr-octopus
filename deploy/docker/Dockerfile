# syntax=docker/dockerfile:1
# /**
#  * @author Codex
#  * @description Installs an exact npm release and native runtime for a non-root container.
#  */
FROM node:24-bookworm-slim

ARG DR_OCTOPUS_VERSION
ARG IMAGE_REVISION=0
ARG SOURCE_COMMIT

LABEL org.opencontainers.image.source="https://github.com/nebulaedata/dr-octopus" \
    org.opencontainers.image.licenses="MIT" \
    org.opencontainers.image.version="${DR_OCTOPUS_VERSION}" \
    org.opencontainers.image.revision="${SOURCE_COMMIT}" \
    com.nebulaedata.dr-octopus.image-revision="${IMAGE_REVISION}"

RUN test -n "${DR_OCTOPUS_VERSION}" \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git python3 make g++ ripgrep \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global "dr-octopus@${DR_OCTOPUS_VERSION}" --registry=https://registry.npmjs.org \
    && npm cache clean --force \
    && mkdir -p /home/node/.dr-octopus/server /home/node/.dr-octopus/agent /workspaces \
    && chown -R node:node /home/node/.dr-octopus /workspaces

# The runtime cache is tied to the OS account home, not just the HOME variable.
# Build and run as the same account; only application data is mounted as volumes.
USER node
WORKDIR /workspaces
RUN dr-octopus deps install --registry https://registry.npmjs.org

ENV NODE_ENV=production \
    SERVER_HOST=0.0.0.0 \
    SERVER_PORT=3000 \
    SERVER_DATA_DIR=/home/node/.dr-octopus/server \
    DR_OCTOPUS_CODING_AGENT_DIR=/home/node/.dr-octopus/agent

EXPOSE 3000
CMD ["dr-octopus", "gateway", "run", "--timeout", "600000"]
