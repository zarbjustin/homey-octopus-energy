# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability involving API
credentials, account data, or the release pipeline. Use GitHub's private
security advisory reporting for this repository instead.

Include the affected version, reproduction steps, expected impact, and any
suggested mitigation. Do not include real Octopus Energy API keys or account
numbers in reports, screenshots, logs, or test fixtures.

## Supported version

Security fixes are applied to the latest Homey App Store version and the
current `main` branch.

## Supply chain, SBOM & provenance

- **Dependencies.** Runtime dependencies are intentionally minimal; the bulk of
  `devDependencies` are the Homey SDK type packages and the lint/test toolchain.
  `npm audit` (production scope) is a **hard release gate** — a release is not cut
  while any advisory is outstanding.
- **SBOM.** Generate a Software Bill of Materials on demand with the pinned
  lockfile:

  ```bash
  npm sbom --sbom-format cyclonedx > sbom.cyclonedx.json   # or --sbom-format spdx
  ```

  The committed `package-lock.json` (lockfileVersion 3) is the authoritative,
  reproducible dependency graph.
- **Build provenance.** App Store builds are produced only by the GitHub Actions
  publish workflow from a pushed commit on `main`: each release commit is tagged
  (`v<version>`) by the release workflow, then `homey app publish` uploads the
  build. The chain of custody is therefore *git tag → CI build → Homey build id*,
  with no manual local uploads. Publishing runs behind repository CI and should be
  restricted to a protected environment with required review (see BL-14).
