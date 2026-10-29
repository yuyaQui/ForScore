// ラウンドのリセットの連鎖（2026-10-22 追加。docs/linear-progress-design.md 2章・6章。API 専用）
//
// 大会は 1st Round → Final の一本道で、あるラウンドの結果が後のラウンドの出場者を決める。
// そのため、あるラウンドの結果を戻したら、後のラウンドは出場者全員ぶんを丸ごと初期化する（ユーザー決定）。
// 各リセットの API は、自分のラウンドの該当部分を戻したあと、同じトランザクションの中で resetRoundsFrom を呼ぶ。
//
// 消さないもの: 選手名簿・1st Round 順位、Extra Round の問題（20問）、大会共通の問題データ。
// 二つ名と写真は、Semi-Final の進出者が決まる前のフェーズ（2nd・3rd・Extra Round）のリセットでだけ消す（clearProfiles）。
import type { Prisma } from '@prisma/client';
import { isTournamentStateClientReady } from './roundGuard';

type Tx = Prisma.TransactionClient;

/** 初期化を始めるラウンド（そのラウンドと、それより後のラウンドをすべて初期化する） */
export type ResetFromRound = 'thirdRound' | 'extraRound' | 'semifinal' | 'final';

const RESET_ORDER: ResetFromRound[] = ['thirdRound', 'extraRound', 'semifinal', 'final'];

/** 3rd Round の結果の列の初期値（所属コースを除く。コースごとのリセットでも使う） */
export const THIRD_ROUND_SCORE_DEFAULTS = {
    thirdRoundCorrectCount: 0,
    thirdRoundWrongCount: 0,
    thirdRoundUpDownPoint: 0,
    thirdRoundSwedishCross: 0,
    thirdRoundFreezeRest: 0,
    thirdRoundRank: 0,
};

/** 3rd Round 全体: 抽選結果・全員の所属コース・スコア・Undo 履歴 */
async function resetThirdRound(tx: Tx) {
    await tx.thirdRoundCourse.updateMany({ data: { playOrder: null } });
    await tx.player.updateMany({ data: { thirdRoundCourseName: null, ...THIRD_ROUND_SCORE_DEFAULTS } });
    await tx.thirdRoundHistory.deleteMany({});
}

/** Extra Round 全体: Second Step の進出・正解数・敗者復活、Undo 履歴、「敗者復活者なし」の確定 */
async function resetExtraRound(tx: Tx) {
    await tx.player.updateMany({ data: { extraRoundSecondStep: false, extraRoundCorrectCount: 0, extraRoundRank: 0 } });
    await tx.extraRoundHistory.deleteMany({});
    // migrate dev 前の古いクライアントには表が無い（そのときは確定もできないので、戻すものも無い）
    if (!isTournamentStateClientReady(tx)) return;
    await tx.tournamentState.upsert({ where: { id: 1 }, update: { extraRoundNoRevival: false }, create: { id: 1, extraRoundNoRevival: false } });
}

/** Semi-Final 全体: ポイント・勝ち抜け／敗退、Undo 履歴 */
async function resetSemifinal(tx: Tx) {
    await tx.player.updateMany({ data: { semifinalPoint: 0, semifinalRank: 0 } });
    await tx.semifinalHistory.deleteMany({});
}

/** Final 全体: 正解数・誤答数・獲得セット数・最終順位、Undo 履歴 */
async function resetFinal(tx: Tx) {
    await tx.player.updateMany({ data: { finalCorrectCount: 0, finalWrongCount: 0, finalSetsWon: 0, finalRank: 0 } });
    await tx.finalHistory.deleteMany({});
}

/** Semi-Final 出場者の二つ名と写真（出場者以外はもともと空） */
async function clearSemifinalProfiles(tx: Tx) {
    await tx.player.updateMany({ data: { nickname: '' } });
    await tx.playerPhoto.deleteMany({});
}

const RESETTERS: Record<ResetFromRound, (tx: Tx) => Promise<void>> = {
    thirdRound: resetThirdRound,
    extraRound: resetExtraRound,
    semifinal: resetSemifinal,
    final: resetFinal,
};

/**
 * from とそれより後のラウンドを、出場者全員ぶん丸ごと初期化する。
 * clearProfiles: Semi-Final の進出者が決まる前のフェーズからのリセットなら true（二つ名と写真も消す）
 */
export async function resetRoundsFrom(tx: Tx, from: ResetFromRound, { clearProfiles }: { clearProfiles: boolean }) {
    for (const round of RESET_ORDER.slice(RESET_ORDER.indexOf(from))) {
        await RESETTERS[round](tx);
    }
    if (clearProfiles) await clearSemifinalProfiles(tx);
}
