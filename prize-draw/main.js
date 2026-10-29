// 현장 확인용 룰렛: 영구 저장/당첨 원장/CSV/계정별 기록 없음.
var PRIZE_CONFIG = {
    drawMapId: "REPLACE_WITH_MAP_HASH_ID", // 관리자 !경품맵확인으로 확인
    autoOpenOnJoin: true, // 지정 맵 입장 시 팝업 자동 표시. 추첨은 버튼을 누를 때 실행.
    interactionMode: "editor",
    objectNumber: "1001",
    objectValue: "prize_draw",
    objectKey: "prize_draw",
    objectPosition: null,
    prizeNames: { rank1: "1등 경품", rank2: "2등 경품", rank3: "3등 경품" },
    ranks: [
        { id: "rank1", name: "1등", probability: 5 },
        { id: "rank2", name: "2등", probability: 10 },
        { id: "rank3", name: "3등", probability: 85 }
    ]
};

(function (App, C) {
    "use strict";
    // 현재 열린 팝업의 응답만 임시 보관하며 닫으면 폐기합니다.
    var sessions = Object.create(null), paused = false;
    function tell(p, text) { try { p.sendMessage("[경품] " + text); } catch (_) {} }
    function key(p) {
        if (!p || (typeof p.id !== "number" && typeof p.id !== "string") || String(p.id) === "" ||
            (typeof p.id === "number" && !isFinite(p.id))) return null;
        return String(p.id);
    }
    function send(session, packet) {
        try { session.widget.sendMessage(packet); return true; } catch (_) { return false; }
    }
    function close(p) {
        var id = key(p); if (id === null) return;
        var session = sessions[id]; delete sessions[id];
        if (session) { try { session.widget.destroy(); } catch (_) {} }
    }
    function notice(session, message) {
        session.phase = "error";
        session.packet = { type: "notice", message: message };
        send(session, session.packet);
    }
    function settings() {
        if (typeof C.drawMapId !== "string" || !C.drawMapId || C.drawMapId === "REPLACE_WITH_MAP_HASH_ID") throw Error("drawMapId를 설정해주세요. 관리자 !경품맵확인으로 확인할 수 있습니다.");
        if (String(App.mapHashID) !== C.drawMapId) throw Error("지정된 추첨 맵에서 이용해주세요.");
        if (["editor", "key", "position"].indexOf(C.interactionMode) < 0) throw Error("오브젝트 연결 모드를 확인해주세요.");
        if (C.interactionMode === "editor" && (typeof C.objectNumber !== "string" || !C.objectNumber || typeof C.objectValue !== "string" || !C.objectValue)) throw Error("오브젝트 Number/Value 설정을 확인해주세요.");
        if (C.interactionMode === "key" && (typeof C.objectKey !== "string" || !C.objectKey)) throw Error("오브젝트 key를 설정해주세요.");
        if (C.interactionMode === "position") {
            var pos = C.objectPosition;
            if (!pos || [3, 5].indexOf(pos.layer) < 0 || !Number.isInteger(pos.x) || pos.x < 0 || !Number.isInteger(pos.y) || pos.y < 0) throw Error("오브젝트 좌표를 확인해주세요.");
        }
        if (!Array.isArray(C.ranks) || C.ranks.length !== 3) throw Error("등수는 3개로 설정해주세요.");
        var ids = Object.create(null), total = 0;
        var ranks = C.ranks.map(function (r, i) {
            if (!r || typeof r.id !== "string" || !r.id || ids[r.id] || typeof r.name !== "string" || !r.name ||
                typeof r.probability !== "number" || !isFinite(r.probability) || r.probability < 0 || r.probability > 100) throw Error("등수/확률 설정을 확인해주세요.");
            ids[r.id] = true; total += r.probability;
            return { id: r.id, name: r.name, probability: r.probability, ball: String(i + 1),
                prize: C.prizeNames && typeof C.prizeNames[r.id] === "string" ? C.prizeNames[r.id] : r.name + " 경품" };
        });
        if (Math.abs(total - 100) > 0.000000001) throw Error("확률 합계를 100%로 수정해주세요. 수정 후 다시 확인할 수 있습니다.");
        return ranks;
    }
    function labels(ranks) { return ranks.map(function (r) { return { name: r.name, ball: r.ball }; }); }
    function prepare(session) {
        try {
            var ranks = settings();
            if (paused) { notice(session, "현재 추첨이 중지되어 있습니다. 잠시 후 다시 확인해주세요."); return; }
            session.phase = "idle";
            session.packet = { type: "idle", ranks: labels(ranks) };
            send(session, session.packet);
        } catch (error) { notice(session, error.message || "설정을 확인한 뒤 다시 시도해주세요."); }
    }
    function spin(session) {
        if (session.phase !== "idle") return;
        session.phase = "drawing";
        try {
            if (paused) { notice(session, "현재 추첨이 중지되어 있습니다. 잠시 후 다시 확인해주세요."); return; }
            // 매 요청마다 새 설정 스냅샷을 사용. 이전 설정/기록과 비교하지 않습니다.
            var ranks = settings(), value = Math.random();
            if (typeof value !== "number" || !isFinite(value) || value < 0 || value >= 1) throw Error("random unavailable");
            var pick = value * 100, selected = null;
            for (var i = 0; i < ranks.length; i++) {
                pick -= ranks[i].probability;
                if (pick < 0) { selected = ranks[i]; break; }
            }
            if (!selected) selected = ranks.filter(function (r) { return r.probability > 0; }).slice(-1)[0];
            var packet = { type: "result", rank: selected.name, ball: selected.ball, prize: selected.prize, ranks: labels(ranks) };
            session.phase = "result"; session.packet = packet;
            send(session, { type: "mixing" });
            send(session, packet);
        } catch (_) {
            // 실패한 요청만 종료. 다른 참여자나 앱 전체를 정지하지 않습니다.
            notice(session, "이번 추첨을 완료하지 못했습니다. 다시 확인을 눌러 재시도해주세요.");
        }
    }
    function open(p) {
        var id = key(p);
        if (id === null) { tell(p, "플레이어 정보를 확인할 수 없습니다. 맵에 다시 입장해주세요."); return; }
        if (sessions[id]) return;
        var session = null;
        try {
            var widget = p.showWidgetResponsive("prize-draw.html", 2, 2, 2, 2);
            if (!widget) throw Error("widget unavailable");
            session = { widget: widget, phase: "loading", packet: { type: "loading" } };
            sessions[id] = session;
            widget.onMessage.Add(function (sender, data) {
                if (key(sender) !== id || sessions[id] !== session || !data) return;
                try {
                    if (data.type === "close") close(p);
                    else if (data.type === "ready") {
                        if (session.phase === "result") send(session, { type: "mixing" });
                        send(session, session.packet);
                    }
                    else if (data.type === "spin") spin(session);
                    else if (data.type === "retry") {
                        if (session.phase === "result") {
                            send(session, { type: "mixing" }); send(session, session.packet);
                        } else if (session.phase !== "drawing") prepare(session);
                    }
                } catch (_) { tell(p, "화면 응답을 확인할 수 없습니다. 팝업을 닫고 다시 이용해주세요."); }
            });
            prepare(session);
        } catch (_) {
            close(p); tell(p, "팝업을 열지 못했습니다. 잠시 후 다시 이용해주세요. 반복되면 ZIP의 prize-draw.html을 확인해주세요.");
        }
    }
    App.onSay.Add(function (p, text) {
        text = String(text).trim();
        if (text === "!경품도움말") { tell(p, "맵 입장 → 자동 팝업 → 룰렛 돌리기. 닫은 뒤에는 오브젝트로 다시 열 수 있습니다.\n관리자: !경품맵확인 / !경품현황 / !경품중지 / !경품시작 / !경품재개"); return; }
        if (text === "!추첨") { tell(p, "맵의 경품 상호작용 오브젝트로 참여해주세요."); return; }
        if (["!경품맵확인", "!경품현황", "!경품중지", "!경품시작", "!경품재개", "!경품초기화", "!당첨내보내기"].indexOf(text) < 0 && !/^!당첨목록(?:\s|$)/.test(text)) return;
        if (!(p.role >= 3000)) { tell(p, "관리자 전용 명령입니다."); return; }
        if (text === "!경품맵확인") {
            tell(p, "mapHashID: " + String(App.mapHashID || "확인 불가") + "\nspaceHashID: " + String(App.spaceHashID || "확인 불가") + "\ndrawMapId: " + JSON.stringify(App.mapHashID)); return;
        }
        if (text === "!경품중지") { paused = true; tell(p, "추첨을 중지했습니다. !경품시작 또는 !경품재개로 재개합니다."); return; }
        // 설정 오류나 저장소 상태와 독립적으로 항상 작동합니다.
        if (text === "!경품시작" || text === "!경품재개") {
            paused = false;
            Object.keys(sessions).forEach(function (id) { if (sessions[id].phase === "error") prepare(sessions[id]); });
            tell(p, "추첨을 재개했습니다. 저장 초기화는 필요 없습니다."); return;
        }
        if (text === "!경품현황") {
            try { var ranks = settings(); tell(p, (paused ? "추첨 중지" : "추첨 진행") + " / 기록 저장 안 함 / 재고·일일 한도 없음\n" + ranks.map(function (r) { return r.name + ": " + r.probability + "%"; }).join("\n")); }
            catch (error) { tell(p, "설정 확인 필요: " + error.message + "\n앱은 오류로 정지되지 않으며 수정 후 다음 요청부터 적용됩니다."); }
            return;
        }
        tell(p, "현장 확인용 버전은 당첨 기록·CSV·초기화 기능을 사용하지 않습니다. 필요한 경우 !경품재개를 이용해주세요.");
    });
    App.onObjectTouched.Add(function (p, x, y, tileID, obj) {
        try {
            if (C.interactionMode !== "editor" || !obj) return;
            var type = typeof ObjectEffectType !== "undefined" ? ObjectEffectType.INTERACTION_WITH_ZEPSCRIPTS : 21;
            if (Number(obj.type) !== type || obj.text == null || obj.param1 == null) return;
            if (String(obj.text) === C.objectNumber && String(obj.param1) === C.objectValue) open(p);
        } catch (_) { tell(p, "오브젝트 연결을 확인한 뒤 다시 이용해주세요."); }
    });
    App.onTriggerObject.Add(function (p, layer, x, y, objectKey) {
        if (C.interactionMode === "key" && objectKey === C.objectKey) open(p);
        if (C.interactionMode === "position") {
            var pos = C.objectPosition;
            if (pos && pos.layer === layer && pos.x === x && pos.y === y) open(p);
        }
    });
    App.onJoinPlayer.Add(function (p) {
        if (C.autoOpenOnJoin !== false && typeof C.drawMapId === "string" && String(App.mapHashID) === C.drawMapId) open(p);
    });
    App.onSidebarTouched.Add(function (p) { tell(p, "입장 시 열린 팝업 또는 맵의 경품 상호작용 오브젝트로 참여해주세요."); });
    App.onLeavePlayer.Add(close);
    App.onDestroy.Add(function () { Object.keys(sessions).forEach(function (id) { close({ id: id }); }); });
})(App, PRIZE_CONFIG);
