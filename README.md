# ORVYQ Production System

A deterministic, fail-closed production system for cinematic, faceless, premium video essays. The visual reference is Aperture-level pacing and atmosphere, but every film is driven by project-owned research, licensed media, official captures, and source-derived graphics.

## Non-negotiable architecture

- One project namespace: `projects/<project_id>/`
- One canonical production truth: `direction/production_plan.json`
- One transformed narration truth: `direction/narration_timeline.json`
- One root CLI: `npm run orvyq -- <command> --project-id <id>`
- Proof and full render use the same `ORVYQVideo` Remotion composition and the same canonical plan.
- Proof approval is bound to the rendered prefix inputs, narration timeline hash, boundary frame, run ID, review score, and source commit.
- Post-proof edits are allowed only when the approved prefix digest remains identical.
- Missing, null, NaN, unmeasurable, placeholder, or provenance-free inputs fail closed.

## Runtime

- Node.js `24.18.0` LTS
- TypeScript
- Remotion
- FFmpeg / FFprobe
- Python only for rendered-speech transcription QA
- Playwright for official source capture
- Git LFS for binary media

## CLI

```bash
npm ci

# Canonical structural validation
npm run orvyq -- validate --project-id 001-ai-race

# Capture active official sources with retry, domain allowlisting, PNG checks, and provenance
npm run orvyq -- capture-sources --project-id 001-ai-race

# Apply the narration pause transform to audio and captions
npm run orvyq -- prepare-audio --project-id 001-ai-race
npm run orvyq -- captions --project-id 001-ai-race

# Compile edit/render input using the same visual-classification metrics as audits
npm run orvyq -- compile --project-id 001-ai-race

# Aggregate audits
npm run orvyq -- audit --project-id 001-ai-race --stage proof
npm run orvyq -- audit --project-id 001-ai-race --stage full-pre-render
npm run orvyq -- audit --project-id 001-ai-race --stage post-render

# Deterministic structural rebalance; preview by default
npm run orvyq -- rebalance --project-id 001-ai-race
npm run orvyq -- rebalance --project-id 001-ai-race --apply

# Bind human approval to the approved prefix after reviewing the proof artifact
npm run orvyq -- approve-proof --project-id 001-ai-race \
  --run-id <github-run-id> \
  --commit <proof-source-commit> \
  --score <0-100>
```

## Workflows

### `ci.yml`

Schema/invariant validation, TypeScript checks, Remotion type-check, regression tests, proof-prefix continuity tests, rebalance tests, and negative tests for non-finite policy values.

### `proof.yml`

Captures sources, produces transformed narration and captions, compiles the canonical edit, runs the aggregate pre-render audit, renders frames `0..proof.boundary_frame-1` from the real full-film composition, transcribes the rendered proof, verifies media/speech/caption termination, and uploads a review artifact. It never writes human approval automatically.

### `render.yml`

Accepts only an immutable commit SHA, prevents concurrent full renders for the same project, verifies the approved prefix and narration hash, runs all preparation and aggregate audits, renders with concurrency `1`, performs FFprobe/FFmpeg and rendered-speech QA, and uploads the final MP4 only when every required check passes.

## Project contract

```text
projects/<project_id>/
├── direction/
│   ├── production_plan.json
│   ├── narration_timeline.json
│   ├── word_alignment.json
│   ├── rebalance_candidates.json
│   └── proof_approval.json        # created only after human approval
├── research/source_catalog.json
├── assets/
│   ├── audio/
│   ├── captures/
│   ├── graphics/
│   └── footage/
├── build/                         # generated
├── qa/                            # generated audit reports
└── output/                        # generated proof/final MP4
```

The `001-ai-race` project is the first full canonical production candidate. Its narration and licensed footage are materialized from a pinned immutable legacy commit with Git LFS SHA-256 verification; all ORVYQ plans, captures, graphics, music, alignment, captions, audits, and renders are produced by the clean ORVYQ system. Full render remains blocked until the real proof artifact is reviewed and explicitly approved.

See `docs/ARCHITECTURE.md` and `docs/OPERATIONS.md`.
