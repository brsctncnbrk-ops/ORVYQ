import type {ProductionPlan, QualityPolicies, Shot} from '../types.js';
import {planMetrics, PRIMARY_TYPES} from './classification.js';

const POLICY_KEYS: Array<keyof QualityPolicies> = [
  'primary_source_capture_min_ratio',
  'source_backed_min_ratio',
  'max_continuous_evidence_seconds',
  'primary_capture_min_seconds',
  'max_fullscreen_graphic_ratio',
  'max_generic_stock_ratio',
  'max_asset_reuse_count',
  'max_motif_reuse_count',
  'mobile_min_font_px',
];

export function validatePlanInvariants(plan: ProductionPlan): string[] {
  const failures: string[] = [];
  for (const key of POLICY_KEYS) {
    const value = plan.policies[key];
    if (value === null || value === undefined || !Number.isFinite(value)) failures.push(`policy ${key} is missing or non-finite`);
  }
  if (plan.proof.minimum_seconds < 150) failures.push('proof.minimum_seconds must be at least 150');
  if (plan.proof.boundary_frame / plan.fps < plan.proof.minimum_seconds) failures.push('proof boundary is shorter than minimum_seconds');
  if (plan.duration_frames !== Math.round(plan.duration_seconds * plan.fps)) failures.push('duration_frames does not match duration_seconds * fps');
  if (plan.sections.length === 0 || plan.shots.length === 0) failures.push('sections and shots must not be empty');

  const sorted = [...plan.shots].sort((a, b) => a.start_frame - b.start_frame);
  let cursor = 0;
  for (const shot of sorted) {
    if (shot.start_frame !== cursor) failures.push(`timeline gap or overlap before ${shot.id}: expected ${cursor}, got ${shot.start_frame}`);
    if (shot.end_frame <= shot.start_frame) failures.push(`${shot.id} has non-positive duration`);
    cursor = shot.end_frame;
    if (shot.source_backed && shot.source_ids.length === 0) failures.push(`${shot.id} is source_backed but has no source_ids`);
    if (shot.visual_type === 'source_graphic' && shot.provenance_mode !== 'source_derived') failures.push(`${shot.id} source_graphic must use source_derived provenance`);
    if (shot.visual_type === 'source_graphic' && !shot.source_line?.trim()) failures.push(`${shot.id} source_graphic must carry a visible source_line`);
    if (PRIMARY_TYPES.has(shot.visual_type) && (shot.end_frame - shot.start_frame) / plan.fps < plan.policies.primary_capture_min_seconds) {
      failures.push(`${shot.id} primary capture is shorter than ${plan.policies.primary_capture_min_seconds}s`);
    }
  }
  if (cursor !== plan.duration_frames) failures.push(`shot timeline ends at ${cursor}, expected ${plan.duration_frames}`);
  const boundaryShot = sorted.find((shot) => shot.end_frame === plan.proof.boundary_frame);
  if (!boundaryShot) failures.push('proof boundary must equal a canonical shot end_frame');
  if (plan.proof.boundary_frame <= plan.fps) failures.push('proof cannot physically end at or before second 1');

  const endCards = sorted.filter((s) => s.visual_type === 'end_card');
  if (endCards.length !== 1) failures.push(`exactly one end_card is required, found ${endCards.length}`);
  if (endCards[0]?.end_frame !== plan.duration_frames) failures.push('end_card must be the terminal shot');
  if (endCards[0] && endCards[0].start_frame < plan.proof.boundary_frame) failures.push('end_card cannot appear in proof prefix');

  const metrics = planMetrics(plan);
  for (const [name, value] of Object.entries(metrics)) if (!Number.isFinite(value)) failures.push(`measurement ${name} is non-finite`);
  return failures;
}

export function visualPolicyFailures(plan: ProductionPlan): string[] {
  const m = planMetrics(plan);
  const p = plan.policies;
  const failures: string[] = [];
  if (!(m.primary_source_capture_ratio >= p.primary_source_capture_min_ratio)) failures.push(`primary capture ratio ${m.primary_source_capture_ratio.toFixed(4)} < ${p.primary_source_capture_min_ratio}`);
  if (!(m.source_backed_ratio >= p.source_backed_min_ratio)) failures.push(`source-backed ratio ${m.source_backed_ratio.toFixed(4)} < ${p.source_backed_min_ratio}`);
  if (!(m.longest_evidence_chain_seconds <= p.max_continuous_evidence_seconds)) failures.push(`continuous evidence chain ${m.longest_evidence_chain_seconds.toFixed(2)}s > ${p.max_continuous_evidence_seconds}s`);
  if (!(m.fullscreen_graphic_ratio <= p.max_fullscreen_graphic_ratio)) failures.push(`full-screen graphic ratio ${m.fullscreen_graphic_ratio.toFixed(4)} > ${p.max_fullscreen_graphic_ratio}`);
  if (!(m.generic_stock_ratio <= p.max_generic_stock_ratio)) failures.push(`generic stock ratio ${m.generic_stock_ratio.toFixed(4)} > ${p.max_generic_stock_ratio}`);
  if (!(m.max_asset_reuse <= p.max_asset_reuse_count)) failures.push(`asset reuse ${m.max_asset_reuse} > ${p.max_asset_reuse_count}`);
  if (!(m.max_motif_reuse <= p.max_motif_reuse_count)) failures.push(`motif reuse ${m.max_motif_reuse} > ${p.max_motif_reuse_count}`);
  return failures;
}
