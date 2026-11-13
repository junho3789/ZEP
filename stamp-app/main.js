/* 업로드 전 CONFIG의 프로그램 링크와 구글폼 링크를 입력하세요. */
var CONFIG = {
  eventId: 'stamp-event-01',
  requiredStamps: 4,
  formUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSe8VHtdu6GkU5bpzIsXkphn0wFUvyC83LewjYpATES-N-CNWA/viewform',
  foundStampId: 's4',
  foundMessage: '뉴턴을 찾았습니다.',
  // 동일 링크의 연속 F 입력에 의한 팝업 중첩 방지
  popupCooldownMs: 1200,
  deskNumber: '205',
  deskValue: 'stamp:desk',
  // 이전 버전 위치 설정은 호환용입니다. 펼친 창은 전체 화면 영역에서 반응형으로 배치합니다.
  ui: { top: 8, right: 62, bottom: 20, left: 7 },
  // 접었을 때 좌측 상단 76×76px 영역에 뉴턴 아이콘만 표시합니다.
  minimized: { align: 'topleft', width: 76, height: 76 },
  objects: [
    { id: 's1', number: '201', value: 'stamp:1', name: '가자! 무대로', url: 'https://www.youtube.com/@e2festa/shorts', enabled: true },
    { id: 's2', number: '202', value: 'stamp:2', name: '온라인 전시관', url: 'https://e2festa.kr/03/02.php', enabled: true },
    { id: 's3', number: '203', value: 'stamp:3', name: '공학 유형테스트', url: 'https://smore.im/quiz/6MRlxlFps1', enabled: true },
    { id: 's4', number: '204', value: 'stamp:4', name: '뉴턴을 찾아라!', enabled: true }
  ]
};

// 포토부스: 별도 F키 상호작용 오브젝트. 실제 촬영/이미지 저장은 하지 않습니다.
CONFIG.photoBooth = { enabled: true, number: '206', value: 'photo:booth', stepMs: 1000, flashMs: 160 };

(function () {
  'use strict';

  var VERSION = '1.10-photo-flash';
  var sessions = [];

  // 설정과 공통 함수
  function isRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function getActiveObjects() {
    return CONFIG.objects.filter(function (object) { return object.enabled; });
  }

  function validateConfig() {
    var ids = {};
    var numbers = {};
    if (!CONFIG.eventId || !Number.isInteger(CONFIG.requiredStamps) ||
        CONFIG.requiredStamps < 1 || CONFIG.requiredStamps > getActiveObjects().length) {
      throw Error('필요 스탬프 수를 확인하세요.');
    }
    CONFIG.objects.forEach(function (object) {
      if (!object.id || ids[object.id] || !/^\d+$/.test(object.number) ||
          numbers[object.number] || object.number === CONFIG.deskNumber || !object.value) {
        throw Error('오브젝트 ID/번호/값 설정을 확인하세요.');
      }
      ids[object.id] = true;
      numbers[object.number] = true;
    });
  }

  function notify(player, text) {
    player.sendMessage('[스탬프] ' + text);
  }

  function findSession(player) {
    return sessions.filter(function (session) { return session.player === player; })[0];
  }

  // 이용자 저장 데이터: 다른 기능의 JSON 필드는 보존합니다.
  function readProgress(player) {
    var root = player.storage ? JSON.parse(player.storage) : {};
    if (!isRecord(root)) throw Error('잘못된 저장 데이터');
    if (root.zepStampEvents !== undefined && !isRecord(root.zepStampEvents)) {
      throw Error('잘못된 스탬프 데이터');
    }
    var events = root.zepStampEvents || {};
    var record = events[CONFIG.eventId];
    if (record !== undefined && (
      !isRecord(record) || record.version !== 1 || !Array.isArray(record.ids) ||
      record.ids.some(function (id) { return typeof id !== 'string'; })
    )) {
      throw Error('지원하지 않는 기록');
    }
    return { root: root, events: events, ids: record ? record.ids.slice() : [] };
  }

  function countCollected(progress) {
    return getActiveObjects().filter(function (object) {
      return progress.ids.indexOf(object.id) >= 0;
    }).length;
  }

  function saveStamp(player, progress, stampId) {
    progress.ids.push(stampId);
    progress.events[CONFIG.eventId] = { version: 1, ids: progress.ids };
    progress.root.zepStampEvents = progress.events;
    var previousStorage = player.storage;
    try {
      player.storage = JSON.stringify(progress.root);
      player.save();
      return true;
    } catch (error) {
      player.storage = previousStorage;
      notify(player, '스탬프 저장에 실패했습니다. 오브젝트를 다시 이용하세요.');
      return false;
    }
  }

  // 수집 UI: 부모가 준비 메시지를 받은 뒤 상태를 전달합니다.
  function sendProgress(session) {
    if (!session) return;
    var payload = {
      type: 'state',
      collapsed: session.collapsed,
      photoActive: !!session.photoBooth,
      desktopDock: !!session.desktopDock,
      required: CONFIG.requiredStamps
    };
    try {
      var progress = readProgress(session.player);
      payload.count = countCollected(progress);
      payload.objects = getActiveObjects().map(function (object) {
        return { name: object.name, collected: progress.ids.indexOf(object.id) >= 0 };
      });
    } catch (error) {
      payload.error = '기록을 읽지 못했습니다. 관리자에게 문의하세요.';
    }
    if (session.widget && session.ready) {
      try { session.widget.sendMessage(payload); } catch (error) {}
    }
    if (session.launcher && session.launcherReady) {
      try { session.launcher.sendMessage(payload); } catch (error) {}
    }
  }

  function destroyWidget(session) {
    if (!session.widget) return true;
    var widget = session.widget;
    // false/undefined 반환만으로 실패를 단정하지 않습니다.
    // 이미 제거된 핸들도 있을 수 있으므로 실제 예외가 날 때만 중단합니다.
    try {
      widget.destroy();
    } catch (error) {
      return false;
    }
    session.widget = null;
    session.ready = false;
    return true;
  }

  function destroyLauncher(session) {
    if (!session.launcher) return true;
    try { session.launcher.destroy(); } catch (error) { return false; }
    session.launcher = null;
    session.launcherReady = false;
    return true;
  }

  function collapseHud(session) {
    if (!destroyWidget(session)) {
      notify(session.player, '창을 전환하지 못했습니다. 잠시 후 다시 눌러주세요.');
      sendProgress(session);
      return false;
    }
    session.collapsed = true;
    sendProgress(session);
    return true;
  }

  function updateHudViewport(session, viewport) {
    if (session.desktopDock) return;
    if (!viewport || typeof viewport.width !== 'number' || !isFinite(viewport.width) || viewport.width < 1 || viewport.width > 20000) return;
    var mobile = viewport.width <= 600 || viewport.touch === true;
    if (session.mobile === mobile) return;
    session.mobile = mobile;
    try { ensureLauncher(session); } catch (error) {}
  }

  // 아이콘은 접기/펼치기 중 제거하지 않아 전환 시 빈 화면과 크기 변화를 방지합니다.
  function ensureLauncher(session) {
    var mini = CONFIG.minimized;
    var align = session.desktopDock ? 'topleft' : (session.mobile ? 'middleleft' : mini.align);
    if (session.launcher && session.launcherAlign === align) return;
    if (session.launcher && !destroyLauncher(session)) return;
    var widget = session.player.showWidget('stamp-mini.html', align, mini.width, mini.height);
    session.launcher = widget;
    session.launcherAlign = align;
    session.launcherReady = false;
    widget.onMessage.Add(function (sender, data) {
      if (sender !== session.player || session.launcher !== widget || !data) return;
      if (data.type === 'ready') {
        session.launcherReady = true;
        sendProgress(session);
      } else if (data.type === 'expand' || data.type === 'toggle') {
        // 반복 탭은 다시 접는 동작이 아니라 동일한 펼치기 요청으로 처리합니다.
        if (session.widget) return;
        session.collapsed = false;
        try { showHud(session); }
        catch (error) {
          session.collapsed = true;
          sendProgress(session);
          notify(session.player, '창을 열지 못했습니다. 아이콘을 다시 눌러주세요.');
        }
      }
    });
  }

  function showHud(session) {
    ensureLauncher(session);
    if (session.collapsed) return collapseHud(session);
    if (session.widget) { sendProgress(session); return true; }
    session.ready = false;
    // 좁은 화면 비율(기존 31% 폭)을 사용하지 않고 HTML이 실제 화면에 맞춰 배치합니다.
    var widget = session.desktopDock
      ? session.player.showWidget('stamp-ui.html', 'topleft', 368, session.desktopHeight || 620)
      : session.player.showWidgetResponsive('stamp-ui.html', 0, 0, 0, 0);
    session.widget = widget;
    widget.onMessage.Add(function (sender, data) {
      if (sender !== session.player || session.widget !== widget || !data) return;
      if (data.type === 'ready') {
        if (!session.desktopDock && data.viewport && data.viewport.width > 600 && data.viewport.touch !== true) {
          try { widget.destroy(); } catch (error) { return; }
          session.widget = null;
          session.desktopDock = true;
          session.desktopHeight = Math.max(240, Math.min(620, (data.viewport.height || 780) - 160));
          session.mobile = false;
          showHud(session);
          return;
        }
        updateHudViewport(session, data.viewport);
        session.ready = true;
        sendProgress(session);
      } else if (data.type === 'viewport') {
        updateHudViewport(session, data.viewport);
      } else if (data.type === 'collapse' || data.type === 'toggle') {
        collapseHud(session);
      }
    });
    sendProgress(session);
    return true;
  }

  // 촬영 연출은 이용자별 위젯만 사용하며 스탬프/이동 속도/아바타를 변경하지 않습니다.
  function closePhotoBooth(session) {
    var panel = session.photoBooth;
    if (!panel) return true;
    try { panel.widget.destroy(); }
    catch (error) {
      try { panel.widget.sendMessage({type: 'photo_close_failed'}); } catch (ignored) {}
      return false;
    }
    panel.active = false;
    session.photoBooth = null;
    sendProgress(session);
    return true;
  }

  function openPhotoBooth(session) {
    if (session.photoBooth) return;
    var panel;
    try {
      var config = CONFIG.photoBooth;
      var step = Number(config.stepMs), flash = Number(config.flashMs);
      step = isFinite(step) ? Math.max(500, Math.min(2000, step)) : 1000;
      flash = isFinite(flash) ? Math.max(80, Math.min(300, flash)) : 160;
      var widget = session.player.showWidgetResponsive('photo-booth.html', 0, 0, 0, 0);
      panel = {widget: widget, active: true, started: false};
      session.photoBooth = panel;
      sendProgress(session);
      widget.onMessage.Add(function (sender, data) {
        if (sender !== session.player || session.photoBooth !== panel || !panel.active || !data) return;
        if (data.type === 'photo_ready' && !panel.started) {
          panel.started = true;
          try { widget.sendMessage({type: 'photo_start', stepMs: step, flashMs: flash}); }
          catch (error) { closePhotoBooth(session); }
        } else if (data.type === 'photo_done' || data.type === 'photo_close') {
          closePhotoBooth(session);
        }
      });
      // HTML이 준비되지 않거나 완료 메시지가 유실되어도 위젯을 정리합니다.
      App.runLater(function () {
        if (findSession(session.player) === session && session.photoBooth === panel && panel.active) {
          closePhotoBooth(session);
        }
      }, (step * 3 + flash) / 1000 + 5);
    } catch (error) {
      if (panel) closePhotoBooth(session);
      notify(session.player, '포토부스 연출을 열지 못했습니다. 다시 시도해 주세요.');
    }
  }

  // 스페셜 카드를 닫아도 별도의 발견 알림을 호출하지 않습니다.
  function closeSpecialCard(session) {
    var panel = session.specialCard;
    if (!panel) return true;
    try { panel.widget.destroy(); }
    catch (error) {
      notify(session.player, '카드를 닫지 못했습니다. 닫기 버튼을 다시 눌러주세요.');
      return false;
    }
    session.specialCard = null;
    panel.active = false;
    return true;
  }

  function openSpecialCard(session, object) {
    if (!session || session.specialCard) return false;
    var panel;
    try {
      var widget = session.player.showWidgetResponsive('stamp-special.html', 0, 0, 0, 0);
      panel = {widget: widget, active: true, stampId: object.id, eventId: CONFIG.eventId};
      session.specialCard = panel;
      widget.onMessage.Add(function (sender, data) {
        if (sender !== session.player || session.specialCard !== panel || !panel.active || !data) return;
        if (data.type === 'card_ready') {
          try {
            var progress = readProgress(session.player);
            if (panel.eventId !== CONFIG.eventId || progress.ids.indexOf(panel.stampId) < 0) {
              closeSpecialCard(session);
              return;
            }
            widget.sendMessage({type: 'card_state', heading: CONFIG.foundMessage});
          } catch (error) {
            closeSpecialCard(session);
            notify(session.player, '카드를 표시하지 못했습니다. 다시 이용해 주세요.');
          }
        } else if (data.type === 'card_close') {
          closeSpecialCard(session);
        }
      });
      return true;
    } catch (error) {
      if (panel) closeSpecialCard(session);
      notify(session.player, '카드를 열지 못했습니다. 다시 시도하세요.');
      return false;
    }
  }

  // 링크 열기 호출 성공을 지급 기준으로 사용합니다. 실제 로딩은 검증하지 않습니다.
  function openLink(player, url, popup) {
    if (typeof url !== 'string' || !/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(url)) {
      notify(player, '링크가 아직 설정되지 않았습니다. 관리자에게 문의하세요.');
      return false;
    }
    var session = findSession(player);
    var now = Date.now();
    if (session && session.lastPopupUrl === url &&
        now - session.lastPopupAt < CONFIG.popupCooldownMs) return false;
    try {
      // SDK의 popup=false는 새 창, true는 ZEP 팝업입니다. 생략 시 기존 팝업 동작을 유지합니다.
      player.openWebLink(url, popup !== false);
      if (session) {
        session.lastPopupUrl = url;
        session.lastPopupAt = now;
      }
      return true;
    } catch (error) {
      notify(player, '링크를 열지 못했습니다. 다시 시도하세요.');
      return false;
    }
  }

  function closeEntryNotice(session) {
    var notice = session && session.entryNotice;
    if (!notice) return true;
    try { notice.widget.destroy(); }
    catch (error) {
      notify(session.player, '안내 창을 닫지 못했습니다. 닫기 버튼을 다시 눌러주세요.');
      return false;
    }
    notice.active = false;
    session.entryNotice = null;
    return true;
  }

  function sendEntryNotice(session) {
    var notice = session.entryNotice;
    if (!notice || !notice.ready) return;
    try {
      var collected = countCollected(readProgress(session.player));
      if (collected >= CONFIG.requiredStamps) { closeEntryNotice(session); return; }
      notice.widget.sendMessage({
        type: 'entry_state', count: collected, required: CONFIG.requiredStamps,
        missing: CONFIG.requiredStamps - collected
      });
    } catch (error) {
      closeEntryNotice(session);
      notify(session.player, '수집 기록을 확인하지 못했습니다. 다시 이용해 주세요.');
    }
  }

  function openEntryNotice(player) {
    var session = findSession(player);
    if (!session) return;
    if (session.entryNotice) { sendEntryNotice(session); return; }
    try {
      var widget = player.showWidgetResponsive('stamp-entry.html', 0, 0, 0, 0);
      var notice = {widget: widget, active: true, ready: false};
      session.entryNotice = notice;
      widget.onMessage.Add(function (sender, data) {
        if (sender !== player || session.entryNotice !== notice || !notice.active || !data) return;
        if (data.type === 'entry_ready') {
          notice.ready = true;
          sendEntryNotice(session);
        } else if (data.type === 'entry_close') {
          closeEntryNotice(session);
        }
      });
    } catch (error) {
      closeEntryNotice(session);
      notify(player, '안내 팝업을 열지 못했습니다. 다시 이용해 주세요.');
    }
  }

  function handleDesk(player, progress) {
    var collected = countCollected(progress);
    if (collected >= CONFIG.requiredStamps) {
      if (!closeEntryNotice(findSession(player))) return;
      openLink(player, CONFIG.formUrl);
      return;
    }
    openEntryNotice(player);
  }

  function handleStamp(player, progress, object) {
    if (object.id === CONFIG.foundStampId) {
      var session = findSession(player);
      if (!openSpecialCard(session, object)) return;
      if (progress.ids.indexOf(object.id) < 0 && !saveStamp(player, progress, object.id)) {
        closeSpecialCard(session);
        return;
      }
      return;
    }
    // CONFIG의 첫 번째/두 번째 스탬프만 새 창으로 엽니다. 기존 링크 설정은 그대로 사용합니다.
    var popup = object !== CONFIG.objects[0] && object !== CONFIG.objects[1];
    if (!openLink(player, object.url, popup)) return;
    if (progress.ids.indexOf(object.id) >= 0) {
      notify(player, '이미 획득한 스탬프입니다.');
      return;
    }
    if (saveStamp(player, progress, object.id)) {
      notify(player, object.name + ' 스탬프 획득! ' +
        countCollected(progress) + '/' + CONFIG.requiredStamps);
    }
  }

  function handleInteraction(player, number, value) {
    var session = findSession(player);
    if (!session || session.busy) return;
    // 포토부스는 스탬프 저장 데이터가 손상된 경우에도 독립적으로 동작합니다.
    var photo = CONFIG.photoBooth;
    if (photo && photo.enabled && number === String(photo.number) && value === photo.value) {
      openPhotoBooth(session);
      return;
    }
    session.busy = true;
    try {
      var progress = readProgress(player);
      if (number === CONFIG.deskNumber && value === CONFIG.deskValue) {
        handleDesk(player, progress);
        return;
      }
      var object = getActiveObjects().filter(function (item) {
        return item.number === number && item.value === value;
      })[0];
      if (object) handleStamp(player, progress, object);
    } catch (error) {
      notify(player, '기록을 처리하지 못했습니다. 관리자에게 문의하세요.');
    } finally {
      session.busy = false;
      sendProgress(session);
    }
  }

  // 관리자 초기화: 서버의 읽기 전용 role만 신뢰합니다.
  // 공식 권한: 관리자=3000, 맵 소유자=3001. 스태프/에디터는 제외합니다.
  function isAdministrator(player) {
    return player.role === 3000 || player.role === 3001;
  }

  function resetPlayerProgress(target) {
    var session = findSession(target);
    if (!session || session.busy) return false;
    session.busy = true;
    var previousStorage = target.storage;
    try {
      var progress = readProgress(target);
      progress.events[CONFIG.eventId] = { version: 1, ids: [] };
      progress.root.zepStampEvents = progress.events;
      target.storage = JSON.stringify(progress.root);
      target.save();
      session.lastPopupUrl = null;
      session.lastPopupAt = 0;
      closePhotoBooth(session);
      closeEntryNotice(session);
      closeSpecialCard(session);
    } catch (error) {
      target.storage = previousStorage;
      return false;
    } finally {
      session.busy = false;
      sendProgress(session);
    }
    notify(target, '관리자가 현재 이벤트의 스탬프를 초기화했습니다. 다시 수집할 수 있습니다.');
    return true;
  }

  function handleAdminCommand(player, text) {
    var parts = text.trim().split(/\s+/);
    if (parts[0] !== '!stamp-reset' && parts[0] !== '!stamp-players') return false;
    if (!isAdministrator(player)) {
      var deniedSession = findSession(player);
      if (deniedSession) deniedSession.pendingReset = null;
      notify(player, '관리자 또는 맵 소유자만 사용할 수 있습니다.');
      return true;
    }
    var session = findSession(player);
    if (!session) return true;
    if (parts[0] === '!stamp-players') {
      sessions.forEach(function (item) {
        notify(player, '이름: ' + item.player.name + ' / ID: ' + item.player.id);
      });
      return true;
    }
    var action = parts[1];
    if (action === 'cancel' && parts.length === 2) {
      session.pendingReset = null;
      notify(player, '초기화를 취소했습니다.');
      return true;
    }
    if (action === 'confirm' && parts.length === 2) {
      var request = session.pendingReset;
      // 확인 명령은 한 번만 실행할 수 있고, 대상은 요청 시점으로 고정합니다.
      session.pendingReset = null;
      if (!request || Date.now() >= request.expiresAt || request.eventId !== CONFIG.eventId) {
        notify(player, '확인할 초기화 요청이 없거나 만료됐습니다. 다시 요청하세요.');
        return true;
      }
      var success = 0;
      var skipped = 0;
      request.targets.forEach(function (targetSession) {
        if (findSession(targetSession.player) !== targetSession) {
          skipped += 1;
          return;
        }
        if (resetPlayerProgress(targetSession.player)) success += 1;
        else skipped += 1;
      });
      notify(player, '현재 이벤트 초기화: 처리 ' + success + '명, 실패/퇴장 ' + skipped + '명.');
      return true;
    }
    var targets;
    if (action === 'me' && parts.length === 2) {
      targets = [session];
    } else if (action === 'all' && parts.length === 2) {
      targets = sessions.slice();
    } else if (action === 'id' && parts.length === 3) {
      targets = sessions.filter(function (item) { return String(item.player.id) === parts[2]; });
    } else {
      session.pendingReset = null;
      notify(player, '사용법: !stamp-reset me | id 이용자ID | all / 확인: !stamp-reset confirm / 취소: !stamp-reset cancel / 접속자: !stamp-players');
      return true;
    }
    session.pendingReset = null;
    if (!targets.length) {
      notify(player, '대상 이용자가 현재 맵에 접속해 있지 않습니다. !stamp-players로 ID를 확인하세요.');
      return true;
    }
    session.pendingReset = {
      targets: targets, eventId: CONFIG.eventId, expiresAt: Date.now() + 30000
    };
    var description = action === 'all'
      ? '현재 맵 접속자 전체 ' + targets.length + '명 (미접속자 제외)'
      : targets[0].player.name + ' (ID: ' + targets[0].player.id + ')';
    notify(player, '초기화 대상: ' + description + ' / 이벤트: ' + CONFIG.eventId +
      '. 30초 안에 !stamp-reset confirm 을 입력하세요. 취소: !stamp-reset cancel');
    return true;
  }

  // ZEP 이벤트 연결
  validateConfig();

  App.onJoinPlayer.Add(function (player) {
    var previous = findSession(player);
    if (previous) {
      // 중복 입장 콜백에서도 하나의 UI만 유지합니다.
      try { showHud(previous); } catch (error) {}
      return;
    }
    var session = {
      player: player, collapsed: false, ready: false, widget: null, busy: false,
      lastPopupUrl: null, lastPopupAt: 0
    };
    sessions.push(session);
    notify(player, '앱 ' + VERSION + ' 실행 중');
    try { showHud(session); }
    catch (error) { notify(player, 'UI를 열지 못했습니다. !stamps로 현황을 확인하세요.'); }
  });

  // type 21: 번호=text, 값=param1. 맵 편집기에서 실행 방법을 F키로 설정하세요.
  App.onObjectTouched.Add(function (player, x, y, tileId, object) {
    if (!object || object.type !== 21) return;
    handleInteraction(player, String(object.text), object.param1);
  });

  App.onSay.Add(function (player, text) {
    if (handleAdminCommand(player, text)) return;
    if (text === '!stamp-version') {
      notify(player, '앱 ' + VERSION);
      return;
    }
    if (text === '!stamp-ui-hide') {
      var current = findSession(player);
      if (current && (!destroyWidget(current) || !destroyLauncher(current))) {
        notify(player, 'UI를 정리하지 못했습니다. 맵에 재접속해 주세요.');
      } else {
        notify(player, '스탬프 UI를 숨겼습니다. !stamps로 다시 표시할 수 있습니다.');
      }
      return;
    }
    if (text !== '!stamps') return;
    try {
      var progress = readProgress(player);
      notify(player, '수집 현황 ' + countCollected(progress) + '/' + CONFIG.requiredStamps);
      var session = findSession(player);
      if (session) {
        session.collapsed = false;
        showHud(session);
      }
    } catch (error) {
      notify(player, '기록을 읽지 못했습니다.');
    }
  });

  App.onDestroy.Add(function () {
    sessions.forEach(function (session) {
      closePhotoBooth(session);
      closeEntryNotice(session);
      closeSpecialCard(session);
      destroyWidget(session);
      destroyLauncher(session);
    });
    sessions = [];
  });

  App.onLeavePlayer.Add(function (player) {
    sessions = sessions.filter(function (session) {
      if (session.player !== player) return true;
      closePhotoBooth(session);
      closeEntryNotice(session);
      closeSpecialCard(session);
      destroyWidget(session);
      destroyLauncher(session);
      return false;
    });
  });
}());
