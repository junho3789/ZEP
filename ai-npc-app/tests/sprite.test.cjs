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
 const selected=selections(),motions=S.defaults();for(const [i,d]of ['down','left','right','up'].entries()){selected[d+'_jump']=[10+i];selected[d+'_sit']=[14+i];}selected.dance=[18];selected.wave=[19,20];motions.push({id:'wave',label:'손 흔들기',loop:false});
 const sprite=S.build(selected,motions,36,48,64,6);assert.equal(sprite.actions.length,4);assert.equal(sprite.actions.find(a=>a.id==='dance').loop,true);assert.equal(sprite.actions.find(a=>a.id==='jump').loop,false);
 const restored=S.read(sprite,36);assert.deepEqual(S.build(restored.selected,restored.motions,36,48,64,6),sprite);
});
test('legacy explicit idle settings survive import and missing optional motions add no buttons',()=>{
 const sprite=S.build(selections(),S.defaults(),36,48,64,6);delete sprite.actions;const restored=S.read(sprite,36);const rebuilt=S.build(restored.selected,restored.motions,36,48,64,6);
 assert.deepEqual(rebuilt.actions,[]);assert.deepEqual(rebuilt.animations.up_idle,[7]);
});
test('duplicate motion IDs and out of range frames are rejected',()=>{
 const selected=selections();selected.down_jump=[99];assert.throws(()=>S.build(selected,S.defaults(),36,48,64,6),/점프/);
 selected.down_jump=[10];assert.throws(()=>S.build(selected,S.defaults().concat([{id:'down',label:'중복',loop:false}]),36,48,64,6),/고유 ID/);assert.equal(S.validId('__proto__'),false);
});
test('directional groups require all four poses and prefer them over a legacy generic motion',()=>{
 const s=selections(),motions=S.defaults().concat([{id:'jump',label:'이전 점프',loop:false}]);s.down_jump=[10];assert.throws(()=>S.build(s,motions,36,48,64,6),/4방향/);
 for(const d of ['down','left','right','up'])s[d+'_jump']=[10];s.jump=[11];const built=S.build(s,motions,36,48,64,6);
 assert.deepEqual(built.actions.filter(a=>a.id==='jump'),[{id:'jump',label:'점프',loop:false,directional:true}]);
 const loaded=S.read(built,36);assert.equal(S.build(loaded.selected,loaded.motions,36,48,64,6).actions.filter(a=>a.id==='jump').length,1);
});
test('feet fine adjustment survives import',()=>{
 const built=S.build(selections(),S.defaults(),36,48,64,6,{offsetX:3,offsetY:-4});const loaded=S.read(built,36);assert.deepEqual(loaded.display,{offsetX:3,offsetY:-4});
 assert.deepEqual(S.build(loaded.selected,loaded.motions,36,48,64,6,loaded.display),built);
});
