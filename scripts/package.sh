#!/bin/bash
#
# Claudian Package Script
# Creates a release package for GitHub Release
#

set -e

# Colors
GREEN='\033[0;32m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }

PROJECT_DIR="$(dirname "$(dirname "$0")")"
DIST_DIR="$PROJECT_DIR/dist"
PKG_DIR="$PROJECT_DIR/package"

# Get version from manifest
VERSION=$(grep '"version"' "$DIST_DIR/manifest.json" | sed 's/.*"version": "\([^"]*\)".*/\1/')
PKG_NAME="claudian-$VERSION"

echo ""
echo "=========================================="
echo "  Claudian Package Script"
echo "=========================================="
echo ""

# Clean
log_info "Cleaning..."
rm -rf "$PKG_DIR"
mkdir -p "$PKG_DIR"

# Copy files
log_info "Copying files..."
cp "$DIST_DIR/main.js" "$PKG_DIR/"
cp "$DIST_DIR/manifest.json" "$PKG_DIR/"
cp "$DIST_DIR/styles.css" "$PKG_DIR/"

# Create zip
log_info "Creating zip..."
cd "$PROJECT_DIR"
rm -f "$PKG_NAME.zip"
zip -r "$PKG_NAME.zip" package/

# Output
echo ""
echo "=========================================="
echo "  Package Created"
echo "=========================================="
echo ""
log_info "File: $PROJECT_DIR/$PKG_NAME.zip"
log_info "Size: $(du -h "$PKG_NAME.zip" | cut -f1)"
echo ""
