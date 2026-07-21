# Engineering & Product Blueprint — Octopus Energy for Homey

> A multi-model Principal-Engineer + Staff-Product-Manager + Senior-Engineer review of
> `zarbjustin/homey-octopus-energy`, intended to guide the next 6–12 months of development.
> Compiled 21 Jul 2026 against `main` @ `f53026d` (v1.0.20 / Build 20).

## How this blueprint was produced (methodology)
A three-model team collaborated, each in its area of strength, with a shared, evidence-grounded
context pack (`_grounding.md`). An orchestrator (Claude Opus 4.8) synthesised the outputs, normalised
priorities into one model, and reconciled disagreements — surfacing trade-offs rather than forcing
false consensus. Every claim is cited (file:line for code, URLs for platform/API/competitor facts);
unverifiable items are labelled assumptions. This is a **documentation deliverable — no application
code was changed**.

### Model roles
| Model | Role | Owns |
|---|---|---|
| **GPT-5.6 Sol** | Principal / Distinguished Architect | Architecture, API, security architecture, Homey capability feasibility, implementation plan, risk register (04, 05, 06, 09, 16, 17) |
| **Claude Opus 4.8** | Product & UX Strategist (+ orchestrator) | Product assessment, widget/Flow opportunities, competitive analysis, product spec, innovation (02, 10, 11, 12, 13, 19); synthesis of 00, 01, 14, 15 |
| **GPT-5.5** | Senior Software Engineer / maintainer | Repo health, performance, bug bash, technical-debt register (03, 07, 08, 18) |
| **security-review** | Independent security specialist | Cross-check feeding 06 |

## Relationship to existing planning
This blueprint **ingests and cross-references** the existing planning rather than replacing it:
`ROADMAP.md` (Sprints 1–58), `docs/handover/sprints-42-48-spec.md`, `docs/handover/sprints-50-58-spec.md`,
`docs/research/*`. Where it diverges from prior direction, the relevant deliverable says so and justifies it.
The open **IOG v1.0.20 field-verification** item (community 156860) is tracked separately in `HANDOVER.md`
and is intentionally untouched here.

## Deliverables
| # | Document | Lead |
|---|---|---|
| 01 | [Executive Summary](01-executive-summary.md) | Orchestrator |
| 02 | [Product Assessment](02-product-assessment.md) | Opus 4.8 |
| 03 | [Repository Health Report](03-repository-health-report.md) | GPT-5.5 |
| 04 | [Architecture Review](04-architecture-review.md) | GPT-5.6 Sol |
| 05 | [API Review](05-api-review.md) | GPT-5.6 Sol |
| 06 | [Security Review](06-security-review.md) | GPT-5.6 Sol + specialist |
| 07 | [Performance Review](07-performance-review.md) | GPT-5.5 |
| 08 | [Bug Bash Report](08-bug-bash-report.md) | GPT-5.5 |
| 09 | [Homey Capability Review](09-homey-capability-review.md) | GPT-5.6 Sol |
| 10 | [Widget Opportunity Report](10-widget-opportunity-report.md) | Opus 4.8 |
| 11 | [Flow Card Opportunity Report](11-flow-card-opportunity-report.md) | Opus 4.8 |
| 12 | [Competitive Analysis](12-competitive-analysis.md) | Opus 4.8 |
| 13 | [Product Specification](13-product-specification.md) | Opus 4.8 |
| 14 | [Engineering Backlog](14-engineering-backlog.md) | Orchestrator (all inputs) |
| 15 | [Prioritised Roadmap](15-prioritised-roadmap.md) | Orchestrator (all inputs) |
| 16 | [Implementation Plan](16-implementation-plan.md) | GPT-5.6 Sol |
| 17 | [Risk Register](17-risk-register.md) | GPT-5.6 Sol |
| 18 | [Technical Debt Register](18-technical-debt-register.md) | GPT-5.5 |
| 19 | [Future Ideas & Innovation Catalogue](19-future-ideas-innovation-catalogue.md) | Opus 4.8 |

Supporting input: [`_grounding.md`](_grounding.md) — shared facts, module map, competitor/platform research.

## Prioritisation model (used across 08/14/15/19)
Priority ≈ (Impact × User value × Innovation) ÷ Engineering effort (S/M/L/XL), tie-broken by risk reduction.
Deliverables state their scores so the roadmap (15) can be reproduced.

## Reading order
New reader → **01 Executive Summary** → **02 Product Assessment** → **15 Prioritised Roadmap**.
Engineer picking up work → **04 Architecture** → **03 Repo Health** → **14 Engineering Backlog** → **16 Implementation Plan**.
