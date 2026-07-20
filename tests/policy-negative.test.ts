import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePlanInvariants,visualPolicyFailures} from '../src/lib/invariants.js';
import {plan,shot} from './helpers.js';
test('missing, null-like and NaN policy values fail closed',()=>{const p=plan([shot('a',0,4500,'source_graphic'),shot('b',4500,5400,'primary_capture'),shot('end',5400,5700,'end_card',{source_ids:[],claim_ids:[],source_backed:false})]);p.policies.source_backed_min_ratio=Number.NaN;const failures=validatePlanInvariants(p);assert.ok(failures.some((failure)=>failure.includes('source_backed_min_ratio')));assert.ok(visualPolicyFailures(p).some((failure)=>failure.includes('source-backed ratio')));});
