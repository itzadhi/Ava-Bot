---
description: Run complete system doctor checks, static analysis, circular dependency verification, and test suite.
---

# /ava-doctor Workflow

Run the complete diagnostic suite to verify codebase integrity:

```bash
# 1. Check all module imports in isolation
node scripts/check-imports.js

# 2. Check for circular dependencies
npx madge --circular src/

# 3. Check for ESLint errors
npx eslint src/ --quiet

# 4. Check for banned patterns from lessons
npm run lessons:check

# 5. Check brand consistency
node scripts/check-brand.js

# 6. Run comprehensive system doctor
node scripts/doctor.js

# 7. Run test suite
npm test
```
