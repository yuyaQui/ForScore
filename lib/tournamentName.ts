// 大会名（2026-11-02 追加）。Admin の「大会準備」で入力し、DB（TournamentState.tournamentName）に保存する。
// Admin 左上の表示と、Main のクイズ画面の見出しの中央（大会ロゴの右。2026-11-06）に使う。
// 画面（Admin）と API の両方から使う純関数だけを置く。DB の読み書きは lib/roundGuard.ts と app/api/tournamentState。
//
// 長さの上限（2026-11-06 ユーザー承認・案 D）: クイズ画面の見出しにロゴと並べて収まる長さまで。
// 全角を 2、半角を 1 と数えて 24 まで（全角なら12文字、半角なら24文字）。以前は 40 文字まで。

/** 大会名の長さの上限（全角 2・半角 1 で数えた幅） */
export const TOURNAMENT_NAME_MAX_WIDTH = 24;

/** 1文字の幅。ASCII の表示文字と半角カナは 1、それ以外（全角・絵文字など）は 2 */
function charWidth(ch: string): number {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code <= 0x7e) return 1;
    if (code >= 0xff61 && code <= 0xff9f) return 1;   // 半角カナ
    return 2;
}

/** 文字列の幅（全角 2・半角 1）。サロゲートペアは1文字として数える */
export function nameWidth(text: string): number {
    let w = 0;
    for (const ch of Array.from(text)) w += charWidth(ch);
    return w;
}

/** 文字数（サロゲートペアなどを1文字として数える） */
export function countNameChars(text: string): number {
    return Array.from(text).length;
}

/** 長さの表示（全角に換算した文字数 / 上限。例「6.5 / 12」）。半角は 0.5 文字分 */
export function nameLengthLabel(text: string): string {
    const half = nameWidth(text) / 2;
    return `${Number.isInteger(half) ? half : half.toFixed(1)} / ${TOURNAMENT_NAME_MAX_WIDTH / 2}`;
}

/** 大会名の検証。前後の空白は取り除く。空文字は「未設定に戻す」として受け付ける */
export function validateTournamentName(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
    if (typeof raw !== 'string') return { ok: false, error: '大会名が不正です' };
    const value = raw.trim();
    if (/[\r\n]/.test(value)) return { ok: false, error: '大会名に改行は使えません' };
    if (nameWidth(value) > TOURNAMENT_NAME_MAX_WIDTH) {
        return { ok: false, error: `大会名は全角${TOURNAMENT_NAME_MAX_WIDTH / 2}文字（半角${TOURNAMENT_NAME_MAX_WIDTH}文字）までです（クイズ画面の見出しに収めるため）` };
    }
    return { ok: true, value };
}
