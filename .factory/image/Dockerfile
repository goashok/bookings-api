# Sandbox image for bookings-api: Node 22, git and Claude Code, with the npm cache warmed from
# package-lock.json so `npm ci` needs no network for the packages already locked.
#   docker build --build-context project=. -t cradleworks/bookings-api-dev:1 .factory/image
FROM node:22.23.4-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g @anthropic-ai/claude-code@2.1.319 \
 && npm cache clean --force
COPY --from=project package.json package-lock.json /tmp/deps/
RUN cd /tmp/deps \
 && npm ci --cache /opt/npm-cache --no-audit --no-fund \
 && cd / && rm -rf /tmp/deps \
 && chmod -R a+rwX /opt/npm-cache
ENV npm_config_cache=/opt/npm-cache
WORKDIR /workspace
