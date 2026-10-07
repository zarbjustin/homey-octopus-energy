# S78 Charging Guidance Slice

7 October 2026. Status: implemented and locally validated in source, pending
new Test delivery and field acceptance. This is a scoped S78 slice, not completion
of the broader cached-health/onboarding roadmap.
The user subsequently approved a new release, normal local Pro install and Test
publication after GitHub checks pass. These delivery steps are pending, not
performed evidence. Live promotion, charging/Flow edits and sending a reply remain
separate.

## Delivered in Source

- Hints distinguish future slot existence, current eligibility, numeric bands,
  rolling cheapest comparisons, configuration and actual Flow events.
- [Standard Flow guide](../charging-flows.md): separate daily configuration,
  period-start, late battery-low and unconditional period-stop recipes. Covers
  direct values/Number tags, missing data, duplicate-command guards and native stops.
- Legacy price-change/drop-below/cheapest-start wording matches observed behaviour.
  Equal-price adjacent boundaries do not emit those legacy numeric-change events;
  first readings seed silently. No legacy listener was changed or new card added.
- README links the guide and corrects its stale v1.0.37 release description using
  the existing dated 5 October v1.0.38 Test evidence, not a fresh channel claim.

## Validation

Local Homey build, 678 tests, lint, production audit (zero vulnerabilities) and
publish validation pass. Only the two documented cumulative-direction warnings.
The electricity Compose contract hash equals v1.0.38 after excluding hint fields;
generated-manifest parity tests pass. Runtime code, versions, dependencies, IDs,
arguments, tokens, capabilities and settings are unchanged.

Targeted charging/guidance suite: 22 passing tests. Added coverage shows:

1. Invented future cheap rates can make availability true while current slot/plan
   eligibility remains false and no early start event is emitted.
2. A cache-only timer starts at the selected boundary, preserves a single run
   across equal-price adjacency, and ends at the expensive gap.
3. A battery-low event during an active period can evaluate the real current
   condition without a new plan-start edge, write or refresh. Outside the selected
   period it cannot start; stale data raises an error instead of inverted permission.
4. Hint semantics, separate stops, late-battery guidance and unchanged card contracts
   are machine-checked. Synthetic callbacks do not issue real battery commands.

## Remaining Acceptance and Delivery

- A new Test build and local install are not performed by this source update.
  Use the separately authorised release workflow before claiming hints installed.
- Check real Homey mobile hints/card selection, literal numbers and Number tags.
- Trial the four recipes with notification/log actions first: low battery before
  and after a period start, equal-price adjacency, separated periods, expired and
  unavailable plans, newly enabled Flows and intentional manual evaluations.
- A support reply remains a draft until approved. Ask the tester which policy
  they want: all slots below a cap, required cheapest duration, or one absolute
  cheapest half-hour. No new cheapest-calendar-day card is assumed.
- Request affected-setup evidence before closing requester/overnight/physical
  gates. UI/event evidence is not proof of battery response; keep stop protections.
- Broader S78 cached source-status, dispatch reasons, onboarding/accessibility
  work remains proposed; S77 dependency alerts and S76 coverage gaps stay open.

No provider call, Homey/Flow edit, battery write, install, version bump, publish,
certification or channel promotion was needed for local implementation/testing.
Private source messages, sender identities and screenshots are not reproduced.
