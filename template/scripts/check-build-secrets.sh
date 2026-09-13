#!/usr/bin/env bash
#
# check-build-secrets.sh — fail the build if a credential can reach a shipped image.
#
# Why this exists. On 2026-09-06 all 9 fleet repos were found shipping a live
# GitHub Packages token (and 7 a Sentry token) inside their published ECR
# images. Three mechanisms, all banned here:
#
#   ENV FOO_TOKEN=...          persists into the FINAL image config, so it is in
#                              `docker inspect` on the pushed image and in the
#                              running container's environment
#   ARG FOO_TOKEN              recorded in `docker history` for the build
#   --build-arg FOO_TOKEN=...  the workflow side of the same leak
#   --build-arg FOO_TOKEN      the no-`=` form, which INHERITS the value from the
#                              build environment and lands in history just the same
#
# The supported way to pass a credential to a build is a BuildKit secret mount:
#   Dockerfile:  RUN --mount=type=secret,id=npm_token,required=true \
#                    NODE_AUTH_TOKEN="$(cat /run/secrets/npm_token)" npm ci
#   workflow:    docker build --secret id=npm_token,env=NODE_AUTH_TOKEN ...
# The value is then never in argv, never in `docker history`, never in the config.
#
# Escape hatch: `build-secrets-guard: allow <reason>` in a comment on the
# offending line or the one directly above it.
#
# What this guard is NOT. It is a static grep over workflows, Dockerfiles and
# shell scripts: a defence against the ACCIDENTAL, literal form of the leak, not
# against a determined author. Shell indirection defeats it by construction:
#
#   ARG_NAME=NPM_TOKEN
#   docker build --build-arg="$ARG_NAME=$VAL" .
#
# The credential's name never appears on the offending line, so no regex over
# that line can see it, and tightening SECRET_RE or the directive patterns will
# not close the gap. Catching it would mean evaluating the shell, which a grep
# cannot do. This is a known, irreducible limitation, not a bug to fix.
#
# Why it is written down: eight bypasses have been closed in two waves (six on
# 2026-09-06, the `=`-joined form on 09-07, the quoted forms on 09-08), each
# found by someone re-reading the patterns and asking "what else gets past
# this?". A reader who believes the guard is exhaustive stops asking. Keep
# asking, and keep reviewing build steps by eye. salesport#82.

set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 2

# A name containing any of these words is treated as a credential. Matched
# CASE-INSENSITIVELY: `ENV npm_token=` leaks exactly as hard as `ENV NPM_TOKEN=`.
# DSN is deliberately absent -- a Sentry DSN is public by design and all 9 web
# images legitimately carry one. NEXT_PUBLIC_* is deliberately NOT exempt: a
# credential inlined into the client bundle is worse, not better.
SECRET_RE='[A-Za-z0-9_]*(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY|API_KEY|APIKEY|ACCESS_KEY)[A-Za-z0-9_]*'

fail=0 allowed=0 scanned=0

# Emit "<first-line-number>:<logical line>" with backslash continuations joined,
# so a directive split across lines is scanned as the one line Docker sees.
logical_lines() {
  awk '
    { if (cont) { buf = buf " " $0 } else { buf = $0; start = NR }
      if (buf ~ /\\[[:space:]]*$/) { sub(/\\[[:space:]]*$/, "", buf); cont = 1; next }
      cont = 0; print start ":" buf; buf = "" }
    END { if (buf != "") print start ":" buf }
  ' "$1"
}

is_allowed() {  # file line
  sed -n "$(( $2 > 1 ? $2 - 1 : 1 )),${2}p" "$1" | grep -q 'build-secrets-guard: allow'
}

report() {  # file line kind text
  if is_allowed "$1" "$2"; then
    printf '  ALLOWED  %s:%s  %s\n' "$1" "$2" "$4"; allowed=$((allowed + 1))
  else
    printf '  ✖ %s  %s:%s\n      %s\n' "$3" "$1" "$2" "$4"; fail=$((fail + 1))
  fi
}

scan() {  # file kind regex
  local f="$1" kind="$2" re="$3" ln text
  scanned=$((scanned + 1))
  while IFS=: read -r ln text; do
    [ -n "${ln:-}" ] || continue
    report "$f" "$ln" "$kind" "$(echo "$text" | sed 's/^[[:space:]]*//')"
  done < <(logical_lines "$f" \
             | sed 's/[[:space:]]#[^"'"'"']*$//' \
             | grep -vE '^[0-9]+:[[:space:]]*#' \
             | grep -iE -- "$re")
}

# ── 1. Dockerfiles: ENV/ARG naming a credential ──────────────────────────────
while IFS= read -r f; do
  [ -f "$f" ] || continue
  scan "$f" "ENV/ARG bakes a credential into the image" \
       "^[0-9]+:[[:space:]]*(ENV|ARG)[[:space:]]+.*\b${SECRET_RE}\b"
done < <(git ls-files | grep -iE '(^|/)[^/]*dockerfile[^/]*$')
dockerfiles=$scanned

# ── 2. Workflows and shell scripts: --build-arg passing a credential ─────────
# Both the `NAME=value` and the bare `NAME` (inherit-from-environment) forms,
# and both the space-separated (`--build-arg NAME=...`) and `=`-joined
# (`--build-arg=NAME=...`) flag syntaxes Docker's CLI accepts for either.
while IFS= read -r f; do
  [ -f "$f" ] || continue
  scan "$f" "--build-arg passes a credential" \
       "--build-arg[[:space:]=]+${SECRET_RE}([=[:space:]]|$)"
done < <(git ls-files | grep -iE '(^\.github/workflows/.*\.ya?ml$|\.sh$)')

echo
# A guard that scans nothing must not report success.
if [ "$dockerfiles" -eq 0 ]; then
  echo "build-secrets guard: ERROR — no Dockerfile was scanned. Refusing to pass." >&2
  exit 2
fi
if [ "$fail" -gt 0 ]; then
  echo "build-secrets guard: FAIL — $fail finding(s), $allowed allowed, $scanned file(s) scanned."
  echo "Use a BuildKit secret mount instead; see the header of scripts/check-build-secrets.sh."
  exit 1
fi
echo "build-secrets guard: PASS — $scanned file(s) scanned ($dockerfiles Dockerfile(s)), $allowed allowed."
