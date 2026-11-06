// 大会ロゴ（2026-11-06 ユーザー承認）。Admin の「大会準備」で登録し、DB（TournamentLogo）に保存する。
// Main のクイズ画面（2nd・3rd・Extra・Semi-Final・Final）の見出しの中央に、大会名と並べて出す（左がロゴ、右が大会名）。
// 画面（Admin・Main）と API の両方から使う純関数・定数だけを置く。
//
//   ・形式は PNG・WebP・JPEG（SVG は受け付けない。中にプログラムを書けるため）
//   ・Admin で長い辺を 1600px までに縮めてから送る（透過は保つ・切り抜きはしない）。2MB まで
//   ・幅・高さも DB に持つ（画像が届く前に見出しの場所を決め、大会名がずれないようにする）

export const LOGO_MIME_TYPES = ['image/png', 'image/webp', 'image/jpeg'] as const;
export type LogoMimeType = (typeof LOGO_MIME_TYPES)[number];
/** 保存する画像の長い辺の上限（px） */
export const LOGO_MAX_SIDE = 1600;
/** 保存する画像の大きさの上限 */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** 大会ロゴの情報（画像そのものは /api/tournamentLogo?v=version） */
export type TournamentLogoInfo = { version: number; width: number; height: number };

/** 画像の URL（版を付けて、差し替えたらキャッシュを捨てる） */
export function logoUrl(info: TournamentLogoInfo): string {
    return `/api/tournamentLogo?v=${info.version}`;
}

// ---- クイズ画面の見出し（1920×1080 の舞台の値） ----
/** ロゴの高さ（見出しの帯は 108px） */
export const BRAND_LOGO_H = 84;
/** ロゴの横幅の上限 */
export const BRAND_LOGO_MAX_W = 260;
/** ロゴと大会名の間 */
export const BRAND_GAP = 20;
/** 大会名の字の大きさ */
export const BRAND_NAME_FONT = 40;
/** ロゴと大会名を合わせた横幅の上限（左右の見出しの文字と重ならない幅） */
export const BRAND_MAX_W = 880;

/** 見出しに出すロゴの大きさ（高さ BRAND_LOGO_H・横幅 BRAND_LOGO_MAX_W に収める。縦横比は保つ） */
export function brandLogoSize(width: number, height: number): { width: number; height: number } {
    if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
    const s = Math.min(BRAND_LOGO_H / height, BRAND_LOGO_MAX_W / width);
    return { width: Math.round(width * s), height: Math.round(height * s) };
}

/** 長い辺を max に収める大きさ（大きいときだけ縮める） */
export function fitWithin(width: number, height: number, max = LOGO_MAX_SIDE): { width: number; height: number } {
    const long = Math.max(width, height);
    if (long <= max) return { width, height };
    const s = max / long;
    return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

/** data URL（data:image/png;base64,...）を分ける。形式が対象外なら null */
export function parseLogoDataUrl(dataUrl: unknown): { mimeType: LogoMimeType; base64: string } | null {
    if (typeof dataUrl !== 'string') return null;
    const m = /^data:([a-z/+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) return null;
    if (!(LOGO_MIME_TYPES as readonly string[]).includes(m[1])) return null;
    return { mimeType: m[1] as LogoMimeType, base64: m[2] };
}

/**
 * 画像のバイト列から幅・高さを読む（PNG・JPEG・WebP）。読めなければ null。
 * 送られてきた幅・高さを信じず、サーバでも中身から確かめるため
 */
export function readImageSize(bytes: Uint8Array, mimeType: string): { width: number; height: number } | null {
    const b = bytes;
    const u16be = (i: number) => (b[i] << 8) | b[i + 1];
    const u32be = (i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
    const u16le = (i: number) => b[i] | (b[i + 1] << 8);
    const u24le = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
    const ok = (w: number, h: number) => (w > 0 && h > 0 ? { width: w, height: h } : null);

    if (mimeType === 'image/png') {
        // 署名 8 バイト → IHDR（幅・高さ）
        const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        if (b.length < 24 || !sig.every((v, i) => b[i] === v)) return null;
        if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null;
        return ok(u32be(16), u32be(20));
    }
    if (mimeType === 'image/jpeg') {
        if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
        let i = 2;
        while (i + 9 < b.length) {
            if (b[i] !== 0xff) return null;
            const marker = b[i + 1];
            if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
            if (marker === 0xff) { i += 1; continue; }
            const len = u16be(i + 2);
            // SOF0〜SOF15（DHT・JPG・DAC を除く）に高さ・幅がある
            if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                return ok(u16be(i + 7), u16be(i + 5));
            }
            i += 2 + len;
        }
        return null;
    }
    if (mimeType === 'image/webp') {
        if (b.length < 30) return null;
        if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'RIFF' || String.fromCharCode(b[8], b[9], b[10], b[11]) !== 'WEBP') return null;
        const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
        if (kind === 'VP8X') return ok(u24le(24) + 1, u24le(27) + 1);
        if (kind === 'VP8 ') return ok(u16le(26) & 0x3fff, u16le(28) & 0x3fff);
        if (kind === 'VP8L') {
            if (b[20] !== 0x2f) return null;
            const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
            return ok((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
        }
        return null;
    }
    return null;
}

/**
 * 登録する画像の検証（API で使う）。バイト列と、中身から読んだ幅・高さを返す
 */
export function validateLogoUpload(dataUrl: unknown):
    { ok: true; mimeType: LogoMimeType; data: Uint8Array; width: number; height: number } | { ok: false; error: string } {
    const parsed = parseLogoDataUrl(dataUrl);
    if (!parsed) return { ok: false, error: '画像の形式が対象外です（PNG・WebP・JPEG）' };
    const data = Uint8Array.from(Buffer.from(parsed.base64, 'base64'));
    if (data.length === 0) return { ok: false, error: '画像が空です' };
    if (data.length > LOGO_MAX_BYTES) return { ok: false, error: '画像が大きすぎます（2MB まで）' };
    const size = readImageSize(data, parsed.mimeType);
    if (!size) return { ok: false, error: '画像を読み取れません（壊れているか、形式が違います）' };
    if (Math.max(size.width, size.height) > LOGO_MAX_SIDE) return { ok: false, error: `画像が大きすぎます（長い辺 ${LOGO_MAX_SIDE}px まで）` };
    return { ok: true, mimeType: parsed.mimeType, data, width: size.width, height: size.height };
}
