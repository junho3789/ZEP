/* ZEP runtime adapter. build.py prepends config, controller and dialogue engine. */
(function () {
    "use strict";
    var npcs = [], chats = {}, editors = {}, conversations = {}, clock = 0;
    var personas = {}, storeRevision = 0, storageReady = false, storageError = "", saving = false;
    var STORE_KEY = "aiNpcOfflineV2";
    var VERSION = "2.0.3", sprite = null, resourceError = "", failures = {}, started = false;
    function problem(id, error) { failures[id] = String(error && error.message ? error.message : error).slice(0, 240); }
    function hostCall(label, fn) {
        try { return fn(); }
        catch (e) { throw new Error(label + " | " + String(e && e.message ? e.message : e)); }
    }
    function tile(layer, x, y) {
        x = Number(x); y = Number(y);
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= Number(Map.width) || y >= Number(Map.height)) {
            throw new Error("타일 좌표 오류: layer=" + layer + ",x=" + x + ",y=" + y);
        }
        return hostCall("타일 조회 layer=" + layer + ",x=" + x + ",y=" + y, function () { return Map.getTile(layer, x, y); });
    }
    function move(n, x, y, path, seconds) {
        x = Number(x); y = Number(y);
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= Number(Map.width) || y >= Number(Map.height)) {
            throw new Error("이동 좌표 오류: " + n.id + ",x=" + x + ",y=" + y);
        }
        return hostCall("이동 요청 " + n.id + " x=" + x + ",y=" + y + ",path=" + path, function () {
            return Map.moveObjectWithKey(n.key, x, y, path, seconds);
        });
    }
    function walk(n, x, y, seconds) {
        var current = position(n);
        if (Math.abs(current.x - x) + Math.abs(current.y - y) !== 1) throw new Error("배회는 인접 한 타일만 이동할 수 있어요");
        if (blocked(n, x, y, true)) return false;
        // ZEP GetWeight throws on this map for usePath=true. Only execute a
        // prevalidated cardinal step, never a multi-tile path or obstacle bypass.
        var accepted = move(n, x, y, false, seconds);
        if (accepted !== false) delete failures[n.id];
        return accepted;
    }
    function admin(p) { return p && (p.role === 3000 || p.role === 3001); }
    function player(id) {
        for (var i = 0; i < App.players.length; i++) if (String(App.players[i].id) === String(id)) return App.players[i];
        return null;
    }
    function position(n) {
        var o = hostCall("위치 조회 " + n.id, function () { return Map.getObjectWithKey(n.key); });
        if (!o || typeof o.tileX !== "number" || typeof o.tileY !== "number") throw new Error("NPC 오브젝트 조회 실패: " + n.id);
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
    function blocked(n, x, y, nativePath) {
        if (x < 0 || y < 0 || x >= Map.width || y >= Map.height) return "맵 경계";
        // Conservative policy: avoid all map objects, walls and impassable effect tiles.
        if (Number(tile(2, x, y)) === 1) return "통행 불가";
        if (!nativePath) {
            if (Number(tile(1, x, y)) >= 0) return "벽 그림";
            if (Number(tile(3, x, y)) >= 0) return "오브젝트 그림";
            if (Number(tile(5, x, y)) >= 0) return "상단 그림";
        }
        for (var i = 0; i < npcs.length; i++) {
            if (npcs[i] === n) continue;
            var q = position(npcs[i]);
            if (q.x === x && q.y === y) return "다른 NPC";
        }
        for (var j = 0; j < App.players.length; j++) {
            if (Number(App.players[j].tileX) === x && Number(App.players[j].tileY) === y) return "유저 위치";
        }
        return "";
    }
    function canWalk(n, x, y) { return !blocked(n, x, y); }
    function dimensions() {
        if (!(Map.width > 0 && Map.height > 0)) throw new Error("맵 크기를 아직 읽을 수 없어요");
        return { width: Math.floor(Map.width), height: Math.floor(Map.height) };
    }
    function clipped(def, anchor) {
        var size = dimensions(), copy = {}, keys = Object.keys(def);
        keys.forEach(function (k) { copy[k] = def[k]; });
        function clamp(v, max) { return Math.max(0, Math.min(max - 1, Math.round(v))); }
        copy.x = clamp(anchor ? anchor.tileX : def.x, size.width);
        copy.y = clamp(anchor ? anchor.tileY : def.y, size.height);
        copy.minX = anchor ? Math.max(0, copy.x - 6) : clamp(def.minX, size.width);
        copy.maxX = anchor ? Math.min(size.width - 1, copy.x + 6) : clamp(def.maxX, size.width);
        copy.minY = anchor ? Math.max(0, copy.y - 6) : clamp(def.minY, size.height);
        copy.maxY = anchor ? Math.min(size.height - 1, copy.y + 6) : clamp(def.maxY, size.height);
        if (copy.minX > copy.maxX || copy.minY > copy.maxY) throw new Error("배회 영역의 최소·최대 좌표가 뒤바뀌었어요");
        copy.x = Math.max(copy.minX, Math.min(copy.maxX, copy.x));
        copy.y = Math.max(copy.minY, Math.min(copy.maxY, copy.y));
        return copy;
    }
    function freeTile(def, ignored) {
        // Nearby search, limited to the actual patrol region. Never replace map objects.
        var maxRadius = Math.max(def.maxX - def.minX, def.maxY - def.minY), checked = 0;
        for (var radius = 0; radius <= maxRadius; radius++) {
            for (var y = Math.max(def.minY, def.y - radius); y <= Math.min(def.maxY, def.y + radius); y++) {
                for (var x = Math.max(def.minX, def.x - radius); x <= Math.min(def.maxX, def.x + radius); x++) {
                    if (Math.max(Math.abs(x - def.x), Math.abs(y - def.y)) !== radius) continue;
                    if (++checked > 4096) throw new Error("빈 타일 검색 한도를 넘었어요. !npc-here를 사용해 주세요");
                    if (canWalk(ignored || null, x, y)) return { x: x, y: y };
                }
            }
        }
        throw new Error("배회 영역에 빈 타일이 없어요. 빈 공간에서 !npc-here를 사용해 주세요");
    }
    function create(def, exact) {
        if (!/^[a-z0-9_-]{1,64}$/.test(def.id)) throw new Error("Invalid NPC ID");
        if (npcs.some(function (n) { return n.id === def.id; })) throw new Error("Duplicate NPC ID");
        if ([def.x, def.y, def.minX, def.maxX, def.minY, def.maxY].some(function (v) {
            return typeof v !== "number" || !isFinite(v) || Math.floor(v) !== v;
        })) throw new Error("NPC 좌표는 정수여야 해요");
        def = clipped(def);
        var spawn = exact || freeTile(def);
        def.x = spawn.x; def.y = spawn.y;
        var n = { id: def.id, key: "ai-npc:" + def.id, name: personas[def.id] ? personas[def.id].name : def.name };
        Map.putObjectWithKey(def.x, def.y, sprite, { key: n.key, type: 21,
            useDirAnim: true, impassable: false, movespeed: 58, activeDistance: NPC_CONFIG.stopRadius,
            triggerByTouch: false, npcProperty: { name: n.name } });
        n.object = Map.getObjectWithKey(n.key);
        if (!n.object) throw new Error("생성한 오브젝트를 조회하지 못했어요");
        if (typeof Map.playObjectAnimationWithKey === "function") Map.playObjectAnimationWithKey(n.key, "down_idle", -1);
        var adapter = {
            position: function () { return position(n); },
            players: function () { return App.players.map(function (p) { return { id: p.id, x: p.tileX, y: p.tileY }; }); },
            // Each cardinal destination is checked locally before a direct step.
            canWalk: function (x, y) { return !blocked(n, x, y, true); },
            step: function (x, y, seconds) { return walk(n, x, y, seconds); },
            stop: function () { var q = position(n); move(n, q.x, q.y, false, 0.01); },
            openChat: function (p) { var actual = player(p.id); if (actual) open(n, actual); },
            closeChat: close
        };
        n.controller = new NpcController(adapter, { stopRadius: NPC_CONFIG.stopRadius,
            resumeRadius: NPC_CONFIG.resumeRadius, minX: def.minX, maxX: def.maxX, minY: def.minY, maxY: def.maxY });
        npcs.push(n);
        delete failures[n.id];
        return n;
    }
    function placeAtPlayer(p, id) {
        var original = NPC_CONFIG.characters.filter(function (d) { return d.id === id; })[0];
        if (!original) throw new Error("NPC ID는 " + NPC_CONFIG.characters.map(function (d) { return d.id; }).join(", ") + " 중에서 선택해 주세요");
        if (!sprite) loadSprite();
        if (!sprite) throw new Error(resourceError || "이미지를 로드하지 못했어요");
        var x = Number(p.tileX), y = Number(p.tileY), size = dimensions();
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= size.width || y >= size.height) throw new Error("현재 유저 좌표가 올바르지 않아요");
        if (Number(tile(2, x, y)) === 1) throw new Error("현재 타일은 통행 불가로 표시돼 있어요. 한 걸음 이동해 주세요");
        var n = npcs.filter(function (item) { return item.id === id; })[0];
        npcs.forEach(function (other) {
            if (other === n) return;
            var q = position(other);
            if (q.x === x && q.y === y) throw new Error("이미 다른 NPC가 있는 자리예요. 두세 타일 이동한 뒤 다시 입력해 주세요");
        });
        // Explicit admin placement overlays a new keyed app object at the user's
        // standing tile. It does not remove or replace editor map objects.
        var area = clipped(original, p);
        if (!n) n = create(area, { x: x, y: y });
        else {
            Object.keys(chats).forEach(function (uid) { if (chats[uid].npc === n) close(uid); });
            if (move(n, x, y, false, 0.01) === false) throw new Error("직접 배치 요청이 거부됐어요");
        }
        n.controller.c.minX = area.minX; n.controller.c.maxX = area.maxX;
        n.controller.c.minY = area.minY; n.controller.c.maxY = area.maxY;
        n.controller.state = "waiting"; n.controller.steps = 0;
        delete failures[id];
        p.sendMessage("[NPC " + VERSION + "] " + n.name + " 직접 배치 요청: (" + x + ", " + y + "). 캐릭터가 겹쳐 보이면 두세 타일 이동해 주세요.");
    }
    function interact(p, key) {
        var best = null, d = Infinity;
        npcs.forEach(function (n) { var nd = distance(n, p); if ((!key || key === n.key) && nd < d) { best = n; d = nd; } });
        if (best && d <= NPC_CONFIG.stopRadius) best.controller.interact({ id: p.id, x: p.tileX, y: p.tileY });
    }
    function loadSprite() {
        try {
            sprite = App.loadSpritesheet(NPC_CONFIG.sprite.file, NPC_CONFIG.sprite.frameWidth,
                NPC_CONFIG.sprite.frameHeight, NPC_CONFIG.sprite.animations, NPC_CONFIG.sprite.frameRate);
            if (!sprite) throw new Error("스프라이트 리소스가 비어 있어요. ZIP 안의 npc.png를 확인해 주세요");
            resourceError = "";
        } catch (e) { sprite = null; resourceError = String(e.message || e); }
    }
    function spawnMissing(anchor) {
        started = true;
        if (!sprite) loadSprite();
        if (!sprite) return;
        NPC_CONFIG.characters.forEach(function (def) {
            if (npcs.some(function (n) { return n.id === def.id; })) return;
            try { create(anchor ? clipped(def, anchor) : def); }
            catch (e) { problem(def.id, e); }
        });
    }
    function status(p) {
        p.sendMessage("[NPC " + VERSION + "] 실행 중 · 맵 " + Map.width + "×" + Map.height +
            " · 생성 " + npcs.length + "/" + NPC_CONFIG.characters.length + " · 설정 " + (storageReady ? "준비됨" : storageError || "로딩 중"));
        if (resourceError) p.sendMessage("[NPC 이미지] " + resourceError);
        else p.sendMessage("[NPC 이미지] " + NPC_CONFIG.sprite.file + " · 프레임 " + NPC_CONFIG.sprite.frameWidth + "×" + NPC_CONFIG.sprite.frameHeight);
        npcs.forEach(function (n) {
            try { var q = position(n); p.sendMessage("[NPC] " + n.name + " (" + q.x + ", " + q.y + ") · " + n.controller.state); }
            catch (e) { p.sendMessage("[NPC] " + n.id + " 조회 실패"); }
        });
        Object.keys(failures).forEach(function (id) { p.sendMessage("[NPC 오류] " + id + ": " + failures[id]); });
        if (admin(p)) {
            try { p.sendMessage("[NPC 현재 타일] (" + p.tileX + ", " + p.tileY + ") · 벽=" + Map.getTile(1, p.tileX, p.tileY) +
                " 효과=" + Map.getTile(2, p.tileX, p.tileY) + " 오브젝트=" + Map.getTile(3, p.tileX, p.tileY) + " 상단=" + Map.getTile(5, p.tileX, p.tileY)); }
            catch (e) { p.sendMessage("[NPC 현재 타일] 조회 실패"); }
            var around = [];
            for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
                try { var x = Number(p.tileX) + dx, y = Number(p.tileY) + dy;
                    around.push("(" + x + "," + y + ")=" + (blocked(null, x, y) || "비어 있음")); }
                catch (e) { around.push("타일 조회 실패"); }
            }
            p.sendMessage("[NPC 주변 판정] " + around.join(" / "));
        }
    }
    App.onInit.Add(function () { loadSprite(); try { load(); } catch (e) { storageError = String(e.message || e); } });
    // Object placement belongs to map-ready lifecycle, after resource initialization.
    App.onStart.Add(function () { spawnMissing(); });
    App.onJoinPlayer.Add(function (p) {
        App.runLater(function () {
            spawnMissing();
            if (admin(p)) p.sendMessage("[NPC " + VERSION + "] !npc-status 상태 확인 · !npc-place moa 현재 자리에 직접 배치");
        }, 0.2);
    });
    App.onUpdate.Add(function (dt) {
        if (typeof dt !== "number" || !isFinite(dt) || dt < 0) return;
        clock += dt;
        if (!started && App.players.length) spawnMissing();
        npcs.forEach(function (n) { try { n.controller.tick(dt); } catch (e) { problem(n.id, e); n.controller.state = "error"; n.controller.steps = 0; } });
        Object.keys(conversations).forEach(function (key) {
            if (clock - conversations[key].touched > 1800) delete conversations[key];
        });
    });
    // Direct F detection avoids relying on editor-only onTriggerObject behavior.
    App.addOnKeyDown(70, function (p) { interact(p); });
    if (App.onTriggerObject) App.onTriggerObject.Add(function (p, layer, x, y, key) { if (typeof key === "string") interact(p, key); });
    if (App.onAppObjectAttacked) App.onAppObjectAttacked.Add(function (p, x, y, layer, key) { interact(p, key); });
    if (typeof App.putMobilePunch === "function") App.putMobilePunch(true);
    App.onLeavePlayer.Add(function (p) {
        var id = String(p.id); close(id);
        if (editors[id]) { editors[id].destroy(); delete editors[id]; }
        Object.keys(conversations).forEach(function (key) { if (key.indexOf(id + ":") === 0) delete conversations[key]; });
    });
    App.onSay.Add(function (p, text) {
        if (/^!npc-place(?:\s|$)/.test(text) && admin(p)) {
            var selected = text.trim().split(/\s+/)[1] || NPC_CONFIG.characters[0].id;
            try { placeAtPlayer(p, selected); } catch (e) { problem(selected, e); p.sendMessage("[NPC 직접 배치] " + String(e.message || e)); }
            return;
        }
        if (text === "!npc-status") { status(p); return; }
        if (text === "!npc-here" && admin(p)) {
            spawnMissing(p);
            npcs.forEach(function (n) {
                try {
                    var original = NPC_CONFIG.characters.filter(function (d) { return d.id === n.id; })[0];
                    var area = clipped(original, p), target = freeTile(area, n);
                    Object.keys(chats).forEach(function (id) { if (chats[id].npc === n) close(id); });
                    if (move(n, target.x, target.y, false, 0.01) === false) throw new Error("근처 배치 요청이 거부됐어요");
                    n.controller.c.minX = area.minX; n.controller.c.maxX = area.maxX;
                    n.controller.c.minY = area.minY; n.controller.c.maxY = area.maxY;
                    delete failures[n.id];
                } catch (e) { problem(n.id, e); }
            });
            status(p); return;
        }
        if (text === "!npc") { interact(p); return; }
        if (text === "!npc-admin") openEditor(p);
    });
}());
