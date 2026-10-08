const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

function fixture(appStorage = '') {
    let saved = appStorage;
    const handlers = {}, reads = [];
    const f = { defer: false, writeFailure: null, reads, writes: 0 };
    const App = {
        get storage() { return saved; },
        getStorage(callback) { if (f.defer) reads.push(callback); else callback(); },
        setStorage(value) {
            if (f.writeFailure === 'before') throw Error('Write failed');
            saved = value; f.writes++;
            if (f.writeFailure === 'after') throw Error('Uncertain commit');
        }
    };
    for (const name of ['onJoinPlayer', 'onLeavePlayer', 'onSay', 'onObjectTouched']) {
        App[name] = {Add(fn) { handlers[name] = fn; }};
    }
    const context = vm.createContext({App});
    vm.runInContext(source, context);
    return Object.assign(f, { handlers, api: context.CoinRewards,
        app: () => saved, totals: () => JSON.parse(saved).zepVoteTotals });
}
function player(id, storage = '') {
    return {id, storage, messages: [], saves: 0, widgets: [], prompts: [],
        save() { this.saves++; }, sendMessage(text) { this.messages.push(text); },
        showConfirm(text, fn) { this.prompts.push({text, fn}); },
        showWidgetResponsive() {
            const w = {messages: [], onMessage: {Add(fn) {w.ready = fn;}},
                sendMessage(data) {w.messages.push(data);}, destroy() {}};
            this.widgets.push(w); return w;
        }};
}
function state(p) { return JSON.parse(p.storage).zepCoinRewards; }
function touch(f, p, n, value) { f.handlers.onObjectTouched(p, 999, 888, 123, {type:21, text:String(n), param1:value}); }
function vote(f, p, box) {
    touch(f, p, box === 'A' ? 101 : 102, 'vote:' + box);
    p.prompts.at(-1).fn(true);
}
function joined(f, id = 'user1') { const p = player(id); f.handlers.onJoinPlayer(p); return p; }

test('100-coin bonus is once per player, including reconnect and a new runtime', () => {
    const f = fixture(), p = joined(f);
    assert.equal(state(p).coins, 100);
    f.handlers.onJoinPlayer(p);
    assert.equal(state(p).coins, 100);
    const fresh = fixture(), q = player(p.id, p.storage);
    fresh.handlers.onJoinPlayer(q);
    assert.equal(state(q).coins, 100);
    assert.equal(q.saves, 0);
    const other = joined(f, 'other');
    assert.equal(state(other).coins, 100);
});
test('A and B receive 10 coins per vote; user balance and HUD decrease', () => {
    const f = fixture(), p = joined(f);
    p.widgets[0].ready(p, {type:'coin_hud_ready'});
    vote(f, p, 'A'); vote(f, p, 'B');
    assert.equal(state(p).coins, 80);
    assert.equal(state(p).pendingVote, undefined);
    assert.equal(f.totals().boxes.A.coins, 10);
    assert.equal(f.totals().boxes.B.coins, 10);
    assert.equal(f.totals().boxes.A.votes, 1);
    assert.equal(p.widgets[0].messages.at(-1).coins, 80);
});
test('votes are repeatable until the wallet is exhausted; no negative balances', () => {
    const f = fixture(), p = joined(f);
    for (let i = 0; i < 10; i++) vote(f, p, 'A');
    const count = p.prompts.length;
    touch(f, p, 101, 'vote:A');
    assert.equal(p.prompts.length, count);
    assert.equal(state(p).coins, 0);
    assert.equal(f.totals().boxes.A.coins, 100);
    assert.equal(f.totals().boxes.A.votes, 10);
});
test('cancelling a prompt and repeated object callbacks never spend automatically', () => {
    const f = fixture(), p = joined(f);
    for (let i = 0; i < 30; i++) touch(f, p, 101, 'vote:A');
    assert.equal(p.prompts.length, 1);
    p.prompts[0].fn(false);
    assert.equal(state(p).coins, 100);
    assert.equal(f.writes, 0);
    vote(f, p, 'A');
    p.prompts.at(-1).fn(true);
    assert.equal(state(p).coins, 90);
    assert.equal(f.totals().boxes.A.coins, 10);
});
test('leave invalidates outstanding vote confirmation', () => {
    const f = fixture(), p = joined(f);
    touch(f, p, 101, 'vote:A');
    f.handlers.onLeavePlayer(p);
    p.prompts[0].fn(true);
    assert.equal(state(p).coins, 100);
    assert.equal(f.writes, 0);
});
test('async reads are serialized so two players do not overwrite totals', () => {
    const f = fixture(), a = joined(f, 'a'), b = joined(f, 'b');
    f.defer = true;
    vote(f, a, 'A'); vote(f, b, 'A');
    assert.equal(f.reads.length, 1);
    f.reads.shift()();
    assert.equal(f.reads.length, 1);
    f.reads.shift()();
    assert.equal(f.totals().boxes.A.coins, 20);
    assert.equal(state(a).coins, 90);
    assert.equal(state(b).coins, 90);
});
test('monitor reports both box totals, coin sum, vote counts and two boxes', () => {
    const f = fixture(), p = joined(f);
    vote(f, p, 'A'); vote(f, p, 'A'); vote(f, p, 'B');
    touch(f, p, 103, 'votes:totals');
    const messages = p.messages.slice(-4).join('\n');
    assert.match(messages, /투표함 수: 2개/);
    assert.match(messages, /A: 20코인 \/ 2표/);
    assert.match(messages, /B: 10코인 \/ 1표/);
    assert.match(messages, /합계: 30코인 \/ 3표/);
});
test('failed app write leaves one pending debit and retry completes without double spending', () => {
    const f = fixture(), p = joined(f);
    f.writeFailure = 'before'; vote(f, p, 'A');
    assert.equal(state(p).coins, 90);
    assert.equal(state(p).pendingVote.box, 'A');
    assert.equal(f.writes, 0);
    assert.equal(f.api.grant(p, 'object:lobby:treasure-01').status, 'vote_pending');
    f.writeFailure = null; f.handlers.onSay(p, '!vote-retry');
    assert.equal(state(p).coins, 90);
    assert.equal(state(p).pendingVote, undefined);
    assert.equal(f.totals().boxes.A.coins, 10);
});
test('uncertain app commit is reconciled idempotently after reconnect in a new runtime', () => {
    const f = fixture(), p = joined(f);
    f.writeFailure = 'after'; vote(f, p, 'B');
    assert.equal(state(p).coins, 90);
    assert.equal(f.totals().boxes.B.coins, 10);
    const fresh = fixture(f.app()), q = player(p.id, p.storage);
    fresh.handlers.onJoinPlayer(q);
    assert.equal(state(q).coins, 90);
    assert.equal(state(q).pendingVote, undefined);
    assert.equal(fresh.totals().boxes.B.coins, 10);
    assert.equal(fresh.writes, 0);
});
test('failure clearing pending player record is reconciled without recrediting box', () => {
    const f = fixture(), p = joined(f);
    const baseSave = p.save;
    p.save = function () { if (this.saves === 2) throw Error('Cleanup failed'); baseSave.call(this); };
    vote(f, p, 'A');
    assert.equal(state(p).pendingVote.box, 'A');
    assert.equal(f.totals().boxes.A.coins, 10);
    p.save = baseSave;
    f.api.resumeVote(p);
    assert.equal(state(p).coins, 90);
    assert.equal(state(p).pendingVote, undefined);
    assert.equal(f.totals().boxes.A.coins, 10);
});
test('debit save failure does not credit app totals', () => {
    const f = fixture(), p = joined(f), before = p.storage;
    p.save = () => { throw Error('Save failed'); };
    vote(f, p, 'A');
    assert.equal(p.storage, before);
    assert.equal(f.writes, 0);
});
test('malformed app storage and wrong vote commands cannot debit', () => {
    const f = fixture('{broken'), p = joined(f), before = p.storage;
    touch(f, p, 101, 'vote:B');
    assert.equal(p.prompts.length, 0);
    vote(f, p, 'A');
    assert.equal(p.storage, before);
    assert.equal(f.app(), '{broken');
});
test('player/app fields belonging to other features survive vote', () => {
    const f = fixture('{"other":{"count":7}}'), p = player('u', '{"otherPlayer":{"x":8}}');
    f.handlers.onJoinPlayer(p); vote(f, p, 'B');
    assert.equal(JSON.parse(f.app()).other.count, 7);
    assert.equal(JSON.parse(p.storage).otherPlayer.x, 8);
});
test('missing player identity cannot debit or aggregate', () => {
    const f = fixture(), p = joined(f); delete p.id;
    vote(f, p, 'A');
    assert.equal(state(p).coins, 100);
    assert.equal(f.writes, 0);
});
test('missing app transaction history blocks replay of old player sequence', () => {
    const f = fixture(), p = joined(f);
    f.writeFailure = 'before'; vote(f, p, 'A');
    const data = JSON.parse(p.storage); data.zepCoinRewards.voteSeq = 2;
    data.zepCoinRewards.pendingVote.seq = 2; p.storage = JSON.stringify(data);
    f.writeFailure = null; f.api.resumeVote(p);
    assert.equal(state(p).pendingVote.seq, 2);
    assert.equal(f.writes, 0);
});
