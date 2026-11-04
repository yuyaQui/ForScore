// API でも大会の順番を守る（2026-10-22 追加。docs/linear-progress-design.md 提案C。API 専用）
//
// 前のラウンドが完了していないときは、そのラウンドの採点・抽選・進出者確定を受け付けない（409）。
// 画面を経由しない操作や、古い画面からの操作でも順番が崩れないようにするため。
import { NextResponse } from 'next/server';
import { prisma } from './prisma';
import { getRoundStatuses, canEnterRound, laterRoundStarted, undoBlockedMessage, ROUND_LABEL, type RoundKey, type RoundStatus } from './roundProgress';
import { isTableMissingError } from './questionPoolDb';

export const TOURNAMENT_STATE_NOT_READY =
    '大会の状態の表がまだ使えません。Mac のターミナルで `npx prisma migrate dev` を実行してから、サーバを再起動してください';

/** Prisma クライアントに大会の状態の表があるか（migrate dev 前の古いクライアントでは無い） */
export function isTournamentStateClientReady(client: object = prisma): boolean {
    return (client as Record<string, unknown>).tournamentState !== undefined;
}

/** 大会の状態（loadTournamentState の戻り値） */
export type TournamentStateValue = {
    extraRoundNoRevival: boolean;
    /** 大会名（2026-11-02 追加。未設定なら空文字） */
    tournamentName: string;
};

const INITIAL_TOURNAMENT_STATE: TournamentStateValue = { extraRoundNoRevival: false, tournamentName: '' };

/**
 * 大会の状態（1行）。まだ無ければ初期値。
 * 表がまだ使えないとき（migrate dev 前）も初期値を返す。採点などの API が順番チェックで止まらないようにするため。
 * 大会名の列が無い古いクライアント・DB でも、大会名は空文字として返す。
 */
export async function loadTournamentState(): Promise<TournamentStateValue> {
    if (!isTournamentStateClientReady()) return INITIAL_TOURNAMENT_STATE;
    try {
        const row = await prisma.tournamentState.findUnique({ where: { id: 1 } });
        const name = (row as { tournamentName?: unknown } | null)?.tournamentName;
        return { extraRoundNoRevival: row?.extraRoundNoRevival ?? false, tournamentName: typeof name === 'string' ? name : '' };
    } catch (error) {
        if (isTableMissingError(error) || isColumnMissingError(error)) return INITIAL_TOURNAMENT_STATE;
        throw error;
    }
}

/**
 * 大会名の列がまだ使えないときのエラーか（2026-11-02）。
 * DB に列が無い（P2022）か、Prisma クライアントが古くて列を知らない（Unknown argument / Unknown field）
 */
export function isColumnMissingError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    if ((error as { code?: unknown }).code === 'P2022') return true;
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' && /Unknown (argument|field)/.test(message);
}

/** DB から全ラウンドの状況を求める */
export async function loadRoundStatuses(): Promise<Record<RoundKey, RoundStatus>> {
    const [players, courses, state] = await Promise.all([
        prisma.player.findMany(),
        prisma.thirdRoundCourse.findMany({ select: { name: true, playOrder: true } }),
        loadTournamentState(),
    ]);
    return getRoundStatuses({ players, courses, extraRoundNoRevival: state.extraRoundNoRevival });
}

/**
 * そのラウンドの操作をしてよいか。前のラウンドが未完了なら 409 の応答を返す（よければ null）。
 * 使い方: const blocked = await guardRound('thirdRound'); if (blocked) return blocked;
 */
export async function guardRound(round: RoundKey): Promise<NextResponse | null> {
    const check = canEnterRound(await loadRoundStatuses(), round);
    if (check.ok) return null;
    return NextResponse.json(
        { error: `${check.reason}のため、${ROUND_LABEL[round]} の操作はできません`, roundBlocked: true },
        { status: 409 }
    );
}

/**
 * そのラウンドの Undo をしてよいか。後のラウンドが始まっていれば 409 の応答を返す（よければ null）。
 * 提案B: Undo は結果を少し戻すだけなので、後のラウンドと食い違う。直すときはリセット（連鎖つき）を使う。
 */
export async function guardUndo(round: RoundKey): Promise<NextResponse | null> {
    const later = laterRoundStarted(await loadRoundStatuses(), round);
    if (!later) return null;
    return NextResponse.json({ error: undoBlockedMessage(round, later), roundBlocked: true }, { status: 409 });
}
