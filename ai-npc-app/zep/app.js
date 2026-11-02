/* ZEP runtime adapter. build.py prepends config, controller and dialogue engine. */
(function () {
    "use strict";
    var npcs = [], chats = {}, editors = {}, conversations = {}, clock = 0;
    var personas = {}, storeRevision = 0, storageReady = false, storageError = "", saving = false;
    var STORE_KEY = "aiNpcOfflineV2";
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
    function record(id, npc) {
        var key = String(id) + ":" + npc.id, persona = personas[npc.id], entry = conversations[key];
        if (!entry || entry.revision !== persona.revision || clock - entry.touched > 1800) {
            if (Object.keys(conversations).length >= 500) {
                var oldest = Object.keys(conversations).sort(function (a, b) { return conversations[a].touched - conversations[b].touched; })[0];
                delete conversations[oldest];
            }
            entry = { revision: persona.revision, state: NpcDialogue.fresh(), history: [], touched: clock };
            conversations[key] = entry;
        }
        entry.touched = clock;
        return entry;
    }
    function suggestions(persona) {
        return persona.rules.filter(function (r) { return r.id !== "builtin_hello" && r.id !== "builtin_bye" && r.id !== "builtin_thanks"; })
            .slice(0, 5).map(function (r) { return { label: r.title, message: r.keywords[0] }; });
    }
    function open(n, p) {
        var id = String(p.id);
        if (!storageReady) { p.sendMessage(storageError || "캐릭터 설정을 불러오고 있어요. 잠시 후 다시 말 걸어 주세요."); return; }
        if (chats[id] && chats[id].npc === n) return;
        close(id);
        var w = p.showWidgetResponsive("chat.html", 12, p.isMobile ? 3 : 28, 12, p.isMobile ? 3 : 28);
        var c = { npc: n, widget: w, pending: null, last: -100, initialized: false };
        chats[id] = c;
        w.onMessage.Add(function (sender, data) {
            if (String(sender.id) !== id || chats[id] !== c || !data || typeof data !== "object") return;
            if (data.type === "npc.close") { close(id); return; }
            if (distance(n, sender) > NPC_CONFIG.resumeRadius) { close(id); return; }
            if (data.type === "npc.editor" && admin(sender)) { close(id); openEditor(sender); return; }
            var persona = personas[n.id];
            if (!persona) return;
            if (data.type === "npc.ready") {
                if (!c.initialized) {
                    c.initialized = true;
                    var saved = record(id, n);
                    if (!saved.history.length) saved.history.push({ role: "assistant", text: NpcDialogue.greeting(persona, saved.state, sender.name) });
                    w.sendMessage({ type: "npc.init", name: persona.name, history: saved.history, suggestions: suggestions(persona), canEdit: admin(sender) });
                }
                return;
            }
            if (data.type !== "npc.chat" || typeof data.requestId !== "string" || data.requestId.length > 100) return;
            function error(text) { w.sendMessage({ type: "npc.reply", requestId: data.requestId, error: text }); }
            if (typeof data.message !== "string" || !data.message.trim() || data.message.length > 1000) { error("메시지는 1~1000자로 입력해 주세요."); return; }
            if (c.pending || clock - c.last < 0.6) { error("잠시만 기다려 주세요."); return; }
            c.pending = data.requestId; c.last = clock;
            App.runLater(function () {
                if (chats[id] !== c || c.pending !== data.requestId) return;
                c.pending = null;
                var current = player(id);
                if (!current || distance(n, current) > NPC_CONFIG.resumeRadius) { close(id); return; }
                var live = personas[n.id], entry = record(id, n);
                var answer = NpcDialogue.reply(live, data.message.trim(), entry.state, current.name);
                entry.history.push({ role: "user", text: data.message.trim() }, { role: "assistant", text: answer });
                entry.history = entry.history.slice(-40);
                w.sendMessage({ type: "npc.reply", requestId: data.requestId, answer: answer, name: live.name, suggestions: suggestions(live) });
            }, 0.35);
        });
    }
    function parseRoot(raw) {
        var root = JSON.parse(raw || "{}");
        if (!root || typeof root !== "object" || Array.isArray(root)) throw new Error("Invalid storage");
        return root;
    }
    function readPack(root) {
        var saved = root[STORE_KEY];
        if (!saved) {
            saved = { schema: 2, revision: 0, personas: {} };
            NPC_CONFIG.characters.forEach(function (def) { saved.personas[def.id] = NpcDialogue.defaults(def.id, def.style || "friendly"); });
        }
        if (saved.schema !== 2 || !Number.isInteger(saved.revision) || saved.revision < 0 || !saved.personas || typeof saved.personas !== "object" || Array.isArray(saved.personas)) throw new Error("Invalid persona storage");
        var validated = {};
        NPC_CONFIG.characters.forEach(function (def) {
            var value = Object.prototype.hasOwnProperty.call(saved.personas, def.id) ? saved.personas[def.id] : NpcDialogue.defaults(def.id, def.style);
            var check = NpcDialogue.validate(value);
            if (check.error || !Number.isInteger(value.revision) || value.revision < 1) throw new Error("Invalid saved persona");
            check.value.revision = value.revision;
            validated[def.id] = check.value;
        });
        return { schema: 2, revision: saved.revision, personas: validated };
    }
    function applyPack(pack) {
        personas = pack.personas; storeRevision = pack.revision; storageReady = true; storageError = "";
        npcs.forEach(function (n) {
            n.name = personas[n.id].name;
            if (n.object && n.object.npcProperty) {
                n.object.npcProperty.name = n.name;
                if (typeof n.object.sendUpdated === "function") n.object.sendUpdated();
            }
        });
    }
    function load(done) {
        App.getStorage(function (raw) {
            try { applyPack(readPack(parseRoot(raw))); if (done) done(null); }
            catch (e) { storageError = "저장된 캐릭터 설정을 읽지 못했어요. 관리자에게 알려 주세요."; if (done) done(storageError); }
        });
    }
    function openEditor(p) {
        if (!admin(p)) return;
        var id = String(p.id);
        if (editors[id]) { editors[id].destroy(); delete editors[id]; }
        var w = p.showWidgetResponsive("editor.html", 3, p.isMobile ? 2 : 12, 3, p.isMobile ? 2 : 12);
        editors[id] = w;
        w.onMessage.Add(function (sender, data) {
            if (String(sender.id) !== id || editors[id] !== w || !data || typeof data !== "object") return;
            if (!admin(sender)) { w.destroy(); delete editors[id]; return; }
            if (data.type === "editor.close") { w.destroy(); delete editors[id]; return; }
            function send(payload) { if (editors[id] === w) w.sendMessage(payload); }
            if (data.type === "editor.ready" || data.type === "editor.reload") {
                load(function (err) {
                    if (err) send({ type: "editor.error", error: err });
                    else send({ type: "editor.init", personas: personas, revision: storeRevision, styles: NpcDialogue.styles });
                });
                return;
            }
            if (data.type === "editor.preset") {
                if (!Object.prototype.hasOwnProperty.call(personas, data.npcId) || !NpcDialogue.styles.some(function (s) { return s.id === data.style; })) return;
                send({ type: "editor.preset", preset: NpcDialogue.defaults(data.npcId, data.style) });
                return;
            }
            if (data.type !== "editor.save") return;
            if (saving) { send({ type: "editor.error", error: "다른 저장을 처리 중이에요. 잠시 후 다시 시도해 주세요." }); return; }
            if (typeof data.npcId !== "string" || !Object.prototype.hasOwnProperty.call(personas, data.npcId)) return;
            var check = NpcDialogue.validate(data.persona);
            if (check.error) { send({ type: "editor.error", error: check.error }); return; }
            saving = true;
            App.getStorage(function (raw) {
                if (!admin(sender) || editors[id] !== w) { saving = false; return; }
                try {
                    var root = parseRoot(raw), pack = readPack(root);
                    if (pack.revision !== data.expectedRevision) { saving = false; send({ type: "editor.error", error: "다른 수정 내용이 있어요. 다시 불러온 뒤 저장해 주세요." }); return; }
                    check.value.revision = pack.personas[data.npcId].revision + 1;
                    pack.personas[data.npcId] = check.value; pack.revision++;
                    root[STORE_KEY] = pack;
                    var serialized = JSON.stringify(root);
                    if (serialized.length > 50000) { saving = false; send({ type: "editor.error", error: "설정이 너무 커요. 대사 수나 길이를 줄여 주세요." }); return; }
                    App.setStorage(serialized);
                    function verify(attempt) {
                        App.getStorage(function (latest) {
                            try {
                                var confirmed = readPack(parseRoot(latest));
                                if (confirmed.revision === pack.revision && JSON.stringify(confirmed.personas) === JSON.stringify(pack.personas)) {
                                    applyPack(confirmed); saving = false;
                                    // Existing conversation state resets on next record() by revision.
                                    Object.keys(chats).forEach(function (uid) { if (chats[uid].npc.id === data.npcId) close(uid); });
                                    send({ type: "editor.saved", personas: personas, revision: storeRevision });
                                } else if (attempt < 2) App.runLater(function () { verify(attempt + 1); }, 0.5);
                                else { saving = false; send({ type: "editor.error", error: "저장 확인이 지연되고 있어요. 다시 불러와 확인해 주세요." }); }
                            } catch (e) { saving = false; send({ type: "editor.error", error: "저장 결과를 확인하지 못했어요." }); }
                        });
                    }
                    verify(0);
                } catch (e) { saving = false; send({ type: "editor.error", error: "설정을 저장하지 못했어요. 저장된 데이터를 확인해 주세요." }); }
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
    App.onInit.Add(function () {
        var sprite = App.loadSpritesheet(NPC_CONFIG.sprite.file, NPC_CONFIG.sprite.frameWidth,
            NPC_CONFIG.sprite.frameHeight, NPC_CONFIG.sprite.animations, NPC_CONFIG.sprite.frameRate);
        NPC_CONFIG.characters.forEach(function (def) { create(def, sprite); });
        load();
    });
    App.onUpdate.Add(function (dt) {
        if (typeof dt !== "number" || !isFinite(dt) || dt < 0) return;
        clock += dt;
        npcs.forEach(function (n) { n.controller.tick(dt); });
        Object.keys(conversations).forEach(function (key) {
            if (clock - conversations[key].touched > 1800) delete conversations[key];
        });
    });
    // Direct F detection avoids relying on editor-only onTriggerObject behavior.
    App.addOnKeyDown(70, function (p) { interact(p); });
    App.onTriggerObject.Add(function (p, layer, x, y, key) { if (typeof key === "string") interact(p, key); });
    App.onAppObjectAttacked.Add(function (p, x, y, layer, key) { interact(p, key); });
    App.putMobilePunch(true); // On mobile, face the NPC and use the interaction/punch button.
    App.onLeavePlayer.Add(function (p) {
        var id = String(p.id); close(id);
        if (editors[id]) { editors[id].destroy(); delete editors[id]; }
        Object.keys(conversations).forEach(function (key) { if (key.indexOf(id + ":") === 0) delete conversations[key]; });
    });
    App.onSay.Add(function (p, text) {
        if (text === "!npc") { interact(p); return; }
        if (text === "!npc-admin") openEditor(p);
    });
}());
