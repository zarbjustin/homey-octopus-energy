---
applyTo: 'widgets/**/*.html,widgets/**/*.js'
description: 'Project-specific accessibility, security, freshness, and API-budget rules for Homey widgets.'
---

# Homey Widget Instructions

- Use native HTML controls such as `<button>`.
- Every interactive control must work with keyboard input and expose its state with appropriate Accessible Rich Internet Applications (ARIA) attributes.
- Dynamic status content must use `aria-live="polite"` or an equivalent status role.
- Do not communicate state through color alone. Include text, a symbol, or another non-color indicator.
- Maintain Web Content Accessibility Guidelines (WCAG) AA contrast for text and controls.
- Escape every device name, error message, upstream value, and other dynamic string before assigning `innerHTML`.
- Reject a stale configured device ID. Never fall back silently to another meter.
- Pass freshness and provenance through the widget Application Programming Interface (API).
- Label forecast, planned, and calculated values as estimates.
- Widget interactions must read cached device state. Do not add outbound Octopus, Kraken, or Carbon API calls.
- Keep layouts usable at narrow Homey widget widths.
- Update `test/widgets.test.js` for escaping, stale-device, freshness, and accessibility behavior.

