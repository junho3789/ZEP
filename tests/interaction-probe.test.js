const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../tools/interaction-probe.js'), 'utf8');

function probe(lookup) {
    const handlers = {}, messages = [];
    const App = {};
    for (const name of ['onJoinPlayer', 'onTriggerObject', 'onObjectTouched', 'onSay', 'onLeavePlayer']) {
        App[name] = { Add(fn) { handlers[name] = fn; } };
    }
    const player = {
        sendMessage(message) { messages.push(message); },
        showCenterLabel() { throw Error('Diagnostics must use private chat'); }
    };
    Object.defineProperty(player, 'storage', {
        get() { throw Error('Probe must not read storage'); },
        set() { throw Error('Probe must not write storage'); }
    });
    vm.runInNewContext(source, { App, Map: { getObjectWithKey: lookup } });
    return { handlers, player, messages };
}

test('probe displays F callback and raw metadata without accessing storage', () => {
    const p = probe(key => {
        assert.equal(key, 'example');
        return {type: 21, param1: 'coin:10', param2: null};
    });
    p.handlers.onJoinPlayer(p.player);
    p.handlers.onTriggerObject(p.player, 3, 9, 7, 'example');
    assert.match(p.messages[0], /진단 앱 실행됨/);
    assert.match(p.messages[1], /"key":"example"/);
    assert.match(p.messages[2], /"param1":"coin:10"/);
    assert.match(p.messages[2], /"param2":null/);
});

test('lookup failure still displays raw F callback', () => {
    const p = probe(() => { throw Error('Missing object'); });
    p.handlers.onTriggerObject(p.player, 3, 9, 7, 'raw-value');
    assert.match(p.messages[0], /raw-value/);
    assert.match(p.messages[1], /조회 실패/);
});

test('touch probe filters non-script objects and displays script metadata', () => {
    const p = probe(() => null);
    p.handlers.onObjectTouched(p.player, 9, 7, 4, {type: 1});
    assert.equal(p.messages.length, 0);
    p.handlers.onObjectTouched(p.player, 9, 7, 4, {type: 21, param1: 'coin:10', param2: null});
    assert.match(p.messages[0], /접촉 이벤트/);
    assert.match(p.messages[0], /coin:10/);
});

test('observed screenshot fields are retained and interpreted without inventing a number', () => {
    const p = probe(() => null);
    p.handlers.onObjectTouched(p.player, 26, 15, 291295958,
        {type: 21, param1: 'coin:10', param2: null, param3: null, param4: null});
    assert.match(p.messages[0], /"tileID":291295958/);
    assert.match(p.messages[0], /"text":"<undefined>"/);
    assert.match(p.messages[1], /param1에서 확인/);
    assert.match(p.messages[1], /번호는 아직 판별하지 않습니다/);
    p.handlers.onSay(p.player, '!diag');
    assert.match(p.messages[2], /접촉=1, F=0/);
});

test('repeated identical touches are counted but not spammed; F events remain visible', () => {
    const p = probe(() => null), object = {type: 21, param1: 'coin:10'};
    for (let i = 0; i < 10; i++) p.handlers.onObjectTouched(p.player, 26, 15, 4, object);
    assert.equal(p.messages.length, 2);
    p.handlers.onTriggerObject(p.player, 3, 26, 15, 'key');
    p.handlers.onTriggerObject(p.player, 3, 26, 15, 'key');
    assert.equal(p.messages.length, 6);
    p.handlers.onSay(p.player, '!diag');
    assert.match(p.messages[6], /접촉=10, F=2/);
});

test('raw callback arguments preserve missing key and extra arguments', () => {
    const p = probe(() => { throw Error('Should not look up missing key'); });
    p.handlers.onTriggerObject(p.player, 3, 26, 15, undefined, 'extra');
    assert.match(p.messages[0], /"args":\[3,26,15,"<undefined>","extra"\]/);
    assert.match(p.messages[1], /조회하지 않음/);
});

test('reset and leave clear session records without accessing storage', () => {
    const p = probe(() => null);
    p.handlers.onTriggerObject(p.player, 3, 26, 15, 'key');
    p.handlers.onSay(p.player, '!diag-reset');
    p.handlers.onSay(p.player, '!diag');
    assert.match(p.messages[3], /접촉=0, F=0/);
    p.handlers.onTriggerObject(p.player, 3, 26, 15, 'key');
    p.handlers.onLeavePlayer(p.player);
    p.handlers.onSay(p.player, '!diag');
    assert.match(p.messages.at(-3), /접촉=0, F=0/);
});
