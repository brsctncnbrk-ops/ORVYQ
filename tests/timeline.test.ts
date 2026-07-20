import test from 'node:test';
import assert from 'node:assert/strict';
import {transformedSecond} from '../src/lib/timeline.js';

test('audio, captions and visual timing share the same pause transform', () => {
  const pauses = [
    {after_word_index: 10, after_source_second: 5, duration_seconds: 1, reason: 'beat'},
    {after_word_index: 20, after_source_second: 10, duration_seconds: 2, reason: 'section'},
  ];
  assert.equal(transformedSecond(4.9, pauses), 4.9);
  assert.equal(transformedSecond(5, pauses), 6);
  assert.equal(transformedSecond(12, pauses), 15);
});
