import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import type {ProductionPlan, Shot} from '../types.js';
import {exists, readJson, writeJson} from './io.js';
import {sha256File} from './hash.js';

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {stdio: 'inherit'});
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}
function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function wrap(value: string, limit = 46): string[] {
  const words = value.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (`${current} ${word}`.trim().length > limit && current) { lines.push(current); current = word; }
    else current = `${current} ${word}`.trim();
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}
function deterministicOffset(id: string): {x: number; y: number} {
  const digest = createHash('sha256').update(id).digest();
  return {x: digest.readUInt16BE(0) % 193, y: digest.readUInt16BE(2) % 109};
}

async function captureVariant(projectDir: string, shot: Shot): Promise<void> {
  const sourceId = shot.source_ids[0];
  if (!sourceId) throw new Error(`${shot.id} capture has no source id`);
  const base = path.join(projectDir, 'assets', 'captures', `${sourceId}.png`);
  const baseProvenance = path.join(projectDir, 'assets', 'captures', `${sourceId}.provenance.json`);
  if (!(await exists(base)) || !(await exists(baseProvenance))) throw new Error(`${shot.id} base capture ${sourceId} is missing`);
  const target = path.join(projectDir, shot.asset);
  const targetProvenance = target.replace(/\.png$/i, '.provenance.json');
  if (await exists(target) && await exists(targetProvenance)) return;
  await mkdir(path.dirname(target), {recursive: true});
  const {x, y} = deterministicOffset(shot.id);
  run('ffmpeg', ['-v', 'error', '-y', '-i', base, '-vf', `crop=1728:972:${x}:${y},scale=1920:1080:flags=lanczos`, '-frames:v', '1', target]);
  const provenance = JSON.parse(await readFile(baseProvenance, 'utf8')) as Record<string, unknown>;
  await writeJson(targetProvenance, {
    ...provenance,
    derived_from: path.relative(projectDir, base),
    derivation: {type: 'deterministic_crop_and_scale', crop: {width: 1728, height: 972, x, y}, output: {width: 1920, height: 1080}},
    shot_id: shot.id,
    sha256: await sha256File(target),
  });
}

async function sourceGraphic(projectDir: string, shot: Shot): Promise<void> {
  const target = path.join(projectDir, shot.asset);
  if (await exists(target)) return;
  await mkdir(path.dirname(target), {recursive: true});
  const lines = wrap(shot.narration_text);
  const seed = createHash('sha256').update(shot.id).digest();
  const x1 = 220 + (seed[0] ?? 0) * 2;
  const y1 = 180 + (seed[1] ?? 0);
  const x2 = 1180 + (seed[2] ?? 0) * 2;
  const y2 = 650 + (seed[3] ?? 0);
  const text = lines.map((line, index) => `<text x="150" y="${405 + index * 86}" fill="#f3f1eb" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="600">${escapeXml(line)}</text>`).join('');
  const source = escapeXml(shot.source_line ?? `Source: ${shot.source_ids.join(', ')}`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#06090e"/><stop offset="0.58" stop-color="#111824"/><stop offset="1" stop-color="#05070a"/></linearGradient><filter id="blur"><feGaussianBlur stdDeviation="42"/></filter></defs>
  <rect width="1920" height="1080" fill="url(#bg)"/>
  <circle cx="${x1}" cy="${y1}" r="260" fill="#5f7696" opacity="0.16" filter="url(#blur)"/><circle cx="${x2}" cy="${y2}" r="330" fill="#96775f" opacity="0.12" filter="url(#blur)"/>
  <path d="M100 820 C420 610 650 940 930 720 S1440 560 1820 760" fill="none" stroke="#d8d2c8" stroke-opacity="0.20" stroke-width="3"/>
  <line x1="150" y1="300" x2="780" y2="300" stroke="#c8bda8" stroke-width="4"/><text x="150" y="250" fill="#aeb7c4" font-family="Arial, Helvetica, sans-serif" font-size="42" letter-spacing="5">ORVYQ / SOURCE CONTEXT</text>
  ${text}
  <rect x="150" y="860" width="1620" height="2" fill="#c8bda8" opacity="0.45"/><text x="150" y="925" fill="#cfd4dc" font-family="Arial, Helvetica, sans-serif" font-size="42">${source}</text>
</svg>`;
  await writeFile(target, svg, 'utf8');
}

async function ambientCue(projectDir: string, cue: ProductionPlan['music_cues'][number], fps: number, index: number): Promise<void> {
  const target = path.join(projectDir, cue.asset);
  if (await exists(target)) return;
  await mkdir(path.dirname(target), {recursive: true});
  const duration = (cue.end_frame - cue.start_frame) / fps;
  const frequency = [48, 55, 62][index % 3] ?? 55;
  const fadeOutStart = Math.max(0, duration - 4);
  const filter = `[0:a]lowpass=f=900,highpass=f=35,volume=0.20[a0];[1:a]volume=0.035[a1];[a0][a1]amix=inputs=2:normalize=0,afade=t=in:st=0:d=3,afade=t=out:st=${fadeOutStart}:d=4,alimiter=limit=0.18[out]`;
  run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `anoisesrc=color=pink:amplitude=0.05:sample_rate=48000:duration=${duration}`, '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=48000:duration=${duration}`, '-filter_complex', filter, '-map', '[out]', '-ac', '2', '-ar', '48000', '-codec:a', 'libmp3lame', '-b:a', '128k', target]);
}

export async function prepareVisualAssets(projectDir: string, mode: 'proof' | 'full'): Promise<void> {
  const plan = await readJson<ProductionPlan>(path.join(projectDir, 'direction', 'production_plan.json'));
  const boundary = mode === 'proof' ? plan.proof.boundary_frame : plan.duration_frames;
  const shots = plan.shots.filter((shot) => shot.start_frame < boundary);
  for (const shot of shots) {
    if (shot.visual_type === 'primary_capture') await captureVariant(projectDir, shot);
    else if (shot.visual_type === 'source_graphic') await sourceGraphic(projectDir, shot);
  }
  const cues = plan.music_cues.filter((cue) => cue.start_frame < boundary);
  for (const [index, cue] of cues.entries()) await ambientCue(projectDir, cue, plan.fps, index);
  console.log(`Prepared ${shots.length} ${mode} shots and ${cues.length} music cues`);
}
