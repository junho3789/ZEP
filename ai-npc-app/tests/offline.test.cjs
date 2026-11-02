const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const D=require('../zep/dialogue.js');
const ROOT=path.join(__dirname,'../zep');
const empty=()=>({name:'테스트',personality:'친구',background:'안내 정보',style:'friendly',revision:1,greetings:['안녕 {player}!'],fallbacks:['모르겠어 A','모르겠어 B'],rules:[]});

function runtime(initial='',options={}){
 const events={},objects={},timers=[],widgets=[],animations=[],updates=[],resources=[];let storage=initial,writes=0;
 const p={id:'u1',name:'유저',role:0,tileX:9,tileY:8,isMobile:false,notifications:[],sendMessage(s){this.notifications.push(s);},showWidgetResponsive(file){
  const w={file,messages:[],destroyed:false,onMessage:{Add(fn){w.receive=fn;}},sendMessage(d){this.messages.push(JSON.parse(JSON.stringify(d)));},destroy(){this.destroyed=true;}};widgets.push(w);return w;
 }};
 const app={players:[p],loadSpritesheet(...args){resources.push(args);return options.badSprite?null:{};},getStorage(fn){fn(storage);},setStorage(raw){storage=raw;writes++;},putMobilePunch(){},
 addOnKeyDown(code,fn){events.key=fn;},runLater(fn,seconds){timers.push({fn,seconds});}};
 for(const name of ['onInit','onStart','onJoinPlayer','onUpdate','onTriggerObject','onAppObjectAttacked','onLeavePlayer','onSay'])app[name]={Add(fn){events[name]=fn;}};
 const map={width:options.width===undefined?30:options.width,height:options.height===undefined?30:options.height,getTile(layer,x,y){return options.tile?options.tile(layer,x,y):-1;},putObjectWithKey(x,y,sprite,opts){if(options.failId&&opts.key==='ai-npc:'+options.failId)throw Error('mock placement failure');const o={...opts,tileX:x,tileY:y,sendUpdated(){updates.push({key:opts.key,x:this.tileX,y:this.tileY,topObject:this.topObject});}};objects[opts.key]=o;return o;},getObjectWithKey:k=>objects[k],playObjectAnimationWithKey(key,name,repeats){animations.push({key,name,repeats});},moveObjectWithKey(k,x,y){objects[k].tileX=x;objects[k].tileY=y;return true;}};
 const context=vm.createContext({App:app,Map:map,console,...(options.random?{Math:Object.assign(Object.create(Math),{random:options.random})}:{})});
 vm.runInContext(['config.js','controller.js','dialogue.js','app.js'].map(n=>fs.readFileSync(path.join(ROOT,n),'utf8')).join('\n'),context);
 if(options.sprite)Object.assign(context.NPC_CONFIG.sprite,options.sprite);events.onInit();if(options.beforeStart)options.beforeStart({objects,map});if(!options.noStart)events.onStart();
 return {events,objects,timers,widgets,animations,updates,resources,p,app,map,get storage(){return storage;},get writes(){return writes;},drain(){for(const t of timers.splice(0))t.fn();},chat(text,id='one'){const w=widgets.at(-1);w.receive(p,{type:'npc.chat',requestId:id,message:text});this.drain();events.onUpdate(.7);return w.messages.at(-1);}};
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
 r.p.tileX=9;r.p.tileY=8;r.events.key(r.p);r.chat('산책');r.widgets.at(-1).receive(r.p,{type:'npc.close'});r.p.tileX=12;r.events.key(r.p);const result=r.chat('좋아');assert.ok(D.defaults('sage','calm').fallbacks.includes(result.answer));
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
test('reported spawn tile can host an NPC even when every neighboring tile fails the empty search',()=>{
 const r=runtime('',{width:141,height:94,tile(layer,x,y){if(layer===1)return x===84&&y===59?-1:5;if(layer===2&&x===84&&y===59)return 2;return -1;}});
 r.p.role=3001;r.p.tileX=84;r.p.tileY=59;r.events.onSay(r.p,'!npc-here');assert.equal(Object.keys(r.objects).length,0);
 r.events.onSay(r.p,'!npc-place moa');assert.equal(Object.keys(r.objects).length,1);assert.equal(r.objects['ai-npc:moa'].tileX,84);assert.equal(r.objects['ai-npc:moa'].tileY,59);
 r.events.onSay(r.p,'!npc-place sage');assert.equal(Object.keys(r.objects).length,1);assert.ok(r.p.notifications.some(s=>s.includes('이미 다른 NPC')));
});
test('direct placement requires actual admin role and still rejects impassable standing tiles',()=>{
 const r=runtime('',{tile(layer){return layer===1?5:-1;}});r.events.onSay(r.p,'!npc-place moa');assert.equal(Object.keys(r.objects).length,0);
 r.p.role=3001;r.map.getTile=layer=>layer===2?1:-1;r.events.onSay(r.p,'!npc-place moa');assert.equal(Object.keys(r.objects).length,0);assert.ok(r.p.notifications.some(s=>s.includes('통행 불가')));
 r.map.getTile=layer=>layer===3?12:layer===2?2:-1;r.events.onSay(r.p,'!npc-place moa');assert.equal(Object.keys(r.objects).length,1);
});
test('placing an existing NPC moves its key without duplication and separate positions allow two NPCs',()=>{
 const r=runtime('',{tile(layer){return layer===1?5:-1;}});r.p.role=3001;r.p.tileX=84;r.p.tileY=59;r.map.width=141;r.map.height=94;r.map.getTile=layer=>layer===2?2:-1;
 r.events.onSay(r.p,'!npc-place moa');r.p.tileX=87;r.events.onSay(r.p,'!npc-place moa');assert.equal(Object.keys(r.objects).length,1);assert.equal(r.objects['ai-npc:moa'].tileX,87);r.events.onUpdate(.2);
 r.p.tileX=84;r.events.onSay(r.p,'!npc-place sage');assert.equal(Object.keys(r.objects).length,2);assert.equal(r.objects['ai-npc:sage'].tileX,84);
});
test('nearby diagnostics distinguish occupied standing tile from neighboring graphic obstacles',()=>{
 const r=runtime('',{tile(layer,x,y){return layer===1&&x===8&&y===8?4:-1;}});r.p.role=3001;r.events.onSay(r.p,'!npc-status');const around=r.p.notifications.find(s=>s.startsWith('[NPC 주변 판정]'));
 assert.match(around,/벽 그림/);assert.match(around,/유저 위치/);
});
test('roaming uses validated direct steps and respects host-rejected movement',()=>{
 const r=runtime('',{tile(layer){return layer===1?5:-1;}});r.p.role=3001;r.events.onSay(r.p,'!npc-place moa');
 const n=r.objects['ai-npc:moa'],origin=[n.tileX,n.tileY],attempts=[];r.p.tileX=25;r.p.tileY=25;
 r.map.moveObjectWithKey=(key,x,y,usePath)=>{attempts.push({key,x,y,usePath});return false;};
 for(let i=0;i<20;i++)r.events.onUpdate(.6);
 assert.ok(attempts.length>0);assert.ok(attempts.every(x=>x.usePath===false));assert.deepEqual([n.tileX,n.tileY],origin);
 r.map.getTile=layer=>layer===2?'1':-1;const count=attempts.length;for(let i=0;i<10;i++)r.events.onUpdate(.6);assert.equal(attempts.length,count);
});
test('a host with broken GetWeight can still roam without invoking pathfinding',()=>{
 const r=runtime('',{tile(layer){return layer===1?5:-1;}});r.p.role=3001;r.events.onSay(r.p,'!npc-place moa');r.p.tileX=25;r.p.tileY=25;
 const attempts=[];r.map.moveObjectWithKey=(key,x,y,usePath)=>{if(usePath)throw Error('System.IndexOutOfRangeException at ScriptMapService.GetWeight');const n=r.objects[key];assert.equal(Math.abs(n.tileX-x)+Math.abs(n.tileY-y),1);attempts.push({x,y});n.tileX=x;n.tileY=y;return true;};
 for(let i=0;i<20;i++)r.events.onUpdate(.6);assert.ok(attempts.length>0);r.events.onSay(r.p,'!npc-status');assert.ok(!r.p.notifications.some(s=>s.startsWith('[NPC 오류] moa:')));
});
test('a failing tile lookup pauses only that NPC with the query coordinates and no retry storm',()=>{
 const r=runtime('',{tile(layer){return layer===1?5:-1;}});r.p.role=3001;r.events.onSay(r.p,'!npc-place moa');r.p.tileX=25;r.p.tileY=25;let calls=0;
 r.map.getTile=(layer,x,y)=>{calls++;throw Error('host tile failure');};
 for(let i=0;i<20;i++)r.events.onUpdate(.6);assert.equal(calls,1);
 r.events.onSay(r.p,'!npc-status');assert.ok(r.p.notifications.some(s=>s.includes('타일 조회 layer=2,x=')&&s.includes('host tile failure')));assert.ok(r.p.notifications.some(s=>s.includes('· error')));
});
test('a failing movement request is labelled and not repeated every update',()=>{
 const r=runtime('',{tile(layer){return layer===1?5:-1;}});r.p.role=3001;r.events.onSay(r.p,'!npc-place moa');r.p.tileX=25;r.p.tileY=25;let calls=0;
 r.map.moveObjectWithKey=()=>{calls++;throw Error('host move failure');};for(let i=0;i<20;i++)r.events.onUpdate(.6);assert.equal(calls,1);
 r.events.onSay(r.p,'!npc-status');assert.ok(r.p.notifications.some(s=>s.includes('이동 요청 moa')&&s.includes('path=false')&&s.includes('host move failure')));
});
test('stale host coordinates are committed at arrival and next moves start from the previous destination',()=>{
 const r=runtime('',{tile(layer){return layer===1?5:-1;}});r.p.role=3001;r.events.onSay(r.p,'!npc-place moa');r.p.tileX=25;r.p.tileY=25;
 let time=0;const requests=[];
 // This host sends the tween but leaves its stored tile at the old position.
 r.map.moveObjectWithKey=(key,x,y,usePath)=>{const n=r.objects[key];requests.push({from:[n.tileX,n.tileY],to:[x,y],time,usePath});return true;};
 for(let i=0;i<200;i++){time+=.1;r.events.onUpdate(.1);}
 assert.ok(requests.length>=3);
 for(let i=1;i<requests.length;i++){assert.deepEqual(requests[i].from,requests[i-1].to);assert.ok(requests[i].time-requests[i-1].time>=.69);}
 assert.ok(requests.every(q=>Math.abs(q.from[0]-q.to[0])+Math.abs(q.from[1]-q.to[1])===1));
});
test('approaching or interacting during a tween never sends a rewind-to-start move',()=>{
 const r=runtime('',{tile(layer){return layer===1?5:-1;}});r.p.role=3001;r.events.onSay(r.p,'!npc-place moa');r.p.tileX=25;r.p.tileY=25;
 const requests=[];r.map.moveObjectWithKey=(key,x,y)=>{requests.push({key,x,y});return true;};
 for(let i=0;i<50&&!requests.length;i++)r.events.onUpdate(.1);assert.equal(requests.length,1);const first=requests[0];
 r.p.tileX=9;r.p.tileY=8;r.events.onUpdate(.02);r.events.key(r.p);assert.equal(requests.length,1);assert.equal(r.widgets.at(-1).file,'chat.html');
 for(let i=0;i<20;i++)r.events.onUpdate(.1);assert.equal(requests.length,1);assert.deepEqual([r.objects[first.key].tileX,r.objects[first.key].tileY],[first.x,first.y]);
});
test('admin relocation cannot interrupt an in-flight step and arrival is not overwritten by old motion',()=>{
 const r=runtime('',{tile(layer){return layer===1?5:-1;}});r.p.role=3001;r.events.onSay(r.p,'!npc-place moa');r.p.tileX=25;r.p.tileY=25;
 const requests=[];r.map.moveObjectWithKey=(key,x,y)=>{requests.push({key,x,y});return true;};
 for(let i=0;i<50&&!requests.length;i++)r.events.onUpdate(.1);assert.equal(requests.length,1);
 r.p.tileX=20;r.p.tileY=20;r.events.onSay(r.p,'!npc-place moa');assert.equal(requests.length,1);assert.ok(r.p.notifications.some(s=>s.includes('이동을 마친 뒤')));
 // Pause roaming at the old tile while the single in-flight step completes.
 r.p.tileX=9;r.p.tileY=8;for(let i=0;i<10;i++)r.events.onUpdate(.1);
 r.p.tileX=20;r.p.tileY=20;r.events.onSay(r.p,'!npc-place moa');assert.equal(requests.length,2);r.events.onUpdate(.2);
 assert.deepEqual([r.objects['ai-npc:moa'].tileX,r.objects['ai-npc:moa'].tileY],[20,20]);
});
test('sprite feet align to tile center and foreground switches by nearby player foot position',()=>{
 const r=runtime('',{sprite:{frameWidth:48,frameHeight:64}}),npc=r.objects['ai-npc:moa'];
 assert.equal(npc.offsetX,-8);assert.equal(npc.offsetY,-48);
 r.p.tileX=8;r.p.tileY=7;r.events.onUpdate(.01);assert.equal(r.objects['ai-npc:moa'].topObject,true);
 r.p.tileY=9;r.events.onUpdate(.01);assert.equal(r.objects['ai-npc:moa'].topObject,false);
});
test('foreground updates are deferred during a tween and contain only the arrived coordinates',()=>{
 const r=runtime('',{tile(layer){return layer===1?5:-1;}});r.p.role=3001;r.events.onSay(r.p,'!npc-place moa');r.p.tileX=25;r.p.tileY=25;const requests=[];
 r.map.moveObjectWithKey=(key,x,y)=>{requests.push({key,x,y});return true;};for(let i=0;i<50&&!requests.length;i++)r.events.onUpdate(.1);const first=requests[0],count=r.updates.length;
 r.p.tileX=9;r.p.tileY=7;r.events.onUpdate(.02);assert.equal(r.updates.length,count);for(let i=0;i<10;i++)r.events.onUpdate(.1);
 assert.ok(r.updates.slice(count).every(p=>p.x===first.x&&p.y===first.y));assert.equal(requests.length,1);
});
test('registered action buttons play once or loop and restore independent idle animation',()=>{
 const extra={jump:[10,11],dance:[12,13],sit:[14],wave:[15,16],down_idle:[20]};
 const actions=[{id:'jump',label:'점프',loop:false},{id:'dance',label:'춤추기',loop:true},{id:'sit',label:'앉기',loop:true},{id:'wave',label:'손 흔들기',loop:false}];
 const r=runtime('',{sprite:{actions,animations:{down:[0,1],left:[2,3],right:[4,5],up:[6,7],left_idle:[21],right_idle:[22],up_idle:[23],...extra}}});
 r.events.key(r.p);const w=r.widgets.at(-1);w.receive(r.p,{type:'npc.ready'});assert.equal(w.messages[0].actions.length,4);assert.deepEqual(r.resources[0][3].down_idle,[20]);
 const last=()=>r.animations.filter(a=>a.key==='ai-npc:moa').at(-1);
 w.receive(r.p,{type:'npc.action',actionId:'jump'});assert.equal(last().name,'jump');assert.equal(last().repeats,1);r.events.onUpdate(1);assert.equal(last().name,'right_idle');
 w.receive(r.p,{type:'npc.action',actionId:'dance'});r.events.onUpdate(2);assert.equal(last().name,'dance');assert.equal(last().repeats,-1);
 w.receive(r.p,{type:'npc.action',actionId:'sit'});assert.equal(last().name,'sit');w.receive(r.p,{type:'npc.action',actionId:'wave'});assert.equal(last().name,'wave');
 w.receive(r.p,{type:'npc.action',actionId:'idle'});assert.equal(last().name,'right_idle');
 w.receive(r.p,{type:'npc.action',actionId:'dance'});r.p.tileX=25;r.p.tileY=25;r.events.onUpdate(.2);assert.equal(last().name,'right_idle');
});
test('forged senders or unknown action IDs cannot start arbitrary animations',()=>{
 const r=runtime();r.events.key(r.p);const w=r.widgets.at(-1),before=r.animations.length;
 w.receive({id:'intruder'},{type:'npc.action',actionId:'dance'});assert.equal(r.animations.length,before);
 w.receive(r.p,{type:'npc.action',actionId:'not_registered'});assert.equal(r.animations.length,before);assert.match(w.messages.at(-1).error,/등록되지 않은/);
});
test('nearby players set facing and directional jump and sit resolve to all four animations',()=>{
 const animations={down:[0,1,2,3],left:[0,1,2,3],right:[0,1,2,3],up:[0,1,2,3],down_idle:[4],left_idle:[4],right_idle:[4],up_idle:[4]};
 for(const d of ['down','left','right','up']){animations[d+'_jump']=[5,6];animations[d+'_sit']=[7];}
 const r=runtime('',{sprite:{animations,actions:[{id:'jump',label:'점프',loop:false,directional:true},{id:'sit',label:'앉기',loop:true,directional:true}]}});
 r.events.key(r.p);const w=r.widgets.at(-1);const last=()=>r.animations.filter(a=>a.key==='ai-npc:moa').at(-1);
 for(const [direction,x,y]of [['up',8,7],['right',9,8],['down',8,9],['left',7,8]]){
  r.p.tileX=x;r.p.tileY=y;r.events.onUpdate(.02);assert.equal(last().name,direction+'_idle');
  w.receive(r.p,{type:'npc.action',actionId:'jump'});assert.equal(last().name,direction+'_jump');w.receive(r.p,{type:'npc.action',actionId:'idle'});
  w.receive(r.p,{type:'npc.action',actionId:'sit'});assert.equal(last().name,direction+'_sit');w.receive(r.p,{type:'npc.action',actionId:'idle'});
 }
});
test('foreground switching uses keyed placement packets at unchanged coordinates',()=>{
 const r=runtime('',{sprite:{frameWidth:48,frameHeight:64,displayOffsetX:2,displayOffsetY:-3}});const nativePut=r.map.putObjectWithKey,packets=[];
 r.map.putObjectWithKey=(x,y,res,opts)=>{packets.push({x,y,opts});return nativePut(x,y,res,opts);};
 r.p.tileX=8;r.p.tileY=7;r.events.onUpdate(.02);r.p.tileY=9;r.events.onUpdate(.02);
 const moa=packets.filter(p=>p.opts.key==='ai-npc:moa');assert.equal(moa.length,2);assert.deepEqual(moa.map(p=>p.opts.topObject),[true,false]);assert.ok(moa.every(p=>p.x===8&&p.y===8&&p.opts.offsetX===-6&&p.opts.offsetY===-51));
});
test('admin can create multiple independent NPCs with persisted modes and restart restoration',()=>{
 const r=runtime(JSON.stringify({unrelated:42}));r.p.role=3001;r.events.onSay(r.p,'!npc-admin');const w=r.widgets.at(-1);w.receive(r.p,{type:'editor.ready'});let revision=0;
 for(let i=0;i<5;i++){
  w.receive(r.p,{type:'editor.create',name:'친구 '+i,style:'friendly',movementMode:i%2?'continuous':'stroll',expectedRevision:revision});const result=w.messages.at(-1);
  assert.equal(result.type,'editor.created',JSON.stringify(result));revision=result.revision;assert.equal(result.personas[result.npcId].name,'친구 '+i);
 }
 assert.equal(Object.keys(r.objects).length,7);const stored=JSON.parse(r.storage);assert.equal(stored.unrelated,42);assert.equal(stored.aiNpcOfflineV2.characters.length,7);
 const restarted=runtime(r.storage);assert.equal(Object.keys(restarted.objects).length,7);
});
test('NPC creation is rejected for stale revisions or revoked administrators without ghost objects',()=>{
 const r=runtime();r.p.role=3001;r.events.onSay(r.p,'!npc-admin');const w=r.widgets.at(-1);w.receive(r.p,{type:'editor.ready'});
 w.receive(r.p,{type:'editor.create',name:'추가',style:'friendly',expectedRevision:100});assert.equal(w.messages.at(-1).type,'editor.error');assert.equal(Object.keys(r.objects).length,2);
 r.p.role=0;w.receive(r.p,{type:'editor.create',name:'권한없음',style:'friendly',expectedRevision:0});assert.equal(Object.keys(r.objects).length,2);assert.equal(r.writes,0);
});
test('NPC creation waits for durable storage confirmation',()=>{
 const r=runtime();r.p.role=3001;r.events.onSay(r.p,'!npc-admin');const w=r.widgets.at(-1);w.receive(r.p,{type:'editor.ready'});r.app.setStorage=()=>{};
 w.receive(r.p,{type:'editor.create',name:'저장실패',style:'friendly',movementMode:'varied',expectedRevision:0});r.drain();r.drain();assert.equal(w.messages.at(-1).type,'editor.error');assert.equal(Object.keys(r.objects).length,2);
});
test('continuous walking loops a four-frame animation once across multiple tile movements',()=>{
 const def={id:'moa',name:'모아',style:'friendly',x:8,y:8,minX:1,maxX:28,minY:1,maxY:28,movementMode:'continuous',localPlacement:true};
 const stored=JSON.stringify({aiNpcOfflineV2:{schema:2,revision:1,characters:[def],personas:{moa:D.defaults('moa','friendly')}}});
 const r=runtime(stored,{random:()=>.01,sprite:{animations:{right:[0,1,2,3],down:[0,1,2,3],left:[0,1,2,3],up:[0,1,2,3],right_idle:[4],left_idle:[4],up_idle:[4],down_idle:[4]}}});
 r.p.tileX=29;r.p.tileY=29;let moves=0;const nativeMove=r.map.moveObjectWithKey;r.map.moveObjectWithKey=(...args)=>{moves++;return nativeMove(...args);};
 for(let i=0;i<80;i++)r.events.onUpdate(.1);assert.ok(moves>=4);assert.equal(r.animations.filter(a=>a.key==='ai-npc:moa'&&a.name==='right').length,1);assert.equal(r.objects['ai-npc:moa'].useDirAnim,false);
});
test('editing an NPC movement mode persists and restores the choice',()=>{
 const r=runtime();r.p.role=3001;r.events.onSay(r.p,'!npc-admin');const w=r.widgets.at(-1);w.receive(r.p,{type:'editor.ready'});
 w.receive(r.p,{type:'editor.save',npcId:'moa',expectedRevision:0,persona:D.defaults('moa','friendly'),movementMode:'patrol'});assert.equal(w.messages.at(-1).type,'editor.saved');
 assert.equal(JSON.parse(r.storage).aiNpcOfflineV2.characters.find(c=>c.id==='moa').movementMode,'patrol');const next=runtime(r.storage);next.p.role=3001;next.events.onSay(next.p,'!npc-admin');const editor=next.widgets.at(-1);editor.receive(next.p,{type:'editor.ready'});assert.equal(editor.messages.at(-1).characters.find(c=>c.id==='moa').movementMode,'patrol');
});
test('looping directional sitting turns toward an approaching player without leaving the sitting action',()=>{
 const animations={down:[0],left:[1],right:[2],up:[3],down_idle:[4],left_idle:[5],right_idle:[6],up_idle:[7],down_sit:[8],left_sit:[9],right_sit:[10],up_sit:[11]};
 const r=runtime('',{sprite:{animations,actions:[{id:'sit',label:'앉기',directional:true,loop:true}]}});r.events.key(r.p);const w=r.widgets.at(-1);w.receive(r.p,{type:'npc.action',actionId:'sit'});r.p.tileX=8;r.p.tileY=7;r.events.onUpdate(.02);assert.equal(r.animations.filter(a=>a.key==='ai-npc:moa').at(-1).name,'up_sit');
 r.p.tileY=9;r.events.onUpdate(.02);assert.equal(r.animations.filter(a=>a.key==='ai-npc:moa').at(-1).name,'down_sit');
});
