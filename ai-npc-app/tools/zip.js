/* Small ZIP writer using stored entries. No dependencies or network calls. */
var NpcZip = (function () {
    "use strict";
    var table = [];
    for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    function crc(data) { var c = 0xffffffff; for (var i = 0; i < data.length; i++) c = table[(c ^ data[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
    function header(size) { return { bytes: new Uint8Array(size), view: null }; }
    function join(parts) {
        var size = parts.reduce(function (sum, x) { return sum + x.length; }, 0), output = new Uint8Array(size), offset = 0;
        parts.forEach(function (part) { output.set(part, offset); offset += part.length; }); return output;
    }
    function create(files) {
        var local = [], central = [], offset = 0;
        files.forEach(function (file) {
            var name = new TextEncoder().encode(file.name), data = file.data, checksum = crc(data);
            var h = header(30), v = new DataView(h.bytes.buffer);
            v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x800, true);
            v.setUint16(12, 0x21, true); v.setUint32(14, checksum, true); v.setUint32(18, data.length, true); v.setUint32(22, data.length, true); v.setUint16(26, name.length, true);
            local.push(h.bytes, name, data);
            var directory = header(46), d = new DataView(directory.bytes.buffer);
            d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x800, true);
            d.setUint16(14, 0x21, true); d.setUint32(16, checksum, true); d.setUint32(20, data.length, true); d.setUint32(24, data.length, true);
            d.setUint16(28, name.length, true); d.setUint32(42, offset, true); central.push(directory.bytes, name);
            offset += h.bytes.length + name.length + data.length;
        });
        var directoryBytes = join(central), end = header(22), e = new DataView(end.bytes.buffer);
        e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
        e.setUint32(12, directoryBytes.length, true); e.setUint32(16, offset, true);
        return join(local.concat([directoryBytes, end.bytes]));
    }
    async function read(bytes) {
        if (!(bytes instanceof Uint8Array) || bytes.length > 15 * 1024 * 1024) throw new Error("15MB 이하의 앱 ZIP을 선택해 주세요");
        var v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), end = -1;
        for (var p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
            if (v.getUint32(p, true) === 0x06054b50 && p + 22 + v.getUint16(p + 20, true) === bytes.length) { end = p; break; }
        }
        if (end < 0 || v.getUint16(end + 4, true) || v.getUint16(end + 6, true)) throw new Error("올바른 단일 앱 ZIP이 아니에요");
        var count = v.getUint16(end + 10, true), offset = v.getUint32(end + 16, true), directoryEnd = offset + v.getUint32(end + 12, true);
        if (count > 32 || directoryEnd > end) throw new Error("ZIP 구성을 확인해 주세요");
        var files = {}, total = 0;
        for (var i = 0; i < count; i++) {
            if (offset + 46 > directoryEnd || v.getUint32(offset, true) !== 0x02014b50) throw new Error("ZIP 목록이 손상됐어요");
            var flags = v.getUint16(offset + 8, true), method = v.getUint16(offset + 10, true), checksum = v.getUint32(offset + 16, true);
            var compressed = v.getUint32(offset + 20, true), size = v.getUint32(offset + 24, true), nameLength = v.getUint16(offset + 28, true);
            var next = offset + 46 + nameLength + v.getUint16(offset + 30, true) + v.getUint16(offset + 32, true), local = v.getUint32(offset + 42, true);
            if (next > directoryEnd || local + 30 > bytes.length || v.getUint32(local, true) !== 0x04034b50 || flags & 1) throw new Error("ZIP 항목을 읽지 못했어요");
            var name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
            if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name === "." || name === ".." || Object.prototype.hasOwnProperty.call(files, name)) throw new Error("앱 ZIP의 파일 이름이나 중복 항목을 확인해 주세요");
            total += size;
            if (size > 6 * 1024 * 1024 || total > 10 * 1024 * 1024) throw new Error("ZIP 압축 해제 크기가 너무 커요");
            var start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
            if (start + compressed > bytes.length) throw new Error("ZIP 데이터가 잘렸어요");
            var data = bytes.slice(start, start + compressed);
            if (method === 8) {
                if (typeof DecompressionStream !== "function") throw new Error("최신 Chrome 또는 Edge에서 다시 열어 주세요");
                var reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader(), parts = [], length = 0;
                while (true) {
                    var chunk = await reader.read(); if (chunk.done) break;
                    length += chunk.value.length;
                    if (length > size || length > 6 * 1024 * 1024) { await reader.cancel(); throw new Error("압축 해제 크기가 일치하지 않아요"); }
                    parts.push(chunk.value);
                }
                data = join(parts);
            } else if (method !== 0) throw new Error("지원하지 않는 ZIP 압축 방식이에요");
            if (data.length !== size || crc(data) !== checksum) throw new Error("ZIP 파일의 검증에 실패했어요");
            files[name] = data; offset = next;
        }
        return files;
    }
    return { create: create, read: read };
}());
if (typeof module !== "undefined") module.exports = NpcZip;
