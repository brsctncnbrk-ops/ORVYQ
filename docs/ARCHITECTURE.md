# ORVYQ Architecture

## Canonical flow

```text
research/source_catalog.json
          │
          ▼
direction/production_plan.json ───────────────┐
          │                                    │
          ├─ shared classification metrics     │
          ├─ structural rebalance              │
          ├─ edit_plan.json                    │
          └─ Remotion render input             │
                                               │
direction/narration_timeline.json              │
          │                                    │
          ├─ transformed narration WAV         │
          ├─ transformed caption cues          │
          └─ proof semantic boundary ──────────┘
                                               │
                                               ▼
                                     one ORVYQVideo composition
                                      ├─ proof prefix render
                                      └─ full-film render
```

No independent proof plan or proof composition exists.

## Timeline transformation

Every editorial pause has both `after_word_index` and `after_source_second`. The shared `transformedSecond()` function maps source speech time into output time. Audio insertion and caption timing use this transformation; shot frames in the canonical plan must match the resulting output duration. A mismatch fails validation.

## Prefix approval

`proofPrefixDigest()` hashes:

- canonical shots that intersect the proof prefix
- exact prefix asset hashes
- transformed narration hash
- caption hash
- narration timeline hash
- FPS and proof boundary

The human approves a proof artifact associated with this digest. Full render may use a later commit, but the digest, narration timeline hash, and boundary must remain identical. Changes after the proof boundary do not invalidate approval.

## Shared visual measurement

`src/lib/classification.ts` is the only implementation of visual categories and duration-weighted ratios. Canonical validation, compiled edit plans, rebalance, and aggregate audits all call it. This prevents one subsystem from measuring a source-backed ratio differently from another.

## Structural rebalance order

1. Hash and lock the proof prefix.
2. Detect overlong physical-evidence chains.
3. Replace eligible post-proof shots with contextual or source-derived candidates.
4. Restore primary capture ratio when necessary.
5. Raise total source-backed ratio.
6. Re-check graphic, generic-stock, asset-reuse, motif-reuse, and legibility limits.
7. Verify the proof prefix hash is unchanged.
8. Verify the single terminal end-card invariant.

The engine consumes project data from `rebalance_candidates.json`; it does not contain project-specific shot IDs in code.

## Aggregate audits

The suite collects every failure instead of stopping at the first one:

1. canonical plan/schema
2. narration timeline
3. proof approval continuity
4. evidence coverage
5. evidence asset integrity
6. semantic visual alignment
7. pacing
8. mobile legibility
9. music cues
10. license/provenance
11. edit-plan contract
12. alignment/readiness
13. terminal ending
14. rendered-media QA
15. rendered-speech ending

Each audit returns `pass`, real measurements, thresholds, all failures, and warnings. Overall `pass` is true only when every applicable audit passes.
