#!/usr/bin/env bash
set -euo pipefail

# Publish @mycolegal-app/sharedlib to GitHub Packages
# Requires NPM_TOKEN env var with write:packages scope

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PKG_DIR"

CURRENT_VERSION=$(node -p "require('./package.json').version")
PKG_NAME=$(node -p "require('./package.json').name")

echo "📦 Publishing ${PKG_NAME}@${CURRENT_VERSION}..."

# Configure auth
if [ -z "${NPM_TOKEN:-}" ]; then
  echo "❌ NPM_TOKEN not set. Export it or set it in .env"
  exit 1
fi

cat > .npmrc <<NPMRC
@mycolegal-app:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}
NPMRC

# Check if this version is already published
PUBLISHED=$(npm view "${PKG_NAME}@${CURRENT_VERSION}" version 2>/dev/null || echo "")
if [ "$PUBLISHED" = "$CURRENT_VERSION" ]; then
  echo "   ✓ ${PKG_NAME}@${CURRENT_VERSION} already published, skipping"
  rm -f .npmrc
  exit 0
fi

npm publish --quiet
rm -f .npmrc

echo "   ✓ Published ${PKG_NAME}@${CURRENT_VERSION}"
