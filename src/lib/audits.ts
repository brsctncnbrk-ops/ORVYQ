import path from 'node:path';
import {readdir, readFile} from 'node:fs/promises';
import type {AuditResult, NarrationTimeline, ProductionPlan, ProofApproval} from '../types.js';
import {planMetrics} from './classification.js';
import {proofPrefixDigest, timelineDigest} from './hash.js';
import {exists, readJson} from './io.js';
import {validatePlanInvariants, visualPolicyFailures} from './invariants.js';
import {renderedMediaAudit, renderedSpeechEndingAudit} from './media.js';
import {validateWithSchema} from './schema.js';
import {validateTimeline} from './timeline.js';

function result(id: string, failures: string[], measurements: Record<string, unknown> = {}, thresholds: Record<string, unknown> = {}, warnings: string[] = [], applicable = true): AuditResult {
  return {id, pass: applicable ? failures.length === 0 : true, applicable, measurements, thresholds, failures, warnings};
}

async function assetIntegrity(projectDir: string, plan: ProductionPlan): Promise<AuditResult> {
  const failures: string[] = [];
  const missing: string[] = [];
  const empty: string[] = [];
  const placeholderAssets: string[] = [];
  const missingProvenance: string[] = [];
  const assets = [...new Set(plan.shots.map((s) => s.asset).concat(plan.music_cues.map((c) => c.asset)))];
  for (const asset of assets) {
    const full = path.join(projectDir, asset);
    if (asset.includes('/placeholders/') || asset.startsWith('assets/placeholders/')) placeholderAssets.push(asset);
    if (!(await exists(full))) missing.push(asset);
    else if ((await readFile(full)).byteLength === 0) empty.push(asset);
    if (asset.startsWith('assets/captures/') && asset.endsWith('.png')) {
      const provenance = full.replace(/\.png$/i, '.provenance.json');
      if (!(await exists(provenance))) missingProvenance.push(path.relative(projectDir, provenance));
    }
  }
  if (missing.length) failures.push(`missing assets: ${missing.join(', ')}`);
  if (empty.length) failures.push(`empty assets: ${empty.join(', ')}`);
  if (placeholderAssets.length) failures.push(`placeholder assets are not renderable evidence: ${placeholderAssets.join(', ')}`);
  if (missingProvenance.length) failures.push(`capture provenance missing: ${missingProvenance.join(', ')}`);
  return result('evidence-asset-integrity', failures, {asset_count: assets.length, missing, empty, placeholderAssets, missingProvenance}, {missing: 0, empty: 0, placeholders: 0, missing_provenance: 0});
}

async function approvalContinuity(projectDir: string, plan: ProductionPlan, timeline: NarrationTimeline, required: boolean): Promise<AuditResult> {
  const approvalFile = path.join(projectDir, 'direction', 'proof_approval.json');
  if (!(await exists(approvalFile))) return result('proof-approval-continuity', required ? ['proof approval is missing'] : [], {approval: 'missing'}, {required}, required ? [] : ['Approval is not required during proof preparation'], required);
  const approval = await readJson<ProofApproval>(approvalFile);
  const schemaFailures = await validateWithSchema('proof_approval.schema.json', approval);
  const digest = await proofPrefixDigest(projectDir, plan, timeline);
  const failures = [...schemaFailures];
  if (approval.proof_prefix_sha256 !== digest.sha256) failures.push('approved proof prefix digest no longer matches');
  if (approval.narration_timeline_sha256 !== timelineDigest(timeline)) failures.push('approved narration timeline hash no longer matches');
  if (approval.proof_boundary_frame !== plan.proof.boundary_frame) failures.push('approved proof boundary changed');
  if (required && approval.human_review_score < 80) failures.push(`human review score ${approval.human_review_score} is below 80`);
  return result('proof-approval-continuity', failures, {current_prefix_sha256: digest.sha256, approved_prefix_sha256: approval.proof_prefix_sha256, current_timeline_sha256: timelineDigest(timeline), approved_timeline_sha256: approval.narration_timeline_sha256, human_review_score: approval.human_review_score}, {required, minimum_review_score: 80});
}

function semanticAlignment(plan: ProductionPlan): AuditResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  for (const shot of plan.shots) {
    if (!shot.narration_text.trim()) failures.push(`${shot.id} has no narration_text`);
    if (shot.source_backed && (shot.claim_ids.length === 0 || shot.source_ids.length === 0)) failures.push(`${shot.id} source-backed visual lacks claim/source links`);
    if (shot.visual_type === 'generic_stock' && shot.claim_ids.length > 0) warnings.push(`${shot.id} uses generic stock against a factual claim`);
  }
  return result('semantic-visual-alignment', failures, {shot_count: plan.shots.length}, {source_backed_requires_claim_and_source: true}, warnings);
}

function pacing(plan: ProductionPlan): AuditResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  const durations = plan.shots.filter((s) => s.visual_type !== 'end_card').map((s) => ({id: s.id, seconds: (s.end_frame - s.start_frame) / plan.fps}));
  for (const item of durations) {
    if (item.seconds < 1.5) warnings.push(`${item.id} is shorter than 1.5s`);
    if (item.seconds > 16) failures.push(`${item.id} is longer than 16s`);
  }
  return result('pacing', failures, {min_seconds: Math.min(...durations.map((d) => d.seconds)), max_seconds: Math.max(...durations.map((d) => d.seconds))}, {max_shot_seconds: 16}, warnings);
}

function mobileLegibility(plan: ProductionPlan): AuditResult {
  const failures = plan.shots
    .filter((s) => s.mobile_font_px !== undefined && s.mobile_font_px < plan.policies.mobile_min_font_px)
    .map((s) => `${s.id} font ${s.mobile_font_px}px < ${plan.policies.mobile_min_font_px}px`);
  return result('mobile-legibility', failures, {minimum_observed_px: Math.min(...plan.shots.map((s) => s.mobile_font_px ?? Number.POSITIVE_INFINITY))}, {minimum_px: plan.policies.mobile_min_font_px});
}

function musicCues(plan: ProductionPlan): AuditResult {
  const failures: string[] = [];
  if (plan.duration_seconds >= 60 && plan.music_cues.length === 0) failures.push('long-form film requires at least one canonical music cue');
  for (const cue of plan.music_cues) {
    if (cue.start_frame < 0 || cue.end_frame <= cue.start_frame || cue.end_frame > plan.duration_frames) failures.push(`${cue.id} has invalid frame bounds`);
    if (!Number.isFinite(cue.gain_db) || cue.gain_db > -8) failures.push(`${cue.id} gain ${cue.gain_db}dB risks masking narration; must be <= -8dB`);
  }
  return result('music-cues', failures, {cue_count: plan.music_cues.length, maximum_gain_db: Math.max(...plan.music_cues.map((c) => c.gain_db), Number.NEGATIVE_INFINITY)}, {maximum_gain_db: -8});
}

async function provenance(projectDir: string, plan: ProductionPlan): Promise<AuditResult> {
  const catalogFile = path.join(projectDir, 'research', 'source_catalog.json');
  if (!(await exists(catalogFile))) return result('license-provenance', ['source_catalog.json is missing']);
  const catalog = await readJson<{sources: Array<{id: string; url: string; domain: string; license_or_basis: string; active: boolean; primary: boolean}>}>(catalogFile);
  const sourceIds = new Set(catalog.sources.map((s) => s.id));
  const failures: string[] = [];
  for (const shot of plan.shots) for (const sourceId of shot.source_ids) if (!sourceIds.has(sourceId)) failures.push(`${shot.id} references unknown source ${sourceId}`);
  for (const source of catalog.sources.filter((s) => s.active)) {
    if (!source.url || !source.domain || !source.license_or_basis) failures.push(`${source.id} has incomplete provenance`);
  }
  return result('license-provenance', failures, {active_sources: catalog.sources.filter((s) => s.active).length, primary_sources: catalog.sources.filter((s) => s.active && s.primary).length}, {all_references_resolve: true});
}

async function editPlanContract(projectDir: string, plan: ProductionPlan): Promise<AuditResult> {
  const compiled = path.join(projectDir, 'build', 'edit_plan.json');
  if (!(await exists(compiled))) return result('edit-plan-contract', ['compiled edit_plan.json is missing']);
  const edit = await readJson<{project_id: string; fps: number; duration_frames: number; metrics: ReturnType<typeof planMetrics>; shots: unknown[]}>(compiled);
  const expectedMetrics = planMetrics(plan);
  const failures: string[] = [];
  if (edit.project_id !== plan.project_id || edit.fps !== plan.fps || edit.duration_frames !== plan.duration_frames) failures.push('compiled edit plan header differs from canonical plan');
  if (JSON.stringify(edit.metrics) !== JSON.stringify(expectedMetrics)) failures.push('compiled edit plan metrics differ from canonical classification library');
  if (edit.shots.length !== plan.shots.length) failures.push('compiled edit plan shot count differs');
  return result('edit-plan-contract', failures, {compiled_metrics: edit.metrics, canonical_metrics: expectedMetrics}, {identical_metrics: true});
}

async function alignmentReadiness(projectDir: string, timeline: NarrationTimeline): Promise<AuditResult> {
  const alignmentFile = path.join(projectDir, 'direction', 'word_alignment.json');
  const narrationFile = path.join(projectDir, 'build', 'narration_final.wav');
  const captionsFile = path.join(projectDir, 'build', 'captions.srt');
  const missing = [] as string[];
  for (const file of [alignmentFile, narrationFile, captionsFile]) if (!(await exists(file))) missing.push(path.relative(projectDir, file));
  return result('alignment-readiness', missing.map((f) => `missing ${f}`), {missing, timeline_output_seconds: timeline.output_duration_seconds}, {missing: 0});
}

function terminalEnding(plan: ProductionPlan): AuditResult {
  const endCards = plan.shots.filter((s) => s.visual_type === 'end_card');
  const failures: string[] = [];
  if (endCards.length !== 1) failures.push(`expected one end card, found ${endCards.length}`);
  if (endCards[0]?.end_frame !== plan.duration_frames) failures.push('end card is not terminal');
  if (endCards[0] && endCards[0].start_frame < plan.proof.boundary_frame) failures.push('end card enters proof prefix');
  return result('terminal-ending', failures, {end_card_count: endCards.length, end_card_start: endCards[0]?.start_frame, proof_boundary: plan.proof.boundary_frame}, {end_card_count: 1, terminal_only: true});
}

export async function aggregateAudit(projectDir: string, stage: 'planning' | 'proof' | 'full-pre-render' | 'post-render'): Promise<{pass: boolean; stage: string; results: AuditResult[]; failures: string[]}> {
  const plan = await readJson<ProductionPlan>(path.join(projectDir, 'direction', 'production_plan.json'));
  const timeline = await readJson<NarrationTimeline>(path.join(projectDir, 'direction', 'narration_timeline.json'));
  const planSchema = await validateWithSchema('production_plan.schema.json', plan);
  const timelineSchema = await validateWithSchema('narration_timeline.schema.json', timeline);
  const results: AuditResult[] = [];
  results.push(result('canonical-plan-schema', [...planSchema, ...validatePlanInvariants(plan)], {fps: plan.fps, duration_frames: plan.duration_frames, shot_count: plan.shots.length}, {schema_version: 1}));
  results.push(result('narration-timeline', [...timelineSchema, ...validateTimeline(timeline, plan.fps)], {source_duration: timeline.source_audio_duration_seconds, output_duration: timeline.output_duration_seconds, pause_count: timeline.editorial_pauses.length, timeline_sha256: timelineDigest(timeline)}, {timeline_matches_plan_seconds: plan.duration_seconds}));
  results.push(await approvalContinuity(projectDir, plan, timeline, stage === 'full-pre-render' || stage === 'post-render'));
  results.push(result('evidence-coverage', visualPolicyFailures(plan), planMetrics(plan), {...plan.policies}));
  results.push(await assetIntegrity(projectDir, plan));
  results.push(semanticAlignment(plan));
  results.push(pacing(plan));
  results.push(mobileLegibility(plan));
  results.push(musicCues(plan));
  results.push(await provenance(projectDir, plan));
  results.push(await editPlanContract(projectDir, plan));
  results.push(stage === 'planning' ? result('alignment-readiness', [], {}, {}, ['Deferred until proof preparation'], false) : await alignmentReadiness(projectDir, timeline));
  results.push(terminalEnding(plan));
  if (stage === 'post-render') {
    results.push(await renderedMediaAudit(path.join(projectDir, 'output', 'final.mp4'), plan, timeline));
    results.push(await renderedSpeechEndingAudit(path.join(projectDir, 'build', 'final_transcript.json'), timeline));
  } else {
    results.push(result('rendered-media-qa', [], {}, {}, ['Runs only after render'], false));
    results.push(result('rendered-speech-ending', [], {}, {}, ['Runs only after render'], false));
  }
  const failures = results.flatMap((r) => r.failures.map((failure) => `${r.id}: ${failure}`));
  return {pass: results.filter((r) => r.applicable).every((r) => r.pass), stage, results, failures};
}
