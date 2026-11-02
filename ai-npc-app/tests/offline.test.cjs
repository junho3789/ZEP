const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const D=require('../zep/dialogue.js');
const ROOT=path.join(__dirname,'../zep');
const empty=()=>({name:'테스트',personality:'친구',background:'안내 정보',style:'friendly',revision:1,greetings:['안녕 {player}!'],fallbacks:['모르겠어 A','모르겠어 B'],rules:[]});

function runtime(initial='',options={}){
 const events={},objects={},timers=[],widgets=[];let storage=initial,writes=0;
 const p={id:'u1',name:'유저',role:0,tileX:9,tileY:8,isMobile:false,notifications:[],sendMessage(s){this.notifications.push(s);},showWidgetResponsive(file){
  const w={file,messages:[],destroyed:false,onMessage:{Add(fn){w.receive=fn;}},sendMessage(d){this.messages.push(JSON.parse(JSON.stringify(d)));},destroy(){this.destroyed=true;}};widgets.push(w);return w;
 }};
 const app={players:[p],loadSpritesheet(){return options.badSprite?null:{};},getStorage(fn){fn(storage);},setStorage(raw){storage=raw;writes++;},putMobilePunch(){},
 addOnKeyDown(code,fn){events.key=fn;},runLater(fn,seconds){timers.push({fn,seconds});}};
 for(const name of ['onInit','onStart','onJoinPlayer','onUpdate','onTriggerObject','onAppObjectAttacked','onLeavePlayer','onSay'])app[name]={Add(fn){events[name]=fn;}};
 const map={width:options.width===undefined?30:options.width,height:options.height===undefined?30:options.height,getTile(layer,x,y){return options.tile?options.tile(layer,x,y):-1;},putObjectWithKey(x,y,sprite,opts){if(options.failId&&opts.key==='ai-npc:'+options.failId)throw Error('mock placement failure');const o={...opts,tileX:x,tileY:y,sendUpdated(){}};objects[opts.key]=o;return o;},getObjectWithKey:k=>objects[k],moveObjectWithKey(k,x,y){objects[k].tileX=x;objects[k].tileY=y;return true;}};
 const context=vm.createContext({App:app,Map:map,console});
 vm.runInContext(['config.js','controller.js','dialogue.js','app.js'].map(n=>fs.readFileSync(path.join(ROOT,n),'utf8')).join('\n'),context);
 events.onInit();if(options.beforeStart)options.beforeStart({objects,map});if(!options.noStart)events.onStart();
 return {events,objects,timers,widgets,p,app,map,get storage(){return storage;},get writes(){return writes;},drain(){for(const t of timers.splice(0))t.fn();},chat(text,id='one'){const w=widgets.at(-1);w.receive(p,{type:'npc.chat',requestId:id,message:text});this.drain();events.onUpdate(.7);return w.messages.at(-1);}};
}
test('every style preset is valid and has a distinct voice',()=>{
 const greetings=new Set();for(const s of D.styles){const p=D.defaults('moa',s.id);assert.ok(D.validate(p).value);greetings.add(D.greeting(p,D.fresh(),'유저',()=>0));}assert.equal(greetings.size,4);
});
test('Korean spacing and punctuation, longer keywords and English boundaries',()=>{
 const p=D.defaults('moa','friendly');const state=D.fresh();
 assert.match(D.reply(p,'뭐 하고 있어?!',state,'친구',()=>0),/산책/);
 assert.match(D.reply(p,'안녕히 가',state,'친구',()=>0),/또 만나/);
 assert.ok(p.fallbacks.includes(D.reply(p,'this is a sentence',state,'친구',()=>0)));
});
test('follow-up consent and refusal only apply to the immediate question',()=>{
 const p=D.defaults('moa','friendly'),state=D.fresh();D.reply(p,'뭐해',state,'친구',()=>0);assert.match(D.reply(p,'좋아',state,'친구',()=>0),/좋아/);
 assert.ok(p.fallbacks.includes(D.reply(p,'좋아',state,'친구',()=>0)));
 D.reply(p,'산책',state,'친구',()=>0);assert.match(D.reply(p,'아니요',state,'친구',()=>0),/괜찮아/);
 D.reply(p,'산책',state,'친구',()=>0);D.reply(p,'고마워',state,'친구',()=>0);assert.ok(p.fallbacks.includes(D.reply(p,'응',state,'친구',()=>0)));
});
test('custom facts and follow-up replies stay within registered content',()=>{
 const p=empty();p.rules=[{id:'location',title:'도서관',keywords:['도서관'],replies:['도서관은 북쪽에 있어요.'],followUps:['파란 문으로 들어오세요.'],acceptReplies:[],declineReplies:[]}];const state=D.fresh();
 assert.equal(D.reply(p,'도서관 어디야?',state,'친구',()=>0),'도서관은 북쪽에 있어요.');assert.equal(D.reply(p,'더 알려줘',state,'친구',()=>0),'파란 문으로 들어오세요.');
 assert.ok(p.fallbacks.includes(D.reply(p,'오늘 실제 날씨는?',state,'친구',()=>0)));
});
test('answer pools avoid repetition even across pool rollover',()=>{
 const p=empty(),s=D.fresh(),answers=[];for(let i=0;i<5;i++)answers.push(D.reply(p,'모름',s,'유저',()=>0));for(let i=1;i<answers.length;i++)assert.notEqual(answers[i],answers[i-1]);
});
test('validation rejects ambiguous short keywords, duplicate rules and one-sided consent',()=>{
 const p=D.defaults('moa','friendly');p.rules[0].keywords=['a'];assert.ok(D.validate(p).error);p.rules[0].keywords=['hi'];p.rules.push({...p.rules[0]});assert.ok(D.validate(p).error);
 const q=D.defaults('moa','friendly');q.rules[2].declineReplies=[];assert.ok(D.validate(q).error);
});
test('F opens local chat without network; identity is taken from ZEP sender',()=>{
 const r=runtime();r.events.key(r.p);assert.equal(r.widgets.length,1);const w=r.widgets[0];w.receive(r.p,{type:'npc.ready'});assert.equal(w.messages[0].name,'모아');assert.match(w.messages[0].history[0].text,/모아/);assert.doesNotMatch(w.messages[0].history[0].text,/\{name\}|\{player\}/);
 w.receive({id:'intruder'},{type:'npc.chat',requestId:'evil',message:'안녕'});assert.equal(r.timers.length,0);
 const reply=r.chat('너 이름이 뭐야?');assert.match(reply.answer,/모아/);assert.equal(reply.type,'npc.reply');r.events.key(r.p);assert.equal(r.widgets.length,1);
});
test('walking away drops delayed replies and independent NPCs keep independent context',()=>{
 const r=runtime();r.events.key(r.p);const w=r.widgets[0];w.receive(r.p,{type:'npc.chat',requestId:'one',message:'산책'});r.p.tileX=25;r.p.tileY=25;r.events.onUpdate(.1);r.drain();assert.equal(w.destroyed,true);assert.equal(w.messages.length,0);
 r.p.tileX=9;r.p.tileY=8;r.events.key(r.p);r.chat('산책');r.widgets.at(-1).receive(r.p,{type:'npc.close'});r.p.tileX=12;r.events.key(r.p);const result=r.chat('좋아');assert.match(result.answer,/모르는|모르|소개/);
});
test('non-admin cannot open or spoof editor access; revoked admin cannot save',()=>{
 const r=runtime();r.events.onSay(r.p,'!npc-admin');assert.equal(r.widgets.length,0);r.events.key(r.p);const w=r.widgets[0];w.receive(r.p,{type:'npc.editor',role:3001});assert.equal(r.widgets.length,1);
 r.p.role=3001;r.events.onSay(r.p,'!npc-admin');const editor=r.widgets.at(-1);editor.receive(r.p,{type:'editor.ready'});assert.equal(editor.messages[0].type,'editor.init');r.p.role=0;editor.receive(r.p,{type:'editor.save',npcId:'moa',expectedRevision:0,persona:D.defaults('moa','friendly')});assert.equal(r.writes,0);assert.equal(editor.destroyed,true);
});
test('admin saves survive restart, preserve unrelated storage and reject stale saves',()=>{
 const r=runtime(JSON.stringify({other:{keep:123}}));r.p.role=3001;r.events.onSay(r.p,'!npc-admin');const editor=r.widgets.at(-1);editor.receive(r.p,{type:'editor.ready'});const changed=D.defaults('moa','polite');changed.name='안내봇';
 editor.receive(r.p,{type:'editor.save',npcId:'moa',expectedRevision:0,persona:changed});assert.equal(editor.messages.at(-1).type,'editor.saved');assert.equal(JSON.parse(r.storage).other.keep,123);assert.equal(r.writes,1);
 editor.receive(r.p,{type:'editor.save',npcId:'moa',expectedRevision:0,persona:changed});assert.equal(editor.messages.at(-1).type,'editor.error');assert.equal(r.writes,1);
 const restarted=runtime(r.storage);restarted.events.key(restarted.p);const chat=restarted.widgets[0];chat.receive(restarted.p,{type:'npc.ready'});assert.equal(chat.messages[0].name,'안내봇');
});
test('persona updates reset context and close the old popup',()=>{
 const r=runtime();r.events.key(r.p);const chat=r.widgets[0];r.chat('산책');r.p.role=3001;r.events.onSay(r.p,'!npc-admin');const editor=r.widgets.at(-1);editor.receive(r.p,{type:'editor.ready'});editor.receive(r.p,{type:'editor.save',npcId:'moa',expectedRevision:0,persona:D.defaults('moa','calm')});assert.equal(chat.destroyed,true);
 r.events.key(r.p);const result=r.chat('좋아');assert.match(result.answer,/모르는|모르|없는 내용|소개/);
});
test('invalid stored configuration is never overwritten',()=>{
 const r=runtime('broken JSON');r.p.role=3001;r.events.onSay(r.p,'!npc-admin');const editor=r.widgets.at(-1);editor.receive(r.p,{type:'editor.ready'});assert.equal(editor.messages.at(-1).type,'editor.error');editor.receive(r.p,{type:'editor.save',npcId:'moa',expectedRevision:0,persona:D.defaults('moa','friendly')});assert.equal(r.writes,0);assert.equal(r.storage,'broken JSON');
});
test('controller keeps waiting in the distance gap, considers all users and avoids blocked tiles',()=>{
 const Controller=require('../zep/controller.js');let players=[{id:'a',x:6,y:5}],moves=0;
 const c=new Controller({position:()=>({x:5,y:5}),players:()=>players,stop(){},closeChat(){},openChat(){},canWalk:()=>false,step(){moves++;}});
 c.tick(.1);assert.equal(c.state,'waiting');players=[{id:'a',x:8,y:5}];c.tick(.1);assert.equal(c.state,'waiting');players=[{id:'b',x:6,y:5},{id:'a',x:20,y:20}];c.tick(.1);assert.equal(c.state,'waiting');players=[];c.tick(1);assert.equal(c.state,'roaming');c.steps=2;c.direction=[1,0];c.timer=0;c.tick(1);assert.equal(moves,0);
});
test('objects are placed after map-ready onStart, not during onInit',()=>{
 const r=runtime('',{width:0,height:0,beforeStart({objects,map}){assert.equal(Object.keys(objects).length,0);map.width=30;map.height=30;}});
 assert.equal(Object.keys(r.objects).length,2);
});
test('small maps clamp patrol bounds instead of aborting startup',()=>{
 const r=runtime('',{width:6,height:6});assert.equal(Object.keys(r.objects).length,2);
 for(const n of Object.values(r.objects)){assert.ok(n.tileX<6&&n.tileY<6);assert.ok(n.tileX>=0&&n.tileY>=0);}
 assert.notDeepEqual([r.objects['ai-npc:moa'].tileX,r.objects['ai-npc:moa'].tileY],[r.objects['ai-npc:sage'].tileX,r.objects['ai-npc:sage'].tileY]);
});
test('blocked starting tile relocates nearby; one failed NPC does not prevent other NPCs',()=>{
 const relocated=runtime('',{tile(layer,x,y){return layer===1&&x===8&&y===8?3:-1;}});
 assert.equal(Object.keys(relocated.objects).length,2);assert.notDeepEqual([relocated.objects['ai-npc:moa'].tileX,relocated.objects['ai-npc:moa'].tileY],[8,8]);
 const partial=runtime('',{failId:'moa'});assert.equal(Object.keys(partial.objects).length,1);partial.events.onSay(partial.p,'!npc-status');assert.ok(partial.p.notifications.some(s=>s.includes('mock placement failure')));
});
test('fully blocked patrol areas can be recovered by an admin from a clear location',()=>{
 const r=runtime('',{tile(layer,x,y){return layer===1&&x<20?3:-1;}});assert.equal(Object.keys(r.objects).length,0);
 r.p.tileX=25;r.p.tileY=25;r.events.onSay(r.p,'!npc-here');assert.equal(Object.keys(r.objects).length,0);
 r.p.role=3001;r.events.onSay(r.p,'!npc-here');assert.equal(Object.keys(r.objects).length,2);
 for(const n of Object.values(r.objects))assert.ok(n.tileX>=20&&Math.abs(n.tileX-25)<=6&&Math.abs(n.tileY-25)<=6);
});
test('missing sprite is reported while editor and diagnostics remain usable',()=>{
 const r=runtime('',{badSprite:true});assert.equal(Object.keys(r.objects).length,0);r.p.role=3001;r.events.onSay(r.p,'!npc-status');assert.ok(r.p.notifications.some(s=>s.includes('스프라이트')));
 r.events.onSay(r.p,'!npc-admin');assert.equal(r.widgets.at(-1).file,'editor.html');
});
