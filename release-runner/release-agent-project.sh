#!/bin/sh
# This file runs only inside the restricted release-runner container. It accepts
# no user-controlled shell expression: both project and commit are allow-listed.
set -eu

project="${1:?project required}"
revision="${2:?revision required}"
case "$project" in security-triage-agent|malware-triage-agent) ;; *) exit 64 ;; esac

release_dir="/deploy/${project}"
manifest="${release_dir}/agent-compose.yml"
generated="${release_dir}/.release-${commit}.yml"
case "$project" in
  security-triage-agent) agent="triage-operator"; capset="security-triage" ;;
  malware-triage-agent) agent="malware-triage-operator"; capset="malware-analysis" ;;
esac

cleanup() { rm -f "$generated"; }
trap cleanup EXIT HUP INT TERM
test -d "$release_dir" && test -f "$manifest" && test -f "$release_dir/.env"
test "$(stat -c '%a' "$release_dir/.env")" = "600"

git -C "$release_dir" fetch --quiet origin main
if [ "$revision" = "main" ]; then
  commit="$(git -C "$release_dir" rev-parse --verify origin/main)"
else
  commit="$revision"
  test "${#commit}" -eq 40
  case "$commit" in *[!0123456789abcdef]*) exit 64 ;; esac
fi
git -C "$release_dir" cat-file -e "${commit}^{commit}"
git -C "$release_dir" merge-base --is-ancestor "$commit" origin/main

# Read the manifest at the approved commit, then pin its Git workspace ref for
# this registration. The secret .env is not checked out, copied, printed, or changed.
git -C "$release_dir" show "${commit}:agent-compose.yml" | awk -v pinned="$commit" '
  /^[[:space:]]*ref:[[:space:]]+main[[:space:]]*$/ { sub(/main[[:space:]]*$/, pinned); changed=1 }
  { print }
  END { if (!changed) exit 42 }
' "$manifest" > "$generated"

docker exec agent-compose agent-compose up -f "/deploy/${project}/.release-${commit}.yml" >/dev/null
docker exec agent-compose agent-compose project ls --json | grep -F "$project" >/dev/null
docker exec octobus octobus capset list-methods "$capset" | grep . >/dev/null

# Non-mutating guest check: no raw sample, private IOC, or production alert is supplied.
if [ "$project" = "malware-triage-agent" ]; then
  docker exec agent-compose agent-compose -p "$project" run "$agent" --rm --command 'cd agent && node src/cli.js --self-check' >/dev/null
else
  docker exec agent-compose agent-compose -p "$project" run "$agent" --rm --command 'cd agent && node --check src/cli.js' >/dev/null
fi

# The runner returns only the immutable commit that it actually pinned.
printf '%s\n' "$commit"
