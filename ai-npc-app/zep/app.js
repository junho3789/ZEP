/* ZEP runtime adapter. build.py prepends config.js and controller.js. */
(function () {
    "use strict";
    var npcs = [], chats = {}, connection = null, clock = 0, refreshAt = 0;
    var setupBusy = false, setupGeneration = 0, storageReady = false, STORE_KEY = "aiNpcConnectionV1";
    function admin(p) { return p && (p.role === 3000 || p.role === 3001); }
    function player(id) {
        for (var i = 0; i < App.players.length; i++) if (String(App.players[i].id) === String(id)) return App.players[i];
        return null;
    }
    function position(n) {
        var o = Map.getObjectWithKey(n.key);
        return { x: o.tileX, y: o.tileY };
    }
    function distance(n, p) {
        var q = position(n);
        return Math.max(Math.abs(q.x - p.tileX), Math.abs(q.y - p.tileY));
    }
    function close(id) {
        var c = chats[id];
        if (!c) return;
        delete chats[id]; // Invalidate callbacks before destroying the widget.
        c.npc.controller.close(id);
        c.widget.destroy();
    }
    function post(path, body, done) {
        if (!connection) { done({ error: "관리자가 !npc-setup으로 AI 서버를 연결해야 해요." }); return; }
        var completed = false;
        function finish(data) { if (completed) return; completed = true; done(data); }
        try {
            var accepted = App.httpPostJson(connection.url + path,
                { Authorization: "Bearer " + connection.token, "Content-Type": "application/json" }, body,
                function (raw) {
                    try { finish(JSON.parse(raw)); }
                    catch (e) { finish({ error: "AI 서버 응답을 읽지 못했어요." }); }
                });
            if (accepted === false) finish({ error: "서버 요청을 시작하지 못했어요." });
        } catch (e) { finish({ error: "AI 서버에 연결하지 못했어요." }); }
        App.runLater(function () { finish({ error: "응답이 지연되고 있어요. 다시 시도해 주세요." }); }, 28);
    }
    function refresh() {
        if (!connection) return;
        post("/characters", {}, function (data) {
            if (!data || !data.characters) return;
            npcs.forEach(function (n) {
                var meta = data.characters[n.id];
                if (!meta || typeof meta.name !== "string") return;
                n.name = meta.name;
                if (n.object && n.object.npcProperty) {
                    n.object.npcProperty.name = n.name;
                    if (typeof n.object.sendUpdated === "function") n.object.sendUpdated();
                }
            });
        });
    }
    function open(n, p) {
        var id = String(p.id);
        if (chats[id] && chats[id].npc === n) return;
        close(id);
        var w = p.showWidgetResponsive("chat.html", 12, p.isMobile ? 3 : 28, 12, p.isMobile ? 3 : 28);
        var c = { npc: n, widget: w, pending: null, last: -100, initialized: false };
        chats[id] = c;
        w.onMessage.Add(function (sender, data) {
            if (String(sender.id) !== id || chats[id] !== c || !data || typeof data !== "object") return;
            if (data.type === "npc.close") { close(id); return; }
            if (distance(n, sender) > NPC_CONFIG.resumeRadius) { close(id); return; }
            if (data.type === "npc.ready") {
                if (!c.initialized) { c.initialized = true; w.sendMessage({ type: "npc.init", name: n.name }); }
                return;
            }
            if (data.type !== "npc.chat" || typeof data.requestId !== "string" || data.requestId.length > 100) return;
            function error(text) { w.sendMessage({ type: "npc.reply", requestId: data.requestId, error: text }); }
            if (typeof data.message !== "string" || !data.message.trim() || data.message.length > 1500) { error("메시지는 1~1500자로 입력해 주세요."); return; }
            if (c.pending || clock - c.last < 1.5) { error("잠시만 기다려 주세요."); return; }
            c.pending = data.requestId; c.last = clock;
            // Player, map and NPC identities always come from authoritative ZEP objects.
            var sessionId = [App.spaceHashID, App.mapHashID, App.appHashID, sender.id].join(":");
            post("/chat", { sessionId: sessionId, npcId: n.id, message: data.message.trim() }, function (result) {
                if (chats[id] !== c || c.pending !== data.requestId) return;
                c.pending = null;
                var current = player(id);
                if (!current || distance(n, current) > NPC_CONFIG.resumeRadius) { close(id); return; }
                w.sendMessage({ type: "npc.reply", requestId: data.requestId,
                    answer: typeof result.answer === "string" ? result.answer : undefined,
                    error: result.error || (typeof result.answer === "string" ? undefined : "답변이 비어 있어요.") });
            });
        });
    }
    function canWalk(n, x, y) {
        if (x < 0 || y < 0 || x >= Map.width || y >= Map.height) return false;
        // Conservative policy: avoid all map objects, walls and impassable effect tiles.
        if (Map.getTile(1, x, y) >= 0 || Map.getTile(2, x, y) === 1 ||
            Map.getTile(3, x, y) >= 0 || Map.getTile(5, x, y) >= 0) return false;
        for (var i = 0; i < npcs.length; i++) {
            if (npcs[i] === n) continue;
            var q = position(npcs[i]);
            if (q.x === x && q.y === y) return false;
        }
        for (var j = 0; j < App.players.length; j++) {
            if (App.players[j].tileX === x && App.players[j].tileY === y) return false;
        }
        return true;
    }
    function create(def, sprite) {
        if (!/^[a-z0-9_-]{1,64}$/.test(def.id)) throw new Error("Invalid NPC ID");
        if (npcs.some(function (n) { return n.id === def.id; })) throw new Error("Duplicate NPC ID");
        if ([def.x, def.y, def.minX, def.maxX, def.minY, def.maxY].some(function (v) {
            return typeof v !== "number" || !isFinite(v) || Math.floor(v) !== v;
        }) || def.minX < 0 || def.minY < 0 || def.maxX >= Map.width || def.maxY >= Map.height ||
            def.x < def.minX || def.x > def.maxX || def.y < def.minY || def.y > def.maxY) throw new Error("Invalid NPC patrol bounds");
        if (!canWalk(null, def.x, def.y)) throw new Error("NPC spawn blocked: " + def.id);
        var n = { id: def.id, key: "ai-npc:" + def.id, name: def.name };
        n.object = Map.putObjectWithKey(def.x, def.y, sprite, { key: n.key, type: 21,
            useDirAnim: true, impassable: false, movespeed: 58, activeDistance: NPC_CONFIG.stopRadius,
            triggerByTouch: false, npcProperty: { name: n.name } });
        var adapter = {
            position: function () { return position(n); },
            players: function () { return App.players.map(function (p) { return { id: p.id, x: p.tileX, y: p.tileY }; }); },
            canWalk: function (x, y) { return canWalk(n, x, y); },
            step: function (x, y, seconds) { Map.moveObjectWithKey(n.key, x, y, true, seconds); },
            stop: function () { var q = position(n); Map.moveObjectWithKey(n.key, q.x, q.y, false, 0.01); },
            openChat: function (p) { var actual = player(p.id); if (actual) open(n, actual); },
            closeChat: close
        };
        n.controller = new NpcController(adapter, { stopRadius: NPC_CONFIG.stopRadius,
            resumeRadius: NPC_CONFIG.resumeRadius, minX: def.minX, maxX: def.maxX, minY: def.minY, maxY: def.maxY });
        npcs.push(n);
    }
    function interact(p, key) {
        var best = null, d = Infinity;
        npcs.forEach(function (n) { var nd = distance(n, p); if ((!key || key === n.key) && nd < d) { best = n; d = nd; } });
        if (best && d <= NPC_CONFIG.stopRadius) best.controller.interact({ id: p.id, x: p.tileX, y: p.tileY });
    }
    function rootStorage(raw) { try { var root = JSON.parse(raw || "{}"); return root && typeof root === "object" && !Array.isArray(root) ? root : {}; } catch (e) { return {}; } }
    App.onInit.Add(function () {
        var sprite = App.loadSpritesheet("npc.png", 32, 48, {
            down: [0, 1, 2], left: [3, 4, 5], right: [6, 7, 8], up: [9, 10, 11],
            down_idle: [1], left_idle: [4], right_idle: [7], up_idle: [10]
        }, 6);
        NPC_CONFIG.characters.forEach(function (def) { create(def, sprite); });
        App.getStorage(function (raw) {
            var saved = rootStorage(raw)[STORE_KEY];
            if (saved && /^https:\/\//.test(saved.url) && typeof saved.token === "string") connection = saved;
            storageReady = true; refresh();
        });
    });
    App.onUpdate.Add(function (dt) {
        if (typeof dt !== "number" || !isFinite(dt) || dt < 0) return;
        clock += dt;
        npcs.forEach(function (n) { n.controller.tick(dt); });
        if (clock >= refreshAt) { refreshAt = clock + 60; refresh(); }
    });
    // Direct F detection avoids relying on editor-only onTriggerObject behavior.
    App.addOnKeyDown(70, function (p) { interact(p); });
    App.onTriggerObject.Add(function (p, layer, x, y, key) { if (typeof key === "string") interact(p, key); });
    App.onAppObjectAttacked.Add(function (p, x, y, layer, key) { interact(p, key); });
    App.putMobilePunch(true); // On mobile, face the NPC and use the interaction/punch button.
    App.onLeavePlayer.Add(function (p) { close(String(p.id)); });
    App.onSay.Add(function (p, text) {
        if (text === "!npc") { interact(p); return; }
        if (text === "!npc-admin") {
            if (admin(p) && connection) p.openWebLink(connection.url + "/admin", false);
            return;
        }
        if (text !== "!npc-setup" || !admin(p)) return;
        if (!storageReady || setupBusy) { p.sendMessage("설정 처리 중이에요. 잠시 후 다시 시도해 주세요."); return; }
        setupBusy = true;
        var setupId = ++setupGeneration;
        function active() { return setupBusy && setupId === setupGeneration; }
        function finish() { if (setupId === setupGeneration) setupBusy = false; }
        App.runLater(function () { if (active()) finish(); }, 120);
        p.showPrompt("AI 서버 HTTPS 주소", function (url) {
            if (!active() || !admin(p) || typeof url !== "string") { finish(); return; }
            url = url.trim().replace(/\/+$/, "");
            if (!/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?(?:\/[a-zA-Z0-9_./-]*)?$/.test(url)) { p.sendMessage("올바른 HTTPS 주소를 입력해 주세요."); finish(); return; }
            p.showPrompt("서버의 ZEP_SHARED_SECRET 입력", function (token) {
                if (!active() || !admin(p) || typeof token !== "string" || token.length < 24 || token.length > 512) { p.sendMessage("24자 이상의 연결 키가 필요해요."); finish(); return; }
                App.getStorage(function (raw) {
                    if (!active() || !admin(p)) { finish(); return; }
                    var root = rootStorage(raw);
                    root[STORE_KEY] = { url: url, token: token };
                    App.setStorage(JSON.stringify(root));
                    connection = root[STORE_KEY]; finish(); refresh();
                    p.sendMessage("AI 서버 연결 설정을 저장했어요. !npc-admin으로 페르소나 에디터를 열 수 있어요.");
                });
            }, { textType: "password" });
        });
    });
}());
