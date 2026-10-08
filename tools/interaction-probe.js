/* Temporary ZEP runtime probe. Does not read or write player.storage. */
(function () {
    "use strict";
    var sessions = [];
    function session(player) {
        for (var i = 0; i < sessions.length; i++) {
            if (sessions[i].player === player) return sessions[i];
        }
        var state = { player: player, sequence: 0, touches: 0, triggers: 0,
            lastTouch: null, lastTrigger: null };
        sessions.push(state);
        return state;
    }
    function show(player, message) {
        var state = session(player);
        state.sequence += 1;
        player.sendMessage("[ZEP 진단 v2 #" + state.sequence + "] " + message);
    }
    function json(value) {
        // Keep absent fields visible instead of silently omitting them.
        return JSON.stringify(value, function (key, item) {
            return item === undefined ? "<undefined>" : item;
        });
    }
    function describe(object) {
        if (!object) return { object: null };
        return {
            index: object.index,
            type: object.type,
            text: object.text,
            subType: object.subType,
            subText: object.subText,
            param1: object.param1,
            param2: object.param2,
            param3: object.param3,
            param4: object.param4,
            triggerByTouch: object.triggerByTouch,
            activeDistance: object.activeDistance
        };
    }
    App.onJoinPlayer.Add(function (player) {
        show(player, "상호작용 진단 앱 실행됨. 번호 1, 값 coin:10인 오브젝트에서 F를 누르세요. " +
            "메시지는 개인 채팅에 표시됩니다. !diag로 최근 결과를 다시 볼 수 있습니다. 코인은 변경하지 않습니다.");
    });
    App.onTriggerObject.Add(function (player, layerId, x, y, key) {
        var state = session(player);
        state.triggers += 1;
        var raw = Array.prototype.slice.call(arguments, 1);
        // Raw arguments also expose differences from the SDK callback signature.
        var event = json({ args: raw, layer: layerId, x: x, y: y, key: key });
        var metadata = { object: null };
        try {
            if (typeof key === "string" && key !== "") {
                metadata = describe(Map.getObjectWithKey(key));
            } else {
                metadata = { lookup: "문자열 key가 없어 조회하지 않음" };
            }
        } catch (error) {
            metadata = { lookup: "getObjectWithKey 조회 실패" };
        }
        state.lastTrigger = event + " / " + json(metadata);
        show(player, "F 이벤트 " + event);
        show(player, "F 오브젝트 필드 " + json(metadata));
    });
    App.onObjectTouched.Add(function (player, x, y, tileID, object) {
        if (!object || object.type !== 21) return;
        var state = session(player);
        state.touches += 1;
        var snapshot = json({ x: x, y: y, tileID: tileID }) + " / " + json(describe(object));
        // Movement may emit the same touch repeatedly; keep the chat readable.
        if (snapshot === state.lastTouch) return;
        state.lastTouch = snapshot;
        show(player, "접촉 이벤트 " + snapshot);
        if (object.param1 === "coin:10") {
            show(player, "값 coin:10은 param1에서 확인됩니다. 번호는 아직 판별하지 않습니다. " +
                "접촉 이벤트만으로 F 실행 여부를 판단하거나 코인을 지급하지 않습니다.");
        }
    });
    App.onSay.Add(function (player, message) {
        if (message !== "!diag" && message !== "!diag-reset") return;
        var state = session(player);
        if (message === "!diag-reset") {
            state.touches = 0;
            state.triggers = 0;
            state.lastTouch = null;
            state.lastTrigger = null;
            show(player, "메모리 진단 기록을 초기화했습니다. 다시 F를 눌러주세요. 저장 코인은 변경하지 않았습니다.");
            return;
        }
        show(player, "관측 횟수: 접촉=" + state.touches + ", F=" + state.triggers);
        show(player, "최근 접촉: " + (state.lastTouch || "없음"));
        show(player, "최근 F: " + (state.lastTrigger || "없음"));
    });
    App.onLeavePlayer.Add(function (player) {
        for (var i = sessions.length - 1; i >= 0; i--) {
            if (sessions[i].player === player) sessions.splice(i, 1);
        }
    });
}());
