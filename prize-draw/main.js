// ZEP 경품 추첨 전용 앱. 다른 앱 main.js에 덮어쓰지 마세요.
var PRIZE_CONFIG = {
    eventId: "prize-event-2026-v1",
    drawMapId: "REPLACE_WITH_MAP_HASH_ID", // 앱 설치 후 관리자 !경품맵확인 결과로 교체 (단축 URL 코드 아님)
    interactionMode: "editor", // 기본: 개발자 기능 > ZEP Script 상호작용 오브젝트
    objectNumber: "1001",      // 오브젝트 설정 Number (obj.text)
    objectValue: "prize_draw", // 오브젝트 설정 Value (obj.param1)
    // 이전 방식이 필요할 때만 interactionMode를 "key" 또는 "position"으로 변경
    objectKey: "prize_draw", // 맵 에디터의 ZEP Script 상호작용 오브젝트 key
    // key 설정이 어려운 경우 { layer: 3, x: 10, y: 10 }처럼 지정.
    // 좌표 지정 시 key 대신 이 레이어/좌표만 검사합니다(상단 오브젝트 layer: 5).
    objectPosition: null,
    // 실제 경품명이 정해지면 등수 id에 맞춰 수정. 추첨 확률과 별개인 표시용 값.
    prizeNames: { rank1: "1등 경품", rank2: "2등 경품", rank3: "3등 경품", rank4: "4등 경품", rank5: "5등 경품" },
    ranks: [
        { id: "rank1", name: "1등", probability: 5 },
        { id: "rank2", name: "2등", probability: 10 },
        { id: "rank3", name: "3등", probability: 15 },
        { id: "rank4", name: "4등", probability: 20 },
        { id: "rank5", name: "5등", probability: 50 }
    ],
    maxQueue: 100,
    storageTimeoutSeconds: 15,
    // 플랫폼 한도가 아닌 앱 자체 안전 한도(UTF-8 바이트). 실제 환경에서 확인.
    maxStorageBytes: 200000
};

(function (App, C) {
    "use strict";
    var KEY = "zepPrizeDrawV1", queue = [], busy = false, stopped = false;
    var pending = Object.create(null), elapsed = 0, token = 0;
    var resetTickets = Object.create(null), ticketSerial = 0;
    var popups = Object.create(null);
    var exports = Object.create(null);
    var guestIds = Object.create(null), guestSequence = 0;
    var hasOwn = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
    function object(o) { return o && typeof o === "object" && !Array.isArray(o); }
    function integer(n) { return typeof n === "number" && isFinite(n) && Math.floor(n) === n && n >= 0; }
    function tell(p, s) { try { p.sendMessage("[경품] " + s); } catch (_) {} }
    function popupPacket(p, packet) {
        var session = popups[String(p.id)];
        if (!session) return false;
        session.packet = packet;
        try { session.widget.sendMessage(packet); return true; } catch (_) { return false; }
    }
    function drawNotice(p, message) {
        if (!popupPacket(p, { type: "notice", message: message })) tell(p, message);
    }
    function closePopup(p) {
        var key = String(p.id), session = popups[key];
        delete popups[key];
        if (session) { try { session.widget.destroy(); } catch (_) {} }
    }
    function closeExport(p) {
        var key = String(p.id), session = exports[key]; delete exports[key];
        if (session) { try { session.widget.destroy(); } catch (_) {} }
    }
    function csvCell(value) {
        var text = String(value == null ? "" : value);
        if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
    }
    function exportWinners(p, data) {
        var header = ["이벤트", "회차", "순번", "당첨번호", "등수", "경품명", "당첨일(KST)", "당첨시각(KST)", "참여자 식별값", "참여 유형"];
        var rows = [header];
        data.state.winners.forEach(function (w) {
            var r = rankById(w.rank);
            rows.push([C.eventId, "R" + data.state.round, w.no, C.eventId + "-R" + data.state.round + "-" + w.no,
                r.name, C.prizeNames && C.prizeNames[w.rank] || r.name + " 경품", w.day,
                new Date(w.at + 9 * 3600000).toISOString().slice(0, 19).replace("T", " "), w.user,
                w.user.indexOf("guest:") === 0 ? "게스트" : "로그인 계정"]);
        });
        var csv = "\ufeff" + rows.map(function (row) { return row.map(csvCell).join(","); }).join("\r\n") + "\r\n";
        var now = Date.now(), safeName = C.eventId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
        var packet = { type: "export", csv: csv, count: data.state.winners.length, round: data.state.round,
            generatedAt: new Date(now + 9 * 3600000).toISOString().slice(0, 19).replace("T", " ") + " KST",
            filename: "prize-winners-" + safeName + "-R" + data.state.round + "-" + day(now) + ".csv" };
        closeExport(p);
        var widget = p.showWidgetResponsive("prize-export.html", 5, 4, 5, 4);
        if (!widget) throw Error("export widget unavailable");
        var session = { widget: widget }; exports[String(p.id)] = session;
        widget.onMessage.Add(function (sender, message) {
            if (!sender || String(sender.id) !== String(p.id) || exports[String(p.id)] !== session || !message) return;
            if (message.type === "close") { closeExport(p); return; }
            if (!(sender.role >= 3000)) { closeExport(p); return; }
            if (message.type === "ready") { try { widget.sendMessage(packet); } catch (_) {} }
        });
    }
    function openDraw(p) {
        if (popups[String(p.id)]) return; // 반복 접촉은 이미 열린 화면을 유지합니다.
        try {
            var widget = p.showWidgetResponsive("prize-draw.html", 2, 2, 2, 2);
            if (!widget) throw Error("widget unavailable");
            var session = { widget: widget, packet: { type: "loading" }, requested: false };
            popups[String(p.id)] = session;
            widget.onMessage.Add(function (sender, data) {
                if (!sender || String(sender.id) !== String(p.id) || popups[String(p.id)] !== session || !data) return;
                if (data.type === "ready") {
                    try { widget.sendMessage(session.packet); } catch (_) {}
                } else if (data.type === "close") closePopup(p);
                else if (data.type === "spin" && session.packet.type === "idle" && !session.requested) {
                    session.requested = true;
                    popupPacket(p, { type: "mixing" });
                    enqueue(p, "draw");
                }
                // 결과/등수는 클라이언트 입력을 받지 않고 서버에서 결정합니다.
            });
        } catch (_) {
            closePopup(p); tell(p, "추첨 팝업을 열 수 없습니다. 앱 ZIP에 prize-draw.html이 포함됐는지 확인해주세요."); return;
        }
        enqueue(p, "view"); // 팝업 열기만으로는 경품을 소모하지 않습니다.
    }
    function day(ms) { return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10); }
    function identity(p) {
        // 기존 로그인 당첨자의 해시 키는 유지합니다.
        if (p.isGuest !== true && typeof p.emailHash === "string" && p.emailHash) return p.emailHash;
        if ((typeof p.id !== "string" && typeof p.id !== "number") || String(p.id) === "") return null;
        var key = String(p.id);
        // 비로그인은 현재 방문 동안만 식별. 클라이언트가 제출한 ID는 사용하지 않습니다.
        if (!guestIds[key]) guestIds[key] = "guest:" + Date.now().toString(36) + "-" + (++guestSequence).toString(36) + "-" + Math.floor(Math.random() * 1e12).toString(36);
        return guestIds[key];
    }
    function checkConfig() {
        if (!C.eventId || !C.drawMapId || C.drawMapId === "REPLACE_WITH_MAP_HASH_ID") throw Error("eventId와 drawMapId를 설정하세요.");
        if (["editor", "key", "position"].indexOf(C.interactionMode) === -1) throw Error("오브젝트 연결 모드 오류");
        if (C.interactionMode === "editor") {
            if (typeof C.objectNumber !== "string" || !C.objectNumber || typeof C.objectValue !== "string" || !C.objectValue) throw Error("오브젝트 Number/Value를 설정하세요.");
        } else if (C.interactionMode === "position") {
            if (!object(C.objectPosition) || (C.objectPosition.layer !== 3 && C.objectPosition.layer !== 5) ||
                !integer(C.objectPosition.x) || !integer(C.objectPosition.y)) throw Error("오브젝트 좌표 설정 오류");
        } else if (typeof C.objectKey !== "string" || !C.objectKey) throw Error("오브젝트 key를 설정하세요.");
        if (!Array.isArray(C.ranks) || C.ranks.length !== 5) throw Error("등수는 1등~5등으로 설정하세요.");
        var sum = 0, ids = Object.create(null);
        C.ranks.forEach(function (r) {
            if (!r.id || typeof r.id !== "string" || ids[r.id] || typeof r.name !== "string" || !r.name ||
                !integer(r.probability)) throw Error("등수 설정 오류");
            ids[r.id] = true; sum += r.probability;
        });
        if (sum !== 100) throw Error("당첨 확률의 합계는 100이어야 합니다.");
        if (!integer(C.maxQueue) || C.maxQueue < 1 || !integer(C.maxStorageBytes) || C.maxStorageBytes < 1 ||
            !integer(C.storageTimeoutSeconds) || C.storageTimeoutSeconds < 1) throw Error("운영 설정 오류");
    }
    function signature() { return JSON.stringify([C.eventId, C.drawMapId, C.ranks]); }
    function read() {
        var root = App.storage == null || App.storage === "" ? {} : JSON.parse(App.storage);
        if (!object(root)) throw Error("스토리지 형식 오류");
        var state = hasOwn(root, KEY) ? root[KEY] : { version: 2, config: signature(), revision: 0, winners: [], round: 1, paused: false };
        // 같은 이벤트/맵/등수의 이전 재고형 원장을 유지하고 확률형으로 이어갑니다.
        if (object(state) && state.version === 1) {
            var oldConfig = JSON.parse(state.config);
            if (!Array.isArray(oldConfig) || oldConfig[0] !== C.eventId || oldConfig[1] !== C.drawMapId ||
                !Array.isArray(oldConfig[3]) || oldConfig[3].length !== C.ranks.length ||
                oldConfig[3].some(function(r,i) { return r.id !== C.ranks[i].id || r.name !== C.ranks[i].name; })) throw Error("이전 원장 설정 불일치");
            state.version = 2; state.config = signature();
            if (!hasOwn(state,"round")) state.round = 1;
            if (!hasOwn(state,"paused")) state.paused = false;
        }
        if (!object(state) || state.version !== 2 || state.config !== signature() ||
            !integer(state.round) || state.round < 1 || typeof state.paused !== "boolean" ||
            !integer(state.revision) || !Array.isArray(state.winners) || state.revision !== state.winners.length) throw Error("설정 변경 또는 당첨 기록 오류: 관리자 확인 필요");
        var totals = Object.create(null), daily = Object.create(null), people = Object.create(null);
        C.ranks.forEach(function(r) { totals[r.id] = 0; });
        state.winners.forEach(function(w,i) {
            if (!object(w) || typeof w.user !== "string" || !w.user || people[w.user] ||
                !hasOwn(totals,w.rank) || !integer(w.at) || w.day !== day(w.at) || w.no !== i+1) throw Error("당첨 기록 손상");
            people[w.user] = w; totals[w.rank]++;
            var k = w.day+":"+w.rank; daily[k] = (daily[k] || 0)+1;
        });
        return { root: root, state: state, totals: totals, daily: daily, people: people };
    }
    function rankById(id) {
        return C.ranks.filter(function (r) { return r.id === id; })[0];
    }
    function result(w, round) { return rankById(w.rank).name + " 당첨! 당첨번호 " + C.eventId + "-R" + round + "-" + w.no + " (" + w.day + ")"; }
    function drawResult(w, round, repeated) {
        var rank = rankById(w.rank);
        return { type: "result", rank: rank.name, ball: String(C.ranks.indexOf(rank) + 1),
            prize: C.prizeNames && C.prizeNames[w.rank] || rank.name + " 경품",
            receipt: C.eventId + "-R" + round + "-" + w.no, date: w.day, repeated: repeated };
    }
    function fail(message) {
        stopped = true; token++;
        queue.forEach(function (job) {
            var text = message + " 추첨을 중지했습니다. 관리자에게 문의하세요.";
            if (job.kind === "draw" || job.kind === "view") drawNotice(job.player, text); else tell(job.player, text);
        });
        queue = []; pending = Object.create(null); busy = false;
        resetTickets = Object.create(null);
    }
    function finish(job, message) {
        if (job.kind === "view") {
            popupPacket(job.player, job.viewPacket || { type: "notice", message: message });
        } else if (job.kind === "draw") {
            if (job.drawResult) { if (!popupPacket(job.player, job.drawResult)) tell(job.player, message); }
            else drawNotice(job.player, message);
        } else tell(job.player, message);
        delete pending[job.key]; queue.shift(); busy = false; elapsed = 0;
        // 다음 요청은 onUpdate에서 처리해 동기 콜백의 재귀를 피합니다.
    }
    function guarded(id, fn) {
        return function () {
            if (stopped || id !== token) return;
            try { fn(); } catch (_) { fail("저장 또는 기록 확인 오류입니다."); }
        };
    }
    function save(job, id, data, message) {
        data.root[KEY] = data.state;
        var serialized = JSON.stringify(data.root);
        if (unescape(encodeURIComponent(serialized)).length > C.maxStorageBytes) throw Error("저장 안전 한도 초과");
        App.setStorage(serialized);
        App.getStorage(guarded(id, function () {
            var saved = read();
            if (JSON.stringify(saved.state) !== JSON.stringify(data.state)) throw Error("저장 재조회 불일치");
            finish(job, message);
        }));
    }
    function process() {
        if (busy || stopped || !queue.length) return;
        busy = true; elapsed = 0;
        var job = queue[0], id = ++token;
        try {
            App.getStorage(guarded(id, function () {
                var data = read(), today = day(Date.now());
                // 큐 대기 중 권한 변경도 반영합니다.
                if (job.kind !== "draw" && job.kind !== "view" && !(job.player.role >= 3000)) { finish(job, "관리자 전용 명령입니다."); return; }
                if (job.kind === "view") {
                    var existing = job.user && data.people[job.user];
                    job.viewPacket = existing ? drawResult(existing, data.state.round, true) : { type: "idle" };
                    finish(job, ""); return;
                }
                if (job.kind === "export") {
                    try { exportWinners(job.player, data); finish(job, "당첨 목록 다운로드 창을 열었습니다. 현재 회차 " + data.state.winners.length + "건입니다."); }
                    catch (_) { closeExport(job.player); finish(job, "내보내기 창을 열 수 없습니다. ZIP에 prize-export.html이 포함됐는지 확인해주세요."); }
                    return;
                }
                if (job.kind === "status") {
                    var lines = [today + " (한국시간) / 총 당첨 " + data.state.winners.length + "건 / 재고·일일 한도 없음",
                        "회차 R" + data.state.round + " / " + (data.state.paused ? "추첨 중지" : "추첨 진행")];
                    C.ranks.forEach(function (r) {
                        lines.push(r.name + ": 확률 " + r.probability + "% / 전체 " + data.totals[r.id] + "건, 오늘 " + (data.daily[today + ":" + r.id] || 0) + "건");
                    });
                    if (data.state.lastReset) lines.push("최근 초기화: " + new Date(data.state.lastReset.at).toISOString() +
                        " / 이전 당첨 " + data.state.lastReset.previousCount + "건 / 관리자 ID " + data.state.lastReset.by);
                    finish(job, lines.join("\n")); return;
                }
                if (job.kind === "winners") {
                    var start = (job.page - 1) * 10;
                    var rows = data.state.winners.slice(start, start + 10).map(function (w) {
                        return "#" + w.no + " | " + rankById(w.rank).name + " | " + w.day + " | 참여자 " + w.user;
                    });
                    finish(job, "R" + data.state.round + " 당첨 기록 " + job.page + "페이지\n" + (rows.join("\n") || "기록 없음")); return;
                }
                if (job.kind === "pause" || job.kind === "resume") {
                    data.state.paused = job.kind === "pause";
                    resetTickets = Object.create(null);
                    save(job, id, data, data.state.paused ? "추첨을 중지했습니다. !경품초기화 또는 !경품시작" : "추첨을 시작했습니다."); return;
                }
                if (job.kind === "resetPrepare") {
                    if (!data.state.paused) { finish(job, "먼저 !경품중지 후 초기화하세요."); return; }
                    var code = Date.now().toString(36) + "-" + (++ticketSerial).toString(36);
                    resetTickets[String(job.player.id)] = { code: code, expires: Date.now() + 60000, snapshot: JSON.stringify(data.state) };
                    finish(job, "초기화 시 당첨 기록·통계·계정별 참여 제한이 초기화됩니다. 확률 설정은 유지됩니다. 기존 원장은 별도 보관하세요.\n" +
                        "60초 안에 !경품초기화 " + code + " 입력. 초기화 후에도 중지 상태입니다."); return;
                }
                if (job.kind === "reset") {
                    var ticket = resetTickets[String(job.player.id)];
                    delete resetTickets[String(job.player.id)];
                    if (!data.state.paused || !ticket || ticket.code !== job.argument || Date.now() >= ticket.expires ||
                        ticket.snapshot !== JSON.stringify(data.state)) { finish(job, "초기화 확인 코드가 만료/불일치했거나 기록이 변경되었습니다. !경품초기화부터 다시 진행하세요."); return; }
                    var old = data.state;
                    data.state = { version: 2, config: signature(), revision: 0, winners: [], round: old.round + 1, paused: true,
                        lastReset: { at: Date.now(), by: String(job.player.id), previousCount: old.winners.length, previousRound: old.round } };
                    resetTickets = Object.create(null);
                    save(job, id, data, "경품 초기화 완료. 새 회차 R" + data.state.round + ". !경품시작으로 재개하세요."); return;
                }
                if (data.state.paused) { finish(job, "현재 추첨이 중지되어 있습니다. 잠시 후 다시 참여해주세요."); return; }
                var previous = data.people[job.user];
                if (previous) { job.drawResult = drawResult(previous, data.state.round, true); finish(job, "이미 참여하셨습니다. " + result(previous, data.state.round)); return; }
                var pick = Math.random() * 100, selected = C.ranks[C.ranks.length - 1];
                for (var i = 0; i < C.ranks.length; i++) {
                    pick -= C.ranks[i].probability;
                    if (pick < 0) { selected = C.ranks[i]; break; }
                }
                var winner = { no: data.state.revision + 1, user: job.user, rank: selected.id, day: today, at: Date.now() };
                // 날짜 경계는 추첨 시각 하나로 고정합니다.
                winner.day = day(winner.at);
                if (winner.day !== today) { finish(job, "날짜가 변경되었습니다. 다시 참여해주세요."); return; }
                data.state.winners.push(winner); data.state.revision++;
                job.drawResult = drawResult(winner, data.state.round, false);
                // 쓰기 콜백/트랜잭션 API를 가정하지 않고 재조회 결과로 확인합니다.
                save(job, id, data, result(winner, data.state.round));
            }));
        } catch (_) { fail("스토리지 접근 오류입니다."); }
    }
    function enqueue(p, kind, page, argument) {
        function reject(message) { if (kind === "draw" || kind === "view") drawNotice(p, message); else tell(p, message); }
        try { checkConfig(); } catch (e) { reject(e.message); return; }
        if (String(App.mapHashID) !== C.drawMapId) { reject("지정된 추첨 맵에서 참여해주세요."); return; }
        if (stopped) { reject("추첨 점검 중입니다. 관리자에게 문의하세요."); return; }
        if (kind !== "draw" && kind !== "view" && !(p.role >= 3000)) { tell(p, "관리자 전용 명령입니다."); return; }
        var user = identity(p);
        if (kind === "draw" && !user) { reject("플레이어 식별 정보를 확인할 수 없습니다. 맵에 다시 입장해주세요."); return; }
        var key = kind === "draw" ? "draw:" + user : (kind === "view" ? "view:" : "admin:") + String(p.id);
        if (pending[key]) { reject("이전 요청 처리 중입니다."); return; }
        if (queue.length >= C.maxQueue) { reject("참여자가 많습니다. 잠시 후 다시 시도해주세요."); return; }
        pending[key] = true;
        queue.push({ player: p, user: user, key: key, kind: kind, page: page || 1, argument: argument });
        process();
    }
    App.onSay.Add(function (p, text) {
        text = String(text).trim();
        // 최초 설치/맵 설정 전에도 조회 가능. 스토리지와 추첨 상태는 변경하지 않습니다.
        if (text === "!경품맵확인") {
            if (!(p.role >= 3000)) { tell(p, "관리자 전용 명령입니다."); return; }
            if (typeof App.mapHashID !== "string" || !App.mapHashID) { tell(p, "현재 맵 ID를 확인할 수 없습니다."); return; }
            tell(p, "현재 mapHashID: " + App.mapHashID + "\nspaceHashID: " + String(App.spaceHashID || "확인 불가") +
                "\nmain.js 설정: drawMapId: " + JSON.stringify(App.mapHashID) +
                "\n단축 링크의 코드를 맵 ID로 추정하지 마세요. 현재 추첨 맵에서 확인한 값을 사용하세요.");
            return;
        }
        if (text === "!추첨") tell(p, "맵의 경품 상호작용 오브젝트를 이용해 참여해주세요.");
        else if (text === "!경품현황") enqueue(p, "status");
        else if (text === "!당첨내보내기") enqueue(p, "export");
        else if (text === "!경품중지") enqueue(p, "pause");
        else if (text === "!경품시작") enqueue(p, "resume");
        else if (text === "!경품초기화") enqueue(p, "resetPrepare");
        else if (/^!경품초기화\s+\S+$/.test(text)) enqueue(p, "reset", 1, text.split(/\s+/)[1]);
        else if (/^!당첨목록(?:\s+[1-9][0-9]*)?$/.test(text)) enqueue(p, "winners", Number(text.split(/\s+/)[1] || 1));
        else if (text === "!경품도움말") tell(p, "경품 상호작용 오브젝트 이용: 회차당 계정별 1회 당첨\n" +
            "관리자: !경품맵확인 / !경품현황 / !당첨목록 1 / !당첨내보내기 / !경품중지 / !경품시작 / !경품초기화 → 확인 코드 입력");
    });
    // 맵 에디터 > 오브젝트설치 > 개발자 기능 > ZEP Script 상호작용.
    // 공식 가이드의 onObjectTouched(sender, x, y, tileID, obj) 연결 방식.
    App.onObjectTouched.Add(function (p, x, y, tileID, obj) {
        if (C.interactionMode !== "editor" || !obj) return;
        var effectType = typeof ObjectEffectType !== "undefined" ? ObjectEffectType.INTERACTION_WITH_ZEPSCRIPTS : 21;
        if (Number(obj.type) !== effectType || obj.text == null || obj.param1 == null) return;
        if (String(obj.text) !== C.objectNumber || String(obj.param1) !== C.objectValue) return;
        openDraw(p);
    });
    App.onTriggerObject.Add(function (p, layer, x, y, key) {
        if (C.interactionMode !== "key" && C.interactionMode !== "position") return;
        var pos = C.objectPosition;
        if (C.interactionMode === "position") {
            if (!object(pos) || layer !== pos.layer || x !== pos.x || y !== pos.y) return;
        } else if (key !== C.objectKey) return;
        openDraw(p);
    });
    App.onSidebarTouched.Add(function (p) {
        tell(p, "맵의 경품 상호작용 오브젝트를 이용해 참여해주세요. !경품도움말");
    });
    App.onJoinPlayer.Add(function (p) { tell(p, "맵의 경품 상호작용 오브젝트로 참여하세요. !경품도움말"); });
    App.onUpdate.Add(function (dt) {
        if (stopped) return;
        if (busy) {
            elapsed += dt;
            if (elapsed > C.storageTimeoutSeconds) fail("저장 응답이 지연되어 결과 확인이 필요합니다.");
        } else process();
    });
    // 서버 이전 때 새 쓰기를 멈춥니다. 메모리를 재저장해 최신 원장을 덮어쓰지 않습니다.
    if (App.onMigrationStart && App.onMigrationStart.Add) App.onMigrationStart.Add(function () { fail("서버 이전 중입니다."); });
    App.onLeavePlayer.Add(function (p) { closePopup(p); closeExport(p); delete guestIds[String(p.id)]; });
    App.onDestroy.Add(function () {
        fail("앱이 종료되었습니다.");
        Object.keys(popups).forEach(function (key) { closePopup({ id: key }); });
        Object.keys(exports).forEach(function (key) { closeExport({ id: key }); });
    });
})(App, PRIZE_CONFIG);
