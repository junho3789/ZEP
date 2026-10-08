const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
test('monitor renders totals, percentages, loading/error and refresh/close without accepting foreign messages', () => {
    const html = fs.readFileSync(path.join(__dirname, '../vote-monitor.html'), 'utf8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    const nodes = {}, posted = [], documentHandlers = {};
    for (const id of html.matchAll(/id="([^"]+)"/g)) {
        nodes[id[1]] = {textContent:'—', style:{}, disabled:false, className:'', handlers:{},
            addEventListener(type, fn) {this.handlers[type] = fn;}, focus() {this.focused = true;}};
    }
    const parent = {postMessage(data) {posted.push(data);}};
    let receive;
    vm.runInNewContext(script, {
        window: {parent, addEventListener(type, fn) {receive = fn;}},
        document: {getElementById(id) {return nodes[id];}, addEventListener(type, fn) {documentHandlers[type] = fn;}}
    });
    assert.equal(posted[0].type, 'vote_monitor_ready');
    assert.equal(nodes.close.focused, true);
    const data = {type:'vote_totals', status:'ok', boxCount:2,
        boxes:{A:{coins:30,votes:3},B:{coins:10,votes:1}},totalCoins:40,totalVotes:4};
    receive({source:{},data});
    assert.equal(nodes.total.textContent, '—');
    receive({source:parent,data});
    assert.equal(nodes.total.textContent, '40');
    assert.equal(nodes['a-share'].textContent, '75.0%');
    assert.equal(nodes['b-bar'].style.width, '25%');
    nodes.refresh.handlers.click();
    assert.equal(posted.at(-1).type, 'vote_monitor_refresh');
    assert.equal(nodes.refresh.disabled, true);
    const count = posted.length;
    nodes.refresh.handlers.click();
    assert.equal(posted.length, count);
    receive({source:parent,data:{type:'vote_totals',status:'storage_error'}});
    assert.equal(nodes.total.textContent, '—');
    assert.equal(nodes.status.className, 'error');
    assert.equal(nodes.refresh.disabled, false);
    receive({source:parent,data:{...data, boxes:{A:{coins:0,votes:0},B:{coins:0,votes:0}},totalCoins:0,totalVotes:0}});
    assert.equal(nodes.total.textContent, '0');
    assert.equal(nodes['a-share'].textContent, '0.0%');
    receive({source:parent,data:{...data,totalCoins:999}});
    assert.equal(nodes.total.textContent, '—');
    nodes.close.handlers.click();
    assert.equal(posted.at(-1).type, 'vote_monitor_close');
    documentHandlers.keydown({key:'Escape'});
    assert.equal(posted.at(-1).type, 'vote_monitor_close');
});
