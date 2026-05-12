#!/bin/bash
#
# Claudian Full Publish Script
# 1. Build
# 2. Package
# 3. Install to local vaults
# 4. Git commit & tag
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# For this project, build outputs to root directory
DIST_DIR="$PROJECT_DIR"

echo ""
echo "╔════════════════════════════════════════════════╗"
echo "║       Claudian Full Publish Script             ║"
echo "╚════════════════════════════════════════════════╝"
echo ""

# Step 1: Build
echo -e "${CYAN}[Step 1/4]${NC} Building..."
cd "$PROJECT_DIR"
npm run typecheck || { log_error "Typecheck failed"; exit 1; }
npm run lint || { log_error "Lint failed"; exit 1; }
npm run build || { log_error "Build failed"; exit 1; }
echo "✓ Build complete"
echo ""

# Step 2: Package
echo -e "${CYAN}[Step 2/4]${NC} Packaging..."
rm -rf "$PROJECT_DIR/package"
mkdir -p "$PROJECT_DIR/package"
cp "$DIST_DIR/main.js" "$PROJECT_DIR/package/"
cp "$DIST_DIR/manifest.json" "$PROJECT_DIR/package/"
cp "$DIST_DIR/styles.css" "$PROJECT_DIR/package/"

VERSION=$(grep '"version"' "$DIST_DIR/manifest.json" | sed 's/.*"version": "\([^"]*\)".*/\1/')
PKG_NAME="claudian-$VERSION"
rm -f "$PKG_NAME.zip"
zip -r "$PKG_NAME.zip" package/ > /dev/null 2>&1
echo "✓ Package created: $PKG_NAME.zip"
echo ""

# Step 3: Install to vaults
echo -e "${CYAN}[Step 3/4]${NC} Installing to vaults..."

VAULTS=(
    "$HOME/Documents/Obsidian Vault"
    "$HOME/Documents/linchong/lumosnote"
)

for vault in "${VAULTS[@]}"; do
    if [ -d "$vault" ]; then
        plugin_dir="$vault/.obsidian/plugins/claudian"
        mkdir -p "$plugin_dir"
        cp "$DIST_DIR/main.js" "$plugin_dir/"
        cp "$DIST_DIR/manifest.json" "$plugin_dir/"
        cp "$DIST_DIR/styles.css" "$plugin_dir/"
        chmod 755 "$plugin_dir/main.js"
        rm -rf "$vault/.claudian"
        echo "  ✓ $vault"
    fi
done
echo ""

# Step 4: Git
echo -e "${CYAN}[Step 4/4]${NC} Git operations..."

# Check for changes
if git diff --quiet && git diff --cached --quiet; then
    log_warn "No changes to commit"
else
    git add -A
    git commit -m "Release v$VERSION"
    echo "  ✓ Committed"
fi

# Create tag
git tag -a "v$VERSION" -m "Release v$VERSION" 2>/dev/null || true

echo ""
echo "╔════════════════════════════════════════════════╗"
echo "║           Publish Complete!                  ║"
echo "╚════════════════════════════════════════════════╝"
echo ""
log_info "Version:     $VERSION"
log_info "Package:    $PKG_NAME.zip"
log_info "Git tag:    v$VERSION"
echo ""
log_info "Next steps:"
echo "  1. Push:    git push && git push --tags"
echo "  2. Release: https://github.com/YishenTu/claudian/releases/new"
echo "  3. Upload: $PKG_NAME.zip"
echo ""
