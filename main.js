/* ZEP runtime entrypoint. No npm dependencies or Node APIs. */
var CoinRewards = (function () {
    "use strict";
    var FIELD = "zepCoinRewards";
    var MAX_INTEGER = 9007199254740991;
    var MAX_CLAIMS = 1000;
    var rewards = Object.create(null);
    var owns = function (object, key) {
        return Object.prototype.hasOwnProperty.call(object, key);
    };

    // Change coordinates to those of your map-editor object. Keep its id stable.
    var OBJECT_REWARDS = [
        { id: "object:lobby:treasure-01", layer: 3, x: 10, y: 10, coins: 10 }
    ];

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
            player.storage = JSON.stringify(data.root);
            return { status: "granted", amount: rewards[id], coins: state.coins };
        } catch (error) {
            // Never reset or overwrite unreadable data.
            return { status: "storage_error" };
        }
    }

    function balance(player) {
        try { return { status: "ok", coins: read(player).state.coins }; }
        catch (error) { return { status: "storage_error" }; }
    }

    function showBalance(player) {
        var result = balance(player);
        player.showCenterLabel(result.status === "ok" ?
            "보유 코인: " + result.coins : "코인 데이터를 읽을 수 없습니다. 관리자에게 문의하세요.");
    }

    for (var i = 0; i < OBJECT_REWARDS.length; i++) {
        var entry = OBJECT_REWARDS[i];
        if ((entry.layer !== 3 && entry.layer !== 5) ||
                !integer(entry.x) || !integer(entry.y)) throw new Error("Invalid object location");
        for (var j = 0; j < i; j++) {
            var previous = OBJECT_REWARDS[j];
            if (previous.layer === entry.layer && previous.x === entry.x && previous.y === entry.y) {
                throw new Error("Duplicate object location");
            }
        }
        register(entry.id, entry.coins);
    }

    App.onJoinPlayer.Add(showBalance);
    App.onTriggerObject.Add(function (player, layerId, x, y, key) {
        // Match documented tile coordinates/layer; do not assume key semantics.
        for (var i = 0; i < OBJECT_REWARDS.length; i++) {
            var entry = OBJECT_REWARDS[i];
            if (entry.layer !== layerId || entry.x !== x || entry.y !== y) continue;
            var result = grant(player, entry.id);
            if (result.status === "granted") {
                player.showCenterLabel("+" + result.amount + " 코인! 보유 코인: " + result.coins);
            } else if (result.status === "already_claimed") {
                player.showCenterLabel("이미 보상을 받은 오브젝트입니다. 보유 코인: " + result.coins);
            } else {
                player.showCenterLabel("보상을 지급할 수 없습니다. 관리자에게 문의하세요.");
            }
            return;
        }
    });

    return { register: register, grant: grant, balance: balance };
}());
