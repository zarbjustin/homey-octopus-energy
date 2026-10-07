# S78 Charging Guidance Slice

7 October 2026. Status: delivered as v1.0.39 / Build 39 Test and installed on local
Pro; field acceptance remains open. This is a scoped S78 slice, not completion of
the broader cached-health/onboarding roadmap. The user approved release, install
and Test publication after green GitHub checks. No Live promotion, charging/Flow
edit or support reply was performed.

## Delivered in Source

- Hints distinguish future slot existence, current eligibility, numeric bands,
  rolling cheapest comparisons, configuration and actual Flow events.
- [Charging Flow guide](../charging-flows.md): separate daily configuration,
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
generated-manifest parity tests pass. Runtime code, dependencies, IDs,
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

## Release and Installation Evidence

- Implementation PR [#51](https://github.com/zarbjustin/homey-octopus-energy/pull/51)
  merged as `5527baa`; release workflow `37634301291` prepared PR
  [#52](https://github.com/zarbjustin/homey-octopus-energy/pull/52), merged as
  `f48f2e1`. Required checks and CodeQL passed on both PRs and the release merge.
- Annotated tag and GitHub release `v1.0.39` resolve to `f48f2e1`;
  release run `37634645420` passed. Exact-tag publish run `37635125770` passed
  audit, lint, 678 tests, validation and upload; Build 39 was promoted to Test.
- Fresh Developer Tools readback: Build 39 / v1.0.39 Test and Build 38 / v1.0.38
  Live. Build 38 was already Live before this delivery; it was not promoted here.
- Direct CLI 4.5.2 install could not reach the local/forwarded connection. Its
  supported cloud strategy reached the hub but rejected devkit upload with 400;
  neither attempt upgraded the app. Developer Tools' Build 39 Install route on
  the explicitly selected Pro succeeded without clean install or re-pairing.
- Independent cloud API readback: v1.0.39 running, enabled and not crashed.
  14:20 UTC sanitized smoke: two meters available; identities, settings,
  six standard and five Advanced Flow fingerprints match the pre-install baseline.
  One degraded dispatch account is unchanged, not provider recovery evidence.
- Sanitized baseline/readback and channel screenshot are stored outside Git.
  No live Flow was edited or manually triggered; no battery command was issued.
- Post-delivery documentation review caught a recipe limitation: the existing
  configuration action returns output tokens, making it Advanced-only under the
  official Homey SDK rule. The corrected recipe uses one Advanced setup and three
  Standard controls. A Standard-compatible no-output setup card is future S78 work;
  existing contracts and the published runtime are not changed to hide this limitation.

## Remaining Acceptance

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

Local implementation/testing used synthetic fixtures without provider calls.
The subsequent authorized release/install/Test delivery is recorded above;
no certification/Live promotion or physical acceptance is implied.
Private source messages, sender identities and screenshots are not reproduced.
