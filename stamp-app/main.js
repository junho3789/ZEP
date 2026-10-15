/* 업로드 전 CONFIG의 프로그램 링크와 구글폼 링크를 입력하세요. */
var CONFIG = {
  eventId: 'stamp-event-01',
  requiredStamps: 4,
  formUrl: '',
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
    if (!session.widget) return;
    try { session.widget.destroy(); }
    catch (error) { /* 이미 제거된 위젯은 무시합니다. */ }
  }

  function showHud(session) {
    destroyWidget(session);
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
    try {
      player.openWebLink(url);
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

  // ZEP 이벤트 연결
  validateConfig();

  App.onJoinPlayer.Add(function (player) {
    var session = { player: player, collapsed: false, ready: false, widget: null, busy: false };
    sessions.push(session);
    try { showHud(session); }
    catch (error) { notify(player, 'UI를 열지 못했습니다. !stamps로 현황을 확인하세요.'); }
  });

  // type 21: 번호=text, 값=param1. 맵 편집기에서 실행 방법을 F키로 설정하세요.
  App.onObjectTouched.Add(function (player, x, y, tileId, object) {
    if (!object || object.type !== 21) return;
    handleInteraction(player, String(object.text), object.param1);
  });

  App.onSay.Add(function (player, text) {
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

  App.onLeavePlayer.Add(function (player) {
    sessions = sessions.filter(function (session) {
      if (session.player !== player) return true;
      destroyWidget(session);
      return false;
    });
  });
}());
