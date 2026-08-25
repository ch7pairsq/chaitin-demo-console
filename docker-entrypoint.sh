#!/bin/sh
set -eu

# Secret bind mounts remain root:root 0600 on the host. Read them only during
# bootstrap, then drop permanently to the unprivileged application account.
read_secret() {
  name="$1"
  file_var="${name}_FILE"
  file="$(printenv "$file_var" 2>/dev/null || true)"
  if [ -n "$file" ] && [ -r "$file" ]; then
    value="$(tr -d '\r\n' < "$file")"
    test -n "$value"
    export "$name=$value"
    unset "$file_var"
  fi
}

if [ "$(id -u)" = "0" ]; then
  read_secret RELEASE_RUNNER_TOKEN
  read_secret RELEASE_UI_CONFIRMATION
  read_secret AGENT_TRIGGER_BRIDGE_TOKEN
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

exec "$@"
