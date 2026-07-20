# ORVYQ Operations

## Add a project

1. Run `orvyq init --project-id <id>`.
2. Add project data only: sources, claims, narration, alignment, assets, canonical plan, and optional rebalance candidates.
3. Do not add project-specific TypeScript or workflow code.
4. Run `validate`, then `compile`, then the planning/proof audit.

## Proof review

1. Dispatch `Proof` with a project ID and candidate ref.
2. Download the proof review artifact.
3. Review the real MP4 for opening quality, visual/narration match, evidence rhythm, typography, pacing, music balance, subtitles, and semantic ending.
4. Only after explicit human approval, run `approve-proof` with the workflow run ID, source commit, and review score.
5. Commit `proof_approval.json` with the approved prefix unchanged.

## Full render

1. Resolve the exact candidate commit SHA.
2. Dispatch `Full Render` using that 40-character SHA.
3. The workflow refuses branch names, moving refs, changed prefix inputs, missing LFS objects, failed audits, incomplete speech, black intervals, long silence, invalid duration/frame count, or missing provenance.
4. The final artifact is uploaded only after post-render QA passes.

## Root-cause policy

- Do not lower thresholds to make a project pass.
- Do not disable an audit.
- Do not add diagnostic workflows.
- Do not create a second render plan.
- Do not patch a specific shot in shared code.
- Add new project choices as project data or add a general invariant/test when the rule applies to all films.
