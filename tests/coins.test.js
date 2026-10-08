const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../main.js'), 'utf8');
const ID = 'object:lobby:treasure-01';

function runtime(code = source) {
    const handlers = {};
    const App = {};
    for (const event of ['onJoinPlayer', 'onTriggerObject']) {
        App[event] = { Add(fn) { handlers[event] = fn; } };
    }
    const context = vm.createContext({ App });
    vm.runInContext(code, context);
    return { api: context.CoinRewards, handlers };
}
function player(storage = '') {
    return { storage, labels: [], showCenterLabel(text) { this.labels.push(text); } };
}
function state(p) { return JSON.parse(p.storage).zepCoinRewards; }

test('join shows balance without modifying storage', () => {
    const r = runtime(), p = player();
    r.handlers.onJoinPlayer(p);
    assert.equal(p.labels[0], '보유 코인: 0');
    assert.equal(p.storage, '');
});
test('F interaction credits configured object and saves duplicate guard together', () => {
    const r = runtime(), p = player();
    r.handlers.onTriggerObject(p, 3, 10, 10, 'unused');
    assert.equal(state(p).coins, 10);
    assert.equal(state(p).claimed['reward:' + ID], true);
    assert.match(p.labels[0], /\+10/);
});
test('wrong location and wrong layer do not award coins', () => {
    const r = runtime(), p = player();
    r.handlers.onTriggerObject(p, 3, 11, 10, '');
    r.handlers.onTriggerObject(p, 5, 10, 10, '');
    assert.equal(p.storage, '');
});
test('100 repeated interactions award only once', () => {
    const r = runtime(), p = player();
    for (let i = 0; i < 100; i++) r.handlers.onTriggerObject(p, 3, 10, 10, '');
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
    assert.equal(b.labels[0], '보유 코인: 10');
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
    const p = { get storage() { return saved; }, set storage(value) {
        if (fail) throw Error('unavailable'); saved = value;
    } };
    assert.equal(r.api.grant(p, ID).status, 'storage_error');
    assert.equal(saved, '');
    fail = false;
    assert.equal(r.api.grant(p, ID).status, 'granted');
    assert.equal(state(p).coins, 10);
});
test('duplicate configured location fails at startup', () => {
    const duplicate = source.replace(
        '{ id: "object:lobby:treasure-01", layer: 3, x: 10, y: 10, coins: 10 }',
        '{ id: "object:lobby:treasure-01", layer: 3, x: 10, y: 10, coins: 10 },' +
        '{ id: "object:lobby:treasure-02", layer: 3, x: 10, y: 10, coins: 10 }');
    assert.throws(() => runtime(duplicate), /Duplicate object location/);
});
