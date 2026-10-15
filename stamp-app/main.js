/* 업로드 전 CONFIG의 프로그램 링크와 구글폼 링크를 입력하세요. */
var CONFIG = {
  eventId: 'stamp-event-01',
  requiredStamps: 4,
  formUrl: '',
  // 동일 링크의 연속 F 입력에 의한 팝업 중첩 방지
  popupCooldownMs: 1200,
  deskNumber: '205',
  deskValue: 'stamp:desk',
  // 화면 대비 % 여백. 접으면 아래쪽 여백을 늘려 위젯 높이를 줄입니다.
  ui: { top: 8, right: 62, bottom: 42, left: 7, collapsedBottom: 83 },
  objects: [
    { id: 's1', number: '201', value: 'stamp:1', name: '프로그램 1', url: '', enabled: true },
    { id: 's2', number: '202', value: 'stamp:2', name: '프로그램 2', url: '', enabled: true },
    { id: 's3', number: '203', value: 'stamp:3', name: '프로그램 3', url: '', enabled: true },
    { id: 's4', number: '204', value: 'stamp:4', name: '프로그램 4', url: '', enabled: true }
  ]
};

(function () {
  'use strict';

  var VERSION = '1.3-admin-reset';
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
    if (!session || !session.ready) return;
    var payload = {
      type: 'state',
      collapsed: session.collapsed,
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
    try { session.widget.sendMessage(payload); }
    catch (error) { /* UI 전송 실패가 저장된 스탬프에 영향을 주지 않게 합니다. */ }
  }

  function destroyWidget(session) {
    if (!session.widget) return true;
    var widget = session.widget;
    // 제거에 실패하면 새 위젯을 겹쳐 만들지 않습니다.
    try {
      if (widget.destroy() === false) return false;
    } catch (error) {
      return false;
    }
    session.widget = null;
    session.ready = false;
    return true;
  }

  function showHud(session) {
    if (!destroyWidget(session)) {
      notify(session.player, 'UI를 정리하지 못했습니다. 맵에 재접속해 주세요.');
      return;
    }
    session.ready = false;
    var layout = CONFIG.ui;
    var bottom = session.collapsed ? layout.collapsedBottom : layout.bottom;
    var widget = session.player.showWidgetResponsive(
      'stamp-ui.html', layout.top, layout.right, bottom, layout.left
    );
    session.widget = widget;
    widget.onMessage.Add(function (sender, data) {
      if (sender !== session.player || session.widget !== widget || !data) return;
      if (data.type === 'ready') {
        session.ready = true;
        sendProgress(session);
      } else if (data.type === 'toggle') {
        session.collapsed = !session.collapsed;
        showHud(session);
      }
    });
  }

  // 링크 열기 호출 성공을 지급 기준으로 사용합니다. 실제 로딩은 검증하지 않습니다.
  function openLink(player, url) {
    if (typeof url !== 'string' || !/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(url)) {
      notify(player, '링크가 아직 설정되지 않았습니다. 관리자에게 문의하세요.');
      return false;
    }
    var session = findSession(player);
    var now = Date.now();
    if (session && session.lastPopupUrl === url &&
        now - session.lastPopupAt < CONFIG.popupCooldownMs) return false;
    try {
      // 공식 SDK: 두 번째 인자가 true이면 ZEP 팝업으로 표시합니다.
      player.openWebLink(url, true);
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

  function handleDesk(player, progress) {
    var collected = countCollected(progress);
    if (collected >= CONFIG.requiredStamps) {
      openLink(player, CONFIG.formUrl);
      return;
    }
    notify(player, '현재 ' + collected + '/' + CONFIG.requiredStamps + '개입니다. ' +
      (CONFIG.requiredStamps - collected) + '개 더 모아주세요.');
  }

  function handleStamp(player, progress, object) {
    if (!openLink(player, object.url)) return;
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
      if (current && !destroyWidget(current)) {
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
      if (session) showHud(session);
    } catch (error) {
      notify(player, '기록을 읽지 못했습니다.');
    }
  });

  App.onDestroy.Add(function () {
    sessions.forEach(destroyWidget);
    sessions = [];
  });

  App.onLeavePlayer.Add(function (player) {
    sessions = sessions.filter(function (session) {
      if (session.player !== player) return true;
      destroyWidget(session);
      return false;
    });
  });
}());
