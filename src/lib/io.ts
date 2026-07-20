import {mkdir, readFile, writeFile, access} from 'node:fs/promises';
import path from 'node:path';

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), {recursive: true});
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export function projectRoot(projectId: string): string {
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(projectId)) {
    throw new Error(`Invalid project_id: ${projectId}`);
  }
  return path.join(process.cwd(), 'projects', projectId);
}
