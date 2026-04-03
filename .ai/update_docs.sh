#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# .ai/update_docs.sh — Run the doc-agent to sync all documentation
# This is a convenience wrapper around run.sh for the update-docs task.
#
# Usage: ./.ai/update_docs.sh [--dry-run]
#
# Environment variables:
#   LLM_API_KEY   — Your LLM provider API key (required)
#   LLM_MODEL     — Model to use (default: gpt-4o)
#   LLM_PROVIDER  — Provider: openai | anthropic | google (default: openai)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRY_RUN_ARG="${1:-}"

echo "─────────────────────────────────────────────────────────────────"
echo " FaucetPick — doc-agent: Documentation Update"
echo "─────────────────────────────────────────────────────────────────"
echo " This will audit all Markdown files against the current source"
echo " code and produce a corrected output for human review."
echo ""
echo " SAFETY: This script does NOT automatically apply changes."
echo " Review the LLM output and apply manually or via PR."
echo "─────────────────────────────────────────────────────────────────"
echo ""

exec "${SCRIPT_DIR}/run.sh" "update-docs" "${DRY_RUN_ARG}"
