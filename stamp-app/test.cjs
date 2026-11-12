const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const source = fs.readFileSync(__dirname + '/main.js', 'utf8');

function createApp() {
  const events = {};
  const App = {};
  let now = 10000;
  for (const name of ['onJoinPlayer', 'onLeavePlayer', 'onObjectTouched', 'onSay', 'onDestroy']) {
    App[name] = { Add: callback => { events[name] = callback; } };
  }
  const context = { App, Date: { now: () => now } };
  vm.createContext(context);
  vm.runInContext(source, context);
  context.CONFIG.objects.forEach(object => { object.url = 'https://example.com/' + object.id; });
  context.CONFIG.formUrl = 'https://forms.gle/test';
  const messages = [], links = [], widgets = [], cardWidgets = [], noticeWidgets = [], alerts = [];
  const player = {
    storage: JSON.stringify({ other: 42 }),
    save() {},
    showAlert(text) { alerts.push(text); },
    sendMessage: text => messages.push(text),
    openWebLink: (...args) => links.push(args),
    showWidget(...args) { return this.showWidgetResponsive(...args); },
    showWidgetResponsive(...args) {
      const widget = {
        args, dead: false,
        destroy() { this.dead = true; return true; },
        sendMessage(state) { this.state = state; },
        onMessage: { Add(callback) { widget.receive = callback; } }
      };
      if (args[0] === 'stamp-special.html') cardWidgets.push(widget);
      else if (args[0] === 'stamp-entry.html') noticeWidgets.push(widget);
      else widgets.push(widget);
      return widget;
    }
  };
  Object.defineProperty(player, 'moveSpeed', {
    set() { throw Error('Movement speed must not be modified'); }
  });
  function ready() { widgets.at(-1).receive(player, { type: 'ready' }); }
  events.onJoinPlayer(player);
  ready();
  return {
    context, events, player, messages, links, widgets, cardWidgets, noticeWidgets, alerts, ready,
    advance(ms = 1201) { now += ms; },
    hit(number, value) {
      events.onObjectTouched(player, 0, 0, 0, { type: 21, text: number, param1: value });
    },
    collectAll() {
      for (let i = 1; i <= 4; i++) this.hit(200 + i, 'stamp:' + i);
      const link = cardWidgets.at(-1);
      if (link && !link.dead) {
        link.receive(player, {type:'card_ready'});
        link.receive(player, {type:'card_close'});
      }
    }
  };
}

 test('stamp one and two use new windows while stamp three and form use popups', () => {
  const app = createApp();
  app.hit(205, 'stamp:desk');
  assert.equal(app.links.length, 0);
  app.collectAll();
  app.hit(205, 'stamp:desk');
  assert.equal(app.links.length, 4);
  assert.deepEqual(app.links.map(args=>args[1]),[false,false,true,true]);
  assert.equal(app.links.at(-1)[0], 'https://forms.gle/test');
  assert.equal(app.widgets.at(-1).state.count, 4);
  assert.equal(JSON.parse(app.player.storage).other, 42);
});

test('repeated F at desk is throttled, but reopening later works', () => {
  const app = createApp();
  app.collectAll();
  app.hit(205, 'stamp:desk');
  for (let i = 0; i < 10; i++) app.hit(205, 'stamp:desk');
  assert.equal(app.links.length, 4);
  app.advance();
  app.hit(205, 'stamp:desk');
  assert.equal(app.links.length, 5);
});

test('revisiting a program reopens popup without a duplicate stamp', () => {
  const app = createApp();
  app.hit(201, 'stamp:1');
  app.advance();
  app.hit(201, 'stamp:1');
  assert.equal(app.links.length, 2);
  assert.equal(JSON.parse(app.player.storage).zepStampEvents['stamp-event-01'].ids.length, 1);
});

test('rejoin preserves progress and duplicate join does not leak a HUD', () => {
  const app = createApp();
  app.collectAll();
  app.events.onJoinPlayer(app.player);
  assert.equal(app.widgets.filter(widget => !widget.dead).length, 1);
  app.events.onLeavePlayer(app.player);
  assert.ok(app.widgets.every(widget => widget.dead));
  app.events.onJoinPlayer(app.player);
  app.ready();
  assert.equal(app.widgets.at(-1).state.count, 4);
});

test('collapse removes old HUD and ignores messages from stale widget', () => {
  const app = createApp();
  const old = app.widgets.at(-1);
  old.receive(app.player, { type: 'toggle' });
  app.ready();
  assert.equal(old.dead, true);
  assert.equal(app.widgets.at(-1).state.collapsed, true);
  assert.deepEqual(app.widgets.at(-1).args, ['stamp-mini.html', 'topleft', 76, 76]);
  old.receive(app.player, { type: 'toggle' });
  assert.equal(app.widgets.length, 2);
});

test('failed widget destruction prevents additional overlapping HUDs', () => {
  const app = createApp();
  const old = app.widgets.at(-1);
  old.destroy = () => { throw Error('destroy exception'); };
  old.receive(app.player, { type: 'toggle' });
  assert.equal(app.widgets.length, 1);
  assert.ok(app.messages.at(-1).includes('다시 눌러'));
});

test('recovery command hides HUD without changing progress, then restores it', () => {
  const app = createApp();
  app.hit(201, 'stamp:1');
  const stored = app.player.storage;
  const old = app.widgets.at(-1);
  app.events.onSay(app.player, '!stamp-ui-hide');
  assert.equal(old.dead, true);
  assert.equal(app.player.storage, stored);
  old.receive(app.player, { type: 'toggle' });
  assert.equal(app.widgets.length, 1);
  app.events.onSay(app.player, '!stamps');
  app.ready();
  assert.equal(app.widgets.at(-1).state.count, 1);
});

test('empty URL and wrong object value do not grant stamps', () => {
  const app = createApp();
  app.context.CONFIG.objects[0].url = '';
  app.hit(201, 'stamp:1');
  app.hit(202, 'wrong');
  assert.equal(app.links.length, 0);
  assert.equal(JSON.parse(app.player.storage).zepStampEvents, undefined);
});

test('popup exception leaves interaction unlocked for a subsequent attempt', () => {
  const app = createApp();
  app.collectAll();
  const open = app.player.openWebLink;
  app.player.openWebLink = () => { throw Error('popup failed'); };
  app.hit(205, 'stamp:desk');
  app.player.openWebLink = open;
  app.hit(205, 'stamp:desk');
  assert.equal(app.links.length, 4);
});

test('save failure restores old storage and allows retry after cooldown', () => {
  const app = createApp();
  const before = app.player.storage;
  app.player.save = () => { throw Error('offline'); };
  app.hit(201, 'stamp:1');
  assert.equal(app.player.storage, before);
  app.player.save = () => {};
  app.advance();
  app.hit(201, 'stamp:1');
  assert.equal(app.widgets.at(-1).state.count, 1);
});

test('corrupt storage remains untouched', () => {
  const app = createApp();
  app.player.storage = 'corrupt';
  app.hit(201, 'stamp:1');
  assert.equal(app.player.storage, 'corrupt');
  assert.equal(app.links.length, 0);
});

test('required count remains configurable and disabled stamps are excluded', () => {
  const app = createApp();
  app.context.CONFIG.requiredStamps = 2;
  app.context.CONFIG.objects[3].enabled = false;
  app.hit(204, 'stamp:4');
  assert.equal(app.links.length, 0);
  app.hit(201, 'stamp:1');
  app.hit(202, 'stamp:2');
  app.hit(205, 'stamp:desk');
  assert.equal(app.links.at(-1)[0], 'https://forms.gle/test');
});

test('app shutdown destroys HUDs', () => {
  const app = createApp();
  app.events.onDestroy();
  assert.ok(app.widgets.every(widget => widget.dead));
});

test('HUD returns keyboard focus after click, pointer release, leaving, and arrow keys', () => {
  const html = fs.readFileSync(__dirname + '/stamp-ui.html', 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const listeners = {}, rootListeners = {};
  const elements = {};
  let blurred = 0, focused = 0;
  const sent = [];
  const parent = { postMessage: message => sent.push(message), focus: () => { focused++; } };
  const document = {
    querySelector() { return {}; },
    activeElement: { blur: () => { blurred++; } },
    getElementById(id) { return elements[id] ||= {}; },
    addEventListener(type, listener) { listeners[type] = listener; },
    documentElement: { addEventListener(type, listener) { rootListeners[type] = listener; } }
  };
  vm.runInNewContext(script, { document, window: { parent, addEventListener() {}, requestAnimationFrame() {} } });
  elements.toggle.onclick();
  listeners.pointerup();
  rootListeners.mouseleave();
  listeners.keydown({ key: 'ArrowUp' });
  assert.equal(blurred, 4);
  assert.equal(focused, 4);
  assert.equal(sent.at(-1).type, 'toggle');
});

function say(app, text, player = app.player) {
  app.events.onSay(player, text);
}

function joinTarget(app, id, name = '참가자') {
  const target = {
    ...app.player, id, name, role: 0,
    storage: JSON.stringify({ other: 77 }),
    save() {}, sendMessage() {}
  };
  app.events.onJoinPlayer(target);
  app.widgets.at(-1).receive(target, { type: 'ready' });
  return target;
}

function savedIds(player, eventId = 'stamp-event-01') {
  return JSON.parse(player.storage).zepStampEvents?.[eventId]?.ids;
}

test('admin reset requires confirmation, refreshes UI, and allows immediate recollection', () => {
  const app = createApp();
  app.player.role = 3000;
  app.collectAll();
  say(app, '!stamp-reset me');
  assert.equal(savedIds(app.player).length, 4);
  say(app, '!stamp-reset confirm');
  assert.deepEqual(savedIds(app.player), []);
  assert.equal(app.widgets.at(-1).state.count, 0);
  assert.equal(JSON.parse(app.player.storage).other, 42);
  app.hit(204, 'stamp:4');
  assert.equal(savedIds(app.player).length, 1);
  say(app, '!stamp-reset confirm');
  assert.equal(savedIds(app.player).length, 1);
});

test('guests, staff, editors, and unknown roles cannot reset or list players', () => {
  for (const role of [-1, 0, 1000, 2000, undefined, '3000']) {
    const app = createApp();
    app.player.role = role;
    app.collectAll();
    const before = app.player.storage;
    say(app, '!stamp-reset all');
    say(app, '!stamp-reset confirm');
    say(app, '!stamp-players');
    assert.equal(app.player.storage, before);
    assert.ok(app.messages.at(-1).includes('관리자'));
  }
});

test('owner is allowed, but confirmation after losing permission is denied', () => {
  const app = createApp();
  app.player.role = 3001;
  app.collectAll();
  say(app, '!stamp-reset me');
  app.player.role = 2000;
  say(app, '!stamp-reset confirm');
  assert.equal(savedIds(app.player).length, 4);
  app.player.role = 3001;
  say(app, '!stamp-reset confirm');
  assert.equal(savedIds(app.player).length, 4);
  say(app, '!stamp-reset me');
  say(app, '!stamp-reset confirm');
  assert.equal(savedIds(app.player).length, 0);
});

test('expired, cancelled, and malformed requests never reset progress', () => {
  const app = createApp();
  app.player.role = 3000;
  app.collectAll();
  say(app, '!stamp-reset me');
  app.advance(30000);
  say(app, '!stamp-reset confirm');
  assert.equal(savedIds(app.player).length, 4);
  say(app, '!stamp-reset me');
  say(app, '!stamp-reset cancel');
  say(app, '!stamp-reset confirm');
  assert.equal(savedIds(app.player).length, 4);
  say(app, '!stamp-reset me');
  say(app, '!stamp-reset all extra');
  say(app, '!stamp-reset confirm');
  assert.equal(savedIds(app.player).length, 4);
});

test('ID targets are exact and other event records are preserved', () => {
  const app = createApp();
  app.player.id = 'admin';
  app.player.role = 3000;
  app.collectAll();
  const target = joinTarget(app, '123');
  target.storage = JSON.stringify({
    other: 77,
    zepStampEvents: {
      'stamp-event-01': { version: 1, ids: ['s1', 's2'] },
      previous: { version: 1, ids: ['old'] }
    }
  });
  say(app, '!stamp-reset id 12');
  say(app, '!stamp-reset confirm');
  assert.equal(savedIds(target).length, 2);
  say(app, '!stamp-reset id 123');
  say(app, '!stamp-reset confirm');
  assert.deepEqual(savedIds(target), []);
  assert.deepEqual(savedIds(target, 'previous'), ['old']);
  assert.equal(JSON.parse(target.storage).other, 77);
  assert.equal(savedIds(app.player).length, 4);
});

test('all applies to a snapshot of current sessions and skips departed players', () => {
  const app = createApp();
  app.player.role = 3000;
  app.collectAll();
  const leaving = joinTarget(app, 'leaving');
  const stored = JSON.stringify({ zepStampEvents: { 'stamp-event-01': { version: 1, ids: ['s1'] } } });
  leaving.storage = stored;
  say(app, '!stamp-reset all');
  app.events.onLeavePlayer(leaving);
  const newcomer = joinTarget(app, 'newcomer');
  newcomer.storage = stored;
  say(app, '!stamp-reset confirm');
  assert.deepEqual(savedIds(app.player), []);
  assert.equal(leaving.storage, stored);
  assert.equal(newcomer.storage, stored);
  assert.ok(app.messages.at(-1).includes('처리 1명, 실패/퇴장 1명'));
});

test('save failures report partial results and restore failed player storage', () => {
  const app = createApp();
  app.player.role = 3000;
  app.collectAll();
  const failing = joinTarget(app, 'failing');
  failing.storage = JSON.stringify({ zepStampEvents: { 'stamp-event-01': { version: 1, ids: ['s1'] } } });
  const before = failing.storage;
  failing.save = () => { throw Error('offline'); };
  say(app, '!stamp-reset all');
  say(app, '!stamp-reset confirm');
  assert.deepEqual(savedIds(app.player), []);
  assert.equal(failing.storage, before);
  assert.ok(app.messages.at(-1).includes('처리 1명, 실패/퇴장 1명'));
});

test('mini icon keeps progress and expands without changing stored stamps', () => {
  const app = createApp();
  app.hit(201, 'stamp:1');
  app.widgets.at(-1).receive(app.player, {type:'toggle'});
  app.ready();
  const mini = app.widgets.at(-1);
  assert.equal(mini.args[0], 'stamp-mini.html');
  assert.equal(mini.state.count, 1);
  app.hit(202, 'stamp:2');
  assert.equal(mini.state.count, 2);
  const saved = app.player.storage;
  mini.receive(app.player, {type:'toggle'});
  app.ready();
  assert.equal(app.widgets.at(-1).args[0], 'stamp-ui.html');
  assert.equal(app.widgets.at(-1).state.count, 2);
  assert.equal(app.player.storage, saved);
});
test('chat command expands the mini icon', () => {
  const app = createApp();
  app.widgets.at(-1).receive(app.player, {type:'toggle'});
  app.ready();
  app.events.onSay(app.player, '!stamps');
  app.ready();
  assert.equal(app.widgets.at(-1).state.collapsed, false);
  assert.equal(app.widgets.at(-1).args[0], 'stamp-ui.html');
});

test('mini icon click reopens window and progress stays in accessible label only', () => {
  const html = fs.readFileSync(__dirname + '/stamp-mini.html', 'utf8');
  const script = html.split('<script>')[1].split('</script>')[0];
  const sent = [];
  let listener, blurred = 0, focused = 0;
  const attributes = {};
  const launcher = {
    blur(){ blurred++; },
    classList:{ toggle(name,enabled){ attributes[name]=enabled; } },
    setAttribute(name,value){ attributes[name]=value; }
  };
  const parent = { postMessage(data){sent.push(data);}, focus(){focused++;} };
  const document = {getElementById(){return launcher;}};
  vm.runInNewContext(script,{document,window:{parent,addEventListener(type,fn){listener=fn;}}});
  listener({source:parent,data:{type:'state',count:2,required:4}});
  assert.ok(attributes['aria-label'].includes('2/4'));
  launcher.onclick();
  assert.equal(sent.at(-1).type,'toggle');
  assert.equal(blurred,1);
  assert.equal(focused,1);
  listener({source:parent,data:{type:'state',count:4,required:4}});
  assert.equal(attributes.complete,true);
});

test('false destroy return still switches to mini icon and back without losing stamps', () => {
  const app = createApp();
  app.collectAll();
  const stored = app.player.storage;
  for (let i = 0; i < 8; i++) {
    const old = app.widgets.at(-1);
    old.destroy = function(){ this.dead = true; return false; };
    old.receive(app.player,{type:'toggle'});
    app.ready();
    const current = app.widgets.at(-1);
    assert.equal(old.dead,true);
    assert.equal(current.args[0],i % 2 === 0 ? 'stamp-mini.html' : 'stamp-ui.html');
    assert.equal(current.state.count,4);
    assert.equal(app.widgets.filter(widget=>!widget.dead).length,1);
    old.receive(app.player,{type:'toggle'});
    assert.equal(app.widgets.at(-1),current);
  }
  assert.equal(app.player.storage,stored);
  assert.ok(!app.messages.some(message=>message.includes('UI를 정리하지 못했습니다')));
});
test('destroy exception preserves expanded state and the next click can retry', () => {
  const app = createApp();
  const old = app.widgets.at(-1);
  const destroy = old.destroy;
  old.destroy=()=>{throw Error('temporary');};
  old.receive(app.player,{type:'toggle'});
  assert.equal(old.state.collapsed,false);
  assert.equal(app.widgets.length,1);
  old.destroy=destroy;
  old.receive(app.player,{type:'toggle'});
  app.ready();
  assert.equal(app.widgets.at(-1).args[0],'stamp-mini.html');
  assert.equal(app.widgets.at(-1).state.collapsed,true);
});

test('expanded stamps and mini icon embed the same PNG instead of relative file URLs', () => {
  const full = fs.readFileSync(__dirname + '/stamp-ui.html', 'utf8');
  const mini = fs.readFileSync(__dirname + '/stamp-mini.html', 'utf8');
  const prefix = 'data:image/png;base64,';
  assert.ok(full.includes(prefix) && mini.includes(prefix));
  const fullImage = full.split('<script>')[1].split(prefix).at(-1).split(String.fromCharCode(39))[0];
  const miniImage = mini.split(prefix)[1].split(String.fromCharCode(34))[0];
  assert.ok(fullImage.startsWith('iVBORw0KGgo'));
  assert.ok(fullImage.length > 10000);
  assert.equal(fullImage,miniImage);
  assert.ok(!full.includes('newton-stamp.png'));
  assert.ok(!mini.includes('newton-stamp.png'));
});


test('fourth stamp embeds the uploaded PNG byte-for-byte', () => {
  const html = fs.readFileSync(__dirname + '/stamp-ui.html', 'utf8');
  const assignment = html.split("image.src = index === 3 ? '")[1];
  assert.ok(assignment);
  const uri = assignment.split("'")[0];
  const original = fs.readFileSync(__dirname + '/stamp-four.png');
  assert.deepEqual(Buffer.from(uri.split(',')[1], 'base64'), original);
});


test('fourth stamp shows a card and never shows a separate found alert', () => {
  const app = createApp();
  app.hit(204,'stamp:4');
  assert.equal(app.links.length,0);
  assert.equal(app.alerts.length,0);
  const link=app.cardWidgets.at(-1);
  link.receive(app.player,{type:'card_ready'});
  assert.equal(link.state.heading,'뉴턴을 찾았습니다.');
  assert.equal(link.state.url,undefined);
  assert.equal(app.widgets.at(-1).state.count,1);
  link.receive(app.player,{type:'card_close'});
  assert.equal(link.dead,true);
  assert.deepEqual(app.alerts,[]);
  link.receive(app.player,{type:'card_close'});
  assert.equal(app.alerts.length,0);
});

test('foreign or stale popup messages cannot show a found alert', () => {
  const app=createApp();
  app.hit(204,'stamp:4');
  const link=app.cardWidgets.at(-1);
  link.receive({}, {type:'card_ready'});
  link.receive({}, {type:'card_close'});
  assert.equal(app.alerts.length,0);
  assert.equal(link.dead,false);
  link.receive(app.player,{type:'card_ready'});
  app.events.onLeavePlayer(app.player);
  link.receive(app.player,{type:'card_close'});
  assert.equal(link.dead,true);
  assert.equal(app.alerts.length,0);
});

test('save failure and administrator reset do not display found after close', () => {
  const app=createApp();
  app.player.save=()=>{throw Error('save failed');};
  app.hit(204,'stamp:4');
  let link=app.cardWidgets.at(-1);
  link.receive(app.player,{type:'card_ready'});
  link.receive(app.player,{type:'card_close'});
  assert.equal(app.alerts.length,0);
  app.player.save=()=>{};
  app.advance();
  app.hit(204,'stamp:4');
  link=app.cardWidgets.at(-1);
  link.receive(app.player,{type:'card_ready'});
  app.player.role=3000;
  say(app,'!stamp-reset me');
  say(app,'!stamp-reset confirm');
  link.receive(app.player,{type:'card_close'});
  assert.equal(link.dead,true);
  assert.equal(app.alerts.length,0);
});

test('repeated fourth-object interaction does not stack link windows or stamps', () => {
  const app=createApp();
  app.hit(204,'stamp:4');
  app.advance();
  app.hit(204,'stamp:4');
  assert.equal(app.cardWidgets.length,1);
  assert.equal(savedIds(app.player).length,1);
  const link=app.cardWidgets[0];
  link.receive(app.player,{type:'card_ready'});
  link.receive(app.player,{type:'card_close'});
  app.advance();
  app.hit(204,'stamp:4');
  const second=app.cardWidgets[1];
  second.receive(app.player,{type:'card_ready'});
  second.receive(app.player,{type:'card_close'});
  assert.equal(savedIds(app.player).length,1);
  assert.equal(app.alerts.length,0);
});

test('failed popup destruction allows retry without prematurely announcing found', () => {
  const app=createApp();
  app.hit(204,'stamp:4');
  const link=app.cardWidgets[0];
  link.receive(app.player,{type:'card_ready'});
  link.destroy=()=>{throw Error('temporary');};
  link.receive(app.player,{type:'card_close'});
  assert.equal(app.alerts.length,0);
  link.destroy=function(){this.dead=true;return false;};
  link.receive(app.player,{type:'card_close'});
  assert.equal(app.alerts.length,0);
});


test('fourth stamp needs no URL and only the other programs require links', () => {
  const app=createApp();
  app.context.CONFIG.objects.forEach(object=>{object.url='';});
  app.hit(201,'stamp:1');
  assert.equal(app.widgets.at(-1).state.count,0);
  app.hit(204,'stamp:4');
  assert.deepEqual(savedIds(app.player),['s4']);
  const card=app.cardWidgets[0];
  card.receive(app.player,{type:'card_ready'});
  assert.equal(card.state.type,'card_state');
  assert.equal(card.state.heading,'뉴턴을 찾았습니다.');
  assert.equal(app.links.length,0);
  card.receive(app.player,{type:'card_close'});
  assert.equal(app.alerts.length,0);
});

test('failed card creation does not grant a stamp', () => {
  const app=createApp();
  app.player.showWidgetResponsive=()=>{throw Error('create failed');};
  app.hit(204,'stamp:4');
  assert.equal(savedIds(app.player),undefined);
  assert.equal(app.cardWidgets.length,0);
});

test('a failed stamp save immediately removes the card without a discovery state', () => {
  const app=createApp();
  app.player.save=()=>{throw Error('save failed');};
  app.hit(204,'stamp:4');
  const card=app.cardWidgets[0];
  assert.equal(card.dead,true);
  card.receive(app.player,{type:'card_ready'});
  assert.equal(card.state,undefined);
  assert.equal(savedIds(app.player),undefined);
  assert.equal(app.alerts.length,0);
});

test('card data delivery failure cleans the overlay without altering saved stamps', () => {
  const app=createApp();
  app.hit(204,'stamp:4');
  const card=app.cardWidgets[0];
  card.sendMessage=()=>{throw Error('send failed');};
  card.receive(app.player,{type:'card_ready'});
  assert.equal(card.dead,true);
  assert.deepEqual(savedIds(app.player),['s4']);
  assert.equal(app.alerts.length,0);
});

test('special card embeds the new Newton study illustration without a web iframe', () => {
  const html=fs.readFileSync(__dirname+'/stamp-special.html','utf8');
  const image=html.split('id="character" src="')[1].split('"')[0];
  assert.deepEqual(Buffer.from(image.split(',')[1],'base64'),fs.readFileSync(__dirname+'/newton-study.png'));
  assert.ok(!html.includes('<iframe'));
});


test('insufficient stamps at desk show a designed popup instead of shortage chat', () => {
  const app=createApp();
  app.hit(201,'stamp:1');
  const before=app.messages.length;
  app.hit(205,'stamp:desk');
  assert.equal(app.messages.length,before);
  assert.equal(app.links.length,1);
  const notice=app.noticeWidgets[0];
  assert.equal(notice.args[0],'stamp-entry.html');
  notice.receive(app.player,{type:'entry_ready'});
  assert.equal(notice.state.count,1);
  assert.equal(notice.state.required,4);
  assert.equal(notice.state.missing,3);
  notice.receive(app.player,{type:'entry_close'});
  assert.equal(notice.dead,true);
  assert.equal(app.alerts.length,0);
});

test('repeated desk entry reuses notice and rejects foreign or stale messages', () => {
  const app=createApp();
  app.hit(205,'stamp:desk');
  const notice=app.noticeWidgets[0];
  app.hit(205,'stamp:desk');
  assert.equal(app.noticeWidgets.length,1);
  notice.receive({}, {type:'entry_close'});
  assert.equal(notice.dead,false);
  notice.receive(app.player,{type:'entry_ready'});
  notice.receive(app.player,{type:'entry_close'});
  app.hit(205,'stamp:desk');
  const next=app.noticeWidgets[1];
  notice.receive(app.player,{type:'entry_close'});
  assert.equal(next.dead,false);
});

test('eligible desk closes previous notice and opens the form', () => {
  const app=createApp();
  app.hit(205,'stamp:desk');
  const notice=app.noticeWidgets[0];
  app.collectAll();
  app.hit(205,'stamp:desk');
  assert.equal(notice.dead,true);
  assert.equal(app.links.at(-1)[0],'https://forms.gle/test');
});

test('notice handles configurable requirements and zero collected stamps', () => {
  const app=createApp();
  app.context.CONFIG.requiredStamps=3;
  app.hit(205,'stamp:desk');
  const notice=app.noticeWidgets[0];
  notice.receive(app.player,{type:'entry_ready'});
  assert.equal(notice.state.count,0);
  assert.equal(notice.state.required,3);
  assert.equal(notice.state.missing,3);
});

test('notice is destroyed on leave and reset without modifying unrelated storage', () => {
  const app=createApp();
  app.hit(205,'stamp:desk');
  const first=app.noticeWidgets[0];
  app.player.role=3000;
  say(app,'!stamp-reset me');
  say(app,'!stamp-reset confirm');
  assert.equal(first.dead,true);
  assert.equal(JSON.parse(app.player.storage).other,42);
  app.hit(205,'stamp:desk');
  const second=app.noticeWidgets[1];
  app.events.onLeavePlayer(app.player);
  assert.equal(second.dead,true);
});


test('new-window mode preserves duplicate prevention and existing custom stamp IDs', () => {
  const app=createApp();
  app.context.CONFIG.objects[0].id='custom-first';
  app.context.CONFIG.objects[1].id='custom-second';
  app.hit(201,'stamp:1');
  app.hit(202,'stamp:2');
  app.advance();
  app.hit(201,'stamp:1');
  assert.deepEqual(app.links.map(args=>args[1]),[false,false,false]);
  assert.equal(savedIds(app.player).length,2);
});
