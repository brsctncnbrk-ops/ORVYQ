import test from 'node:test';
import assert from 'node:assert/strict';
import {validateExternalManifest} from '../src/lib/materialize.js';

test('external asset manifest requires immutable source and safe paths', () => {
  const valid = {
    schema_version: 1 as const,
    source_repository: 'owner/repo',
    source_commit: 'a'.repeat(40),
    imports: [{source_path: 'projects/a/file.mp4', target_path: 'assets/footage/file.mp4', kind: 'footage' as const}],
  };
  assert.deepEqual(validateExternalManifest(valid), []);
  assert.ok(validateExternalManifest({...valid, source_commit: 'main'}).some((failure) => failure.includes('40-character')));
  assert.ok(validateExternalManifest({...valid, imports: [{...valid.imports[0]!, target_path: '../escape.mp4'}]}).some((failure) => failure.includes('escapes')));
});
