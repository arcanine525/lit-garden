#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
compose() {
  docker compose --env-file .env.local "$@"
}
setup() {
  umask 077
  tmp=$(mktemp .env.local.tmp.XXXXXX)
  awk -v existing=".env.local" '
    BEGIN {
      while ((getline line < existing) > 0) {
        print line
        split(line, pair, "=")
        seen[pair[1]] = 1
      }
      close(existing)
    }
    /^[A-Z_]+=/ {
      split($0, pair, "=")
      if (seen[pair[1]]) next
      if ($0 ~ /_(PASSWORD|SECRET)=$/) {
        cmd = "openssl rand -hex 24"
        cmd | getline secret
        close(cmd)
        if (length(secret) != 48) exit 1
        print $0 secret
      } else print
    }
  ' .env.example > "$tmp"
  mv "$tmp" .env.local
}
wait_for() {
  label="$1"
  endpoint="$2"
  attempt=0
  until curl --fail --silent --output /dev/null --max-time 3 "$endpoint"; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 90 ]; then
      printf '%s did not become ready. Check docker compose logs.\n' "$label" >&2
      return 1
    fi
    sleep 2
  done
  printf '%s ready\n' "$label"
}
case "${1:-}" in
  setup) setup ;;
  up)
    setup
    compose up -d --wait
    # Values are local configuration produced by setup or supplied by the developer.
    . ./.env.local
    wait_for 'Keycloak OIDC discovery' "$KEYCLOAK_ISSUER/.well-known/openid-configuration"
    wait_for 'Drive mock' "$DRIVE_MOCK_URL/health"
    ;;
  down)
    if [ -f .env.local ]; then compose down; fi
    ;;
  *) printf 'Usage: %s setup|up|down\n' "$0" >&2; exit 2 ;;
esac
