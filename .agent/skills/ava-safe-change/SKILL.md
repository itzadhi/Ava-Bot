---
name: ava-safe-change
description: Workflow for safe code modifications, usage search, minimal diffs, verification tests, and proof verification.
---

# AVA Safe Change Workflow

## 1. Pre-Change Analysis
- **Search All Usages First:**
  Always run a ripgrep or static search for function, variable, or class names before refactoring or removing them.
  ```bash
  grep -rn "targetFunction" src/
  ```
- **Read the Entire File:**
  Never blindly replace large blocks or edit from memory. Read the target file in full to understand existing imports, scopes, and side effects.
- **Identify Affected Modules & Tests:**
  Determine which modules depend on the code being changed and locate corresponding tests in `tests/`.

## 2. Targeted Execution
- Keep changes minimal and focused. Do not refactor unrelated lines or reformat surrounding code unless instructed.
- Keep all new source files under ~300 lines. Split modular logic when files grow too large.
- Preserve all existing comments and docstrings.

## 3. Strict Verification Loop
Never state or assume a change works without running real commands and observing the output:
1. **Module Import Resolution:**
   ```bash
   npm run check:imports
   ```
2. **ESLint Static Analysis:**
   ```bash
   npx eslint src/ --quiet
   ```
3. **Circular Dependencies:**
   ```bash
   npx madge --circular src/
   ```
4. **Targeted & Full Test Suites:**
   ```bash
   node --test tests/path_to_test.test.js
   npm test
   ```
5. **System Doctor Verification:**
   ```bash
   npm run doctor
   ```

## 4. Documentation & Commit
1. If a bug or edge-case was resolved, append a new lesson entry to `docs/LESSONS.md`.
2. Update `PROGRESS.md` with current phase, completed tasks, and next steps.
3. Commit with standard conventional commit syntax:
   ```bash
   git add <modified-files>
   git commit -m "feat(module): descriptive summary of change"
   ```
