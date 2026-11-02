/* Sprite registration shared by the offline builder and tests. */
var NpcSprite = (function () {
    "use strict";
    var required = ["down", "left", "right", "up", "down_idle", "left_idle", "right_idle", "up_idle"];
    var labels = { down: "아래 걷기", left: "왼쪽 걷기", right: "오른쪽 걷기", up: "위 걷기",
        down_idle: "아래 정지", left_idle: "왼쪽 정지", right_idle: "오른쪽 정지", up_idle: "위 정지" };
    var directions = ["down", "left", "right", "up"], directionNames = ["아래", "왼쪽", "오른쪽", "위"];
    var groups = [{ id: "jump", label: "점프", loop: false }, { id: "sit", label: "앉기", loop: true }];
    function groupOf(id) { return groups.filter(function (g) { return directions.some(function (d) { return id === d + "_" + g.id; }); })[0]; }
    function defaults() {
        var motions = [{ id: "dance", label: "춤추기", loop: true }];
        groups.forEach(function (g) { directions.forEach(function (d, i) { motions.push({ id: d + "_" + g.id, label: directionNames[i] + " " + g.label, loop: g.loop }); }); });
        return motions;
    }
    function empty() { var selected = Object.create(null); required.forEach(function (k) { selected[k] = []; }); defaults().forEach(function (a) { selected[a.id] = []; }); return selected; }
    function validId(id) { return typeof id === "string" && /^[a-z][a-z0-9_]{0,31}$/.test(id) && ["idle", "constructor", "prototype", "__proto__"].indexOf(id) < 0; }
    function frames(list, limit, name) {
        if (!Array.isArray(list) || !list.length || list.length > 16 || list.some(function (i) { return !Number.isInteger(i) || i < 0 || i >= limit; })) throw new Error(name + " 프레임을 1~16개 지정해 주세요");
        return list.slice();
    }
    function build(selected, motions, limit, width, height, fps, display) {
        var animations = Object.create(null), actions = [], ids = Object.create(null);
        required.forEach(function (id) { animations[id] = frames(selected[id], limit, labels[id]); ids[id] = true; });
        if (!Array.isArray(motions) || motions.length > 40) throw new Error("모션 프레임 항목은 최대 40개까지 등록할 수 있어요");
        motions.forEach(function (m) {
            if (!validId(m.id) || ids[m.id] || typeof m.label !== "string" || !m.label.trim() || m.label.length > 24 || typeof m.loop !== "boolean") throw new Error("추가 모션의 고유 ID·표시 이름·반복 설정을 확인해 주세요");
            ids[m.id] = true;
            if (!selected[m.id] || !selected[m.id].length) return;
            animations[m.id] = frames(selected[m.id], limit, m.label);
            if (!groupOf(m.id)) actions.push({ id: m.id, label: m.label.trim(), loop: m.loop });
        });
        groups.forEach(function (g) {
            var names = directions.map(function (d) { return d + "_" + g.id; });
            if (!names.some(function (id) { return animations[id]; })) return;
            if (!names.every(function (id) { return animations[id]; })) throw new Error(g.label + "는 4방향을 모두 지정해 주세요");
            var looping = motions.filter(function (m) { return m.id === names[0]; })[0].loop;
            if (!names.every(function (id) { return motions.filter(function (m) { return m.id === id; })[0].loop === looping; })) throw new Error(g.label + "의 방향별 반복 설정을 같게 해 주세요");
            actions = actions.filter(function (a) { return a.id !== g.id; });
            actions.push({ id: g.id, label: g.label, loop: looping, directional: true });
        });
        if (actions.length > 16) throw new Error("재생 버튼은 최대 16개까지 등록할 수 있어요");
        display = display || { offsetX: 0, offsetY: 0 };
        if (!Number.isInteger(display.offsetX) || !Number.isInteger(display.offsetY) || Math.abs(display.offsetX) > 128 || Math.abs(display.offsetY) > 128) throw new Error("발 위치 보정은 -128~128px 정수로 입력해 주세요");
        return { file: "npc.png", frameWidth: width, frameHeight: height, frameRate: fps, animations: animations, actions: actions,
            displayOffsetX: display.offsetX, displayOffsetY: display.offsetY };
    }
    function read(settings, limit) {
        var selected = empty(), motions = defaults(), known = Object.create(null);
        required.forEach(function (id) { selected[id] = frames(settings.animations[id], limit, labels[id]); known[id] = true; });
        Object.keys(settings.animations).forEach(function (id) {
            if (known[id]) return;
            if (!validId(id)) throw new Error("지원하지 않는 모션 ID예요");
            selected[id] = frames(settings.animations[id], limit, id);
            var group = groupOf(id);
            var configured = (settings.actions || []).filter(function (m) { return m.id === id || (group && m.id === group.id && m.directional); })[0];
            var existing = motions.filter(function (m) { return m.id === id; })[0];
            if (existing) { if (configured) { if (!group) existing.label = configured.label; existing.loop = configured.loop; } }
            else motions.push({ id: id, label: configured ? configured.label : id, loop: configured ? configured.loop : false });
        });
        var display = { offsetX: settings.displayOffsetX || 0, offsetY: settings.displayOffsetY || 0 };
        build(selected, motions, limit, settings.frameWidth, settings.frameHeight, settings.frameRate, display);
        return { selected: selected, motions: motions, display: display };
    }
    return { required: required, labels: labels, defaults: defaults, empty: empty, validId: validId, build: build, read: read, groups: groups, groupOf: groupOf };
}());
if (typeof module !== "undefined") module.exports = NpcSprite;
