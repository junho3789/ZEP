const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../main.js'), 'utf8');
const ID = 'object:lobby:treasure-01';

function runtime(code = source) {
    const handlers = {};
    const App = {};
    for (const event of ['onJoinPlayer', 'onObjectTouched', 'onLeavePlayer', 'onSay']) {
        App[event] = { Add(fn) { handlers[event] = fn; } };
    }
    const context = vm.createContext({ App });
    vm.runInContext(code, context);
    return { api: context.CoinRewards, handlers };
}
function player(storage = '') {
    const p = { storage, labels: [], widgets: [], saves: 0,
        save() { this.saves++; }, sendMessage(text) { this.labels.push(text); },
        showWidgetResponsive(file, ...margins) {
            const w = { file, margins, messages: [], destroyed: false,
                onMessage: { Add(fn) { w.ready = fn; } },
                sendMessage(data) { w.messages.push(data); }, destroy() { w.destroyed = true; } };
            this.widgets.push(w); return w;
        } };
    return p;
}
function state(p) { return JSON.parse(p.storage).zepCoinRewards; }

test('join shows balance without modifying storage', () => {
    const r = runtime(), p = player();
    r.handlers.onJoinPlayer(p);
    const w = p.widgets[0];
    w.ready(p, {type: 'coin_hud_ready'});
    assert.equal(w.messages[0].coins, 0);
    assert.equal(p.storage, '');
});
test('F interaction credits configured object and saves duplicate guard together', () => {
    const r = runtime(), p = player();
    r.handlers.onObjectTouched(p, 99, 88, 123, {type: 21, text: '1', param1: 'coin:10'});
    assert.equal(state(p).coins, 10);
    assert.equal(state(p).claimed['reward:' + ID], true);
    assert.match(p.labels[0], /\+10/);
});
test('non-script objects and invalid numbers do not award coins', () => {
    const r = runtime(), p = player();
    r.handlers.onObjectTouched(p, 1, 1, 99, {type: 1, text: '1', param1: 'coin:10'});
    r.handlers.onObjectTouched(p, 1, 1, 99, {type: 21, text: '01', param1: 'coin:10'});
    assert.equal(p.storage, '');
});
test('100 repeated interactions award only once', () => {
    const r = runtime(), p = player();
    for (let i = 0; i < 100; i++) r.handlers.onObjectTouched(p, i, 0, 123, {type: 21, text: '1', param1: 'coin:10'});
    assert.equal(state(p).coins, 10);
    assert.match(p.labels.at(-1), /이미/);
});
test('separate player records earn independently', () => {
    const r = runtime(), a = player(), b = player();
    r.api.grant(a, ID);
    assert.equal(r.api.balance(b).coins, 0);
    r.api.grant(b, ID);
    assert.equal(state(a).coins, 10);
    assert.equal(state(b).coins, 10);
});
test('new runtime and player restore stored balance and duplicate protection', () => {
    const a = player();
    runtime().api.grant(a, ID);
    const b = player(a.storage), r = runtime();
    r.handlers.onJoinPlayer(b);
    b.widgets[0].ready(b, {type: 'coin_hud_ready'});
    assert.equal(b.widgets[0].messages[0].coins, 10);
    assert.equal(r.api.grant(b, ID).status, 'already_claimed');
    assert.equal(state(b).coins, 10);
});
test('new reward source uses same balance and independent claim id', () => {
    const r = runtime(), p = player();
    r.api.register('quiz:intro:q1', 25);
    r.api.grant(p, ID);
    assert.equal(r.api.grant(p, 'quiz:intro:q1').status, 'granted');
    assert.equal(r.api.grant(p, 'quiz:intro:q1').status, 'already_claimed');
    assert.equal(state(p).coins, 35);
});
test('unrelated existing storage fields survive', () => {
    const r = runtime(), p = player('{"otherApp":{"score":7}}');
    r.api.grant(p, ID);
    assert.deepEqual(JSON.parse(p.storage).otherApp, { score: 7 });
});
test('malformed and incompatible records are never overwritten', () => {
    const records = ['{bad', '[]', 'null', '42', '{}broken',
        JSON.stringify({zepCoinRewards: {version: 2, coins: 10, claimed: {}}}),
        JSON.stringify({zepCoinRewards: {version: 1, coins: -1, claimed: {}}}),
        JSON.stringify({zepCoinRewards: {version: 1, coins: 1.5, claimed: {}}}),
        JSON.stringify({zepCoinRewards: {version: 1, coins: 10, claimed: {x: false}}}),
        JSON.stringify({zepCoinRewards: null}), 12];
    for (const raw of records) {
        const r = runtime(), p = player(raw);
        assert.equal(r.api.grant(p, ID).status, 'storage_error');
        assert.equal(p.storage, raw);
    }
});
test('unregistered reward cannot change balance', () => {
    const r = runtime(), p = player();
    assert.equal(r.api.grant(p, 'quiz:fake').status, 'unknown_reward');
    assert.equal(p.storage, '');
});
test('invalid or duplicate registration is rejected', () => {
    const r = runtime();
    for (const [id, amount] of [[ID, 10], ['bad', 0], ['bad', -1], ['bad', 0.5],
        ['bad', Infinity], ['bad', '10'], ['bad', 9007199254740992], ['__proto__', 1]]) {
        assert.throws(() => r.api.register(id, amount));
    }
});
test('balance overflow cannot consume claim', () => {
    const r = runtime(), raw = JSON.stringify({zepCoinRewards:
        {version: 1, coins: 9007199254740990, claimed: {}}}), p = player(raw);
    assert.equal(r.api.grant(p, ID).status, 'balance_limit');
    assert.equal(p.storage, raw);
});
test('claim cap preserves data', () => {
    const claimed = {};
    for (let i = 0; i < 1000; i++) claimed['reward:old:' + i] = true;
    const raw = JSON.stringify({zepCoinRewards: {version: 1, coins: 10, claimed}});
    const p = player(raw);
    assert.equal(runtime().api.grant(p, ID).status, 'claim_limit');
    assert.equal(p.storage, raw);
});
test('storage setter failure does not acknowledge grant or consume retry', () => {
    const r = runtime();
    let saved = '', fail = true;
    const p = { save() {}, get storage() { return saved; }, set storage(value) {
        if (fail) throw Error('unavailable'); saved = value;
    } };
    assert.equal(r.api.grant(p, ID).status, 'storage_error');
    assert.equal(saved, '');
    fail = false;
    assert.equal(r.api.grant(p, ID).status, 'granted');
    assert.equal(state(p).coins, 10);
});
test('number-based rewards ignore coordinates and keep distinct claims', () => {
    const r = runtime(), p = player();
    r.handlers.onObjectTouched(p, 1, 2, 123, {type: 21, text: '1', param1: 'coin:10'});
    r.handlers.onObjectTouched(p, 90, 91, 999, {type: 21, text: '2', param1: 'coin:20'});
    r.handlers.onObjectTouched(p, 8, 7, 777, {type: 21, text: '1', param1: 'coin:100'});
    assert.equal(state(p).coins, 30);
    assert.equal(p.saves, 2);
});
test('ready handshake restores latest balance; grants refresh HUD including quiz rewards', () => {
    const r = runtime(), p = player();
    r.handlers.onJoinPlayer(p);
    const w = p.widgets[0];
    assert.equal(w.file, 'coin-hud.html');
    assert.deepEqual(w.margins, [8, 68, 80, 2]);
    assert.equal(w.messages.length, 0);
    r.api.grant(p, ID);
    w.ready(p, {type: 'coin_hud_ready'});
    assert.equal(w.messages.at(-1).coins, 10);
    r.api.register('quiz:q1', 25);
    r.api.grant(p, 'quiz:q1');
    assert.equal(w.messages.at(-1).coins, 35);
    assert.equal(p.saves, 2);
    const count = w.messages.length;
    w.ready(p, {type: 'grant', amount: 1000});
    w.ready(player(), {type: 'coin_hud_ready'});
    assert.equal(w.messages.length, count);
    assert.equal(state(p).coins, 35);
});
test('HUD is cleaned up on rejoin and leave', () => {
    const r = runtime(), p = player();
    r.handlers.onJoinPlayer(p);
    const first = p.widgets[0];
    r.handlers.onJoinPlayer(p);
    assert.equal(first.destroyed, true);
    r.handlers.onLeavePlayer(p);
    assert.equal(p.widgets[1].destroyed, true);
});
test('save failures roll back memory and do not update HUD or block retry', () => {
    const r = runtime(), p = player();
    r.handlers.onJoinPlayer(p);
    p.widgets[0].ready(p, {type: 'coin_hud_ready'});
    p.save = () => { throw Error('Save failed'); };
    assert.equal(r.api.grant(p, ID).status, 'storage_error');
    assert.equal(p.storage, '');
    assert.equal(p.widgets[0].messages.at(-1).coins, 0);
    p.save = () => {};
    assert.equal(r.api.grant(p, ID).status, 'granted');
    assert.equal(p.widgets[0].messages.at(-1).coins, 10);
});
test('HUD errors do not undo saved rewards', () => {
    const r = runtime(), p = player();
    r.handlers.onJoinPlayer(p);
    p.widgets[0].ready(p, {type: 'coin_hud_ready'});
    p.widgets[0].sendMessage = () => { throw Error('Closed widget'); };
    assert.equal(r.api.grant(p, ID).status, 'granted');
    assert.equal(p.saves, 1);
    assert.equal(state(p).coins, 10);
});
test('invalid storage displays error rather than zero; chat fallback works', () => {
    const r = runtime(), p = player('{broken');
    r.handlers.onJoinPlayer(p);
    p.widgets[0].ready(p, {type: 'coin_hud_ready'});
    assert.equal(p.widgets[0].messages[0].status, 'storage_error');
    assert.equal(p.widgets[0].messages[0].coins, null);
    r.handlers.onSay(p, '!coins');
    assert.match(p.labels.at(-1), /읽을 수 없습니다/);
    assert.equal(p.storage, '{broken');
});
test('invalid editor commands do not pay', () => {
    const r = runtime(), p = player();
    for (const value of ['coin:0', 'coin:-10', 'coin:1.5', 'coin:1000000', 'coin:10oops']) {
        r.handlers.onObjectTouched(p, 0, 0, 123, {type: 21, text: '1', param1: value});
    }
    assert.equal(p.storage, '');
    assert.equal(p.saves, 0);
});
