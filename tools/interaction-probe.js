/* Temporary ZEP runtime probe. Does not read or write player.storage. */
(function () {
    "use strict";
    function show(player, message) {
        player.showCenterLabel(message, 0xffffff, 0x222222, 0, 15000);
    }
    function describe(object) {
        if (!object) return "object=null";
        return JSON.stringify({
            type: object.type,
            param1: object.param1,
            param2: object.param2,
            param3: object.param3,
            param4: object.param4
        });
    }
    App.onJoinPlayer.Add(function (player) {
        show(player, "상호작용 진단 앱 실행됨. 번호 1, 값 coin:10인 오브젝트에서 F를 누르세요.");
    });
    App.onTriggerObject.Add(function (player, layerId, x, y, key) {
        var metadata;
        try {
            metadata = describe(Map.getObjectWithKey(key));
        } catch (error) {
            metadata = "getObjectWithKey 조회 실패";
        }
        show(player, "F 이벤트 " + JSON.stringify({ layer: layerId, x: x, y: y, key: key }) +
            "\n" + metadata);
    });
    App.onObjectTouched.Add(function (player, x, y, tileID, object) {
        if (!object || object.type !== 21) return;
        show(player, "접촉 이벤트 " + JSON.stringify({ x: x, y: y, tileID: tileID }) +
            "\n" + describe(object));
    });
}());
