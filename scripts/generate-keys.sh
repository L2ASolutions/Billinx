#!/usr/bin/env bash
# Generate RSA-2048 key pair for JWT signing.
# Keys are written to the keys/ folder (gitignored).
# Paste the output values into your .env file.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
KEYS_DIR="$REPO_ROOT/keys"

mkdir -p "$KEYS_DIR"

echo "Generating 2048-bit RSA key pair in $KEYS_DIR ..."
openssl genrsa -out "$KEYS_DIR/private.key" 2048 2>/dev/null
openssl rsa -in "$KEYS_DIR/private.key" -pubout -out "$KEYS_DIR/public.key" 2>/dev/null

echo ""
echo "Keys generated. Add the following to your .env file:"
echo "----------------------------------------------------------------"
echo "JWT_PRIVATE_KEY=\"$(cat "$KEYS_DIR/private.key")\""
echo ""
echo "JWT_PUBLIC_KEY=\"$(cat "$KEYS_DIR/public.key")\""
echo "----------------------------------------------------------------"
echo ""
echo "IMPORTANT: Delete the key files after copying to .env:"
echo "  rm -f $KEYS_DIR/private.key $KEYS_DIR/public.key"
echo ""
echo "Never commit private.key or public.key — they are in .gitignore."
