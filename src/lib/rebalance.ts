import type {ProductionPlan, Shot} from '../types.js';
import {planMetrics, PHYSICAL_EVIDENCE_TYPES} from './classification.js';
import {stableStringify, sha256Text} from './hash.js';
import {visualPolicyFailures} from './invariants.js';

export interface RebalanceCandidate {
  target_shot_id: string;
  replacement: Omit<Shot, 'id' | 'section_id' | 'start_frame' | 'end_frame' | 'narration_text' | 'transition' | 'music_cue'>;
  priority: number;
}

function prefixHash(plan: ProductionPlan): string {
  return sha256Text(stableStringify(plan.shots.filter((s) => s.end_frame <= plan.proof.boundary_frame)));
}

function applyCandidate(plan: ProductionPlan, candidate: RebalanceCandidate): boolean {
  const shot = plan.shots.find((s) => s.id === candidate.target_shot_id);
  if (!shot || shot.start_frame < plan.proof.boundary_frame) return false;
  Object.assign(shot, candidate.replacement);
  return true;
}

export function rebalancePlan(original: ProductionPlan, candidates: RebalanceCandidate[]): {plan: ProductionPlan; applied: string[]; failures: string[]} {
  const plan = structuredClone(original);
  const lockedPrefix = prefixHash(plan);
  const applied: string[] = [];
  const available = [...candidates].sort((a, b) => b.priority - a.priority || a.target_shot_id.localeCompare(b.target_shot_id));

  const applyFirst = (predicate: (candidate: RebalanceCandidate) => boolean): boolean => {
    const index = available.findIndex(predicate);
    if (index < 0) return false;
    const [candidate] = available.splice(index, 1);
    if (!candidate) return false;
    if (!applyCandidate(plan, candidate)) return false;
    applied.push(candidate.target_shot_id);
    return true;
  };

  for (let guard = 0; guard < 200; guard += 1) {
    const m = planMetrics(plan);
    const p = plan.policies;
    let changed = false;
    if (m.longest_evidence_chain_seconds > p.max_continuous_evidence_seconds) {
      let chain: Shot[] = [];
      let longest: Shot[] = [];
      for (const shot of plan.shots) {
        if (PHYSICAL_EVIDENCE_TYPES.has(shot.visual_type)) {
          chain.push(shot);
          if ((chain.at(-1)!.end_frame - chain[0]!.start_frame) > ((longest.at(-1)?.end_frame ?? 0) - (longest[0]?.start_frame ?? 0))) longest = [...chain];
        } else chain = [];
      }
      changed = applyFirst((c) => longest.some((s) => s.id === c.target_shot_id) && ['contextual_footage', 'source_graphic'].includes(c.replacement.visual_type));
    } else if (m.primary_source_capture_ratio < p.primary_source_capture_min_ratio) changed = applyFirst((c) => c.replacement.visual_type === 'primary_capture');
    else if (m.source_backed_ratio < p.source_backed_min_ratio) changed = applyFirst((c) => ['primary_capture', 'physical_evidence', 'source_graphic'].includes(c.replacement.visual_type));
    else if (m.fullscreen_graphic_ratio > p.max_fullscreen_graphic_ratio) changed = applyFirst((c) => !c.replacement.full_screen_graphic);
    else if (m.generic_stock_ratio > p.max_generic_stock_ratio) changed = applyFirst((c) => c.replacement.visual_type !== 'generic_stock');
    else break;
    if (!changed) break;
  }

  const failures = visualPolicyFailures(plan);
  if (prefixHash(plan) !== lockedPrefix) failures.push('approved proof prefix changed during rebalance');
  const endCards = plan.shots.filter((s) => s.visual_type === 'end_card');
  if (endCards.length !== 1 || endCards[0]?.end_frame !== plan.duration_frames) failures.push('terminal end-card invariant failed after rebalance');
  return {plan, applied, failures};
}
