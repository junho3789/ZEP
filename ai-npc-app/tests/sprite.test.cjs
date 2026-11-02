const {test}=require('node:test');
const assert=require('node:assert/strict');
const S=require('../tools/sprite-model.js');
function selections(){const s=S.empty();for(let i=0;i<S.required.length;i++)s[S.required[i]]=[i];return s;}
test('idle frames are independently registered, not copied from the first walking frame',()=>{
 const selected=selections();selected.down=[0,1,2];selected.down_idle=[8,9];const sprite=S.build(selected,S.defaults(),36,48,64,6);
 assert.deepEqual(sprite.animations.down,[0,1,2]);assert.deepEqual(sprite.animations.down_idle,[8,9]);
 selected.left_idle=[];assert.throws(()=>S.build(selected,S.defaults(),36,48,64,6),/왼쪽 정지/);
});
test('jump dance sit and a custom animation retain their frames labels and loop settings',()=>{
 const selected=selections(),motions=S.defaults();selected.jump=[10,11];selected.dance=[12,13,14];selected.sit=[15];selected.wave=[16,17];motions.push({id:'wave',label:'손 흔들기',loop:false});
 const sprite=S.build(selected,motions,36,48,64,6);assert.equal(sprite.actions.length,4);assert.equal(sprite.actions.find(a=>a.id==='dance').loop,true);assert.equal(sprite.actions.find(a=>a.id==='jump').loop,false);
 const restored=S.read(sprite,36);assert.deepEqual(S.build(restored.selected,restored.motions,36,48,64,6),sprite);
});
test('legacy explicit idle settings survive import and missing optional motions add no buttons',()=>{
 const sprite=S.build(selections(),S.defaults(),36,48,64,6);delete sprite.actions;const restored=S.read(sprite,36);const rebuilt=S.build(restored.selected,restored.motions,36,48,64,6);
 assert.deepEqual(rebuilt.actions,[]);assert.deepEqual(rebuilt.animations.up_idle,[7]);
});
test('duplicate motion IDs and out of range frames are rejected',()=>{
 const selected=selections();selected.jump=[99];assert.throws(()=>S.build(selected,S.defaults(),36,48,64,6),/점프/);
 selected.jump=[10];assert.throws(()=>S.build(selected,S.defaults().concat([{id:'down',label:'중복',loop:false}]),36,48,64,6),/고유 ID/);assert.equal(S.validId('__proto__'),false);
});
