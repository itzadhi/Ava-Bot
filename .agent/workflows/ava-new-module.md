---
description: Scaffold a new modular plugin with command, component, schema, and tests.
---

# /ava-new-module Workflow

Scaffold a fully compliant AVA feature module:

```bash
# Run the module generator script
npm run new:module <module_name>
```

This scaffolds:
1. `src/modules/<module_name>/module.js` (Manifest contract).
2. `src/modules/<module_name>/commands/<module_name>.js` (Slash and prefix command).
3. `src/modules/<module_name>/components/panel.js` (Components V2 UI with grey buttons).
4. `src/modules/<module_name>/schema.js` (Zod settings validation).
5. `tests/<module_name>.test.js` (Unit test verifying manifest, V2 cards, and grey buttons).
