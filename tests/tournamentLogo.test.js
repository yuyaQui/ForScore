// 大会ロゴ（lib/tournamentLogo.ts）と大会名の長さ（lib/tournamentName.ts）のテスト（2026-11-06）
// Node 22 の型の取り除き（.ts をそのまま読む）を使う
const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const L = require("../lib/tournamentLogo.ts");
const N = require("../lib/tournamentName.ts");

/** 幅 w・高さ h の最小の PNG */
function png(w, h) {
    const crc32 = (buf) => { let c, crc = 0xffffffff; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; };
    const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    const raw = Buffer.alloc((w * 4 + 1) * h);
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
/** 幅 w・高さ h の JPEG の先頭（SOF0 まで） */
function jpegHead(w, h) {
    return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
        0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
}
const dataUrl = (mime, buf) => `data:${mime};base64,${buf.toString("base64")}`;

test("画像の幅・高さを中身から読む（PNG・JPEG・WebP VP8X / VP8L）", () => {
    assert.deepEqual(L.readImageSize(png(640, 320), "image/png"), { width: 640, height: 320 });
    assert.deepEqual(L.readImageSize(jpegHead(1200, 600), "image/jpeg"), { width: 1200, height: 600 });
    const vp8x = Buffer.alloc(30); vp8x.write("RIFF", 0); vp8x.write("WEBP", 8); vp8x.write("VP8X", 12);
    vp8x.writeUIntLE(799, 24, 3); vp8x.writeUIntLE(399, 27, 3);
    assert.deepEqual(L.readImageSize(vp8x, "image/webp"), { width: 800, height: 400 });
    const vp8l = Buffer.alloc(30); vp8l.write("RIFF", 0); vp8l.write("WEBP", 8); vp8l.write("VP8L", 12); vp8l[20] = 0x2f;
    vp8l.writeUInt32LE((300 - 1) | ((150 - 1) << 14), 21);
    assert.deepEqual(L.readImageSize(vp8l, "image/webp"), { width: 300, height: 150 });
    assert.equal(L.readImageSize(Buffer.from("not an image"), "image/png"), null);
});

test("登録の検証: 形式・壊れた画像・大きさ（中身から読んだ幅・高さを使う）", () => {
    const ok = L.validateLogoUpload(dataUrl("image/png", png(800, 400)));
    assert.equal(ok.ok, true);
    assert.deepEqual([ok.width, ok.height, ok.mimeType], [800, 400, "image/png"]);
    assert.equal(L.validateLogoUpload(dataUrl("image/svg+xml", Buffer.from("<svg/>"))).ok, false);
    assert.match(L.validateLogoUpload(dataUrl("image/png", Buffer.from("broken"))).error, /読み取れません/);
    assert.match(L.validateLogoUpload(dataUrl("image/png", png(1601, 10))).error, /1600px/);
    assert.match(L.validateLogoUpload(dataUrl("image/jpeg", Buffer.alloc(L.LOGO_MAX_BYTES + 1, 1))).error, /2MB/);
    assert.equal(L.validateLogoUpload("not a data url").ok, false);
});

test("縮める大きさ・見出しに出す大きさ", () => {
    assert.deepEqual(L.fitWithin(3200, 1600), { width: 1600, height: 800 });
    assert.deepEqual(L.fitWithin(800, 400), { width: 800, height: 400 });
    // 横長は横幅 260 に、縦長・正方形は高さ 84 に収める
    assert.deepEqual(L.brandLogoSize(1600, 400), { width: 260, height: 65 });
    assert.deepEqual(L.brandLogoSize(400, 400), { width: 84, height: 84 });
    assert.deepEqual(L.brandLogoSize(0, 10), { width: 0, height: 0 });
});

test("大会名の長さ: 全角12文字・半角24文字まで（全角 2・半角 1 で数える）", () => {
    assert.equal(N.validateTournamentName("あ".repeat(12)).ok, true);
    assert.equal(N.validateTournamentName("あ".repeat(13)).ok, false);
    assert.equal(N.validateTournamentName("a".repeat(24)).ok, true);
    assert.equal(N.validateTournamentName("a".repeat(25)).ok, false);
    assert.equal(N.validateTournamentName("第24回 abc 大会").ok, true);          // 全角5 + 半角9 = 19
    assert.equal(N.nameWidth("ｱｲｳ"), 3);                                       // 半角カナは 1
    assert.equal(N.nameWidth("😀"), 2);
    assert.equal(N.nameLengthLabel("abc"), "1.5 / 12");
    assert.match(N.validateTournamentName("a".repeat(25)).error, /全角12文字（半角24文字）まで/);
    assert.equal(N.validateTournamentName("  abc  ").value, "abc");
});
