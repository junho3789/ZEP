/* 노멀 앱: 동일 스페이스 모든 맵에 적용. 사이드바 앱: 스페이스에 적용. */
var CONFIG = {
  maxItems: 200,
  // 원격 맵의 이름을 미리 지정할 때 사용. 예: 'mapHashID': '제2전시장'
  mapNames: {},
  // 이전 단일 맵 기록의 키. 원래 맵 ID를 아는 경우 legacyMapId를 입력하면 이동도 유지됩니다.
  legacyMapKey: 'booth-map-01',
  legacyMapId: '',
  ui: { top: 10, right: 2, bottom: 22, left: 66 },
  minimized: { top: 90.5, right: 77, bottom: 0.8, left: 18.7 },
  transferTimeoutMs: 120000,
  // 현재 맵의 번호별 고정 목적지. 미설정이면 등록 당시 플레이어 위치를 저장합니다.
  // 예: '101': { mapId: '목적지맵ID', x: 12, y: 8 }
  // 또는 '102': { mapId: '목적지맵ID', location: 'booth-102' }
  destinations: {}
};
(function () {
  'use strict';
  var sessions = [];
  function record(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function hash(v) { return typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v); }
  function coordinates(v) { return record(v) && Number.isInteger(v.x) && Number.isInteger(v.y) && v.x >= 0 && v.y >= 0; }
  function target(v) { return record(v) && hash(v.mapId) && (v.location !== undefined ? typeof v.location === 'string' && v.location.trim().length > 0 && v.location.length <= 100 : coordinates(v)); }
  function position(v) { return coordinates(v) && v.x < Map.width && v.y < Map.height; }
  function currentMap() { if (!hash(App.mapHashID) || !hash(App.spaceHashID)) throw Error('map identity'); return App.mapHashID; }
  function validName(v) { return typeof v === 'string' && v.trim().length > 0 && v.length <= 100; }
  function mapName(mapId, stored) {
    var configured = CONFIG.mapNames[mapId];
    if (validName(configured)) return configured.trim();
    if (mapId === App.mapHashID && validName(Map.name)) return Map.name.trim();
    return validName(stored) ? stored.trim() : '';
  }
  function refreshMapNames(p) {
    var progress = read(p), name = mapName(App.mapHashID), changed = false;
    if (!name) return;
    progress.data.items.forEach(function(i) {
      if (i.mapId === App.mapHashID && i.mapName !== name) { i.mapName = name; changed = true; }
    });
    if (changed) save(p, progress);
  }
  function find(p) { return sessions.filter(function(s) { return s.player === p; })[0]; }
  function tell(p, t) { p.sendMessage('[위시리스트] ' + t); }
  function read(p) {
    currentMap();
    var root = p.storage ? JSON.parse(p.storage) : {};
    if (!record(root)) throw Error('storage');
    var data = root.zepWishlistShared;
    if (data === undefined) {
      data = {version:2, spaceId:App.spaceHashID, sort:'recent', items:[]};
      // 이전 데이터는 백업으로 남기며, 원래 맵이 불명확하면 이동을 차단합니다.
      if (root.zepWishlist !== undefined && !record(root.zepWishlist)) throw Error('legacy storage');
      var old = root.zepWishlist && root.zepWishlist[CONFIG.legacyMapKey];
      if (old !== undefined) {
        if (!record(old) || old.version !== 1 || !Array.isArray(old.items) || old.items.length > CONFIG.maxItems || ['recent','number','name'].indexOf(old.sort) < 0) throw Error('legacy data');
        data.sort = old.sort;
        data.items = old.items.map(function(i) {
          if (!record(i) || typeof i.number !== 'string' || !/^\d{1,12}$/.test(i.number) || typeof i.name !== 'string' || !i.name.trim() || i.name.length > 100 || !coordinates(i)) throw Error('legacy item');
          var mapId = hash(CONFIG.legacyMapId) ? CONFIG.legacyMapId : '';
          return {id:(mapId || 'legacy') + ':' + i.number, number:i.number, name:i.name, mapId:mapId, x:i.x, y:i.y};
        });
      }
    }
    if (!record(data) || data.version !== 2 || data.spaceId !== App.spaceHashID || !Array.isArray(data.items) || data.items.length > CONFIG.maxItems || ['recent','number','name'].indexOf(data.sort) < 0) throw Error('data');
    var seen = {};
    data.items.forEach(function(i) {
      if (!record(i) || typeof i.number !== 'string' || !/^\d{1,12}$/.test(i.number) || typeof i.name !== 'string' || !i.name.trim() || i.name.length > 100 || !(target(i) || i.mapId === '' && coordinates(i)) || i.id !== (i.mapId || 'legacy') + ':' + i.number || seen[i.id]) throw Error('item');
      seen[i.id] = true;
    });
    data.items.forEach(function(i) { if (i.mapName !== undefined && !validName(i.mapName)) throw Error('map name'); });
    if (data.pending !== undefined && (!target(data.pending) || typeof data.pending.id !== 'string' || !Number.isFinite(data.pending.expiresAt))) throw Error('pending');
    return {root:root, data:data};
  }
  function save(p, progress) {
    var before = p.storage;
    progress.root.zepWishlistShared = progress.data;
    try { p.storage = JSON.stringify(progress.root); p.save(); }
    catch(e) { p.storage = before; throw e; }
  }
  function send(s, message) {
    if (!s || !s.widget || !s.ready) return;
    var payload = {type:'state', collapsed:s.collapsed, message:message || ''};
    try {
      var data = read(s.player).data;
      payload.items = data.items.map(function(i) {
        return {id:i.id, number:i.number, name:i.name, mapId:i.mapId, mapName:mapName(i.mapId, i.mapName) || (i.mapId ? '맵 이름 확인 필요' : '맵 정보 없음'), otherMap:!!i.mapId && i.mapId !== App.mapHashID, needsRegistration:!i.mapId};
      });
      payload.sort = data.sort;
    } catch(e) { payload.error = '기록을 읽지 못했습니다. 관리자에게 문의하세요.'; }
    try { s.widget.sendMessage(payload); } catch(e) {}
  }
  function destroy(s) {
    if (s.widget) { try { s.widget.destroy(); } catch(e) { return false; } }
    s.widget = null; s.ready = false; return true;
  }
  function arrive(p, destination) {
    if (destination.location) p.spawnAtLocation(destination.location);
    else {
      if (!position(destination)) throw Error('position');
      p.spawnAt(destination.x, destination.y);
    }
  }
  function finishTransfer(p) {
    var progress = read(p), pending = progress.data.pending;
    if (!pending) return;
    if (Date.now() >= pending.expiresAt) { delete progress.data.pending; save(p, progress); tell(p, '이전 이동 요청이 만료됐습니다. 목록에서 다시 선택해 주세요.'); return; }
    if (pending.mapId !== App.mapHashID) return;
    var item = progress.data.items.filter(function(i) { return i.id === pending.id; })[0];
    // 이동 요청은 한 번만 소비합니다. 저장 실패 시 좌표 이동을 실행하지 않습니다.
    delete progress.data.pending; save(p, progress);
    if (!item) return;
    try { arrive(p, pending); tell(p, item.name + ' 위치로 이동했습니다.'); }
    catch(e) { tell(p, '목적지 위치로 이동하지 못했습니다. 목록에서 다시 선택하거나 관리자에게 문의하세요.'); }
  }
  function move(s, item, progress) {
    var p = s.player;
    if (s.lastMove && Date.now() - s.lastMove < 800) return;
    if (!item.mapId) { send(s, '이전 기록에 맵 정보가 없습니다. 원래 위치의 하트에서 다시 등록해 주세요.'); return; }
    if (!target(item)) throw Error('destination');
    if (item.mapId === currentMap()) {
      if (progress.data.pending) { delete progress.data.pending; save(p, progress); }
      arrive(p, item); s.lastMove = Date.now(); send(s, item.name + ' 위치로 이동했습니다.'); return;
    }
    var pending = progress.data.pending;
    if (pending && Date.now() < pending.expiresAt) { send(s, '맵 이동 요청 중입니다. 도착하지 않으면 !wishlist-cancel로 취소 후 다시 선택하세요.'); return; }
    pending = {id:item.id, mapId:item.mapId, expiresAt:Date.now() + CONFIG.transferTimeoutMs};
    if (item.location) pending.location = item.location;
    else { pending.x = item.x; pending.y = item.y; }
    progress.data.pending = pending;
    save(p, progress); // 목적지 맵에서 읽을 수 있도록 맵 전환 전에 저장합니다.
    s.lastMove = Date.now();
    send(s, '목적지 맵으로 이동을 요청했습니다.');
    try { p.spawnAtMap(App.spaceHashID, item.mapId); }
    catch(e) {
      var latest = read(p);
      if (latest.data.pending && latest.data.pending.id === pending.id && latest.data.pending.expiresAt === pending.expiresAt) { delete latest.data.pending; save(p, latest); }
      s.lastMove = 0; send(s, '맵 이동 요청에 실패했습니다. 목적지 맵과 입장 권한을 확인해 주세요.');
    }
  }
  function show(s) {
    if (!destroy(s)) return false;
    var u = s.collapsed ? CONFIG.minimized : CONFIG.ui;
    var w = s.player.showWidgetResponsive(s.collapsed ? 'wishlist-mini.html' : 'wishlist.html', u.top, u.right, u.bottom, u.left);
    s.widget = w;
    w.onMessage.Add(function(p, d) {
      if (p !== s.player || s.widget !== w || !record(d)) return;
      if (d.type === 'ready') { s.ready = true; send(s); return; }
      if (d.type === 'toggle') { s.collapsed = !s.collapsed; if (!show(s)) send(s); return; }
      try {
        var progress = read(p), data = progress.data;
        if (d.type === 'sort' && ['recent','number','name'].indexOf(d.sort) >= 0) { data.sort = d.sort; save(p, progress); send(s); return; }
        if (typeof d.id !== 'string') return;
        var item = data.items.filter(function(i) { return i.id === d.id; })[0];
        if (!item) return;
        if (d.type === 'delete') {
          data.items = data.items.filter(function(i) { return i.id !== d.id; });
          if (data.pending && data.pending.id === item.id) delete data.pending;
          save(p, progress); send(s, item.name + ' 삭제됨');
        } else if (d.type === 'move') move(s, item, progress);
      } catch(e) { send(s, '처리하지 못했습니다. 기록·목적지·저장 상태를 확인해 주세요.'); }
    });
    return true;
  }
  function join(p) {
    var s = find(p);
    if (!s) { s = {player:p, collapsed:false, ready:false, widget:null}; sessions.push(s); }
    try { finishTransfer(p); } catch(e) { tell(p, '이동 기록을 처리하지 못했습니다. !wishlist-cancel로 취소하거나 관리자에게 문의하세요.'); }
    try { refreshMapNames(p); } catch(e) { tell(p, '맵 이름 갱신을 저장하지 못했습니다.'); }
    try { if (!show(s)) send(s); } catch(e) { tell(p, '창을 열지 못했습니다. !wishlist로 다시 열어 주세요.'); }
  }
  App.onJoinPlayer.Add(join);
  // 앱을 실행하기 전부터 접속 중인 플레이어도 창을 표시합니다.
  App.onStart.Add(function() {
    (App.players || []).forEach(function(p) { if (!find(p)) join(p); });
  });
  function openWishlist(p) {
    var s = find(p);
    if (!s) { join(p); return; }
    try { s.collapsed = false; if (!show(s)) send(s); }
    catch(e) { tell(p, '창을 열지 못했습니다.'); }
  }
  // 스페이스 전체에 설치한 사이드바 앱 아이콘으로 어느 맵에서든 다시 열 수 있습니다.
  App.onSidebarTouched.Add(openWishlist);
  App.onObjectTouched.Add(function(p, x, y, tileId, obj) {
    if (!obj || obj.type !== 21 || typeof obj.param1 !== 'string' || !/^wishlist(?:$|:)/.test(obj.param1)) return;
    var number = String(obj.text), s = find(p);
    if (!s) return;
    try {
      var raw = obj.param1.slice(9).trim(), details = raw.charAt(0) === '{' ? JSON.parse(raw) : null;
      if (details !== null && !record(details)) throw Error('details');
      var name = details ? details.name : typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : raw;
      if (typeof name !== 'string' || !name.trim() || name.length > 100 || !/^\d{1,12}$/.test(number)) throw Error('name');
      var mapId = currentMap();
      var configured = CONFIG.destinations[number];
      var source = details || configured || {x:p.tileX, y:p.tileY};
      var destination = {mapId:source.mapId === undefined ? mapId : source.mapId};
      if (source.location !== undefined) destination.location = source.location;
      else { destination.x = source.x; destination.y = source.y; }
      if (!target(destination) || destination.mapId === mapId && !destination.location && !position(destination)) throw Error('position');
      var progress = read(p), items = progress.data.items, id = destination.mapId + ':' + number;
      var existing = items.filter(function(i) { return i.id === id; })[0];
      if (!existing && items.length >= CONFIG.maxItems) { tell(p, '최대 ' + CONFIG.maxItems + '개까지 저장할 수 있습니다.'); return; }
      if (source.mapName !== undefined && !validName(source.mapName)) throw Error('map name');
      var item = {id:id, number:number, name:name.trim(), mapId:destination.mapId};
      var destinationName = mapName(destination.mapId, source.mapName || (existing && existing.mapName));
      if (destinationName) item.mapName = destinationName;
      if (destination.location) item.location = destination.location;
      else { item.x = destination.x; item.y = destination.y; }
      if (existing) items[items.indexOf(existing)] = item; else items.push(item);
      save(p, progress);
      var message = item.name + (existing ? ' · 등록 정보를 갱신했습니다.' : ' · 위시리스트에 추가했습니다.');
      tell(p, message); send(s, message);
    } catch(e) { tell(p, '등록하지 못했습니다. 하트의 번호·이름·목적지 설정과 저장 기록을 확인해 주세요.'); }
  });
  App.onSay.Add(function(p, text) {
    if (text === '!wishlist') { openWishlist(p); return; }
    var s = find(p); if (!s) return;
    if (text === '!wishlist-map') { tell(p, '스페이스 ID: ' + App.spaceHashID + ' / 맵 ID: ' + App.mapHashID + ' / 현재 타일: ' + p.tileX + ', ' + p.tileY); return; }
    if (text === '!wishlist-cancel') {
      try { var progress = read(p); delete progress.data.pending; save(p, progress); s.lastMove = 0; tell(p, '이동 요청을 취소했습니다.'); send(s); }
      catch(e) { tell(p, '이동 요청 취소를 저장하지 못했습니다.'); } return;
    }
  });
  App.onLeavePlayer.Add(function(p) { sessions = sessions.filter(function(s) { if(s.player !== p) return true; destroy(s); return false; }); });
  App.onDestroy.Add(function() { sessions.forEach(destroy); sessions = []; });
}());
