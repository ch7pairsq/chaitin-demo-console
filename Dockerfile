FROM node:22.5.1-bookworm-slim AS console
WORKDIR /app
COPY . .
RUN chmod 0555 /app/docker-entrypoint.sh
ENTRYPOINT ["/app/docker-entrypoint.sh"]
EXPOSE 7411
CMD ["node", "server.mjs"]

# This separate target is deliberately the only component with Docker-engine
# access. It has no published host port and is reached only from demo-console.
FROM node:22.5.1-bookworm-slim AS release-runner
RUN apt-get update \
  && apt-get install -y --no-install-recommends docker.io git \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /runner
COPY release-runner/release-runner.mjs ./release-runner.mjs
COPY release-runner/release-agent-project.sh /usr/local/bin/release-agent-project.sh
RUN chmod 0555 /usr/local/bin/release-agent-project.sh
EXPOSE 7420
CMD ["node", "release-runner.mjs"]

FROM node:22.5.1-bookworm-slim AS trigger-bridge
WORKDIR /bridge
COPY trigger-bridge/agent-trigger-bridge.mjs ./agent-trigger-bridge.mjs
EXPOSE 7430
CMD ["node", "agent-trigger-bridge.mjs"]
