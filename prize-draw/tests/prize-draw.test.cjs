const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../main.js'), 'utf8');

function setup(options = {}) {
    const listeners = {}, callbacks = [];
    let storage = options.storage ?? null, writes = 0, now = Date.parse('2026-10-19T03:00:00Z');
    const App = { mapHashID: 'map-a', get storage() { return storage; },
        getStorage(fn) { callbacks.push(fn); },
        setStorage(s) { writes++; if (options.throwWrite) throw Error('write failed'); if (!options.dropWrite) storage = s; },
        addOnKeyDown(key, fn) { listeners.key = fn; }
    };
    ['onSay', 'onObjectTouched', 'onTriggerObject', 'onSidebarTouched', 'onJoinPlayer', 'onLeavePlayer', 'onUpdate', 'onDestroy', 'onMigrationStart'].forEach(k => {
        App[k] = { Add(fn) { listeners[k] = fn; } };
    });
    class Clock extends Date { static now() { return now; } }
    const math = Object.create(Math); math.random = options.random || (() => 0);
    const ctx = vm.createContext({ App, Date: Clock, Math: math });
    vm.runInContext(source, ctx);
    Object.assign(ctx.PRIZE_CONFIG, { drawMapId: 'map-a' }, options.config || {});
    function user(id = 1, extra = {}) {
        return Object.assign({ id, emailHash: 'hash-' + id, isGuest: false, role: 0, messages: [],
            widgets: [],
            showWidgetResponsive(file, ...margins) {
                const w = { file, margins, packets: [], destroyed: false, sendMessage(data) { this.packets.push(JSON.parse(JSON.stringify(data))); },
                    destroy() { this.destroyed = true; }, onMessage: { Add(fn) { w.receive = fn; } } };
                this.widgets.push(w); return w;
            },
            sendMessage(s) { this.messages.push(s); }, showConfirm(s, cb) { cb(); } }, extra);
    }
    function flush() {
        let guard = 0;
        while (callbacks.length) { if (++guard > 10000) throw Error('loop'); callbacks.shift()(); }
    }
    function settle() { for (let i = 0; i < 110; i++) { flush(); listeners.onUpdate(0.02); } flush(); }
    return { App, listeners, callbacks, user, flush, settle, ctx,
        interact(p) { listeners.onObjectTouched(p, 10, 10, 0, { type: 21, text: '1001', param1: 'prize_draw' }); },
        draw(p) { listeners.onObjectTouched(p, 10, 10, 0, { type: 21, text: '1001', param1: 'prize_draw' });
            flush();
            const active = p.widgets.at(-1); if (active && !active.destroyed) active.receive(p, { type: 'spin' });
            // 기존 원장 검증은 팝업을 바로 닫고 개인 메시지로 결과를 확인합니다.
            const w = p.widgets.at(-1); if (w && !w.destroyed) w.receive(p, { type: 'close' }); },
        get storage() { return storage; }, set storage(s) { storage = s; },
        get state() { return JSON.parse(storage).zepPrizeDrawV1; }, get writes() { return writes; },
        setNow(value) { now = Date.parse(value); }
    };
}

function command(h,a,text) { h.listeners.onSay(a,text); h.settle(); }
function resetCode(h,a) { command(h,a,'!경품초기화'); const m=a.messages.at(-1).match(/60초 안에 !경품초기화 (\S+) 입력/); assert.ok(m); return m[1]; }
function openAndSpin(h,p) { h.interact(p); h.flush(); const w=p.widgets.at(-1); w.receive(p,{type:'spin'}); return w; }
test('팝업 열기와 ready는 원장에 쓰지 않고 버튼 요청 후 저장 확인 결과만 전달',()=>{
 const h=setup(),p=h.user();h.interact(p);h.flush();const w=p.widgets[0];assert.equal(h.writes,0);assert.equal(w.packets.at(-1).type,'idle');
 w.receive(p,{type:'ready'});assert.equal(h.writes,0);w.receive(p,{type:'spin'});assert.equal(w.packets.at(-1).type,'mixing');
 h.callbacks.shift()();assert.equal(h.writes,1);assert.ok(!w.packets.some(x=>x.type==='result'));h.flush();assert.equal(w.packets.at(-1).type,'result');
});
test('100개 균등 구간 입력에서 확률 5/10/15/20/50 선택',()=>{
 let i=0;const h=setup({random:()=>((i++)+.5)/100});for(let n=0;n<100;n++){h.draw(h.user(n));h.flush();}
 assert.deepEqual(['rank1','rank2','rank3','rank4','rank5'].map(r=>h.state.winners.filter(w=>w.rank===r).length),[5,10,15,20,50]);
});
test('확률 누적 경계값을 정확하게 다음 등수에 배정',()=>{
 for(const [value,rank] of [[0,1],[.049999,1],[.05,2],[.149999,2],[.15,3],[.299999,3],[.3,4],[.499999,4],[.5,5],[.999999,5]]){
 const h=setup({random:()=>value});h.draw(h.user());h.flush();assert.equal(h.state.winners[0].rank,'rank'+rank);}
});
test('총 1000개 및 1등 6개/일일 2개 제한 없이 1100명 이상 당첨',()=>{
 const h=setup();for(let i=0;i<1101;i++){h.draw(h.user(i));h.flush();}assert.equal(h.state.winners.length,1101);assert.ok(h.state.winners.every(w=>w.rank==='rank1'));
});
test('동시 버튼 100개를 직렬 처리하고 계정 중복 요청을 한 건으로 처리',()=>{
 const h=setup();const people=Array.from({length:100},(_,i)=>h.user(i));people.forEach(p=>h.interact(p));h.settle();people.forEach(p=>{p.widgets[0].receive(p,{type:'spin'});p.widgets[0].receive(p,{type:'spin'});});h.settle();assert.equal(h.state.winners.length,100);assert.equal(h.writes,100);
});
test('임의 draw/result 메시지와 다른 사람의 위젯 요청은 추첨하지 않음',()=>{
 const h=setup(),p=h.user();h.interact(p);h.flush();const w=p.widgets[0];w.receive(h.user(2),{type:'spin'});w.receive(p,{type:'draw'});w.receive(p,{type:'result',rank:'rank1'});assert.equal(h.writes,0);
});
test('같은 계정 재접속/팝업 재열기/재시작은 저장된 결과를 복구',()=>{
 const h=setup(),p=h.user();h.draw(p);h.flush();const next=setup({storage:h.storage}),q=next.user(123,{emailHash:p.emailHash});next.interact(q);next.flush();assert.equal(next.writes,0);assert.equal(q.widgets[0].packets.at(-1).repeated,true);
});
test('열린 팝업 반복 접촉과 닫기 중에도 추첨은 최대 한 번',()=>{
 const h=setup(),p=h.user();const w=openAndSpin(h,p);h.interact(p);assert.equal(p.widgets.length,1);w.receive(p,{type:'close'});h.flush();assert.equal(h.writes,1);assert.match(p.messages.join(''),/당첨!/);
});
test('다른 맵 및 게스트는 버튼 추첨 불가',()=>{
 for(const options of [{isGuest:true},{emailHash:''}]){const h=setup(),p=h.user(1,options);openAndSpin(h,p);h.flush();assert.equal(h.writes,0);assert.equal(p.widgets[0].packets.at(-1).type,'notice');}
 const h=setup();h.App.mapHashID='other';h.interact(h.user());h.flush();assert.equal(h.writes,0);
});
test('오브젝트 타입/Number/Value 및 이전 key/좌표 모드 필터',()=>{
 const h=setup();for(const obj of [null,{}, {type:1,text:'1001',param1:'prize_draw'},{type:21,text:'1002',param1:'prize_draw'}])h.listeners.onObjectTouched(h.user(),0,0,0,obj);assert.equal(h.callbacks.length,0);
 for(const mode of ['key','position']){const x=setup({config:{interactionMode:mode,objectPosition:{layer:3,x:2,y:4}}}),p=x.user();x.listeners.onTriggerObject(p,3,2,4,'wrong');if(mode==='key')assert.equal(p.widgets.length,0);x.listeners.onTriggerObject(p,3,2,4,'prize_draw');x.flush();p.widgets[0].receive(p,{type:'spin'});x.flush();assert.equal(x.writes,1);}
});
test('채팅/Q/사이드바는 추첨하지 않음',()=>{const h=setup(),p=h.user();command(h,p,'!추첨');h.listeners.onSidebarTouched(p);assert.equal(h.writes,0);assert.equal(p.widgets.length,0);assert.equal(h.listeners.key,undefined);});
test('관리자 현황은 확률/누적 통계만 표시하고 중지 상태는 재시작 후 유지',()=>{
 const h=setup(),a=h.user(99,{role:3000});h.draw(h.user());h.flush();command(h,a,'!경품현황');assert.match(a.messages.join(''),/확률 5%/);assert.match(a.messages.join(''),/재고·일일 한도 없음/);command(h,a,'!경품중지');const next=setup({storage:h.storage});const p=next.user(2);openAndSpin(next,p);next.flush();assert.equal(next.state.winners.length,1);command(next,a,'!경품시작');assert.equal(next.state.paused,false);
});
test('일반 회원/스태프 관리자 명령 거부, 큐 대기 중 권한도 재검사',()=>{
 const h=setup();for(const role of [0,1000,2000])for(const c of ['!경품중지','!경품시작','!경품초기화','!경품현황'])command(h,h.user(role,{role}),c);assert.equal(h.writes,0);
 const a=h.user(99,{role:3000});h.listeners.onSay(a,'!경품중지');a.role=0;h.settle();assert.equal(h.writes,0);
});
test('초기화는 중지/관리자 확인 코드 필요, 새 회차에서 재참여 가능',()=>{
 const h=setup(),a=h.user(99,{role:3000}),p=h.user();h.draw(p);h.flush();command(h,a,'!경품초기화');assert.match(a.messages.at(-1),/먼저/);command(h,a,'!경품중지');const code=resetCode(h,a);command(h,a,'!경품초기화 '+code);assert.equal(h.state.round,2);assert.equal(h.state.paused,true);assert.equal(h.state.winners.length,0);command(h,a,'!경품시작');h.draw(p);h.flush();assert.equal(h.state.winners.length,1);
});
test('확인 코드 만료/오타/다른 관리자/재사용 차단',()=>{
 const h=setup(),a=h.user(99,{role:3000}),b=h.user(98,{role:3000});command(h,a,'!경품중지');let c=resetCode(h,a);command(h,b,'!경품초기화 '+c);assert.equal(h.state.round,1);h.setNow('2026-10-19T03:01:00Z');command(h,a,'!경품초기화 '+c);assert.equal(h.state.round,1);c=resetCode(h,a);command(h,a,'!경품초기화 WRONG');assert.equal(h.state.round,1);c=resetCode(h,a);command(h,a,'!경품초기화 '+c);command(h,a,'!경품초기화 '+c);assert.equal(h.state.round,2);
});
test('이전 재고형 v1 원장의 당첨번호/계정/회차를 보존하며 확률형으로 전환',()=>{
 const h=setup();h.draw(h.user());h.flush();const root=JSON.parse(h.storage),s=root.zepPrizeDrawV1;s.version=1;s.config=JSON.stringify(['prize-event-2026-v1','map-a',1000,h.ctx.PRIZE_CONFIG.ranks.map(r=>({id:r.id,name:r.name,total:0,dailyLimit:0}))]);delete s.paused;delete s.round;
 const next=setup({storage:JSON.stringify(root)}),p=next.user();next.interact(p);next.flush();assert.equal(p.widgets[0].packets.at(-1).repeated,true);assert.equal(next.writes,0);next.draw(next.user(2));next.flush();assert.equal(next.state.version,2);assert.equal(next.state.winners.length,2);
});
test('잘못된 이전 맵 설정/손상된 JSON/중복 원장은 덮어쓰지 않음',()=>{
 const h=setup({storage:'{broken'});h.interact(h.user());h.flush();assert.equal(h.writes,0);assert.equal(h.storage,'{broken');
 const x=setup();x.draw(x.user());x.flush();const root=JSON.parse(x.storage);root.zepPrizeDrawV1.winners.push(root.zepPrizeDrawV1.winners[0]);root.zepPrizeDrawV1.revision=2;const next=setup({storage:JSON.stringify(root)});next.interact(next.user(2));next.flush();assert.equal(next.writes,0);
});
test('운영 중 확률 변경은 원장을 초기화하지 않고 차단, 합계 오류도 거부',()=>{
 const h=setup();h.draw(h.user());h.flush();h.ctx.PRIZE_CONFIG.ranks[0].probability=10;h.ctx.PRIZE_CONFIG.ranks[1].probability=5;h.draw(h.user(2));h.flush();assert.equal(h.writes,1);
 const x=setup();x.ctx.PRIZE_CONFIG.ranks[0].probability=6;x.interact(x.user());x.flush();assert.equal(x.writes,0);
});
for(const option of [{dropWrite:true},{throwWrite:true}])test('저장 실패 시 룰렛 당첨 결과를 전송하지 않음 '+JSON.stringify(option),()=>{
 const h=setup(option),p=h.user();const w=openAndSpin(h,p);h.flush();assert.ok(!w.packets.some(x=>x.type==='result'));assert.equal(w.packets.at(-1).type,'notice');
});
test('팝업 실패/저장 타임아웃/용량 안전 한도는 임의 당첨을 만들지 않음',()=>{
 const h=setup(),p=h.user(1,{showWidgetResponsive(){throw Error();}});h.interact(p);h.flush();assert.equal(h.writes,0);
 const x=setup();x.interact(x.user());x.listeners.onUpdate(16);x.flush();assert.equal(x.writes,0);
 const y=setup({config:{maxStorageBytes:10}});y.draw(y.user());y.flush();assert.equal(y.writes,0);
});
test('당첨 저장 직후 이전/종료해도 새 실행에서 기존 결과를 복구',()=>{
 const h=setup(),p=h.user();const w=openAndSpin(h,p);h.callbacks.shift()();assert.equal(h.writes,1);h.listeners.onMigrationStart();h.flush();const next=setup({storage:h.storage}),q=next.user();next.interact(q);next.flush();assert.equal(q.widgets[0].packets.at(-1).repeated,true);assert.equal(next.writes,0);
});
test('맵 미설정에서도 관리자 런타임 맵 ID 확인 가능; 원장 변경 없음',()=>{const h=setup({config:{drawMapId:'REPLACE_WITH_MAP_HASH_ID'}}),a=h.user(99,{role:3000});command(h,a,'!경품맵확인');assert.match(a.messages.join(''),/map-a/);assert.equal(h.writes,0);});
test('다른 최상위 스토리지 데이터 보존; 이탈 시 위젯 정리',()=>{
 const h=setup({storage:JSON.stringify({other:{count:42}})}),p=h.user();const w=openAndSpin(h,p);h.flush();assert.equal(JSON.parse(h.storage).other.count,42);h.listeners.onLeavePlayer(p);assert.equal(w.destroyed,true);w.receive(p,{type:'spin'});assert.equal(h.writes,1);
});
test('관리자 CSV 내보내기는 현재 원장 전체를 읽고 한글 BOM/한국시각 포함; 저장 미변경', () => {
    const h = setup(), a = h.user(99, { role: 3000 }); h.draw(h.user()); h.flush();
    const before = h.storage; command(h, a, '!당첨내보내기'); const w = a.widgets.at(-1);
    assert.equal(w.file, 'prize-export.html'); assert.equal(w.packets.length, 0);
    w.receive(a, { type: 'ready' }); const packet = w.packets.at(-1);
    assert.equal(packet.type, 'export'); assert.equal(packet.count, 1); assert.equal(packet.csv.charCodeAt(0), 0xfeff);
    assert.match(packet.csv, /계정 이메일 해시/); assert.match(packet.csv, /hash-1/);
    assert.match(packet.csv, /2026-10-19 12:00:00/); assert.match(packet.csv, /prize-event-2026-v1-R1-1/);
    assert.equal(h.storage, before); assert.equal(h.writes, 1);
});
test('일반 유저의 CSV 요청/다른 사용자의 위젯 요청/권한 회수 후 조회 거부', () => {
    const h = setup(), p = h.user(), a = h.user(99, { role: 3000 }); command(h, p, '!당첨내보내기');
    assert.equal(p.widgets.length, 0); assert.match(p.messages.join(''), /관리자 전용/);
    command(h, a, '!당첨내보내기'); const w = a.widgets.at(-1);
    w.receive(p, { type: 'ready' }); assert.equal(w.packets.length, 0);
    a.role = 0; w.receive(a, { type: 'ready' }); assert.equal(w.destroyed, true); assert.equal(w.packets.length, 0);
});
test('CSV 특수문자 이스케이프와 엑셀 수식 문자열 보호', () => {
    const h = setup({ config: { prizeNames: { rank1: ' =HYPERLINK("test")\n경품, 이름' } } });
    h.draw(h.user(1, { emailHash: '+formula' })); h.flush();
    const a = h.user(99, { role: 3001 }); command(h, a, '!당첨내보내기'); const w = a.widgets.at(-1);
    w.receive(a, { type: 'ready' }); const csv = w.packets.at(-1).csv;
    assert.ok(csv.includes('"\' =HYPERLINK(""test"")\n경품, 이름"')); assert.ok(csv.includes('"\'+formula"'));
});
test('빈 목록도 헤더 CSV로 내보내고 팝업 닫기/이탈 정리', () => {
    const h = setup(), a = h.user(99, { role: 3000 }); command(h, a, '!당첨내보내기'); const w = a.widgets.at(-1);
    w.receive(a, { type: 'ready' }); assert.equal(w.packets.at(-1).count, 0);
    assert.equal(w.packets.at(-1).csv.split('\r\n').length, 2); w.receive(a, { type: 'close' }); assert.equal(w.destroyed, true);
    command(h, a, '!당첨내보내기'); h.listeners.onLeavePlayer(a); assert.equal(a.widgets.at(-1).destroyed, true);
});
test('초기화 후 내보내기는 새 회차만 포함; 이전 내려받기 원문은 조회시점 스냅샷', () => {
    const h = setup(), a = h.user(99, { role: 3000 }); h.draw(h.user()); h.flush(); command(h, a, '!당첨내보내기');
    const w = a.widgets.at(-1); command(h, a, '!경품중지'); const code = resetCode(h, a); command(h, a, '!경품초기화 ' + code);
    w.receive(a, { type: 'ready' }); assert.equal(w.packets.at(-1).count, 1); assert.equal(w.packets.at(-1).round, 1);
    command(h, a, '!당첨내보내기'); const next = a.widgets.at(-1); next.receive(a, { type: 'ready' });
    assert.equal(next.packets.at(-1).count, 0); assert.equal(next.packets.at(-1).round, 2);
});
