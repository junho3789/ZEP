/* 같은 맵에서만 운영하세요. 맵별로 mapKey를 다르게 지정하세요. */
var CONFIG = {
  mapKey: 'booth-map-01',
  maxItems: 200,
  ui: { top: 10, right: 2, bottom: 22, left: 66, collapsedBottom: 76 },
  // 선택: 번호별 도착 위치를 지정하면 최초 상호작용 위치 대신 사용합니다.
  destinations: {} // 예: '101': { x: 12, y: 8 }
};
(function () {
  'use strict';
  var sessions = [];
  function record(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function position(v) { return record(v) && Number.isInteger(v.x) && Number.isInteger(v.y) && v.x >= 0 && v.y >= 0 && v.x < Map.width && v.y < Map.height; }
  function find(p) { return sessions.filter(function(s) { return s.player === p; })[0]; }
  function tell(p, t) { p.sendMessage('[위시리스트] ' + t); }
  function read(p) {
    var root = p.storage ? JSON.parse(p.storage) : {};
    if (!record(root) || (root.zepWishlist !== undefined && !record(root.zepWishlist))) throw Error('storage');
    var maps = root.zepWishlist || {};
    var data = maps[CONFIG.mapKey];
    if (data !== undefined && (!record(data) || data.version !== 1 || !Array.isArray(data.items) || data.items.length > CONFIG.maxItems || ['recent','number','name'].indexOf(data.sort) < 0)) throw Error('data');
    var seen = {};
    if (data) data.items.forEach(function(i) {
      if (!record(i) || typeof i.number !== 'string' || !/^\d{1,12}$/.test(i.number) || seen[i.number] || typeof i.name !== 'string' || !i.name.trim() || i.name.length > 100 || !Number.isInteger(i.x) || !Number.isInteger(i.y) || i.x < 0 || i.y < 0) throw Error('item');
      seen[i.number] = true;
    });
    return {root:root, maps:maps, data:data || {version:1, sort:'recent', items:[]}};
  }
  function save(p, progress) {
    var before = p.storage;
    progress.maps[CONFIG.mapKey] = progress.data;
    progress.root.zepWishlist = progress.maps;
    try { p.storage = JSON.stringify(progress.root); p.save(); }
    catch(e) { p.storage = before; throw e; }
  }
  function send(s, message) {
    if (!s || !s.widget || !s.ready) return;
    var payload = {type:'state', collapsed:s.collapsed, message:message || ''};
    try {
      var data = read(s.player).data;
      payload.items = data.items; payload.sort = data.sort;
    } catch(e) { payload.error = '기록을 읽지 못했습니다. 관리자에게 문의하세요.'; }
    try { s.widget.sendMessage(payload); } catch(e) {}
  }
  function destroy(s) {
    if (s.widget) {
      // ZEP 문서는 destroy()의 반환값을 성공 여부로 정의하지 않습니다.
      try { s.widget.destroy(); } catch(e) { return false; }
    }
    s.widget = null; s.ready = false; return true;
  }
  function show(s) {
    if (!destroy(s)) return false;
    var u = CONFIG.ui;
    var w = s.player.showWidgetResponsive('wishlist.html', u.top, u.right, s.collapsed ? u.collapsedBottom : u.bottom, u.left);
    s.widget = w;
    w.onMessage.Add(function(p, d) {
      if (p !== s.player || s.widget !== w || !record(d)) return;
      if (d.type === 'ready') { s.ready = true; send(s); return; }
      if (d.type === 'toggle') {
        s.collapsed = !s.collapsed;
        // 제거 API 실패 시에도 기존 위젯에서 접기/펼치기를 적용합니다.
        if (!show(s)) send(s);
        return;
      }
      try {
        var progress = read(p), data = progress.data;
        if (d.type === 'sort' && ['recent','number','name'].indexOf(d.sort) >= 0) {
          data.sort = d.sort; save(p, progress); send(s); return;
        }
        if (typeof d.number !== 'string') return;
        var item = data.items.filter(function(i) { return i.number === d.number; })[0];
        if (!item) return;
        if (d.type === 'delete') {
          data.items = data.items.filter(function(i) { return i.number !== d.number; });
          save(p, progress); send(s, item.name + ' 삭제됨');
        } else if (d.type === 'move') {
          if (s.lastMove && Date.now() - s.lastMove < 800) return;
          var destination = CONFIG.destinations[item.number] || item;
          if (!position(destination)) { send(s, '이동 위치를 확인해 주세요. 관리자에게 문의하세요.'); return; }
          p.spawnAt(destination.x, destination.y); s.lastMove = Date.now();
          send(s, item.name + ' 부스로 이동했습니다.');
        }
      } catch(e) { send(s, '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
    });
    return true;
  }
  App.onJoinPlayer.Add(function(p) {
    var s = find(p);
    if (!s) { s = {player:p, collapsed:false, ready:false, widget:null}; sessions.push(s); }
    try { if (!show(s)) send(s); } catch(e) { tell(p, '창을 열지 못했습니다. !wishlist로 다시 열어 주세요.'); }
  });
  App.onObjectTouched.Add(function(p, x, y, tileId, obj) {
    // 명시적인 접두어로 다른 앱의 Script 오브젝트와 구분합니다.
    if (!obj || obj.type !== 21 || typeof obj.param1 !== 'string' || !/^wishlist(?:$|:)/.test(obj.param1)) return;
    var number = String(obj.text), s = find(p);
    if (!s) return;
    var name = typeof obj.name === 'string' ? obj.name.trim() : '';
    if (!name) name = obj.param1.slice(9).trim();
    if (!/^\d{1,12}$/.test(number) || !name || name.length > 100) { tell(p, '하트의 번호와 부스 이름(값: wishlist:부스 이름)을 확인해 주세요.'); return; }
    try {
      var progress = read(p), items = progress.data.items;
      var existing = items.filter(function(i) { return i.number === number; })[0];
      var target = CONFIG.destinations[number] || {x:p.tileX, y:p.tileY};
      if (!position(target)) throw Error('position');
      if (!existing && items.length >= CONFIG.maxItems) { tell(p, '최대 ' + CONFIG.maxItems + '개까지 저장할 수 있습니다.'); return; }
      if (existing) { existing.name = name; existing.x = target.x; existing.y = target.y; }
      else items.push({number:number, name:name, x:target.x, y:target.y});
      save(p, progress);
      var message = name + (existing ? ' · 이미 저장된 부스입니다.' : ' · 위시리스트에 추가했습니다.');
      tell(p, message); send(s, message);
    } catch(e) { tell(p, '저장하지 못했습니다. 기록과 설정을 확인해 주세요.'); }
  });
  App.onSay.Add(function(p, text) { if (text === '!wishlist') { var s = find(p); if (s) { try { s.collapsed = false; if (!show(s)) send(s); } catch(e) { tell(p, '창을 열지 못했습니다.'); } } } });
  App.onLeavePlayer.Add(function(p) { sessions = sessions.filter(function(s) { if(s.player !== p) return true; destroy(s); return false; }); });
  App.onDestroy.Add(function() { sessions.forEach(destroy); sessions = []; });
}());
