// Public, non-secret map settings. IDs must match the administrator's persona IDs.
var NPC_CONFIG = {
    stopRadius: 2,
    resumeRadius: 4,
    // Original attached sheet will replace this preview asset once available as a PNG file.
    sprite: { file: "npc.png", frameWidth: 32, frameHeight: 48, frameRate: 6,
        animations: { down: [0, 1, 2], left: [3, 4, 5], right: [6, 7, 8], up: [9, 10, 11],
            down_idle: [1], left_idle: [4], right_idle: [7], up_idle: [10] } },
    characters: [
        { id: "moa", name: "모아", style: "friendly", x: 8, y: 8, minX: 3, maxX: 16, minY: 3, maxY: 16 },
        { id: "sage", name: "서가", style: "calm", x: 12, y: 8, minX: 3, maxX: 16, minY: 3, maxY: 16 }
    ]
};
