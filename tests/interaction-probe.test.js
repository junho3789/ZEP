const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../tools/interaction-probe.js'), 'utf8');

function probe(lookup) {
    const handlers = {}, messages = [];
    const App = {};
    for (const name of ['onJoinPlayer', 'onTriggerObject', 'onObjectTouched']) {
        App[name] = { Add(fn) { handlers[name] = fn; } };
    }
    const player = { showCenterLabel(message) { messages.push(message); } };
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
        return {type: 21, param1: '1', param2: 'coin:10'};
    });
    p.handlers.onJoinPlayer(p.player);
    p.handlers.onTriggerObject(p.player, 3, 9, 7, 'example');
    assert.match(p.messages[0], /진단 앱 실행됨/);
    assert.match(p.messages[1], /"key":"example"/);
    assert.match(p.messages[1], /"param1":"1"/);
    assert.match(p.messages[1], /"param2":"coin:10"/);
});

test('lookup failure still displays raw F callback', () => {
    const p = probe(() => { throw Error('Missing object'); });
    p.handlers.onTriggerObject(p.player, 3, 9, 7, 'raw-value');
    assert.match(p.messages[0], /raw-value/);
    assert.match(p.messages[0], /조회 실패/);
});

test('touch probe filters non-script objects and displays script metadata', () => {
    const p = probe(() => null);
    p.handlers.onObjectTouched(p.player, 9, 7, 4, {type: 1});
    assert.equal(p.messages.length, 0);
    p.handlers.onObjectTouched(p.player, 9, 7, 4, {type: 21, param1: '1', param2: 'coin:10'});
    assert.match(p.messages[0], /접촉 이벤트/);
    assert.match(p.messages[0], /coin:10/);
});
