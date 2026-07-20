import {cp, mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import type {NarrationTimeline, ProductionPlan} from '../types.js';
import {exists, readJson, writeJson} from './io.js';
import {sha256File} from './hash.js';

interface ExternalImport {
  source_path: string;
  target_path: string;
  kind: 'narration' | 'footage' | 'provenance';
  companion_for?: string;
}
interface ExternalManifest {
  schema_version: 1;
  source_repository: string;
  source_commit: string;
  imports: ExternalImport[];
}

function safeRelative(value: string, label: string): string {
  if (!value || path.isAbsolute(value) || value.includes('\\')) throw new Error(`${label} must be a non-empty POSIX relative path`);
  const normalized = path.posix.normalize(value);
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) throw new Error(`${label} escapes its root: ${value}`);
  return normalized;
}

export function validateExternalManifest(manifest: ExternalManifest): string[] {
  const failures: string[] = [];
  if (manifest.schema_version !== 1) failures.push('schema_version must be 1');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(manifest.source_repository)) failures.push('source_repository must be owner/name');
  if (!/^[a-f0-9]{40}$/.test(manifest.source_commit)) failures.push('source_commit must be a full 40-character SHA');
  const targets = new Set<string>();
  for (const [index, item] of manifest.imports.entries()) {
    try { safeRelative(item.source_path, `imports[${index}].source_path`); } catch (error) { failures.push(String(error)); }
    try { safeRelative(item.target_path, `imports[${index}].target_path`); } catch (error) { failures.push(String(error)); }
    if (!['narration', 'footage', 'provenance'].includes(item.kind)) failures.push(`imports[${index}].kind is invalid`);
    if (targets.has(item.target_path)) failures.push(`duplicate target_path ${item.target_path}`);
    targets.add(item.target_path);
    if (item.companion_for) {
      try { safeRelative(item.companion_for, `imports[${index}].companion_for`); } catch (error) { failures.push(String(error)); }
    }
  }
  return failures;
}

function run(command: string, args: string[], cwd?: string, env?: NodeJS.ProcessEnv): string {
  const result = spawnSync(command, args, {cwd, env: {...process.env, ...env}, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024});
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function parseLfsPointer(text: string): {oid: string; size: number} | null {
  if (!text.startsWith('version https://git-lfs.github.com/spec/v1')) return null;
  const oid = text.match(/oid sha256:([a-f0-9]{64})/)?.[1];
  const size = Number(text.match(/size (\d+)/)?.[1]);
  if (!oid || !Number.isFinite(size)) throw new Error('Malformed Git LFS pointer');
  return {oid, size};
}

export async function materializeExternalAssets(projectDir: string, mode: 'proof' | 'full'): Promise<void> {
  const manifestFile = path.join(projectDir, 'migration', 'external_assets.json');
  if (!(await exists(manifestFile))) {
    console.log('No external asset manifest; nothing to materialize');
    return;
  }
  const manifest = await readJson<ExternalManifest>(manifestFile);
  const failures = validateExternalManifest(manifest);
  if (failures.length) throw new Error(`Invalid external asset manifest:\n- ${failures.join('\n- ')}`);
  const plan = await readJson<ProductionPlan>(path.join(projectDir, 'direction', 'production_plan.json'));
  const timeline = await readJson<NarrationTimeline>(path.join(projectDir, 'direction', 'narration_timeline.json'));
  const boundary = mode === 'proof' ? plan.proof.boundary_frame : plan.duration_frames;
  const requiredTargets = new Set<string>([
    timeline.source_audio,
    ...plan.shots.filter((shot) => shot.start_frame < boundary).map((shot) => shot.asset),
  ]);
  const selected = manifest.imports.filter((item) => requiredTargets.has(item.target_path) || (item.companion_for && requiredTargets.has(item.companion_for)));
  const missingMappings = [...requiredTargets].filter((target) => {
    if (!target.startsWith('assets/footage/') && target !== timeline.source_audio) return false;
    return !selected.some((item) => item.target_path === target);
  });
  if (missingMappings.length) throw new Error(`External asset mappings missing: ${missingMappings.join(', ')}`);

  const temp = await mkdtemp(path.join(os.tmpdir(), 'orvyq-external-'));
  const checkout = path.join(temp, 'source');
  const records: Array<Record<string, unknown>> = [];
  try {
    await mkdir(checkout, {recursive: true});
    run('git', ['init', '--quiet'], checkout);
    run('git', ['remote', 'add', 'origin', `https://github.com/${manifest.source_repository}.git`], checkout);
    let fetched = false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        run('git', ['fetch', '--depth=1', 'origin', manifest.source_commit], checkout, {GIT_LFS_SKIP_SMUDGE: '1'});
        fetched = true;
        break;
      } catch (error) {
        if (attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 10_000));
      }
    }
    if (!fetched) throw new Error('Unable to fetch external source commit');
    run('git', ['checkout', '--detach', 'FETCH_HEAD'], checkout, {GIT_LFS_SKIP_SMUDGE: '1'});
    run('git', ['lfs', 'install', '--local'], checkout);

    const pointers = new Map<string, {oid: string; size: number} | null>();
    for (const item of selected) {
      const pointerText = run('git', ['show', `HEAD:${item.source_path}`], checkout);
      pointers.set(item.source_path, parseLfsPointer(pointerText));
    }
    const lfsPaths = [...new Set(selected.filter((item) => pointers.get(item.source_path)).map((item) => item.source_path))];
    if (lfsPaths.length) {
      let pulled = false;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          run('git', ['lfs', 'pull', '--include', lfsPaths.join(','), '--exclude', ''], checkout);
          pulled = true;
          break;
        } catch (error) {
          if (attempt === 3) throw error;
          await new Promise((resolve) => setTimeout(resolve, attempt * 10_000));
        }
      }
      if (!pulled) throw new Error('Unable to pull external LFS objects');
      run('git', ['lfs', 'fsck'], checkout);
    }

    for (const item of selected) {
      const source = path.join(checkout, item.source_path);
      const target = path.join(projectDir, safeRelative(item.target_path, 'target_path'));
      if (!(await exists(source))) throw new Error(`External source file is missing after checkout: ${item.source_path}`);
      const pointer = pointers.get(item.source_path) ?? null;
      const sourceBytes = await readFile(source);
      if (pointer) {
        if (sourceBytes.byteLength !== pointer.size) throw new Error(`${item.source_path} size ${sourceBytes.byteLength} != LFS pointer ${pointer.size}`);
        const digest = await sha256File(source);
        if (digest !== pointer.oid) throw new Error(`${item.source_path} SHA-256 ${digest} != LFS pointer ${pointer.oid}`);
      }
      await mkdir(path.dirname(target), {recursive: true});
      await cp(source, target);
      records.push({
        source_repository: manifest.source_repository,
        source_commit: manifest.source_commit,
        source_path: item.source_path,
        target_path: item.target_path,
        kind: item.kind,
        lfs_oid_sha256: pointer?.oid ?? null,
        size_bytes: sourceBytes.byteLength,
        materialized_sha256: await sha256File(target),
      });
    }
    await writeJson(path.join(projectDir, 'build', `external_assets.${mode}.provenance.json`), {
      schema_version: 1,
      project_id: plan.project_id,
      mode,
      source_repository: manifest.source_repository,
      source_commit: manifest.source_commit,
      records,
    });
    console.log(`Materialized ${records.length} external asset files for ${mode}`);
  } finally {
    await rm(temp, {recursive: true, force: true});
  }
}
