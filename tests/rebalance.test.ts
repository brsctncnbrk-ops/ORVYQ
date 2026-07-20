import test from 'node:test';
import assert from 'node:assert/strict';
import {rebalancePlan} from '../src/lib/rebalance.js';
import {plan, shot} from './helpers.js';

test('rebalance never changes the approved proof prefix', () => {
  const p = plan([
    shot('proof', 0, 4500, 'source_graphic'),
    shot('e1', 4500, 4800, 'primary_capture'),
    shot('e2', 4800, 5400, 'physical_evidence'),
    shot('end', 5400, 5700, 'end_card', {source_ids: [], claim_ids: [], source_backed: false}),
  ]);
  const before = JSON.stringify(p.shots[0]);
  const output = rebalancePlan(p, [
    {
      target_shot_id: 'e2',
      priority: 10,
      replacement: {
        visual_type: 'source_graphic',
        asset: 'assets/replacement.svg',
        source_ids: ['src-1'],
        claim_ids: ['claim-1'],
        source_backed: true,
        provenance_mode: 'source_derived',
        full_screen_graphic: false,
        motif: 'replacement',
        mobile_font_px: 48,
      },
    },
  ]);
  assert.equal(JSON.stringify(output.plan.shots[0]), before);
  assert.ok(!output.failures.some((failure) => failure.includes('prefix changed')));
});

test('candidate targeting proof prefix is ignored', () => {
  const p = plan([
    shot('proof', 0, 4500, 'source_graphic'),
    shot('after', 4500, 5400, 'primary_capture'),
    shot('end', 5400, 5700, 'end_card', {source_ids: [], claim_ids: [], source_backed: false}),
  ]);
  const output = rebalancePlan(p, [{
    target_shot_id: 'proof',
    priority: 100,
    replacement: {
      visual_type: 'contextual_footage', asset: 'assets/new.mp4', source_ids: [], claim_ids: [], source_backed: false,
      provenance_mode: 'licensed_footage', full_screen_graphic: false, motif: 'new', mobile_font_px: 48,
    },
  }]);
  assert.equal(output.plan.shots[0]!.visual_type, 'source_graphic');
});
