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
    return { create: create };
}());
if (typeof module !== "undefined") module.exports = NpcZip;
