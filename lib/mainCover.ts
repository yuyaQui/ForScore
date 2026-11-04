// Main を覆う表示（待機画面・ブランク。2026-11-04 ユーザー承認）の型と、Admin が使う小さな部品。
// 進行状態はサーバのメモリ（server/MainCoverHandler.js）。値の定義元は constants.js
import { MAIN_COVER_ON_MODE } from '../constants.js';

export { MAIN_COVER_ON_MODE };

export type MainCoverKind = 'none' | 'blank' | 'standby';
export type MainCoverAt = 'start' | 'end' | 'manual';

export type MainCover = {
    kind: MainCoverKind;
    at: MainCoverAt | null;
    /** 待機画面の NEXT のあとのラウンド名（例「2nd Round」）。手動の待機画面では null */
    title: string | null;
    /** ラウンド名の下の組・コース・Step（例「Set 2」「Freeze 10」「Second Step」） */
    sub: string | null;
    /** ブランクから次の画面を出すボタンの名前（例「ターンオーバーを始める」） */
    startLabel: string | null;
};

export const NO_COVER: MainCover = { kind: 'none', at: null, title: null, sub: null, startLabel: null };

/** 待機画面（これから始まる場面）。startLabel はブランクにした後のボタン名 */
export function standbyCover(title: string, sub: string | null, startLabel: string): MainCover {
    return { kind: 'standby', at: 'start', title, sub, startLabel };
}

/** 終わった後の待機画面（次のラウンドへ移るまで）。ボタンは各ラウンドの Admin が出す */
export function standbyAfterCover(title: string): MainCover {
    return { kind: 'standby', at: 'end', title, sub: null, startLabel: null };
}

/** これから始まる場面のブランク。Admin 上部の「startLabel ▶」で外す */
export function blankStartCover(startLabel: string): MainCover {
    return { kind: 'blank', at: 'start', title: null, sub: null, startLabel };
}

/** クイズを終えた後のブランク（「クイズを終了する」）。次は各ラウンドの Admin のボタンで進める */
export const BLANK_END_COVER: MainCover = { kind: 'blank', at: 'end', title: null, sub: null, startLabel: null };

/** 手動の待機画面（「PLEASE STAND BY」だけ） */
export const MANUAL_STANDBY_COVER: MainCover = { kind: 'standby', at: 'manual', title: null, sub: null, startLabel: null };

/**
 * 覆いが「これから始まる場面」や手動のときは、各ラウンドの進行ボタンを止める
 * （待機画面のまま裏で画面を進めてしまわないように。進めるのは Admin 上部のボタン）
 */
export function coverBlocksRound(cover: MainCover): boolean {
    return cover.kind !== 'none' && cover.at !== 'end';
}

/** 待機画面の説明（Admin の表示用。例「待機画面 NEXT 2nd Round / Set 2」） */
export function describeCover(cover: MainCover): string {
    if (cover.kind === 'none') return '通常の表示';
    if (cover.kind === 'blank') return 'ブランク（何も表示しない）';
    if (cover.at === 'manual' || !cover.title) return '待機画面（PLEASE STAND BY）';
    return `待機画面 NEXT ${cover.title}${cover.sub ? ` / ${cover.sub}` : ''}`;
}
