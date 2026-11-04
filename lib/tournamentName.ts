// 大会名（2026-11-02 追加）。Admin の「大会準備」で入力し、DB（TournamentState.tournamentName）に保存する。
// Admin 左上の表示に使い、今後 Main などで大会名を出すときもここの値を使う。
// 画面（Admin）と API の両方から使う純関数だけを置く。DB の読み書きは lib/roundGuard.ts と app/api/tournamentState。

/** 大会名の最大文字数（2026-11-02 ユーザー承認）。絵文字や結合文字も1文字として数える */
export const TOURNAMENT_NAME_MAX = 40;

/** 文字数（サロゲートペアなどを1文字として数える） */
export function countNameChars(text: string): number {
    return Array.from(text).length;
}

/** 大会名の検証。前後の空白は取り除く。空文字は「未設定に戻す」として受け付ける */
export function validateTournamentName(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
    if (typeof raw !== 'string') return { ok: false, error: '大会名が不正です' };
    const value = raw.trim();
    if (/[\r\n]/.test(value)) return { ok: false, error: '大会名に改行は使えません' };
    if (countNameChars(value) > TOURNAMENT_NAME_MAX) return { ok: false, error: `大会名は${TOURNAMENT_NAME_MAX}文字までです` };
    return { ok: true, value };
}
