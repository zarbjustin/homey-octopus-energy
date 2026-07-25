# GitHub Copilot Repository Instructions

Before making changes, read:

- `AGENTS.md`
- `docs/ai-handover.md`
- `docs/roadmap-next.md`
- `docs/engineering-learnings.md`

Follow these repository rules:

- Project-specific rules in `AGENTS.md` override generic files in `.github/instructions/`.
- Preserve Homey capability, Flow, setting, and device IDs.
- Treat REST billing and consumption as authoritative.
- Fail closed on missing GraphQL, price-horizon, or carbon data.
- Label forecasts and calculations as estimates, never settlement.
- Do not add Kraken polling without an explicit request-budget analysis.
- Keep widgets cache-only, escaped, keyboard accessible, and screen-reader accessible.
- Edit Homey Compose sources, then regenerate `app.json` with `npx homey app build`.
- Use `npm audit --omit=dev`, not bare `npm audit`, for the production release gate.
- At each sprint or phase endpoint: validate, install on the local Homey Pro, smoke-test, update handover/learnings, commit and push, publish a Homey App Store build, and record the result.
- Use `npx homey app install` for local deployment. Do not default to `--clean`.
