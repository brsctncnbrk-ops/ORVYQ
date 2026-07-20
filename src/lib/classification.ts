import type {ProductionPlan, Shot, VisualType} from '../types.js';

export const PRIMARY_TYPES = new Set<VisualType>(['primary_capture']);
export const SOURCE_BACKED_TYPES = new Set<VisualType>(['primary_capture', 'physical_evidence', 'source_graphic']);
export const PHYSICAL_EVIDENCE_TYPES = new Set<VisualType>(['primary_capture', 'physical_evidence']);

export function shotFrames(shot: Shot): number {
  return shot.end_frame - shot.start_frame;
}

export function ratioFor(plan: ProductionPlan, predicate: (shot: Shot) => boolean): number {
  const eligible = plan.shots.filter((s) => s.visual_type !== 'end_card');
  const total = eligible.reduce((sum, s) => sum + shotFrames(s), 0);
  if (!Number.isFinite(total) || total <= 0) return Number.NaN;
  return eligible.filter(predicate).reduce((sum, s) => sum + shotFrames(s), 0) / total;
}

export function planMetrics(plan: ProductionPlan) {
  const assetCounts = new Map<string, number>();
  const motifCounts = new Map<string, number>();
  for (const shot of plan.shots) {
    assetCounts.set(shot.asset, (assetCounts.get(shot.asset) ?? 0) + 1);
    motifCounts.set(shot.motif, (motifCounts.get(shot.motif) ?? 0) + 1);
  }

  let longestEvidenceFrames = 0;
  let chainStart: number | null = null;
  let chainEnd = 0;
  for (const shot of plan.shots) {
    if (PHYSICAL_EVIDENCE_TYPES.has(shot.visual_type)) {
      chainStart ??= shot.start_frame;
      chainEnd = shot.end_frame;
      longestEvidenceFrames = Math.max(longestEvidenceFrames, chainEnd - chainStart);
    } else {
      chainStart = null;
      chainEnd = 0;
    }
  }

  return {
    primary_source_capture_ratio: ratioFor(plan, (s) => PRIMARY_TYPES.has(s.visual_type)),
    source_backed_ratio: ratioFor(plan, (s) => SOURCE_BACKED_TYPES.has(s.visual_type)),
    fullscreen_graphic_ratio: ratioFor(plan, (s) => s.full_screen_graphic),
    generic_stock_ratio: ratioFor(plan, (s) => s.visual_type === 'generic_stock'),
    longest_evidence_chain_seconds: longestEvidenceFrames / plan.fps,
    max_asset_reuse: Math.max(0, ...assetCounts.values()),
    max_motif_reuse: Math.max(0, ...motifCounts.values()),
  };
}
