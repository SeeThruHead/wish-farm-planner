#!/bin/bash
set -e

BUMP="${1:-patch}"

if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  echo "Usage: ./release.sh [patch|minor|major]"
  exit 1
fi

# Ensure clean working tree
if [[ -n "$(git status --porcelain)" ]]; then
  echo "❌ Git working directory not clean. Commit or stash changes first."
  exit 1
fi

# Run tests first
bun test

# Bump version (updates package.json, commits, and tags)
npm version "$BUMP"

# Push commit and tag
git push && git push --tags

# Build and publish to npm
bun run build
npm publish --access public

echo "✅ Released $(node -p "require('./package.json').version")"
