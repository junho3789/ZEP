/* ZEP runtime entrypoint. No npm dependencies or Node APIs. */
var CoinRewards = (function () {
    "use strict";
    var FIELD = "zepCoinRewards";
    var MAX_INTEGER = 9007199254740991;
    var MAX_CLAIMS = 1000;
    var rewards = Object.create(null);
    var huds = [];
    var owns = function (object, key) {
        return Object.prototype.hasOwnProperty.call(object, key);
    };

    // Number 1 retains the original claim ID to preserve previous rewards.
    var LEGACY_OBJECT_ID = "object:lobby:treasure-01";

    function integer(value) {
        return typeof value === "number" && isFinite(value) &&
            Math.floor(value) === value && value >= 0 && value <= MAX_INTEGER;
    }

    function object(value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    function read(player) {
        var raw = player.storage;
        if (raw !== undefined && raw !== null && typeof raw !== "string") {
            throw new Error("Invalid player storage type");
        }
        var root = raw ? JSON.parse(raw) : {};
        if (!object(root)) throw new Error("Invalid player storage root");
        var state = owns(root, FIELD) ? root[FIELD] :
            { version: 1, coins: 0, claimed: {} };
        if (!object(state) || state.version !== 1 || !integer(state.coins) ||
                !object(state.claimed)) throw new Error("Invalid coin data");
        var keys = Object.keys(state.claimed);
        for (var i = 0; i < keys.length; i++) {
            if (state.claimed[keys[i]] !== true) throw new Error("Invalid claim data");
        }
        return { root: root, state: state };
    }

    function register(id, coins) {
        if (typeof id !== "string" || !/^[a-z][a-z0-9:_-]{0,119}$/.test(id) ||
                !integer(coins) || coins === 0 || owns(rewards, id)) {
            throw new Error("Invalid or duplicate reward definition");
        }
        rewards[id] = coins;
    }

    // Call only after a server-side condition (e.g. correct quiz answer) succeeds.
    // Returns a status; never accepts a user-supplied reward amount.
    function grant(player, id) {
        var previousStorage;
        var assigned = false;
        if (!owns(rewards, id)) return { status: "unknown_reward" };
        try {
            var data = read(player);
            var state = data.state;
            var claimKey = "reward:" + id;
            if (owns(state.claimed, claimKey)) {
                return { status: "already_claimed", coins: state.coins };
            }
            if (Object.keys(state.claimed).length >= MAX_CLAIMS) {
                return { status: "claim_limit", coins: state.coins };
            }
            if (state.coins > MAX_INTEGER - rewards[id]) {
                return { status: "balance_limit", coins: state.coins };
            }
            state.coins += rewards[id];
            state.claimed[claimKey] = true;
            data.root[FIELD] = state;
            // One storage write contains both the balance and duplicate guard.
            // The SDK exposes no durable-write acknowledgement or transaction.
            previousStorage = player.storage;
            player.storage = JSON.stringify(data.root);
            assigned = true;
            player.save();
            refreshHud(player);
            return { status: "granted", amount: rewards[id], coins: state.coins };
        } catch (error) {
            // Restore the in-memory record if save threw; no backend acknowledgement exists.
            if (assigned) {
                try { player.storage = previousStorage; } catch (restoreError) {}
            }
            // Never reset or overwrite unreadable data.
            return { status: "storage_error" };
        }
    }

    function balance(player) {
        try { return { status: "ok", coins: read(player).state.coins }; }
        catch (error) { return { status: "storage_error" }; }
    }

    function refreshHud(player) {
        for (var i = 0; i < huds.length; i++) {
            var hud = huds[i];
            if (hud.player !== player || !hud.ready) continue;
            var result = balance(player);
            try {
                hud.widget.sendMessage({ type: "coin_balance", status: result.status,
                    coins: result.status === "ok" ? result.coins : null });
            } catch (error) {
                // UI failure must not undo a saved reward.
            }
        }
    }

    function removeHud(player) {
        for (var i = huds.length - 1; i >= 0; i--) {
            if (huds[i].player !== player) continue;
            try { huds[i].widget.destroy(); } catch (error) {}
            huds.splice(i, 1);
        }
    }

    App.onJoinPlayer.Add(function (player) {
        removeHud(player);
        try {
            // Percent margins: top, right, bottom, left. Official guide pp.400-402.
            var widget = player.showWidgetResponsive("coin-hud.html", 8, 68, 80, 2);
            var hud = { player: player, widget: widget, ready: false };
            huds.push(hud);
            widget.onMessage.Add(function (sender, data) {
                if (sender !== player || !data || data.type !== "coin_hud_ready") return;
                hud.ready = true;
                refreshHud(player);
            });
        } catch (error) {
            player.sendMessage("코인 UI를 열지 못했습니다. !coins로 잔액을 확인하세요.");
        }
    });
    App.onLeavePlayer.Add(removeHud);
    App.onSay.Add(function (player, text) {
        if (text !== "!coins") return;
        var result = balance(player);
        player.sendMessage(result.status === "ok" ? "보유 코인: " + result.coins :
            "코인 데이터를 읽을 수 없습니다. 관리자에게 문의하세요.");
        refreshHud(player);
    });

    // Official guide p.207: number=obj.text, value=obj.param1.
    App.onObjectTouched.Add(function (player, x, y, tileID, obj) {
        if (!obj || obj.type !== 21) return;
        var number = String(obj.text);
        if (!/^[1-9][0-9]{0,8}$/.test(number)) return;
        if (obj.param1 === "balance") {
            refreshHud(player);
            var current = balance(player);
            player.sendMessage(current.status === "ok" ? "보유 코인: " + current.coins :
                "코인 데이터를 읽을 수 없습니다. 관리자에게 문의하세요.");
            return;
        }
        var match = typeof obj.param1 === "string" && /^coin:([1-9][0-9]{0,5})$/.exec(obj.param1);
        if (!match) {
            player.sendMessage("보상 값은 coin:10처럼 입력하세요. 지급액은 1~999999입니다.");
            return;
        }
        var id = number === "1" ? LEGACY_OBJECT_ID : "object:script:" + number;
        // This amount is read from map-editor metadata, never a widget message.
        rewards[id] = Number(match[1]);
        var result = grant(player, id);
        if (result.status === "granted") {
            player.sendMessage("+" + result.amount + " 코인! 보유 코인: " + result.coins);
        } else if (result.status === "already_claimed") {
            player.sendMessage("이미 보상을 받은 오브젝트입니다. 보유 코인: " + result.coins);
        } else {
            player.sendMessage("보상을 지급할 수 없습니다. 관리자에게 문의하세요.");
        }
    });

    register(LEGACY_OBJECT_ID, 10);
    return { register: register, grant: grant, balance: balance };
}());
