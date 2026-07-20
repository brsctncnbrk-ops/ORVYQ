import path from 'node:path';
import {readJson} from './io.js';

export async function validateWithSchema(schemaName: string, data: unknown): Promise<string[]> {
  const [{default: Ajv}, {default: addFormats}] = await Promise.all([import('ajv/dist/2020.js'), import('ajv-formats')]);
  const schema = await readJson<Record<string, unknown>>(path.join(process.cwd(), 'schemas', schemaName));
  const ajv = new Ajv({allErrors: true, strict: true});
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (validate(data)) return [];
  return (validate.errors ?? []).map((error: {instancePath?: string; message?: string}) => `${error.instancePath || '/'} ${error.message || 'schema error'}`);
}
