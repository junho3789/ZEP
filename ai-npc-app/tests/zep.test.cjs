const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ROOT=path.join(__dirname,'../zep');

function runtime(){
 const events={},objects={},requests=[],timers=[],widgets=[];
 const p={id:'u1',role:0,tileX:9,tileY:8,isMobile:false,sendMessage(){},showWidgetResponsive(){
   const w={messages:[],destroyed:false,onMessage:{Add(fn){w.receive=fn;}},sendMessage(d){this.messages.push(d);},destroy(){this.destroyed=true;}};widgets.push(w);return w;
 }};
 const app={players:[p],spaceHashID:'space',mapHashID:'map',appHashID:'app',
 loadSpritesheet(){return{};},getStorage(fn){fn(JSON.stringify({aiNpcConnectionV1:{url:'https://npc.example.com',token:'bridge'}}));},
 setStorage(){throw Error('unexpected storage write');},putMobilePunch(){},addOnKeyDown(code,fn){events.key=fn;},
 runLater(fn,seconds){timers.push({fn,seconds});},httpPostJson(url,headers,body,done){requests.push({url,headers,body,done});return true;}};
 for(const name of ['onInit','onUpdate','onTriggerObject','onAppObjectAttacked','onLeavePlayer','onSay'])app[name]={Add(fn){events[name]=fn;}};
 const map={width:30,height:30,getTile(){return -1;},putObjectWithKey(x,y,sprite,opts){const o={...opts,tileX:x,tileY:y,sendUpdated(){}};objects[opts.key]=o;return o;},getObjectWithKey:k=>objects[k],moveObjectWithKey(k,x,y,path,time){objects[k].tileX=x;objects[k].tileY=y;return true;}};
 const context=vm.createContext({App:app,Map:map,console});
 vm.runInContext(['config.js','controller.js','app.js'].map(n=>fs.readFileSync(path.join(ROOT,n),'utf8')).join('\n'),context);
 events.onInit();return{events,objects,requests,timers,widgets,p,app,map};
}
test('F opens a nearby NPC, server owns identity and rejects forged widget senders',()=>{
 const r=runtime();r.events.key(r.p);assert.equal(r.widgets.length,1);const w=r.widgets[0];
 w.receive(r.p,{type:'npc.ready'});assert.equal(w.messages[0].name,'모아');
 w.receive({id:'attacker'},{type:'npc.chat',requestId:'evil',message:'안녕'});
 assert.equal(r.requests.filter(q=>q.url.endsWith('/chat')).length,0);
 w.receive(r.p,{type:'npc.chat',requestId:'one',message:'안녕',npcId:'sage',sessionId:'forged'});
 const request=r.requests.find(q=>q.url.endsWith('/chat'));
 assert.equal(request.body.npcId,'moa');assert.equal(request.body.sessionId,'space:map:app:u1');
 request.done(JSON.stringify({answer:'반가워요'}));assert.equal(w.messages.at(-1).answer,'반가워요');
 r.events.key(r.p);assert.equal(r.widgets.length,1);
});
test('walking away destroys the popup and drops late AI replies',()=>{
 const r=runtime();r.events.key(r.p);const w=r.widgets[0];w.receive(r.p,{type:'npc.chat',requestId:'one',message:'안녕'});
 const request=r.requests.find(q=>q.url.endsWith('/chat'));r.p.tileX=25;r.p.tileY=25;r.events.onUpdate(.1);assert.equal(w.destroyed,true);
 request.done(JSON.stringify({answer:'late'}));assert.equal(w.messages.length,0);
});
test('disconnect closes popup; non-admin cannot invoke connection prompts',()=>{
 const r=runtime();r.events.key(r.p);r.events.onLeavePlayer(r.p);assert.equal(r.widgets[0].destroyed,true);
 r.p.showPrompt=()=>{throw Error('unauthorized prompt');};r.events.onSay(r.p,'!npc-setup');
});
test('controller keeps waiting in the distance gap, considers all users and avoids blocked steps',()=>{
 const Controller=require('../zep/controller.js');let players=[{id:'a',x:6,y:5}],moves=0;
 const c=new Controller({position:()=>({x:5,y:5}),players:()=>players,stop(){},closeChat(){},openChat(){},canWalk:()=>false,step(){moves++;}});
 c.tick(.1);assert.equal(c.state,'waiting');players=[{id:'a',x:8,y:5}];c.tick(.1);assert.equal(c.state,'waiting');
 players=[{id:'b',x:6,y:5},{id:'a',x:20,y:20}];c.tick(.1);assert.equal(c.state,'waiting');players=[];c.tick(1);assert.equal(c.state,'roaming');
 c.steps=2;c.direction=[1,0];c.timer=0;c.tick(1);assert.equal(moves,0);
});
