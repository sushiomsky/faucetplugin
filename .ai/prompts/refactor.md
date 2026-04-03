---
# refactor.md — Prompt Template for review-agent / dev-agent refactoring tasks
# Strict convention adherence. Minimal diffs. No behavior changes.
---

# Role

You are performing a **code review and refactoring analysis** for the FaucetPick repository.
Your task is to identify code quality issues and produce minimal, safe refactoring proposals.

---

# Critical Rules — Read Before Proceeding

1. **No behavior changes.** A refactoring must not change what the code does, only how it is written.
2. **Minimal diffs.** Do not reformat files wholesale. Change only specific problem areas.
3. **Verify before removing.** Before marking anything as dead code, search for its usage across ALL files.
4. **No new patterns.** Do not introduce new coding patterns, module systems, or abstractions.
5. **Output a diff, not applied changes.** All proposals are dry-run only. A human must approve before application.

---

# Context You Have Been Given

- Memory context: `.ai/memory.json` (conventions, architecture)
- Source files to be reviewed (provided in the task invocation)
- PR diff (if reviewing a pull request)

---

# Task — Code Quality Review

## Step 1 — Identify Issues
For each source file provided, scan for:

### Dead Code
- Functions defined but never called from any other file
- Constants defined but never referenced
- Commented-out code blocks older than the last release

### Convention Violations (from `.ai/memory.json → conventions`)
- Hardcoded faucet defaults outside `constants.js`
- `localStorage` or `sessionStorage` usage
- Inline CSS selectors not in `selectors.js`
- Unencrypted credential storage
- `console.log()` used for debug traces (should use `log()`)

### Complexity
- Functions with more than 5 levels of nesting
- Functions longer than 80 lines that could be split
- Duplicated logic that could share a utility function already in `utils.js`

## Step 2 — For Each Issue, Propose a Safe Fix
- Describe the issue precisely (file, function name, line range).
- Propose the minimal fix.
- State explicitly: does this fix change observable behavior? (Answer must be NO for a true refactor.)

## Step 3 — Output Unified Diff
For each approved fix, output the diff in this format:

```diff
--- a/filename.js
+++ b/filename.js
@@ -N,M +N,M @@ context
-old code
+new code
```

## Step 4 — PR Review Comment (if reviewing a PR)
If reviewing a pull request, output a structured comment with sections:
- **Summary**: High-level assessment (e.g., "3 convention violations, 1 breaking change risk, 1 dead code candidate")
- **Breaking Change Risk**: List any removed/renamed symbols with their usage sites
- **Convention Violations**: List all failures vs `.ai/memory.json → conventions`
- **Suggestions**: Non-blocking improvements
- **Verdict**: APPROVE, REQUEST_CHANGES, or COMMENT
