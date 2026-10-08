/* ZEP runtime entrypoint. No npm dependencies or Node APIs. */
var CoinRewards = (function () {
    "use strict";
    var FIELD = "zepCoinRewards";
    var MAX_INTEGER = 9007199254740991;
    var MAX_CLAIMS = 1000;
    var rewards = Object.create(null);
    var huds = [];
    var monitors = [];
    var voteQueue = [];
    var voteBusy = false;
    var votePrompts = [];
    var VOTE_FIELD = "zepVoteTotals";
    var VOTE_COST = 10;
    var VOTE_OBJECTS = { "101": "A", "102": "B" };
    var MONITOR_NUMBER = "103";
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
        if (state.voteSeq !== undefined && !integer(state.voteSeq)) throw new Error("Invalid vote sequence");
        if (state.pendingVote !== undefined) {
            var pending = state.pendingVote;
            if (!object(pending) || (pending.box !== "A" && pending.box !== "B") ||
                    pending.amount !== VOTE_COST || !integer(pending.seq) || pending.seq < 1 ||
                    pending.seq !== state.voteSeq) throw new Error("Invalid pending vote");
        }
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
            if (state.pendingVote) return { status: "vote_pending" };
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

    function saveRecord(player, data) {
        var before = player.storage;
        try {
            data.root[FIELD] = data.state;
            player.storage = JSON.stringify(data.root);
            player.save();
        } catch (error) {
            try { player.storage = before; } catch (restoreError) {}
            throw error;
        }
        refreshHud(player);
    }

    function playerKey(player) {
        if ((typeof player.id !== "string" && typeof player.id !== "number") ||
                String(player.id) === "") throw new Error("Missing player identity");
        return "user:" + String(player.id);
    }

    function readTotals() {
        var raw = App.storage;
        if (raw !== null && raw !== undefined && typeof raw !== "string") throw new Error("Invalid app storage");
        var root = raw ? JSON.parse(raw) : {};
        if (!object(root)) throw new Error("Invalid app record");
        var totals = owns(root, VOTE_FIELD) ? root[VOTE_FIELD] : {
            version: 1, boxes: { A: { coins: 0, votes: 0 }, B: { coins: 0, votes: 0 } }, processed: {}
        };
        if (!object(totals) || totals.version !== 1 || !object(totals.boxes) ||
                !object(totals.processed)) throw new Error("Invalid vote totals");
        for (var i = 0; i < 2; i++) {
            var box = totals.boxes[i === 0 ? "A" : "B"];
            if (!object(box) || !integer(box.coins) || !integer(box.votes) ||
                    box.votes > MAX_INTEGER / VOTE_COST || box.coins !== box.votes * VOTE_COST) {
                throw new Error("Invalid vote box");
            }
        }
        if (!integer(totals.boxes.A.coins + totals.boxes.B.coins)) throw new Error("Total overflow");
        var keys = Object.keys(totals.processed);
        for (var j = 0; j < keys.length; j++) {
            var record = totals.processed[keys[j]];
            if (!object(record) || !integer(record.seq) || record.seq < 1 ||
                    (record.box !== "A" && record.box !== "B")) throw new Error("Invalid transaction record");
        }
        return { root: root, totals: totals };
    }

    // Serialize app read-modify-write operations in this one running map instance.
    // getStorage/setStorage do not provide a cross-server transaction or lock.
    function enqueueVote(work) {
        voteQueue.push(work);
        pumpVotes();
    }
    function pumpVotes() {
        if (voteBusy || voteQueue.length === 0) return;
        voteBusy = true;
        var work = voteQueue.shift();
        var called = false;
        function complete() {
            voteBusy = false;
            pumpVotes();
        }
        try {
            App.getStorage(function () {
                if (called) return;
                called = true;
                var data = null;
                try { data = readTotals(); } catch (error) {}
                try { work(data); } finally { complete(); }
            });
        } catch (error) {
            if (!called) {
                called = true;
                try { work(null); } finally { complete(); }
            }
        }
    }

    function transferVote(player, requestedBox, recovering) {
        enqueueVote(function (appData) {
            if (!appData) {
                player.sendMessage("투표 집계를 읽을 수 없습니다. 잠시 후 !vote-retry를 입력하세요.");
                return;
            }
            try {
                var key = playerKey(player);
                var data = read(player);
                var state = data.state;
                var pending = state.pendingVote;
                var previous = owns(appData.totals.processed, key) ? appData.totals.processed[key] : null;
                if (!pending) {
                    if (recovering) return;
                    if (state.coins < VOTE_COST) {
                        player.sendMessage("코인이 부족합니다. 투표에는 10코인이 필요합니다.");
                        return;
                    }
                    var sequence = state.voteSeq || 0;
                    if ((!previous && sequence > 0) || (previous && previous.seq > sequence)) throw new Error("Player/app history mismatch");
                    if (sequence === MAX_INTEGER) throw new Error("Vote sequence exhausted");
                    var box = appData.totals.boxes[requestedBox];
                    if (!box || appData.totals.boxes.A.coins + appData.totals.boxes.B.coins > MAX_INTEGER - VOTE_COST) {
                        throw new Error("Vote total overflow");
                    }
                    pending = { box: requestedBox, amount: VOTE_COST, seq: sequence + 1 };
                    state.coins -= VOTE_COST;
                    state.voteSeq = pending.seq;
                    state.pendingVote = pending;
                    saveRecord(player, data);
                }
                if (previous && previous.seq >= pending.seq) {
                    if (previous.seq !== pending.seq || previous.box !== pending.box) {
                        throw new Error("Transaction conflict");
                    }
                } else {
                    if ((!previous && pending.seq !== 1) || (previous && previous.seq !== pending.seq - 1)) throw new Error("Sequence gap");
                    var target = appData.totals.boxes[pending.box];
                    if (appData.totals.boxes.A.coins + appData.totals.boxes.B.coins > MAX_INTEGER - VOTE_COST) {
                        throw new Error("Vote total overflow");
                    }
                    target.coins += VOTE_COST;
                    target.votes += 1;
                    appData.totals.processed[key] = { seq: pending.seq, box: pending.box };
                    appData.root[VOTE_FIELD] = appData.totals;
                    // Keep pending debit on a write exception; never blindly refund an uncertain commit.
                    App.setStorage(JSON.stringify(appData.root));
                }
                var completedBox = pending.box;
                delete state.pendingVote;
                saveRecord(player, data);
                player.sendMessage("투표함 " + completedBox + "에 10코인을 투표했습니다. 보유 코인: " + state.coins);
                // Recovers first-login reward if a prior pending vote blocked it.
                grant(player, "welcome:v1");
            } catch (error) {
                player.sendMessage("투표 저장을 완료하지 못했습니다. !vote-retry로 재시도하세요. " +
                    "처리 중인 10코인은 재시도 때 다시 차감하지 않습니다.");
            }
        });
    }

    function resumeVote(player) {
        try {
            if (read(player).state.pendingVote) transferVote(player, null, true);
        } catch (error) {
            player.sendMessage("투표 데이터를 읽을 수 없습니다. 관리자에게 문의하세요.");
        }
    }

    function requestVote(player, box) {
        for (var i = 0; i < votePrompts.length; i++) if (votePrompts[i] === player) return;
        try {
            var state = read(player).state;
            if (state.pendingVote) {
                resumeVote(player);
                return;
            }
            if (state.coins < VOTE_COST) {
                player.sendMessage("코인이 부족합니다. 투표에는 10코인이 필요합니다.");
                return;
            }
            votePrompts.push(player);
            var answered = false;
            player.showConfirm("투표함 " + box + "에 10코인을 사용해 투표할까요?", function (accepted) {
                if (answered || votePrompts.indexOf(player) === -1) return;
                answered = true;
                for (var j = votePrompts.length - 1; j >= 0; j--) {
                    if (votePrompts[j] === player) votePrompts.splice(j, 1);
                }
                if (accepted) transferVote(player, box, false);
            });
        } catch (error) {
            for (var j = votePrompts.length - 1; j >= 0; j--) {
                if (votePrompts[j] === player) votePrompts.splice(j, 1);
            }
            player.sendMessage("투표를 시작할 수 없습니다. 관리자에게 문의하세요.");
        }
    }

    function closeMonitor(monitor) {
        monitor.active = false;
        try { monitor.widget.destroy(); } catch (error) {}
        for (var i = monitors.length - 1; i >= 0; i--) {
            if (monitors[i] === monitor) monitors.splice(i, 1);
        }
    }

    function loadMonitor(monitor) {
        if (!monitor.active || !monitor.ready || monitor.busy) return;
        monitor.busy = true;
        try { monitor.widget.sendMessage({ type: "vote_totals", status: "loading" }); }
        catch (error) { closeMonitor(monitor); return; }
        enqueueVote(function (appData) {
            monitor.busy = false;
            if (!monitor.active) return;
            var payload = { type: "vote_totals", status: "storage_error" };
            if (appData) {
                var a = appData.totals.boxes.A;
                var b = appData.totals.boxes.B;
                payload = { type: "vote_totals", status: "ok", boxCount: 2,
                    boxes: { A: { coins: a.coins, votes: a.votes },
                        B: { coins: b.coins, votes: b.votes } },
                    totalCoins: a.coins + b.coins, totalVotes: a.votes + b.votes };
            }
            try { monitor.widget.sendMessage(payload); }
            catch (error) { closeMonitor(monitor); }
        });
    }

    function showTotals(player) {
        for (var i = 0; i < monitors.length; i++) {
            if (monitors[i].player === player) { loadMonitor(monitors[i]); return; }
        }
        try {
            var widget = player.showWidgetResponsive("vote-monitor.html", 0, 0, 0, 0);
            var monitor = { player: player, widget: widget, ready: false, active: true, busy: false };
            monitors.push(monitor);
            widget.onMessage.Add(function (sender, data) {
                if (sender !== player || !monitor.active || !data) return;
                if (data.type === "vote_monitor_close") { closeMonitor(monitor); return; }
                if (data.type === "vote_monitor_ready") {
                    monitor.ready = true;
                    loadMonitor(monitor);
                } else if (data.type === "vote_monitor_refresh") {
                    loadMonitor(monitor);
                }
            });
        } catch (error) {
            player.sendMessage("집계 팝업을 열지 못했습니다. 잠시 후 모니터를 다시 실행하세요.");
        }
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
        var welcome = grant(player, "welcome:v1");
        if (welcome.status === "granted") player.sendMessage("첫 접속 보너스 100코인을 받았습니다!");
        else if (welcome.status !== "already_claimed" && welcome.status !== "vote_pending") {
            player.sendMessage("접속 보너스를 저장하지 못했습니다. 관리자에게 문의하세요.");
        }
        resumeVote(player);
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
    App.onLeavePlayer.Add(function (player) {
        removeHud(player);
        for (var m = monitors.length - 1; m >= 0; m--) {
            if (monitors[m].player === player) closeMonitor(monitors[m]);
        }
        for (var i = votePrompts.length - 1; i >= 0; i--) {
            if (votePrompts[i] === player) votePrompts.splice(i, 1);
        }
    });
    App.onSay.Add(function (player, text) {
        if (text === "!vote-retry") { resumeVote(player); return; }
        if (text === "!votes") { showTotals(player); return; }
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
        if (owns(VOTE_OBJECTS, number)) {
            var box = VOTE_OBJECTS[number];
            if (obj.param1 !== "vote:" + box) {
                player.sendMessage("투표함 값은 vote:" + box + "로 설정하세요.");
                return;
            }
            requestVote(player, box);
            return;
        }
        if (number === MONITOR_NUMBER) {
            if (obj.param1 === "votes:totals") showTotals(player);
            else player.sendMessage("모니터 값은 votes:totals로 설정하세요.");
            return;
        }
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
    register("welcome:v1", 100);
    return { register: register, grant: grant, balance: balance,
        requestVote: requestVote, showTotals: showTotals, resumeVote: resumeVote };
}());
