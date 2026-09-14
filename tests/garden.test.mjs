import test from 'node:test';
import assert from 'node:assert/strict';
import { gardenFor } from '../src/garden.ts';
import { newLesson } from '../src/lessons.ts';
const stack={id:'test-stack',name:'Hope',verseIds:['one'],updatedAt:'2026-09-14T00:00:00Z'};
test('garden counts unique reviews and completed lessons, never unfinished exercises',()=>{
 const l=newLesson(stack,0),r={id:'a',day:'2026-01-01'};
 assert.equal(gardenFor({history:[],lessons:[l]}).growth,0);
 const g=gardenFor({history:[r,r],lessons:[{...l,step:4},{...l,step:4}]});
 assert.equal(g.growth,2);assert.equal(g.plants.filter(p=>p.earned).length,1);assert.equal(g.next.target,5);
 assert.equal(gardenFor(JSON.parse(JSON.stringify({history:[r],lessons:[{...l,step:4}]}))).growth,2);
});
