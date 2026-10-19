// ZEP 경품 추첨 전용 앱. 다른 앱 main.js에 덮어쓰지 마세요.
var PRIZE_CONFIG = {
    eventId: "prize-event-2026-v1",
    drawMapId: "REPLACE_WITH_MAP_HASH_ID", // URL의 맵 ID로 교체 필수
    objectKey: "prize_draw", // 맵 에디터의 ZEP Script 상호작용 오브젝트 key
    // key 설정이 어려운 경우 { layer: 3, x: 10, y: 10 }처럼 지정.
    // 좌표 지정 시 key 대신 이 레이어/좌표만 검사합니다(상단 오브젝트 layer: 5).
    objectPosition: null,
    totalPrizes: 1000,
    ranks: [
        { id: "rank1", name: "1등", total: 6, dailyLimit: 2 },
        { id: "rank2", name: "2등", total: 8, dailyLimit: 3 },
        { id: "rank3", name: "3등", total: 36, dailyLimit: 10 },
        { id: "rank4", name: "4등", total: 150, dailyLimit: 50 },
        { id: "rank5", name: "5등", total: 800, dailyLimit: 200 }
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
    var hasOwn = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
    function object(o) { return o && typeof o === "object" && !Array.isArray(o); }
    function integer(n) { return typeof n === "number" && isFinite(n) && Math.floor(n) === n && n >= 0; }
    function tell(p, s) { try { p.sendMessage("[경품] " + s); } catch (_) {} }
    function day(ms) { return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10); }
    function identity(p) {
        if (p.isGuest !== false || typeof p.emailHash !== "string" || !p.emailHash) return null;
        return p.emailHash;
    }
    function checkConfig() {
        if (!C.eventId || !C.drawMapId || C.drawMapId === "REPLACE_WITH_MAP_HASH_ID") throw Error("eventId와 drawMapId를 설정하세요.");
        if (C.objectPosition !== null) {
            if (!object(C.objectPosition) || (C.objectPosition.layer !== 3 && C.objectPosition.layer !== 5) ||
                !integer(C.objectPosition.x) || !integer(C.objectPosition.y)) throw Error("오브젝트 좌표 설정 오류");
        } else if (typeof C.objectKey !== "string" || !C.objectKey) throw Error("오브젝트 key를 설정하세요.");
        if (!integer(C.totalPrizes) || C.totalPrizes < 1 || !Array.isArray(C.ranks) || !C.ranks.length) throw Error("총수량/등수 설정 오류");
        var sum = 0, ids = Object.create(null);
        C.ranks.forEach(function (r) {
            if (!r.id || typeof r.id !== "string" || ids[r.id] || typeof r.name !== "string" || !r.name ||
                !integer(r.total) || !integer(r.dailyLimit)) throw Error("등수 설정 오류");
            ids[r.id] = true; sum += r.total;
        });
        if (sum !== C.totalPrizes) throw Error("등수별 total 합계와 totalPrizes가 다릅니다.");
        if (!integer(C.maxQueue) || C.maxQueue < 1 || !integer(C.maxStorageBytes) || C.maxStorageBytes < 1 ||
            !integer(C.storageTimeoutSeconds) || C.storageTimeoutSeconds < 1) throw Error("운영 설정 오류");
    }
    // 운영 중 설정 변경으로 기존 당첨 재고가 초기화되지 않도록 차단합니다.
    function signature() { return JSON.stringify([C.eventId, C.drawMapId, C.totalPrizes, C.ranks]); }
    function read() {
        var root = App.storage == null || App.storage === "" ? {} : JSON.parse(App.storage);
        if (!object(root)) throw Error("스토리지 형식 오류");
        var state;
        if (!hasOwn(root, KEY)) state = { version: 1, config: signature(), revision: 0, winners: [], round: 1, paused: false };
        else state = root[KEY];
        // 기존 v1 당첨 원장은 그대로 유지합니다.
        if (object(state)) {
            if (!hasOwn(state, "round")) state.round = 1;
            if (!hasOwn(state, "paused")) state.paused = false;
        }
        if (!object(state) || state.version !== 1 || state.config !== signature() ||
            !integer(state.round) || state.round < 1 || typeof state.paused !== "boolean" ||
            !integer(state.revision) || !Array.isArray(state.winners) || state.revision !== state.winners.length ||
            state.winners.length > C.totalPrizes) throw Error("설정 변경 또는 당첨 기록 오류: 관리자 확인 필요");
        var totals = Object.create(null), daily = Object.create(null), people = Object.create(null);
        C.ranks.forEach(function (r) { totals[r.id] = 0; });
        state.winners.forEach(function (w, i) {
            if (!object(w) || typeof w.user !== "string" || !w.user || people[w.user] ||
                !hasOwn(totals, w.rank) || !integer(w.at) || w.day !== day(w.at) || w.no !== i + 1) throw Error("당첨 기록 손상");
            people[w.user] = w; totals[w.rank]++;
            var k = w.day + ":" + w.rank;
            daily[k] = (daily[k] || 0) + 1;
        });
        C.ranks.forEach(function (r) {
            if (totals[r.id] > r.total) throw Error("총 재고 초과 기록");
            Object.keys(daily).forEach(function (k) {
                if (k.slice(11) === r.id && daily[k] > r.dailyLimit) throw Error("일일 한도 초과 기록");
            });
        });
        return { root: root, state: state, totals: totals, daily: daily, people: people };
    }
    function rankById(id) {
        return C.ranks.filter(function (r) { return r.id === id; })[0];
    }
    function result(w, round) { return rankById(w.rank).name + " 당첨! 당첨번호 " + C.eventId + "-R" + round + "-" + w.no + " (" + w.day + ")"; }
    function fail(message) {
        stopped = true; token++;
        queue.forEach(function (job) { tell(job.player, message + " 추첨을 중지했습니다. 관리자에게 문의하세요."); });
        queue = []; pending = Object.create(null); busy = false;
        resetTickets = Object.create(null);
    }
    function finish(job, message) {
        tell(job.player, message);
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
                if (job.kind !== "draw" && !(job.player.role >= 3000)) { finish(job, "관리자 전용 명령입니다."); return; }
                if (job.kind === "status") {
                    var lines = [today + " (한국시간) / 총 당첨 " + data.state.winners.length + "/" + C.totalPrizes,
                        "회차 R" + data.state.round + " / " + (data.state.paused ? "추첨 중지" : "추첨 진행")];
                    C.ranks.forEach(function (r) {
                        lines.push(r.name + ": 전체 " + data.totals[r.id] + "/" + r.total +
                            ", 오늘 " + (data.daily[today + ":" + r.id] || 0) + "/" + r.dailyLimit);
                    });
                    if (data.state.lastReset) lines.push("최근 초기화: " + new Date(data.state.lastReset.at).toISOString() +
                        " / 이전 당첨 " + data.state.lastReset.previousCount + "건 / 관리자 ID " + data.state.lastReset.by);
                    finish(job, lines.join("\n")); return;
                }
                if (job.kind === "winners") {
                    var start = (job.page - 1) * 10;
                    var rows = data.state.winners.slice(start, start + 10).map(function (w) {
                        return "#" + w.no + " | " + rankById(w.rank).name + " | " + w.day + " | 계정해시 " + w.user;
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
                    finish(job, "초기화 시 총 재고·오늘 당첨 수·당첨자 기록·중복 당첨 제한이 모두 초기화됩니다. 기존 원장은 별도 보관하세요.\n" +
                        "60초 안에 !경품초기화 " + code + " 입력. 초기화 후에도 중지 상태입니다."); return;
                }
                if (job.kind === "reset") {
                    var ticket = resetTickets[String(job.player.id)];
                    delete resetTickets[String(job.player.id)];
                    if (!data.state.paused || !ticket || ticket.code !== job.argument || Date.now() >= ticket.expires ||
                        ticket.snapshot !== JSON.stringify(data.state)) { finish(job, "초기화 확인 코드가 만료/불일치했거나 기록이 변경되었습니다. !경품초기화부터 다시 진행하세요."); return; }
                    var old = data.state;
                    data.state = { version: 1, config: signature(), revision: 0, winners: [], round: old.round + 1, paused: true,
                        lastReset: { at: Date.now(), by: String(job.player.id), previousCount: old.winners.length, previousRound: old.round } };
                    resetTickets = Object.create(null);
                    save(job, id, data, "경품 초기화 완료. 새 회차 R" + data.state.round + ", 총 재고 " + C.totalPrizes + "개. !경품시작으로 재개하세요."); return;
                }
                if (data.state.paused) { finish(job, "현재 추첨이 중지되어 있습니다. 잠시 후 다시 참여해주세요."); return; }
                var previous = data.people[job.user];
                if (previous) { finish(job, "이미 참여하셨습니다. " + result(previous, data.state.round)); return; }
                // 시계가 이전 날짜로 돌아갔을 때 과거 일자 재고를 다시 배정하지 않습니다.
                if (data.state.winners.some(function (w) { return w.day > today; })) throw Error("시계 역행");
                var available = C.ranks.filter(function (r) {
                    return data.totals[r.id] < r.total && (data.daily[today + ":" + r.id] || 0) < r.dailyLimit;
                });
                var remaining = available.reduce(function (n, r) { return n + r.total - data.totals[r.id]; }, 0);
                if (!remaining) {
                    finish(job, data.state.winners.length === C.totalPrizes ? "모든 경품이 소진되었습니다." : "오늘 배정 가능한 경품이 없습니다. 내일 다시 참여해주세요."); return;
                }
                var pick = Math.random() * remaining, selected = available[available.length - 1];
                for (var i = 0; i < available.length; i++) {
                    pick -= available[i].total - data.totals[available[i].id];
                    if (pick < 0) { selected = available[i]; break; }
                }
                var winner = { no: data.state.revision + 1, user: job.user, rank: selected.id, day: today, at: Date.now() };
                // 날짜 경계는 추첨 시각 하나로 고정합니다.
                winner.day = day(winner.at);
                if (winner.day !== today) { finish(job, "날짜가 변경되었습니다. 다시 참여해주세요."); return; }
                data.state.winners.push(winner); data.state.revision++;
                // 쓰기 콜백/트랜잭션 API를 가정하지 않고 재조회 결과로 확인합니다.
                save(job, id, data, result(winner, data.state.round));
            }));
        } catch (_) { fail("스토리지 접근 오류입니다."); }
    }
    function enqueue(p, kind, page, argument) {
        try { checkConfig(); } catch (e) { tell(p, e.message); return; }
        if (String(App.mapHashID) !== C.drawMapId) { tell(p, "지정된 추첨 맵에서 참여해주세요."); return; }
        if (stopped) { tell(p, "추첨 점검 중입니다. 관리자에게 문의하세요."); return; }
        if (kind !== "draw" && !(p.role >= 3000)) { tell(p, "관리자 전용 명령입니다."); return; }
        var user = identity(p);
        if (kind === "draw" && !user) { tell(p, "ZEP 로그인 후 참여해주세요. 계정 식별 정보를 확인할 수 없습니다."); return; }
        var key = kind === "draw" ? "draw:" + user : "admin:" + String(p.id);
        if (pending[key]) { tell(p, "이전 요청 처리 중입니다."); return; }
        if (queue.length >= C.maxQueue) { tell(p, "참여자가 많습니다. 잠시 후 다시 시도해주세요."); return; }
        pending[key] = true;
        queue.push({ player: p, user: user, key: key, kind: kind, page: page || 1, argument: argument });
        process();
    }
    App.onSay.Add(function (p, text) {
        text = String(text).trim();
        if (text === "!추첨") tell(p, "경품 오브젝트 앞에서 F 상호작용으로 참여해주세요.");
        else if (text === "!경품현황") enqueue(p, "status");
        else if (text === "!경품중지") enqueue(p, "pause");
        else if (text === "!경품시작") enqueue(p, "resume");
        else if (text === "!경품초기화") enqueue(p, "resetPrepare");
        else if (/^!경품초기화\s+\S+$/.test(text)) enqueue(p, "reset", 1, text.split(/\s+/)[1]);
        else if (/^!당첨목록(?:\s+[1-9][0-9]*)?$/.test(text)) enqueue(p, "winners", Number(text.split(/\s+/)[1] || 1));
        else if (text === "!경품도움말") tell(p, "경품 오브젝트 앞에서 F 상호작용: 회차당 계정별 1회 당첨\n" +
            "관리자: !경품현황 / !당첨목록 1 / !경품중지 / !경품시작 / !경품초기화 → 확인 코드 입력");
    });
    App.onTriggerObject.Add(function (p, layer, x, y, key) {
        var pos = C.objectPosition;
        if (pos !== null) {
            if (!object(pos) || layer !== pos.layer || x !== pos.x || y !== pos.y) return;
        } else if (key !== C.objectKey) return;
        enqueue(p, "draw");
    });
    App.onSidebarTouched.Add(function (p) {
        tell(p, "경품 오브젝트 앞에서 F 상호작용으로 참여해주세요. !경품도움말");
    });
    App.onJoinPlayer.Add(function (p) { tell(p, "경품 오브젝트 앞에서 F 상호작용으로 참여하세요. !경품도움말"); });
    App.onUpdate.Add(function (dt) {
        if (stopped) return;
        if (busy) {
            elapsed += dt;
            if (elapsed > C.storageTimeoutSeconds) fail("저장 응답이 지연되어 결과 확인이 필요합니다.");
        } else process();
    });
    // 서버 이전 때 새 쓰기를 멈춥니다. 메모리를 재저장해 최신 원장을 덮어쓰지 않습니다.
    if (App.onMigrationStart && App.onMigrationStart.Add) App.onMigrationStart.Add(function () { fail("서버 이전 중입니다."); });
    App.onDestroy.Add(function () { fail("앱이 종료되었습니다."); });
})(App, PRIZE_CONFIG);
