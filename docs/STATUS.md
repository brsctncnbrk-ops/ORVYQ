# ORVYQ Production Status

## Foundation

- Clean architecture independent from the legacy FactForge orchestrator and state machine.
- One `direction/production_plan.json` and one `direction/narration_timeline.json` per project.
- One root CLI and one Remotion composition for proof and full render.
- Shared visual classification library, aggregate audits, fail-closed policies, structural rebalance, official-source capture, rendered-media QA, and prefix-bound approval.
- Only `ci.yml`, `proof.yml`, and `render.yml` are used.

## First real project

`projects/001-ai-race/` now represents the full 21,598-frame film rather than a short planning fixture.

Canonical measurements:

- Production shots: 46, followed by one terminal end card.
- Primary-source capture ratio: 33.52%.
- Source-backed evidence and graphics ratio: 69.28%.
- Generic stock ratio: 0%.
- Full-screen graphic ratio: 0%.
- Longest uninterrupted physical-evidence chain: 16 seconds.
- Maximum asset reuse: 1.
- Maximum motif reuse: 1.
- Licensed contextual footage assets: 15.
- Proof boundary: frame 6,302, approximately 210.07 seconds.

## Deterministic migration

The legacy repository contributes only approved raw inputs:

- final narration,
- licensed footage,
- footage provenance records.

The source repository and exact commit are pinned in `projects/001-ai-race/migration/external_assets.json`. Materialization verifies each Git LFS object's pointer SHA-256 and size before copying it into the ORVYQ project workspace. No legacy source code, workflow, state machine, or diagnostic script is executed.

## Proof continuity

The proof workflow stores an exact prefix bundle containing narration, alignment, captions, official capture variants, source-derived graphics, music cues, prefix manifests, rendered proof, and post-render QA. After human approval, full render restores that exact bundle before generating post-proof content.

## Verification

- Core TypeScript: PASS.
- Remotion TypeScript: PASS.
- Regression/unit tests: 7/7 PASS.
- Canonical plan and narration timeline: PASS.
- Full render: not started; explicitly blocked pending proof review.
