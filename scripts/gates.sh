#!/bin/sh
# The repository's gate, run before every pull request: the SDK as openapi.json generates it,
# formatted, built and typechecked. The specs run once before each release to npm, not here.
set -eu
cd "$(dirname "$0")/.."

pnpm generate
generated=$(git status --porcelain -- src/client src/api-version.gen.ts)
if [ -n "$generated" ]; then
  echo "The SDK differs from what openapi.json generates: run pnpm generate and commit it." >&2
  echo "$generated" >&2
  exit 1
fi

pnpm format:check
pnpm build
pnpm typecheck
echo "Gates: GREEN"
