#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# .ai/run.sh — FaucetPick AI Agent System Entry Point
# Usage: ./.ai/run.sh <task-id> [--dry-run]
#
# Environment variables:
#   LLM_API_KEY   — Your LLM provider API key (required)
#   LLM_MODEL     — Model to use (default: gpt-4o)
#   LLM_PROVIDER  — Provider: openai | anthropic | google (default: openai)
#   AI_DRY_RUN    — Set to 1 to print the prompt payload without calling the LLM
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

TASK_ID="${1:-}"
DRY_RUN="${AI_DRY_RUN:-0}"
LLM_MODEL="${LLM_MODEL:-gpt-4o}"
LLM_PROVIDER="${LLM_PROVIDER:-openai}"

# ── Validation ─────────────────────────────────────────────────────────────────
if [ -z "${TASK_ID}" ]; then
  echo "ERROR: No task ID provided."
  echo ""
  echo "Usage: ./.ai/run.sh <task-id> [--dry-run]"
  echo ""
  echo "Available tasks (from .ai/tasks.yaml):"
  echo "  update-docs              Audit and update all Markdown documentation"
  echo "  sync-readme-with-code    Sync README version and faucet list"
  echo "  detect-breaking-changes  Analyse a PR diff for breaking changes"
  echo "  improve-test-coverage    Generate test stubs for uncovered functions"
  echo "  refactor-dead-code       Identify and annotate dead code"
  echo "  validate-ci              Validate GitHub Actions workflow files"
  echo "  repo-analysis            Full repo analysis → update memory.json"
  exit 1
fi

if [ "--dry-run" = "${2:-}" ]; then
  DRY_RUN=1
fi

if [ "${DRY_RUN}" != "1" ] && [ -z "${LLM_API_KEY:-}" ]; then
  echo "ERROR: LLM_API_KEY environment variable is not set."
  echo "Set it before running: export LLM_API_KEY=your_key_here"
  exit 1
fi

# ── Helper: read a file into a variable with a header ─────────────────────────
file_block() {
  local filepath="$1"
  local label="${2:-$1}"
  if [ -f "${filepath}" ]; then
    printf '\n\n=== FILE: %s ===\n' "${label}"
    cat "${filepath}"
  else
    printf '\n\n=== FILE: %s === [NOT FOUND - SKIP]\n' "${label}"
  fi
}

# ── Resolve task configuration ─────────────────────────────────────────────────
case "${TASK_ID}" in
  update-docs)
    PROMPT_FILE="${SCRIPT_DIR}/prompts/doc_update.md"
    AGENT_ID="doc-agent"
    SOURCE_FILES=(
      "README.md" "PRIVACY_POLICY.md" "CONTRIBUTING.md" "STORE_LISTING.md"
      "manifest.json" "version.json" "constants.js" "background.js"
      "content.js" "utils.js" "selectors.js" "auth.js"
      "crypto-utils.js" "dice.js" "faucet.js" "withdraw.js" "captcha.js"
    )
    ;;
  sync-readme-with-code)
    PROMPT_FILE="${SCRIPT_DIR}/prompts/doc_update.md"
    AGENT_ID="doc-agent"
    SOURCE_FILES=("README.md" "manifest.json" "version.json" "constants.js")
    ;;
  detect-breaking-changes)
    PROMPT_FILE="${SCRIPT_DIR}/prompts/refactor.md"
    AGENT_ID="review-agent"
    SOURCE_FILES=("constants.js" "utils.js" "selectors.js" "background.js" "content.js")
    ;;
  improve-test-coverage)
    PROMPT_FILE="${SCRIPT_DIR}/prompts/test_generation.md"
    AGENT_ID="test-agent"
    SOURCE_FILES=("constants.js" "utils.js" "selectors.js" "crypto-utils.js" "background.js")
    ;;
  refactor-dead-code)
    PROMPT_FILE="${SCRIPT_DIR}/prompts/refactor.md"
    AGENT_ID="dev-agent"
    SOURCE_FILES=(
      "constants.js" "utils.js" "selectors.js" "background.js"
      "content.js" "auth.js" "faucet.js" "withdraw.js" "dice.js" "captcha.js"
    )
    ;;
  validate-ci)
    PROMPT_FILE="${SCRIPT_DIR}/prompts/repo_analysis.md"
    AGENT_ID="ops-agent"
    SOURCE_FILES=("manifest.json" "version.json" ".ai/agents.yaml")
    ;;
  repo-analysis)
    PROMPT_FILE="${SCRIPT_DIR}/prompts/repo_analysis.md"
    AGENT_ID="doc-agent"
    SOURCE_FILES=(
      "manifest.json" "version.json" "constants.js" "background.js"
      "content.js" "utils.js" "selectors.js" "auth.js"
      "crypto-utils.js" "captcha.js" "faucet.js" "dice.js" "withdraw.js"
      "popup.js" "popup.html" "setup.js" "setup.html"
    )
    ;;
  *)
    echo "ERROR: Unknown task '${TASK_ID}'. Run ./.ai/run.sh without arguments to see available tasks."
    exit 1
    ;;
esac

echo "═══════════════════════════════════════════════════════════════"
echo " FaucetPick AI Agent System"
echo " Task:     ${TASK_ID}"
echo " Agent:    ${AGENT_ID}"
echo " Provider: ${LLM_PROVIDER} / ${LLM_MODEL}"
if [ "${DRY_RUN}" = "1" ]; then
  echo " Mode:     DRY RUN (prompt will be printed, LLM will not be called)"
fi
echo "═══════════════════════════════════════════════════════════════"

# ── Build the full prompt ─────────────────────────────────────────────────────
PROMPT="$(cat "${PROMPT_FILE}")"
PROMPT+="$(file_block "${SCRIPT_DIR}/memory.json" ".ai/memory.json")"
PROMPT+="$(printf '\n\n=== REPOSITORY SOURCE FILES ===\n')"
for f in "${SOURCE_FILES[@]}"; do
  PROMPT+="$(file_block "${REPO_ROOT}/${f}" "${f}")"
done
PROMPT+="$(printf '\n\n=== TASK REQUEST ===\n')"
PROMPT+="$(printf 'Execute task: %s\nAgent: %s\n' "${TASK_ID}" "${AGENT_ID}")"

PROMPT_CHARS="${#PROMPT}"
echo ""
echo "Prompt size: ${PROMPT_CHARS} characters"
echo ""

if [ "${DRY_RUN}" = "1" ]; then
  echo "─── DRY RUN: PROMPT PAYLOAD (first 2000 chars) ───"
  echo "${PROMPT:0:2000}"
  echo "─── END DRY RUN ───"
  exit 0
fi

# ── Call LLM Provider ─────────────────────────────────────────────────────────
echo "Sending request to ${LLM_PROVIDER}..."

RESPONSE=""

case "${LLM_PROVIDER}" in
  openai)
    ESCAPED_PROMPT="$(printf '%s' "${PROMPT}" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
    RESPONSE="$(curl -s https://api.openai.com/v1/chat/completions \
      -H "Authorization: Bearer ${LLM_API_KEY}" \
      -H "Content-Type: application/json" \
      -d "{
        \"model\": \"${LLM_MODEL}\",
        \"messages\": [{\"role\": \"user\", \"content\": ${ESCAPED_PROMPT}}],
        \"max_tokens\": 8192
      }" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["choices"][0]["message"]["content"])')"
    ;;
  anthropic)
    ESCAPED_PROMPT="$(printf '%s' "${PROMPT}" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
    RESPONSE="$(curl -s https://api.anthropic.com/v1/messages \
      -H "x-api-key: ${LLM_API_KEY}" \
      -H "anthropic-version: 2023-06-01" \
      -H "Content-Type: application/json" \
      -d "{
        \"model\": \"${LLM_MODEL}\",
        \"max_tokens\": 8192,
        \"messages\": [{\"role\": \"user\", \"content\": ${ESCAPED_PROMPT}}]
      }" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["content"][0]["text"])')"
    ;;
  google)
    ESCAPED_PROMPT="$(printf '%s' "${PROMPT}" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
    RESPONSE="$(curl -s "https://generativelanguage.googleapis.com/v1beta/models/${LLM_MODEL}:generateContent?key=${LLM_API_KEY}" \
      -H "Content-Type: application/json" \
      -d "{
        \"contents\": [{\"parts\": [{\"text\": ${ESCAPED_PROMPT}}]}]
      }" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["candidates"][0]["content"]["parts"][0]["text"])')"
    ;;
  *)
    echo "ERROR: Unknown LLM_PROVIDER '${LLM_PROVIDER}'. Supported: openai, anthropic, google"
    exit 1
    ;;
esac

# ── Output response ───────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo " Agent Response"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "${RESPONSE}"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo " Task complete. Review the output above before applying changes."
echo "═══════════════════════════════════════════════════════════════"
