#!/bin/bash
#
# Claudian Local Install Script
# Installs plugin to local Obsidian vaults
#

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

PROJECT_DIR="$(dirname "$(dirname "$0")")"
DIST_DIR="$PROJECT_DIR"

# Detect which vault is active
detect_active_vault() {
    # Check Obsidian config for last opened vault
    local config_file="$HOME/.config/obsidian/obsidian.json"
    if [ -f "$config_file" ]; then
        local vault_path=$(grep -o '"open[[:space:]]*":[[:space:]]*"[^"]*"' "$config_file" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)"/\1/' | sed 's/\\\//\//g')
        if [ -n "$vault_path" ]; then
            echo "$vault_path"
            return 0
        fi
    fi

    # Fallback: check common locations
    if [ -d "$HOME/Documents/Obsidian Vault" ]; then
        echo "$HOME/Documents/Obsidian Vault"
        return 0
    fi

    return 1
}

install_to_vault() {
    local vault="$1"
    local plugin_dir="$vault/.obsidian/plugins/claudian"

    if [ ! -d "$vault" ]; then
        log_error "Vault not found: $vault"
        return 1
    fi

    log_info "Installing to: $vault"

    # Create plugin directory
    mkdir -p "$plugin_dir"

    # Copy files
    cp "$DIST_DIR/main.js" "$plugin_dir/"
    cp "$DIST_DIR/manifest.json" "$plugin_dir/"
    cp "$DIST_DIR/styles.css" "$plugin_dir/"

    # Set permissions
    chmod 755 "$plugin_dir/main.js"

    # Clean up old bundled agent
    rm -rf "$vault/.claudian"

    log_info "✓ Installed"
}

# Main
echo ""
echo "=========================================="
echo "  Claudian Local Install"
echo "=========================================="
echo ""

# Check if built
if [ ! -f "$DIST_DIR/main.js" ]; then
    log_warn "main.js not found. Running build..."
    cd "$PROJECT_DIR"
    npm run build
    echo ""
fi

# Detect active vault
ACTIVE_VAULT=$(detect_active_vault 2>/dev/null) || ""

if [ -n "$ACTIVE_VAULT" ]; then
    echo "Detected active vault: $ACTIVE_VAULT"
    install_to_vault "$ACTIVE_VAULT"
    echo ""
fi

# Install to known vaults
VAULTS=(
    "$HOME/Documents/Obsidian Vault"
    "$HOME/Documents/linchong/lumosnote"
)

for vault in "${VAULTS[@]}"; do
    if [ -d "$vault" ] && [ "$vault" != "$ACTIVE_VAULT" ]; then
        install_to_vault "$vault"
    fi
done

echo ""
echo "=========================================="
echo "  Installation Complete"
echo "=========================================="
echo ""
log_info "Please restart Obsidian to load the plugin"
