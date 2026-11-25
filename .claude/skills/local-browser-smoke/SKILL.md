---
name: local-browser-smoke
description: Run a bounded local UI smoke test using an already-installed Playwright and Chromium runtime. Custom minimal alternative to the upstream Playwright CLI skill.
disable-model-invocation: true
---
# Local browser smoke test
Use only when explicitly requested. Determine if project-local Playwright or an existing approved runtime is available; check version and executable path without installing anything. Do not use npx if it would download packages; do not launch an unreviewed browser binary. If no approved runtime exists, stop and report.
Use a temporary browser context, no saved authentication, one local or approved staging URL, synthetic data only. Never submit real bookings, messages, payments or production mutations. Keep normal sandbox/network controls. Use one focused interaction/assertion sequence; optionally one retry; one screenshot only if useful. Close browser and any local server you started. Report pass/fail with evidence. No external uploads, hooks or persistent browser state.
This is an original local testing workflow, not the official Microsoft CLI skill.
