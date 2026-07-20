#!/usr/bin/env node
import {cp, mkdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {aggregateAudit} from './lib/audits.js';
import {captureSources} from './lib/capture.js';
import {planMetrics} from './lib/classification.js';
import {proofPrefixDigest, timelineDigest} from './lib/hash.js';
import {exists, projectRoot, readJson, writeJson} from './lib/io.js';
import {rebalancePlan, type RebalanceCandidate} from './lib/rebalance.js';
import type {NarrationTimeline, ProductionPlan, ProofApproval} from './types.js';
import {transformedSecond} from './lib/timeline.js';
import {renderedMediaAuditFor, renderedSpeechEndingAuditFor} from './lib/media.js';
import {validateWithSchema} from './lib/schema.js';
import {validatePlanInvariants, visualPolicyFailures} from './lib/invariants.js';
import {validateTimeline} from './lib/timeline.js';
import {materializeExternalAssets} from './lib/materialize.js';
import {prepareVisualAssets} from './lib/visuals.js';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function required(name: string): string {
  const value = arg(name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}
function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {stdio: 'inherit'});
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}
function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rem = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(rem).padStart(3, '0')}`;
}

async function loadProject(projectId: string) {
  const root = projectRoot(projectId);
  const plan = await readJson<ProductionPlan>(path.join(root, 'direction', 'production_plan.json'));
  const timeline = await readJson<NarrationTimeline>(path.join(root, 'direction', 'narration_timeline.json'));
  return {root, plan, timeline};
}

async function validateProject(projectId: string): Promise<void> {
  const {plan, timeline} = await loadProject(projectId);
  const failures = [
    ...(await validateWithSchema('production_plan.schema.json', plan)).map((f) => `production_plan schema: ${f}`),
    ...(await validateWithSchema('narration_timeline.schema.json', timeline)).map((f) => `narration_timeline schema: ${f}`),
    ...validatePlanInvariants(plan).map((f) => `canonical invariant: ${f}`),
    ...visualPolicyFailures(plan).map((f) => `visual policy: ${f}`),
    ...validateTimeline(timeline, plan.fps).map((f) => `timeline invariant: ${f}`),
  ];
  if (Math.abs(plan.duration_seconds - timeline.output_duration_seconds) > 1 / plan.fps) failures.push('plan duration and narration timeline output duration differ');
  if (plan.proof.boundary_frame !== timeline.proof_boundary_frame) failures.push('plan and narration proof boundaries differ');
  if (plan.proof.semantic_end !== timeline.proof_semantic_end) failures.push('plan and narration proof semantic endings differ');
  const report = {pass: failures.length === 0, project_id: projectId, failures, metrics: planMetrics(plan)};
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
}

async function stageRenderAssets(projectId: string): Promise<void> {
  const {root} = await loadProject(projectId);
  const destination = path.join(process.cwd(), 'public', 'projects', projectId);
  await rm(destination, {recursive: true, force: true});
  await mkdir(destination, {recursive: true});
  for (const folder of ['assets', 'build']) {
    const source = path.join(root, folder);
    if (await exists(source)) await cp(source, path.join(destination, folder), {recursive: true});
  }
  console.log(`Staged render assets at ${path.relative(process.cwd(), destination)}`);
}

async function compile(projectId: string): Promise<void> {
  const {root, plan, timeline} = await loadProject(projectId);
  await mkdir(path.join(root, 'build'), {recursive: true});
  const metrics = planMetrics(plan);
  await writeJson(path.join(root, 'build', 'edit_plan.json'), {
    schema_version: 1,
    project_id: plan.project_id,
    fps: plan.fps,
    duration_frames: plan.duration_frames,
    duration_seconds: plan.duration_seconds,
    proof_boundary_frame: plan.proof.boundary_frame,
    timeline_sha256: timelineDigest(timeline),
    metrics,
    shots: plan.shots,
    music_cues: plan.music_cues,
  });
  const captionCues = (await exists(path.join(root, 'build', 'captions.json')))
    ? await readJson<Array<{start_frame: number; end_frame: number; text: string}>>(path.join(root, 'build', 'captions.json'))
    : [];
  await writeJson(path.join(root, 'build', 'render_input.json'), {
    projectId: plan.project_id,
    plan,
    timeline,
    narrationAsset: `projects/${plan.project_id}/build/narration_final.wav`,
    captionCues,
  });
  console.log(JSON.stringify({compiled: true, project_id: projectId, metrics}, null, 2));
}

async function prepareAudio(projectId: string): Promise<void> {
  const {root, timeline} = await loadProject(projectId);
  const source = path.join(root, timeline.source_audio);
  if (!(await exists(source))) throw new Error(`Missing source narration: ${timeline.source_audio}`);
  const output = path.join(root, 'build', 'narration_final.wav');
  await mkdir(path.dirname(output), {recursive: true});
  const pauses = [...timeline.editorial_pauses].sort((a, b) => a.after_source_second - b.after_source_second);
  if (pauses.length === 0) {
    run('ffmpeg', ['-y', '-i', source, '-af', 'volume=-3dB,alimiter=limit=0.88', '-ar', '48000', '-ac', '2', output]);
  } else {
    const filters: string[] = [];
    const inputs: string[] = [];
    let previous = 0;
    let stream = 0;
    for (const pause of pauses) {
      filters.push(`[0:a]atrim=start=${previous}:end=${pause.after_source_second},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[a${stream}]`);
      inputs.push(`[a${stream}]`);
      stream += 1;
      filters.push(`anullsrc=r=48000:cl=stereo:d=${pause.duration_seconds}[a${stream}]`);
      inputs.push(`[a${stream}]`);
      stream += 1;
      previous = pause.after_source_second;
    }
    filters.push(`[0:a]atrim=start=${previous},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[a${stream}]`);
    inputs.push(`[a${stream}]`);
    filters.push(`${inputs.join('')}concat=n=${inputs.length}:v=0:a=1[joined]`);
    filters.push('[joined]volume=-3dB,alimiter=limit=0.88[out]');
    run('ffmpeg', ['-y', '-i', source, '-filter_complex', filters.join(';'), '-map', '[out]', '-ar', '48000', '-ac', '2', output]);
  }
  await writeJson(path.join(root, 'build', 'mix_metadata.json'), {
    source_audio: timeline.source_audio,
    source_duration_seconds: timeline.source_audio_duration_seconds,
    editorial_pauses: timeline.editorial_pauses,
    output_duration_seconds: timeline.output_duration_seconds,
    narration_priority: true,
    sample_rate: 48000,
    channels: 2,
  });
  console.log(`Prepared ${path.relative(process.cwd(), output)}`);
}

async function captions(projectId: string): Promise<void> {
  const {root, timeline, plan} = await loadProject(projectId);
  const alignment = await readJson<{words: Array<{word: string; start: number; end: number}>}>(path.join(root, 'direction', 'word_alignment.json'));
  if (!alignment.words.length) throw new Error('word_alignment.json contains no words');
  const groups: Array<typeof alignment.words> = [];
  let current: typeof alignment.words = [];
  for (const word of alignment.words) {
    current.push(word);
    const duration = current.at(-1)!.end - current[0]!.start;
    if (current.length >= 8 || duration >= 3 || /[.!?]$/.test(word.word)) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);
  const lines: string[] = [];
  const cues: Array<{start_frame: number; end_frame: number; text: string}> = [];
  groups.forEach((group, index) => {
    const start = transformedSecond(group[0]!.start, timeline.editorial_pauses);
    const spokenEnd = transformedSecond(group.at(-1)!.end, timeline.editorial_pauses);
    const nextStart = index + 1 < groups.length
      ? transformedSecond(groups[index + 1]![0]!.start, timeline.editorial_pauses)
      : spokenEnd;
    const end = Math.max(spokenEnd, Math.min(nextStart, spokenEnd + 1.25));
    const text = group.map((w) => w.word).join(' ');
    lines.push(String(index + 1), `${srtTime(start)} --> ${srtTime(end)}`, text, '');
    cues.push({start_frame: Math.round(start * plan.fps), end_frame: Math.max(Math.round(end * plan.fps), Math.round(start * plan.fps) + 1), text});
  });
  await mkdir(path.join(root, 'build'), {recursive: true});
  await writeFile(path.join(root, 'build', 'captions.srt'), lines.join('\n'), 'utf8');
  await writeJson(path.join(root, 'build', 'captions.json'), cues);
  console.log(`Generated ${groups.length} caption cues`);
}

async function proofManifest(projectId: string): Promise<void> {
  const {root, plan, timeline} = await loadProject(projectId);
  const digest = await proofPrefixDigest(root, plan, timeline);
  await writeJson(path.join(root, 'build', 'proof_prefix_manifest.json'), {...digest.manifest, proof_prefix_sha256: digest.sha256});
  await writeFile(path.join(root, 'build', 'proof_prefix.sha256'), `${digest.sha256}\n`, 'utf8');
  console.log(JSON.stringify({proof_prefix_sha256: digest.sha256, timeline_sha256: timelineDigest(timeline), boundary_frame: plan.proof.boundary_frame}, null, 2));
}

async function approveProof(projectId: string): Promise<void> {
  const {root, plan, timeline} = await loadProject(projectId);
  const score = Number(required('score'));
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error('--score must be between 0 and 100');
  const digest = await proofPrefixDigest(root, plan, timeline);
  const approval: ProofApproval = {
    schema_version: 1,
    project_id: projectId,
    proof_prefix_sha256: digest.sha256,
    narration_timeline_sha256: timelineDigest(timeline),
    proof_run_id: required('run-id'),
    render_source_commit: required('commit'),
    human_review_score: score,
    proof_boundary_frame: plan.proof.boundary_frame,
    approved_at: new Date().toISOString(),
  };
  await writeJson(path.join(root, 'direction', 'proof_approval.json'), approval);
  console.log('Proof approval recorded');
}

async function initProject(projectId: string): Promise<void> {
  const root = projectRoot(projectId);
  if (await exists(root)) throw new Error(`Project already exists: ${projectId}`);
  for (const dir of ['direction', 'research', 'assets/audio', 'assets/captures', 'assets/graphics', 'build', 'qa', 'output']) await mkdir(path.join(root, dir), {recursive: true});
  await writeFile(path.join(root, 'README.md'), `# ${projectId}\n\nPopulate direction/production_plan.json and direction/narration_timeline.json.\n`, 'utf8');
  console.log(`Initialized ${projectId}`);
}

async function renderedQa(projectId: string): Promise<void> {
  const {root, plan} = await loadProject(projectId);
  const mode = required('mode');
  if (!['proof', 'full'].includes(mode)) throw new Error('--mode must be proof or full');
  const expectedFrames = mode === 'proof' ? plan.proof.boundary_frame : plan.duration_frames;
  const expectedWord = mode === 'proof' ? plan.proof.final_word : (await readJson<NarrationTimeline>(path.join(root, 'direction', 'narration_timeline.json'))).final_word;
  const video = path.resolve(arg('video') ?? path.join(root, 'output', mode === 'proof' ? 'proof.mp4' : 'final.mp4'));
  const transcript = path.resolve(arg('transcript') ?? path.join(root, 'build', mode === 'proof' ? 'proof_transcript.json' : 'final_transcript.json'));
  const media = await renderedMediaAuditFor(video, expectedFrames, plan.fps, `rendered-media-${mode}`);
  const speech = await renderedSpeechEndingAuditFor(transcript, expectedWord, `rendered-speech-${mode}`);
  const captionsFile = path.join(root, 'build', 'captions.json');
  const cues = (await exists(captionsFile)) ? await readJson<Array<{start_frame: number; end_frame: number; text: string}>>(captionsFile) : [];
  const coveredFrames = cues.reduce((sum, cue) => {
    const start = Math.max(0, cue.start_frame);
    const end = Math.min(expectedFrames, cue.end_frame);
    return sum + Math.max(0, end - start);
  }, 0);
  const captionCoverage = coveredFrames / expectedFrames;
  const captionFailures: string[] = [];
  if (!Number.isFinite(captionCoverage) || captionCoverage < 0.9) captionFailures.push(`caption coverage ${captionCoverage} is below 0.9`);
  const endCardInProof = mode === 'proof' && plan.shots.some((shot) => shot.visual_type === 'end_card' && shot.start_frame < expectedFrames);
  if (endCardInProof) captionFailures.push('proof contains the final end card');
  const captionResult = {id: `caption-terminal-${mode}`, pass: captionFailures.length === 0, applicable: true, measurements: {captionCoverage, cueCount: cues.length, endCardInProof}, thresholds: {minimum_caption_coverage: 0.9, proof_end_card_count: 0}, failures: captionFailures, warnings: []};
  const report = {pass: media.pass && speech.pass && captionResult.pass, mode, results: [media, speech, captionResult]};
  await writeJson(path.join(root, 'qa', `rendered.${mode}.json`), report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command) throw new Error('Usage: orvyq <init|validate|materialize-assets|prepare-visuals|compile|prepare-audio|captions|capture-sources|stage-render-assets|audit|rebalance|proof-manifest|approve-proof|rendered-qa> --project-id <id>');
  const projectId = required('project-id');
  if (command === 'init') return initProject(projectId);
  if (command === 'validate') return validateProject(projectId);
  if (command === 'materialize-assets') {
    const mode = (arg('mode') ?? 'proof') as 'proof' | 'full';
    if (!['proof', 'full'].includes(mode)) throw new Error('--mode must be proof or full');
    return materializeExternalAssets(projectRoot(projectId), mode);
  }
  if (command === 'prepare-visuals') {
    const mode = (arg('mode') ?? 'proof') as 'proof' | 'full';
    if (!['proof', 'full'].includes(mode)) throw new Error('--mode must be proof or full');
    return prepareVisualAssets(projectRoot(projectId), mode);
  }
  if (command === 'compile') return compile(projectId);
  if (command === 'prepare-audio') return prepareAudio(projectId);
  if (command === 'captions') return captions(projectId);
  if (command === 'stage-render-assets') return stageRenderAssets(projectId);
  if (command === 'capture-sources') {
    const output = await captureSources(projectRoot(projectId));
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  if (command === 'audit') {
    const stage = (arg('stage') ?? 'planning') as 'planning' | 'proof' | 'full-pre-render' | 'post-render';
    const root = projectRoot(projectId);
    const report = await aggregateAudit(root, stage);
    await writeJson(path.join(root, 'qa', `aggregate.${stage}.json`), report);
    console.log(JSON.stringify(report, null, 2));
    if (!report.pass) process.exitCode = 1;
    return;
  }
  if (command === 'rebalance') {
    const {root, plan} = await loadProject(projectId);
    const candidates = await readJson<RebalanceCandidate[]>(path.join(root, 'direction', 'rebalance_candidates.json'));
    const output = rebalancePlan(plan, candidates);
    const target = flag('apply') ? path.join(root, 'direction', 'production_plan.json') : path.join(root, 'direction', 'production_plan.rebalanced.json');
    await writeJson(target, output.plan);
    await writeJson(path.join(root, 'qa', 'rebalance_report.json'), {applied: output.applied, failures: output.failures});
    console.log(JSON.stringify({target, applied: output.applied, failures: output.failures}, null, 2));
    if (output.failures.length) process.exitCode = 1;
    return;
  }
  if (command === 'proof-manifest') return proofManifest(projectId);
  if (command === 'approve-proof') return approveProof(projectId);
  if (command === 'rendered-qa') return renderedQa(projectId);
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
