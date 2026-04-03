#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# .ai/dev_cycle.sh — Full autonomous development cycle
# Runs: repo-analysis → update-docs → improve-test-coverage
#
# Usage: ./.ai/dev_cycle.sh [--dry-run]
#
# Environment variables:
#   LLM_API_KEY   — Your LLM provider API key (required)
#   LLM_MODEL     — Model to use (default: gpt-4o)
#   LLM_PROVIDER  — Provider: openai | anthropic | google (default: openai)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRY_RUN_ARG="${1:-}"
TIMESTAMP="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
LOG_DIR="${SCRIPT_DIR}/../.ai/logs"

mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/dev_cycle_${TIMESTAMP//[:T]/-}.log"

echo "═══════════════════════════════════════════════════════════════"
echo " FaucetPick — Full AI Development Cycle"
echo " Started: ${TIMESTAMP}"
echo " Log:     ${LOG_FILE}"
echo "═══════════════════════════════════════════════════════════════"
echo ""

run_task() {
  local task_id="$1"
  local step_name="$2"
  local step_num="$3"

  echo ""
  echo "─── Step ${step_num}: ${step_name} ──────────────────────────────────────"
  echo ""

  if "${SCRIPT_DIR}/run.sh" "${task_id}" "${DRY_RUN_ARG}" 2>&1 | tee -a "${LOG_FILE}"; then
    echo ""
    echo "✓ Step ${step_num} (${task_id}) completed."
  else
    echo ""
    echo "✗ Step ${step_num} (${task_id}) FAILED. Halting cycle."
    echo "  See log: ${LOG_FILE}"
    exit 1
  fi
}

# ── Cycle Steps ───────────────────────────────────────────────────────────────
# Step 1: Refresh memory context with current repo state
run_task "repo-analysis" "Repository Analysis → memory.json refresh" "1"

# Step 2: Sync all documentation against current source code
run_task "update-docs" "Documentation Sync (doc-agent)" "2"

# Step 3: Generate test stubs for uncovered functions
run_task "improve-test-coverage" "Test Coverage Improvement (test-agent)" "3"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo " Development Cycle Complete"
echo " Finished: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo " Full log: ${LOG_FILE}"
echo ""
echo " NEXT STEPS:"
echo "   1. Review the LLM output in the log file above."
echo "   2. Apply the documentation changes to your .md files."
echo "   3. Apply the generated test stubs to the /tests/ directory."
echo "   4. Open a PR with all changes for human review."
echo "═══════════════════════════════════════════════════════════════"
