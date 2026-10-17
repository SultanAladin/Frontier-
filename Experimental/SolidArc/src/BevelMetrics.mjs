import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BevelDistance} from './BevelSequence.js';
test('bevel numeric distances and scientific notation',()=>{assert.equal(BevelDistance('0.25'),.25);assert.equal(BevelDistance(' +2.5e-1 m '),.25);assert.equal(BevelDistance('-.25'),-.25);});
test('metric distance suffixes',()=>{assert.equal(BevelDistance('250mm'),.25);assert.equal(BevelDistance('-25 cm'),-.25);assert.equal(BevelDistance('250MM'),.25);});
test('imperial distances',()=>{assert.equal(BevelDistance('1in'),.0254);assert.equal(BevelDistance('1 ft'),.3048);});
test('invalid units and expressions do not become numeric prefixes',()=>{for(const S of ['', 'mm','1+2','0x10','2mm garbage','2m m','NaN','Infinity','-Infinity'])assert.ok(Number.isNaN(BevelDistance(S)),S);});
test('incomplete numeric input stays invalid until complete',()=>{for(const S of ['-','+','.','1e','1e-'])assert.ok(Number.isNaN(BevelDistance(S)),S);assert.equal(BevelDistance('1e-3'),.001);});
