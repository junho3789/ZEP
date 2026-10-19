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
    ['onSay', 'onObjectTouched', 'onTriggerObject', 'onSidebarTouched', 'onJoinPlayer', 'onUpdate', 'onDestroy', 'onMigrationStart'].forEach(k => {
        App[k] = { Add(fn) { listeners[k] = fn; } };
    });
    class Clock extends Date { static now() { return now; } }
    const math = Object.create(Math); math.random = options.random || (() => 0);
    const ctx = vm.createContext({ App, Date: Clock, Math: math });
    vm.runInContext(source, ctx);
    Object.assign(ctx.PRIZE_CONFIG, { drawMapId: 'map-a' }, options.config || {});
    function user(id = 1, extra = {}) {
        return Object.assign({ id, emailHash: 'hash-' + id, isGuest: false, role: 0, messages: [],
            sendMessage(s) { this.messages.push(s); }, showConfirm(s, cb) { cb(); } }, extra);
    }
    function flush() {
        let guard = 0;
        while (callbacks.length) { if (++guard > 10000) throw Error('loop'); callbacks.shift()(); }
    }
    function settle() { for (let i = 0; i < 110; i++) { flush(); listeners.onUpdate(0.02); } flush(); }
    return { App, listeners, callbacks, user, flush, settle, ctx,
        draw(p) { listeners.onObjectTouched(p, 10, 10, 0, { type: 21, text: '1001', param1: 'prize_draw' }); },
        get storage() { return storage; }, set storage(s) { storage = s; },
        get state() { return JSON.parse(storage).zepPrizeDrawV1; }, get writes() { return writes; },
        setNow(value) { now = Date.parse(value); }
    };
}
const small = { totalPrizes: 3, ranks: [
    { id: 'r1', name: '1등', total: 2, dailyLimit: 1 },
    { id: 'r2', name: '2등', total: 1, dailyLimit: 1 }
] };

test('총 1000개 재고와 각 등수 일일 한도; 충분한 날이 지나면 정확히 소진', () => {
    const h = setup(); let id = 0;
    for (let d = 19; d <= 25; d++) {
        h.setNow(`2026-10-${d}T03:00:00Z`);
        for (let n = 0; n < 400; n++) { h.draw(h.user(++id)); h.flush(); }
    }
    assert.equal(h.state.winners.length, 1000);
    for (const r of h.ctx.PRIZE_CONFIG.ranks) {
        const wins = h.state.winners.filter(w => w.rank === r.id);
        assert.equal(wins.length, r.total);
        for (const d of new Set(wins.map(w => w.day))) assert.ok(wins.filter(w => w.day === d).length <= r.dailyLimit);
    }
});
test('비동기 동시 요청 100개를 직렬 처리하여 1등 하루 2개만 배정', () => {
    const h = setup();
    for (let i = 0; i < 100; i++) h.draw(h.user(i));
    h.settle();
    assert.equal(h.state.winners.length, 100);
    assert.equal(h.state.winners.filter(w => w.rank === 'rank1').length, 2);
});
test('같은 계정 중복 클릭, 재접속, 앱 재시작에도 한 번만 당첨', () => {
    const h = setup(), p = h.user(); h.draw(p); h.draw(p); h.settle();
    h.draw(h.user(99, { emailHash: p.emailHash })); h.flush();
    const next = setup({ storage: h.storage }); next.draw(next.user()); next.flush();
    assert.equal(next.state.winners.length, 1); assert.equal(next.writes, 0);
});
test('한국시간 자정에 일일 한도만 갱신, 전체 재고와 기존 당첨자는 유지', () => {
    const h = setup({ config: small });
    h.setNow('2026-10-19T14:59:59Z'); h.draw(h.user(1)); h.flush(); h.draw(h.user(2)); h.flush();
    const waiting = h.user(3); h.draw(waiting); h.flush(); assert.equal(h.state.winners.length, 2);
    assert.match(waiting.messages.join(''), /내일/);
    h.setNow('2026-10-19T15:00:00Z'); h.draw(waiting); h.flush();
    assert.equal(h.state.winners.length, 3); assert.equal(h.state.winners[2].day, '2026-10-20');
    h.draw(h.user(4)); h.flush(); assert.equal(h.state.winners.length, 3);
});
test('일일 한도 0은 해당 등수 배정 중지', () => {
    const h = setup({ config: { totalPrizes: 1, ranks: [{ id: 'r', name: '1등', total: 1, dailyLimit: 0 }] } });
    const p = h.user(); h.draw(p); h.flush(); assert.equal(h.writes, 0); assert.match(p.messages.join(''), /내일/);
});
test('가중 추첨 상단 경계는 마지막 등수 선택', () => {
    const h = setup({ random: () => 0.999999 }); h.draw(h.user()); h.flush(); assert.equal(h.state.winners[0].rank, 'rank5');
});
test('다른 맵/게스트/식별정보 없는 계정은 쓰기 불가', () => {
    const h = setup(); h.App.mapHashID = 'map-b'; h.draw(h.user()); h.flush();
    h.App.mapHashID = 'map-a'; h.draw(h.user(2, { isGuest: true })); h.draw(h.user(3, { emailHash: '' }));
    assert.equal(h.writes, 0); assert.equal(h.callbacks.length, 0);
});
test('관리자 현황 및 페이지별 당첨목록은 비공개 메시지로, 일반 회원은 조회 거부', () => {
    const h = setup(), p = h.user(), admin = h.user(2, { role: 3000 }); h.draw(p); h.flush();
    h.listeners.onSay(p, '!경품현황'); h.listeners.onSay(p, '!당첨목록 1');
    assert.match(p.messages.join(''), /관리자 전용/);
    h.listeners.onSay(admin, '!경품현황'); h.flush(); assert.match(admin.messages.join(''), /총 당첨 1\/1000/);
    h.listeners.onSay(admin, '!당첨목록 1'); h.flush(); assert.match(admin.messages.join(''), /hash-1/);
    assert.equal(h.writes, 1);
});
test('스토리지 다른 최상위 필드 보존', () => {
    const h = setup({ storage: JSON.stringify({ otherApp: { count: 42 } }) }); h.draw(h.user()); h.flush();
    assert.equal(JSON.parse(h.storage).otherApp.count, 42);
});
test('손상된 JSON은 초기화하거나 덮어쓰지 않음', () => {
    const h = setup({ storage: '{broken' }), p = h.user(); h.draw(p); h.flush();
    assert.equal(h.writes, 0); assert.equal(h.storage, '{broken'); assert.match(p.messages.join(''), /중지/);
});
test('저장된 당첨 원장이 손상되면 추가 배정 중지', () => {
    const h = setup(); h.draw(h.user()); h.flush();
    const root = JSON.parse(h.storage); root.zepPrizeDrawV1.winners.push(root.zepPrizeDrawV1.winners[0]);
    root.zepPrizeDrawV1.revision = 2; h.storage = JSON.stringify(root);
    h.draw(h.user(2)); h.flush(); assert.equal(h.writes, 1);
});
test('운영 중 총량/일일 한도 설정을 바꿔도 원장 자동 초기화 안 함', () => {
    const h = setup(); h.draw(h.user()); h.flush();
    h.ctx.PRIZE_CONFIG.ranks[0].dailyLimit = 4; h.draw(h.user(2)); h.flush(); assert.equal(h.writes, 1);
});
test('수량 합계 불일치 또는 미설정 맵은 시작 거부', () => {
    const h = setup({ config: { totalPrizes: 999 } }); h.draw(h.user()); assert.equal(h.callbacks.length, 0);
    h.ctx.PRIZE_CONFIG.totalPrizes = 1000; h.ctx.PRIZE_CONFIG.drawMapId = 'REPLACE_WITH_MAP_HASH_ID';
    h.draw(h.user()); assert.equal(h.callbacks.length, 0);
});
for (const [name, option] of [['예외', { throwWrite: true }], ['저장 누락', { dropWrite: true }]]) {
    test(`쓰기 ${name} 때 당첨 안내 없이 중지`, () => {
        const h = setup(option), p = h.user(); h.draw(p); h.flush();
        assert.doesNotMatch(p.messages.join(''), /당첨!/); assert.match(p.messages.join(''), /중지/);
        h.draw(h.user(2)); h.flush(); assert.equal(h.writes, 1);
    });
}
test('저장 응답 타임아웃 후 늦은 콜백은 쓰지 않음', () => {
    const h = setup(), p = h.user(); h.draw(p); h.listeners.onUpdate(16); h.flush();
    assert.equal(h.writes, 0); assert.match(p.messages.join(''), /중지/);
});
test('쓰기 뒤 결과 전달 전에 종료되어도 재시작 시 원래 결과 복구', () => {
    const h = setup(); h.draw(h.user()); h.callbacks.shift()(); assert.equal(h.writes, 1);
    h.listeners.onMigrationStart(); h.flush();
    const next = setup({ storage: h.storage }), p = next.user(); next.draw(p); next.flush();
    assert.equal(next.writes, 0); assert.match(p.messages.join(''), /이미 참여/); assert.equal(next.state.winners.length, 1);
});
test('서버 날짜 역행은 추가 추첨 중지', () => {
    const h = setup(); h.draw(h.user()); h.flush(); h.setNow('2026-10-18T03:00:00Z');
    h.draw(h.user(2)); h.flush(); assert.equal(h.writes, 1);
});
test('추첨은 오브젝트만 허용; 채팅/사이드바/Q 우회 차단', () => {
    const h = setup(); h.listeners.onSidebarTouched(h.user()); h.listeners.onSay(h.user(), '!추첨'); h.flush();
    assert.equal(h.writes, 0); assert.equal(h.listeners.key, undefined);
    h.draw(h.user()); h.flush(); assert.equal(h.state.winners.length, 1);
});

function command(h, admin, text) { h.listeners.onSay(admin, text); h.settle(); }
function resetCode(h, admin) {
    command(h, admin, '!경품초기화');
    const message = admin.messages[admin.messages.length - 1];
    const match = message.match(/60초 안에 !경품초기화 (\S+) 입력/);
    assert.ok(match, message); return match[1];
}
test('다른 key 오브젝트와 상호작용해도 추첨되지 않음', () => {
    const h = setup({ config: { interactionMode: 'key' } }); h.listeners.onTriggerObject(h.user(), 3, 10, 10, 'other'); h.flush();
    assert.equal(h.writes, 0); assert.equal(h.callbacks.length, 0);
});
test('좌표 모드는 레이어와 x/y가 모두 일치할 때만 추첨', () => {
    const h = setup({ config: { interactionMode: 'position', objectPosition: { layer: 5, x: 4, y: 7 } } });
    for (const coords of [[3,4,7], [5,5,7], [5,4,8]]) h.listeners.onTriggerObject(h.user(), ...coords, 'prize_draw');
    h.flush(); assert.equal(h.writes, 0);
    h.listeners.onTriggerObject(h.user(), 5, 4, 7, undefined); h.flush(); assert.equal(h.state.winners.length, 1);
});
test('중지 상태는 앱 재시작 후에도 유지, 시작 후 재개', () => {
    const h = setup(), admin = h.user(99, { role: 3000 });
    command(h, admin, '!경품중지'); assert.equal(h.state.paused, true);
    const next = setup({ storage: h.storage }); next.draw(next.user()); next.flush(); assert.equal(next.state.winners.length, 0);
    command(next, admin, '!경품시작'); next.draw(next.user()); next.flush(); assert.equal(next.state.winners.length, 1);
});
test('일반 유저/스태프는 관리자 중지·시작·초기화 불가', () => {
    const h = setup();
    for (const role of [0, 1000, 2000]) for (const cmd of ['!경품중지', '!경품시작', '!경품초기화', '!경품초기화 ABC']) {
        const p = h.user(role, { role }); command(h, p, cmd); assert.match(p.messages.join(''), /관리자 전용/);
    }
    assert.equal(h.writes, 0);
});
test('추첨 진행 중에는 초기화 준비 불가', () => {
    const h = setup(), a = h.user(99, { role: 3001 });
    command(h, a, '!경품초기화'); assert.match(a.messages.join(''), /먼저 !경품중지/); assert.equal(h.writes, 0);
});
test('정상 초기화는 재고/당첨자/일일 수량 초기화, 회차 증가, 중지 유지, 타 데이터 보존', () => {
    const h = setup({ config: small, storage: JSON.stringify({ other: { value: 42 } }) });
    const p = h.user(), a = h.user(99, { role: 3000 }); h.draw(p); h.flush();
    const oldReceipt = p.messages.join('');
    command(h, a, '!경품중지'); const code = resetCode(h, a);
    assert.equal(h.state.winners.length, 1); // 준비만으로는 지우지 않음
    command(h, a, '!경품초기화 ' + code);
    assert.equal(h.state.winners.length, 0); assert.equal(h.state.revision, 0); assert.equal(h.state.round, 2);
    assert.equal(h.state.paused, true); assert.equal(h.state.lastReset.previousCount, 1);
    assert.equal(JSON.parse(h.storage).other.value, 42);
    h.draw(p); h.flush(); assert.equal(h.state.winners.length, 0);
    command(h, a, '!경품시작'); h.draw(p); h.flush();
    assert.equal(h.state.winners.length, 1); assert.match(oldReceipt, /R1-1/); assert.match(p.messages.at(-1), /R2-1/);
});
test('확인 코드 오타나 60초 만료는 원장을 지우지 않음', () => {
    for (const expired of [false, true]) {
        const h = setup(), a = h.user(99, { role: 3000 }); h.draw(h.user()); h.flush();
        command(h, a, '!경품중지'); const code = resetCode(h, a);
        if (expired) h.setNow('2026-10-19T03:01:00Z');
        command(h, a, '!경품초기화 ' + (expired ? code : 'WRONG'));
        assert.equal(h.state.winners.length, 1); assert.equal(h.state.round, 1);
    }
});
test('다른 관리자의 코드는 사용할 수 없고 재시작하면 코드도 무효', () => {
    const h = setup(), a = h.user(99, { role: 3000 }), b = h.user(100, { role: 3000 });
    h.draw(h.user()); h.flush(); command(h, a, '!경품중지'); const code = resetCode(h, a);
    command(h, b, '!경품초기화 ' + code); assert.equal(h.state.winners.length, 1);
    const next = setup({ storage: h.storage }); command(next, a, '!경품초기화 ' + code);
    assert.equal(next.state.winners.length, 1);
});
test('초기화 코드 발급 후 상태 변경 또는 사용한 코드는 재사용 불가', () => {
    const h = setup(), a = h.user(99, { role: 3000 }); h.draw(h.user()); h.flush();
    command(h, a, '!경품중지'); const stale = resetCode(h, a);
    command(h, a, '!경품시작'); command(h, a, '!경품중지');
    command(h, a, '!경품초기화 ' + stale); assert.equal(h.state.winners.length, 1);
    const code = resetCode(h, a); command(h, a, '!경품초기화 ' + code); assert.equal(h.state.round, 2);
    command(h, a, '!경품초기화 ' + code); assert.equal(h.state.round, 2);
});
test('확인 코드 발급 후 원장 변동 시 초기화 거부', () => {
    const h = setup(), a = h.user(99, { role: 3000 }); command(h, a, '!경품중지'); const code = resetCode(h, a);
    const root = JSON.parse(h.storage); root.zepPrizeDrawV1.lastReset = { at: 0, by: 'other', previousCount: 0 };
    h.storage = JSON.stringify(root); command(h, a, '!경품초기화 ' + code); assert.equal(h.state.round, 1);
});
test('추첨 요청과 중지 명령이 동시에 대기해도 중지 이후 요청은 배정 안 함', () => {
    const h = setup(), a = h.user(99, { role: 3000 });
    h.draw(h.user(1)); h.listeners.onSay(a, '!경품중지'); h.draw(h.user(2)); h.settle();
    assert.equal(h.state.winners.length, 1); assert.equal(h.state.paused, true);
});
test('큐 대기 중 관리자 권한이 회수되면 변경 명령 거부', () => {
    const h = setup(), a = h.user(99, { role: 3000 }); h.draw(h.user());
    h.listeners.onSay(a, '!경품중지'); a.role = 0; h.settle();
    assert.equal(h.state.paused, false); assert.equal(h.writes, 1);
});
test('이전 버전 원장은 보존하고 round/paused 기본값만 추가', () => {
    const h = setup(); h.draw(h.user()); h.flush(); const root = JSON.parse(h.storage);
    delete root.zepPrizeDrawV1.round; delete root.zepPrizeDrawV1.paused;
    const next = setup({ storage: JSON.stringify(root) }); const p = next.user(); next.draw(p); next.flush();
    assert.equal(next.writes, 0); assert.match(p.messages.join(''), /이미 참여/);
    next.draw(next.user(2)); next.flush(); assert.equal(next.state.winners.length, 2); assert.equal(next.state.round, 1);
});
test('용량 안전 한도 초과 시 쓰기 전에 중단', () => {
    const h = setup({ config: { maxStorageBytes: 10 } }); h.draw(h.user()); h.flush(); assert.equal(h.writes, 0);
});
test('개발자 상호작용 오브젝트의 type/Number/Value가 모두 일치해야 추첨', () => {
    const h = setup();
    for (const obj of [null, {}, { type: 1, text: '1001', param1: 'prize_draw' },
        { type: 21, text: '1002', param1: 'prize_draw' }, { type: 21, text: '1001', param1: 'other' },
        { type: 21, text: '1001' }]) h.listeners.onObjectTouched(h.user(), 10, 10, 0, obj);
    h.flush(); assert.equal(h.writes, 0); assert.equal(h.callbacks.length, 0);
    h.listeners.onObjectTouched(h.user(), 10, 10, 0, { type: 21, text: 1001, param1: 'prize_draw' });
    h.flush(); assert.equal(h.state.winners.length, 1);
});
test('기본 editor 모드에서는 F key/좌표 이벤트가 추첨을 중복 실행하지 않음', () => {
    const h = setup(); h.listeners.onTriggerObject(h.user(), 3, 10, 10, 'prize_draw'); h.flush();
    assert.equal(h.writes, 0); h.draw(h.user()); h.flush();
    h.draw(h.user()); h.flush(); assert.equal(h.state.winners.length, 1);
});
test('이전 key 모드는 명시적으로 선택하면 정상 동작', () => {
    const h = setup({ config: { interactionMode: 'key' } }); h.draw(h.user()); h.flush(); assert.equal(h.writes, 0);
    h.listeners.onTriggerObject(h.user(), 3, 10, 10, 'prize_draw'); h.flush(); assert.equal(h.state.winners.length, 1);
});
test('맵 미설정 상태에서도 관리자 맵 확인은 실제 런타임 ID를 읽고 저장하지 않음', () => {
    const h = setup({ config: { drawMapId: 'REPLACE_WITH_MAP_HASH_ID' } });
    h.App.spaceHashID = 'space-real'; h.App.mapHashID = 'map-real';
    const a = h.user(99, { role: 3000 }); command(h, a, '!경품맵확인');
    assert.match(a.messages.join(''), /drawMapId: "map-real"/);
    assert.match(a.messages.join(''), /space-real/); assert.equal(h.writes, 0); assert.equal(h.callbacks.length, 0);
    assert.equal(h.ctx.PRIZE_CONFIG.drawMapId, 'REPLACE_WITH_MAP_HASH_ID');
});
test('맵 확인은 일반 유저 거부, 런타임 ID가 없으면 추정하지 않음', () => {
    const h = setup(), p = h.user(); command(h, p, '!경품맵확인'); assert.match(p.messages.join(''), /관리자 전용/);
    const a = h.user(99, { role: 3001 }); h.App.mapHashID = undefined;
    command(h, a, '!경품맵확인'); assert.match(a.messages.join(''), /확인할 수 없습니다/); assert.equal(h.writes, 0);
});
