import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {newLesson, gradeLesson, nextExercise, totalSteps, currentExercise, putLesson, normalizeAnswer} from '../src/lessons.ts';
import {initialState, parseBackup} from '../src/leitner.ts';
import {mergeStates} from '../src/sync-merge.ts';
import {LearningStore} from '../src/learning-store.ts';
const verses=JSON.parse(readFileSync(new URL('../src/data/verses.json',import.meta.url)));
const fresh=()=>initialState(verses), parse=s=>parseBackup(s,verses);
const stack={id:'test-stack-123',name:'Hope',verseIds:verses.slice(0,3).map(v=>v.id),updatedAt:'2026-09-14T12:00:00Z'};
test('lessons progress through four stages and revisit mistakes only once',()=>{
 let l=newLesson(stack,0);
 for(let i=0;i<12;i++){
  assert.equal(currentExercise(l).phase,i%4);
  const graded=gradeLesson(l,i!==0); assert.deepEqual(gradeLesson(graded,true),graded);
  l=nextExercise(graded);
 }
 assert.equal(totalSteps(l),13); assert.equal(currentExercise(l).retry,true);
 assert.equal(currentExercise(l).verseId,stack.verseIds[0]);
 l=nextExercise(gradeLesson(l,false)); assert.equal(l.step,totalSteps(l));
 assert.deepEqual(gradeLesson(l,true),l);
});
test('hints trigger recall retry without promoting daily review progress',()=>{
 const s=fresh(),l=gradeLesson({...newLesson(stack,0),hinted:true},true),next=putLesson(s,l);
 assert.equal(l.correct,0); assert.equal(l.result,false); assert.equal(l.mistakes.length,1);
 assert.deepEqual(next.progress,s.progress);assert.deepEqual(next.history,s.history);
 assert.equal(normalizeAnswer('God’s WORD!'),normalizeAnswer("God's word"));
});
test('backups preserve partially typed answers and reject corrupt lesson state',()=>{
 const s={...putLesson(fresh(),{...newLesson(stack,0),input:'An unfinished answer',tiles:[2,0]}),stackDraft:{value:{...stack,name:'',verseIds:[]},updatedAt:stack.updatedAt}};
 assert.deepEqual(parse(JSON.stringify(s)),s);
 for(const patch of [{step:99},{verseIds:['missing']},{tiles:[0,0]},{secret:'unexpected'},{unit:67}]) assert.throws(()=>parse(JSON.stringify({...s,lessons:[{...s.lessons[0],...patch}]})));
});
test('concurrent lessons combine and a draft clear survives a stale device',()=>{
 const base={...fresh(),stackDraft:{value:stack,updatedAt:'2026-09-14T10:00:00Z'}};
 const a={...putLesson(base,newLesson(stack,0)),stackDraft:{value:null,updatedAt:'2026-09-14T13:00:00Z'}};
 const b=putLesson(base,newLesson({...stack,id:'other-stack'},0));
 const merged=mergeStates(base,a,b);assert.equal(merged.lessons.length,2);assert.equal(merged.stackDraft.value,null);
 const old={...fresh()};assert.equal(mergeStates(old,merged,old).lessons.length,2);
 const later={...merged,lessons:merged.lessons.map(l=>({...l,input:'Latest',updatedAt:'2026-09-15T12:00:00Z'}))};
 assert.ok(mergeStates(base,merged,later).lessons.every(l=>l.input==='Latest'));
});
test('offline lesson edits survive account reopen and upload on reconnection',async()=>{
 const data=new Map(),disk={getItem:async k=>data.get(k)??null,setItem:async(k,v)=>{data.set(k,v);}};
 let store=new LearningStore(disk,fresh,parse);
 await store.open('user:lesson-test',{get:async()=>{throw Error('Offline');},put:async()=>{throw Error('Offline');}});
 store.update(s=>({...putLesson(s,{...newLesson(stack,0),input:'Remember this unfinished answer'}),stackDraft:{value:stack,updatedAt:stack.updatedAt}}));
 await store.flush();let saved;
 store=new LearningStore(disk,fresh,parse);await store.open('user:lesson-test',{get:async()=>({state:null,revision:0}),put:async s=>{saved=s;return {state:null,revision:1};}});await store.flush();
 assert.equal(store.snapshot().state.lessons[0].input,'Remember this unfinished answer');assert.equal(saved.stackDraft.value.name,'Hope');
});
