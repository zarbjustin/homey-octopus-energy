# Contributing

Thanks for helping improve Octopus Energy for Homey. This is an unofficial,
community-maintained app and is not affiliated with Octopus Energy.

## Before opening an issue

- Update Homey and install the latest app version or Test-channel build.
- Search existing issues for the same meter, tariff, Flow, or API behavior.
- Remove API keys, account numbers, MPANs/MPRNs, serial numbers, addresses, and
  other personal information from screenshots and logs.
- For security concerns, follow `SECURITY.md` and use a private advisory rather
  than a public issue.

A useful bug report includes the app and Homey versions, device type, tariff
family, expected result, actual result, reproducible steps, and sanitized logs.

## Development

Node.js 22 or newer is required.

```bash
npm install
npm run lint
npm test
npx homey app validate --level publish
```

The two documented cumulative import/export warnings are expected. New warnings
or validation failures should be resolved before review.

## Pull requests

- Keep changes focused and preserve existing Homey Compose and TypeScript patterns.
- Add tests for behavior changes, especially price boundaries, timers, poller
  state, repair identity, pagination, and Flow contracts.
- Never commit credentials or real account/meter data.
- Update README, ROADMAP, and HANDOVER when behavior or release state changes.
- Confirm `package.json`, `package-lock.json`, `.homeycompose/app.json`, and
  `app.json` use the same release version.

See `HANDOVER.md` for architecture, invariants, expected warnings, and the
current release runbook.
