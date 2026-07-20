import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePlanInvariants} from '../src/lib/invariants.js';
import {plan, shot} from './helpers.js';

test('canonical timeline requires exact shot continuity and one terminal end card',()=>{const p=plan([shot('a',0,4500,'source_graphic'),shot('b',4500,5400,'primary_capture'),shot('end',5400,5700,'end_card',{source_ids:[],claim_ids:[],source_backed:false})]);assert.deepEqual(validatePlanInvariants(p),[]);p.shots[1]!.start_frame=4499;assert.ok(validatePlanInvariants(p).some((failure)=>failure.includes('gap or overlap')));});
test('proof boundary must be a canonical shot boundary and at least 150 seconds',()=>{const p=plan([shot('a',0,4499,'source_graphic'),shot('b',4499,5400,'primary_capture'),shot('end',5400,5700,'end_card',{source_ids:[],claim_ids:[],source_backed:false})]);assert.ok(validatePlanInvariants(p).some((failure)=>failure.includes('proof boundary')));});
