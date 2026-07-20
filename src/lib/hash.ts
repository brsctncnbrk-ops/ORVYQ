import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import type {NarrationTimeline, ProductionPlan, Shot} from '../types.js';
import {exists} from './io.js';

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => [key, normalize(val)]),
    );
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256Text(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function sha256File(file: string): Promise<string> {
  return sha256Text(await readFile(file));
}

export function timelineDigest(timeline: NarrationTimeline): string {
  const {timeline_sha256: _storedHash, ...payload} = timeline;
  return sha256Text(stableStringify(payload));
}

export async function proofPrefixDigest(
  projectDir: string,
  plan: ProductionPlan,
  timeline: NarrationTimeline,
): Promise<{sha256: string; manifest: Record<string, unknown>}> {
  const boundary = plan.proof.boundary_frame;
  const prefixShots: Shot[] = plan.shots
    .filter((shot) => shot.start_frame < boundary)
    .map((shot) => ({...shot, end_frame: Math.min(shot.end_frame, boundary)}));

  const assets: Array<{path: string; sha256: string}> = [];
  for (const asset of [...new Set(prefixShots.map((shot) => shot.asset))].sort()) {
    const full = path.join(projectDir, asset);
    if (!(await exists(full))) throw new Error(`Missing proof-prefix asset: ${asset}`);
    assets.push({path: asset, sha256: await sha256File(full)});
  }

  const captionsFile = path.join(projectDir, 'build', 'captions.json');
  const narration = path.join(projectDir, 'build', 'narration_final.wav');
  const prefixCaptions = (await exists(captionsFile))
    ? (JSON.parse(await readFile(captionsFile, 'utf8')) as Array<{start_frame: number; end_frame: number; text: string}>)
        .filter((cue) => cue.start_frame < boundary)
        .map((cue) => ({...cue, end_frame: Math.min(cue.end_frame, boundary)}))
    : null;
  let narrationPrefixSha256: string | null = null;
  if (await exists(narration)) {
    const durationSeconds = boundary / plan.fps;
    const extraction = spawnSync('ffmpeg', [
      '-v', 'error', '-i', narration, '-t', String(durationSeconds),
      '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', '48000', '-ac', '2', 'pipe:1',
    ], {encoding: null, maxBuffer: 1024 * 1024 * 1024});
    if (extraction.status !== 0 || !Buffer.isBuffer(extraction.stdout)) {
      throw new Error(`Unable to hash proof-prefix narration PCM: ${String(extraction.stderr)}`);
    }
    narrationPrefixSha256 = sha256Text(extraction.stdout);
  }
  const manifest = {
    project_id: plan.project_id,
    fps: plan.fps,
    boundary_frame: boundary,
    timeline_sha256: timelineDigest(timeline),
    shots: prefixShots,
    assets,
    captions_prefix_sha256: prefixCaptions ? sha256Text(stableStringify(prefixCaptions)) : null,
    narration_prefix_pcm_sha256: narrationPrefixSha256,
  };
  return {sha256: sha256Text(stableStringify(manifest)), manifest};
}
