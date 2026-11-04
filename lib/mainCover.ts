// Main を覆う表示（待機画面・ブランク。2026-11-04 ユーザー承認）の型と、Admin が使う小さな部品。
// 進行状態はサーバのメモリ（server/MainCoverHandler.js）。値の定義元は constants.js
import { MAIN_COVER_ON_MODE } from '../constants.js';

export { MAIN_COVER_ON_MODE };

export type MainCoverKind = 'none' | 'blank' | 'standby';
export type MainCoverAt = 'start' | 'end' | 'manual';

/** Admin が「こう変えたい」とサーバへ送る覆い（版は付かない。サーバが決める） */
export type CoverTarget = {
    kind: MainCoverKind;
    at: MainCoverAt | null;
    /** 待機画面の NEXT のあとのラウンド名（例「2nd Round」）。手動の待機画面では null */
    title: string | null;
    /** ラウンド名の下の組・コース・Step（例「Set 2」「Freeze 10」「Second Step」） */
    sub: string | null;
    /** ブランクから次の画面を出すボタンの名前（例「ターンオーバーを始める」） */
    startLabel: string | null;
};

/**
 * サーバが配る覆い。rev は覆いが変わるたびに1つ増える版番号で、Admin は操作に「自分が見ていた rev」を添える。
 * サーバの rev と違えば操作は断られる（連打・古い画面・2つ目の Admin からの操作が二重に効かない）。
 * 遷移の決まりは lib/coverFlow.js（サーバと共通）
 */
export type MainCover = CoverTarget & { rev: number };

const TARGET_NONE: CoverTarget = { kind: 'none', at: null, title: null, sub: null, startLabel: null };
export const NO_COVER: CoverTarget = TARGET_NONE;
/** サーバから届く前の初期値 */
export const INITIAL_COVER: MainCover = { ...TARGET_NONE, rev: 0 };

/** 待機画面（これから始まる場面）。startLabel はブランクにした後のボタン名 */
export function standbyCover(title: string, sub: string | null, startLabel: string): CoverTarget {
    return { kind: 'standby', at: 'start', title, sub, startLabel };
}

/** 終わった後の待機画面（次のラウンドへ移るまで）。ボタンは各ラウンドの Admin が出す */
export function standbyAfterCover(title: string): CoverTarget {
    return { kind: 'standby', at: 'end', title, sub: null, startLabel: null };
}

/** これから始まる場面のブランク。Admin 上部の「startLabel ▶」で外す */
export function blankStartCover(startLabel: string): CoverTarget {
    return { kind: 'blank', at: 'start', title: null, sub: null, startLabel };
}

/** クイズを終えた後のブランク（「クイズを終了する」）。次は各ラウンドの Admin のボタンで進める */
export const BLANK_END_COVER: CoverTarget = { kind: 'blank', at: 'end', title: null, sub: null, startLabel: null };

/** 手動の待機画面（「PLEASE STAND BY」だけ） */
export const MANUAL_STANDBY_COVER: CoverTarget = { kind: 'standby', at: 'manual', title: null, sub: null, startLabel: null };

/**
 * 覆いが「これから始まる場面」や手動のときは、各ラウンドの進行ボタンを止める
 * （待機画面のまま裏で画面を進めてしまわないように。進めるのは Admin 上部のボタン）
 */
export function coverBlocksRound(cover: CoverTarget): boolean {
    return cover.kind !== 'none' && cover.at !== 'end';
}

/** 待機画面の説明（Admin の表示用。例「待機画面 NEXT 2nd Round / Set 2」） */
export function describeCover(cover: CoverTarget): string {
    if (cover.kind === 'none') return '通常の表示';
    if (cover.kind === 'blank') return 'ブランク（何も表示しない）';
    if (cover.at === 'manual' || !cover.title) return '待機画面（PLEASE STAND BY）';
    return `待機画面 NEXT ${cover.title}${cover.sub ? ` / ${cover.sub}` : ''}`;
}

/** 再開の待ちのブランクに付ける名前（Undo で組・コースの途中まで戻したとき） */
export const RESUME_QUIZ_LABEL = 'クイズを再開する';

/**
 * Undo などで進行を巻き戻したときの覆い。巻き戻した先の画面をいきなり Main に出さないよう、
 * ブランクにして「クイズを再開する ▶」で出す（Admin が押すまで会場には何も出ない）。
 */
export function rewindCover(label: string = RESUME_QUIZ_LABEL): CoverTarget {
    return blankStartCover(label);
}
