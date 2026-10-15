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
  const messages = [], links = [], widgets = [];
  const player = {
    storage: JSON.stringify({ other: 42 }),
    save() {},
    sendMessage: text => messages.push(text),
    openWebLink: (...args) => links.push(args),
    showWidgetResponsive(...args) {
      const widget = {
        args, dead: false,
        destroy() { this.dead = true; return true; },
        sendMessage(state) { this.state = state; },
        onMessage: { Add(callback) { widget.receive = callback; } }
      };
      widgets.push(widget);
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
    context, events, player, messages, links, widgets, ready,
    advance(ms = 1201) { now += ms; },
    hit(number, value) {
      events.onObjectTouched(player, 0, 0, 0, { type: 21, text: number, param1: value });
    },
    collectAll() { for (let i = 1; i <= 4; i++) this.hit(200 + i, 'stamp:' + i); }
  };
}

 test('programs and eligible desk use the native ZEP popup API', () => {
  const app = createApp();
  app.hit(205, 'stamp:desk');
  assert.equal(app.links.length, 0);
  app.collectAll();
  app.hit(205, 'stamp:desk');
  assert.equal(app.links.length, 5);
  assert.ok(app.links.every(args => args[1] === true));
  assert.equal(app.links.at(-1)[0], 'https://forms.gle/test');
  assert.equal(app.widgets.at(-1).state.count, 4);
  assert.equal(JSON.parse(app.player.storage).other, 42);
});

test('repeated F at desk is throttled, but reopening later works', () => {
  const app = createApp();
  app.collectAll();
  app.hit(205, 'stamp:desk');
  for (let i = 0; i < 10; i++) app.hit(205, 'stamp:desk');
  assert.equal(app.links.length, 5);
  app.advance();
  app.hit(205, 'stamp:desk');
  assert.equal(app.links.length, 6);
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
  assert.equal(app.widgets.at(-1).args[3], 83);
  old.receive(app.player, { type: 'toggle' });
  assert.equal(app.widgets.length, 2);
});

test('failed widget destruction prevents additional overlapping HUDs', () => {
  const app = createApp();
  const old = app.widgets.at(-1);
  old.destroy = () => false;
  old.receive(app.player, { type: 'toggle' });
  assert.equal(app.widgets.length, 1);
  assert.ok(app.messages.at(-1).includes('재접속'));
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
  assert.equal(app.links.length, 5);
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
