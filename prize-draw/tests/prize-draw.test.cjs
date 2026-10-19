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
    ['onSay', 'onSidebarTouched', 'onJoinPlayer', 'onUpdate', 'onDestroy', 'onMigrationStart'].forEach(k => {
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
        draw(p) { listeners.onSay(p, '!추첨'); },
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
test('모바일 사이드바와 Q키로 참여 가능', () => {
    const h = setup(); h.listeners.onSidebarTouched(h.user()); h.flush(); h.listeners.key(h.user(2)); h.flush();
    assert.equal(h.state.winners.length, 2);
});
test('용량 안전 한도 초과 시 쓰기 전에 중단', () => {
    const h = setup({ config: { maxStorageBytes: 10 } }); h.draw(h.user()); h.flush(); assert.equal(h.writes, 0);
});
