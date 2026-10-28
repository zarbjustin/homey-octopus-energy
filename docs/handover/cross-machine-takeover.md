# Cross-machine takeover — 28 October 2026

## Start from GitHub

```bash
git clone https://github.com/zarbjustin/homey-octopus-energy.git
cd homey-octopus-energy
git fetch origin --prune --tags
git switch main
git pull --ff-only
git status --short --branch
git rev-parse HEAD
git rev-parse 'v1.0.44^{commit}'
```

Release tag: `55ec370c967aed05f7f22fc926e8cf6b3d70c26f`. Main also contains
later documentation commits. Never reset main to the tag or overwrite another
machine's work. Check open PRs before changes. Install Node.js 22; use the lockfile
with `npm ci`. Do not copy generated output, node_modules or external tool folders.

Read `AGENTS.md`, `docs/ai-handover.md`, `docs/roadmap-next.md`,
`docs/engineering-learnings.md`, `docs/handover/recovery-and-mini-evidence.md`.
`HANDOVER.md` and older execution records provide historical context.

## GitHub versus private state

Git contains source, tests, locked app dependencies, assets, Compose/generated
manifest, workflows, roadmap and sanitized release/field gates. The approved
v1.0.44 Test reply has been sent and verified; awaiting reporter diagnostics.

Credentials, browser/CLI sessions, customer/meter/account/Flow IDs, raw reports,
private messages/screenshots, Homey device storage and production Flows do not
belong in Git. Reauthenticate normally on the destination. CI secrets stay in
GitHub Secrets; do not extract/export them. A clone does not migrate Homey state.

Owner-controlled private evidence inventory on the source machine:

- Root: `/Users/justinzarb/Documents/Codex/2026-08-09/i-w-2`.
- `artifacts/v1.0.44-before.json`: sanitized pre-install fingerprint baseline.
- `artifacts/v1.0.44-read-only-smoke.js`: sequential/chunked private helper;
  review before reuse because CLI JSON can truncate around 64 KiB.
- `artifacts/v1.0.44-test-verified.png`: Test publication evidence.
- `artifacts/j273-v1.0.44-reply-post9.png`: private sent-message proof, not for Git.
- `/tmp/octopus-v44-smoke.js`: later temporary helper with throttle/error checks;
  not a durable transfer artifact. Empty after-install JSON is not acceptance.

Do not bulk-upload artifacts. Transfer only reviewed necessary evidence privately
if the owner needs exact pre/post comparison. Without the old baseline, a new
baseline cannot prove pre-install preservation; retain that acceptance gap.

## Source-machine checkout caveat

Original cloud-backed `work/homey-octopus-energy` stalls on Git reads during this
audit. Left intact: its dirty/unpushed state could not be certified. Release work
and this sync use verified full clone `/tmp/octopus-mini-sample-20261028`; all its
branch history was reachable from fetched origin/main before this docs change.
Do not erase the old machine/checkout before reviewing or backing up local-only
work and private evidence. GitHub continuity is not a full machine backup.

## Startup prompt for the next Codex instance

> Continue zarbjustin/homey-octopus-energy from freshly fetched main. Read AGENTS.md,
> docs/ai-handover.md, docs/roadmap-next.md, docs/engineering-learnings.md and
> docs/handover/recovery-and-mini-evidence.md first. v1.0.44 / Build 44 was verified
> Test and installed enabled/not crashed on the selected Pro. Last Live observation
> was Build 41; don't assume that dated observation is current. The approved
> v1.0.44 reporter reply has already been sent and verified; await new diagnostics.
> Keep reporter Mini half-hourly samples separate from local REST 403/stale-price
> recovery. Full preservation/freshness readback was blocked by Homey throttling.
> Start read-only, authenticate normally and stop on throttling. No restart,
> refresh, re-pair, credential extraction, new polling, production Flow/battery
> changes, installation, publishing, certification/Live or external posting without
> task-specific authority. Keep private evidence outside Git. Give status first.
