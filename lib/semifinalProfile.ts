// 準決勝の進出者紹介で使う「二つ名」と「写真」の定数・純関数（2026-10-15 追加）。
// DB の読み書きは app/api/semifinal/profiles と app/api/semifinal/photo が行う。
// このファイルはサーバ（API）と画面（Admin / Main）の両方から使う。

import type { Player, ThirdRoundCourse } from './types';
import { getThirdRoundPassOrder } from './semifinal';

/** 二つ名の最大文字数（2026-10-15 ユーザー決定）。絵文字や結合文字も1文字として数える */
export const NICKNAME_MAX = 12;

/** 登録する写真の大きさ（3:4）。Admin の切り抜きでこの大きさに縮めてから送る */
export const PHOTO_WIDTH = 600;
export const PHOTO_HEIGHT = 800;

/** 受け付ける写真の最大サイズ（バイト）。600×800 の JPEG なら通常 100KB 前後なので十分な余裕 */
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

/** 受け付ける画像の種類。切り抜きで JPEG に変換して送るが、念のため PNG / WebP も通す */
export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** 進出者ごとの紹介用データ（GET /api/semifinal/profiles の1件） */
export type SemifinalProfile = {
    playerId: number;
    nickname: string;
    /** 写真の版（最終更新時刻のミリ秒）。写真が無ければ null。画像の URL に付けてキャッシュを捨てる */
    photoVersion: number | null;
};

/** 文字数（サロゲートペアなどを1文字として数える） */
export function countChars(text: string): number {
    return Array.from(text).length;
}

/** 二つ名の検証。前後の空白は取り除く。空文字は「未登録に戻す」として受け付ける */
export function validateNickname(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
    if (typeof raw !== 'string') return { ok: false, error: '二つ名が不正です' };
    const value = raw.trim();
    if (countChars(value) > NICKNAME_MAX) return { ok: false, error: `二つ名は${NICKNAME_MAX}文字までです` };
    if (/[\r\n]/.test(value)) return { ok: false, error: '二つ名に改行は使えません' };
    return { ok: true, value };
}

/** 準決勝の進出者か（3rd Round 通過、または Extra Round の敗者復活者）。写真を登録できる */
export function isSemifinalist(p: Pick<Player, 'thirdRoundRank' | 'extraRoundRank'>): boolean {
    return p.thirdRoundRank > 0 || p.extraRoundRank === 1;
}

/** 進出者紹介の対象か（3rd Round 通過の8名だけ。敗者復活者は紹介しない）。二つ名を登録できる */
export function isIntroTarget(p: Pick<Player, 'thirdRoundRank'>): boolean {
    return p.thirdRoundRank > 0;
}

/**
 * 進出者紹介の順番: 3rd Round の実施コース順 → コース内の 1位 → 2位。
 * 選手カードの表示は、この順のあとに敗者復活者を足す（getLineupOrder）。
 */
export function getIntroOrder(players: Player[], courses: ThirdRoundCourse[]): Player[] {
    return getThirdRoundPassOrder(players, courses);
}

/** 選手カードを並べる順番（紹介順 → 最後に敗者復活者） */
export function getLineupOrder(players: Player[], courses: ThirdRoundCourse[]): Player[] {
    const revived = players.find(p => p.extraRoundRank === 1);
    return [...getIntroOrder(players, courses), ...(revived ? [revived] : [])];
}

/** 写真の URL。版を付けて、差し替えたら画面側が必ず取り直すようにする */
export function photoUrl(profile: SemifinalProfile | undefined): string | null {
    if (!profile || profile.photoVersion === null) return null;
    return `/api/semifinal/photo?playerId=${profile.playerId}&v=${profile.photoVersion}`;
}

/** data URL（data:image/jpeg;base64,...）を分解する。形式が違えば null */
export function parseImageDataUrl(dataUrl: unknown): { mimeType: string; base64: string } | null {
    if (typeof dataUrl !== 'string') return null;
    const m = /^data:([a-z/+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) return null;
    if (!(PHOTO_MIME_TYPES as readonly string[]).includes(m[1])) return null;
    return { mimeType: m[1], base64: m[2] };
}

// ---- 選手カード表示（lineup）の演出の時間。Main の演出と Admin の「表示中…」の解除で同じ値を使う ----

/** カードを1枚ずつ出す間隔 */
export const LINEUP_STEP_MS = 800;
/** 最後の1枚（敗者復活者）の前に足す間 */
export const LINEUP_LAST_EXTRA_MS = 600;
/** カード1枚の登場にかかる時間。開扉 1.9 秒（Main/SemifinalCard.tsx の useSfCardIntro）＋ 中身のフェード 0.6 秒 */
export const SF_CARD_INTRO_MS = 2500;

/** k 枚目（0始まり）のカードが現れ始めるまでの時間 */
export function lineupDelayMs(k: number, count: number): number {
    return k * LINEUP_STEP_MS + (k === count - 1 ? LINEUP_LAST_EXTRA_MS : 0);
}

/** 全員のカードが出そろうまでの時間 */
export function lineupTotalMs(count: number): number {
    return count === 0 ? 0 : lineupDelayMs(count - 1, count) + SF_CARD_INTRO_MS;
}
