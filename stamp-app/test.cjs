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
    activeElement: { blur: () => { blurred++; } },
    getElementById(id) { return elements[id] ||= {}; },
    addEventListener(type, listener) { listeners[type] = listener; },
    documentElement: { addEventListener(type, listener) { rootListeners[type] = listener; } }
  };
  vm.runInNewContext(script, { document, window: { parent, addEventListener() {} } });
  elements.toggle.onclick();
  listeners.pointerup();
  rootListeners.mouseleave();
  listeners.keydown({ key: 'ArrowUp' });
  assert.equal(blurred, 4);
  assert.equal(focused, 4);
  assert.equal(sent.at(-1).type, 'toggle');
});
