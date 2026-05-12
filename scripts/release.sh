#!/bin/bash
#
# Claudian Release Script
# Usage: ./scripts/release.sh [patch|minor|major]
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default version bump
VERSION_BUMP="${1:-patch}"

# Directories
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$PROJECT_DIR/dist"
PLUGIN_NAME="claudian"

# Helper functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Get current version
get_current_version() {
    grep '"version"' "$PROJECT_DIR/package.json" | sed 's/.*"version": "\([^"]*\)".*/\1/'
}

# Bump version
bump_version() {
    local current="$1"
    local bump_type="$2"

    IFS='.' read -r major minor patch <<< "$current"

    case "$bump_type" in
        major)
            major=$((major + 1))
            minor=0
            patch=0
            ;;
        minor)
            minor=$((minor + 1))
            patch=0
            ;;
        patch)
            patch=$((patch + 1))
            ;;
        *)
            log_error "Invalid version bump type: $bump_type"
            exit 1
            ;;
    esac

    echo "$major.$minor.$patch"
}

# Validate version bump
validate_bump() {
    case "$VERSION_BUMP" in
        patch|minor|major)
            return 0
            ;;
        *)
            log_error "Usage: $0 [patch|minor|major]"
            exit 1
            ;;
    esac
}

# Check for uncommitted changes
check_git_status() {
    if [ -n "$(git status --porcelain)" ]; then
        log_warn "You have uncommitted changes:"
        git status --short
        read -p "Continue anyway? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
}

# Run tests
run_tests() {
    log_info "Running tests..."
    cd "$PROJECT_DIR"
    npm run typecheck || { log_error "Typecheck failed"; exit 1; }
    npm run lint || { log_error "Lint failed"; exit 1; }
    npm run test || { log_error "Tests failed"; exit 1; }
    log_info "All tests passed ✓"
}

# Build production
build_production() {
    log_info "Building production version..."
    cd "$PROJECT_DIR"
    npm run build || { log_error "Build failed"; exit 1; }
    log_info "Build successful ✓"
}

# Create GitHub release
create_github_release() {
    local version="$1"
    local tag="v$version"

    log_info "Creating GitHub release: $tag"

    # Create tag
    git tag -a "$tag" -m "Release $version" || { log_error "Failed to create tag"; exit 1; }

    # Push tag
    git push origin "$tag" || { log_error "Failed to push tag"; exit 1; }

    log_info "Tag $tag pushed ✓"
}

# Copy to vaults
install_to_vaults() {
    log_info "Installing to vaults..."

    local vaults=(
        "/Users/louloulin/Documents/Obsidian Vault"
        "/Users/louloulin/Documents/linchong/lumosnote"
    )

    for vault in "${vaults[@]}"; do
        if [ -d "$vault" ]; then
            local plugin_dir="$vault/.obsidian/plugins/$PLUGIN_NAME"
            mkdir -p "$plugin_dir"
            cp "$DIST_DIR/main.js" "$plugin_dir/"
            cp "$DIST_DIR/manifest.json" "$plugin_dir/"
            cp "$DIST_DIR/styles.css" "$plugin_dir/"
            chmod 755 "$plugin_dir/main.js"
            log_info "Installed to: $vault ✓"
        else
            log_warn "Vault not found: $vault"
        fi
    done
}

# Print summary
print_summary() {
    local new_version="$1"

    echo ""
    echo "=========================================="
    echo "       Release Summary"
    echo "=========================================="
    echo "  New Version: $new_version"
    echo "  Build:       $DIST_DIR/main.js"
    echo "  Manifest:    $DIST_DIR/manifest.json"
    echo ""
    echo "  Files ready for manual install:"
    echo "    - main.js"
    echo "    - manifest.json"
    echo "    - styles.css"
    echo ""
    echo "  Git tag pushed: v$new_version"
    echo "=========================================="
    echo ""
    log_info "Done! Next steps:"
    echo "  1. Create GitHub Release at:"
    echo "     https://github.com/YishenTu/claudian/releases/new?tag=v$new_version"
    echo "  2. Upload files: main.js, manifest.json, styles.css"
    echo "  3. BRAT users will auto-update"
}

# Main
main() {
    cd "$PROJECT_DIR"

    echo ""
    echo "=========================================="
    echo "    Claudian Release Script"
    echo "=========================================="
    echo ""

    # Validate
    validate_bump

    # Get versions
    local current_version=$(get_current_version)
    local new_version=$(bump_version "$current_version" "$VERSION_BUMP")

    log_info "Current version: $current_version"
    log_info "New version:     $new_version"
    log_info "Version bump:     $VERSION_BUMP"
    echo ""

    # Confirmation
    read -p "Continue with release? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Cancelled"
        exit 0
    fi

    # Check git
    check_git_status

    # Build
    run_tests
    build_production

    # Update version
    log_info "Updating version to $new_version..."
    cd "$PROJECT_DIR"
    npm version "$VERSION_BUMP" --no-git-tag-version || { log_error "Version update failed"; exit 1; }

    # Install to vaults
    install_to_vaults

    # Git commit
    log_info "Committing changes..."
    git add -A
    git commit -m "Release v$new_version" || { log_error "Git commit failed"; exit 1; }

    # Create release tag
    create_github_release "$new_version"

    # Summary
    print_summary "$new_version"
}

main "$@"
