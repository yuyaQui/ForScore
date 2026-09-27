/**
 * Extra Round Second Step の採点ロジック
 *
 * 「正解 / 誤答が押されたとき、出場者たちがどう変わるか」だけを扱う純粋な計算。
 * DB の読み書きは app/api 側の仕事で、ここには持ち込まない。
 *
 * ルール（設計メモ 4.1）:
 *   - 最初に5問正解した1名が敗者復活
 *   - 誤答は即失格
 *   - 1名を除いて全員が失格した場合、残った1名がその時点で敗者復活
 *
 * 3rd Round の10 up-downと同じ形（純関数に切り出す・順位フィールドの規約・
 * 「残り人数＝残り枠」の終了判定）を流用する。枠数が1固定なぶんシンプルになる。
 */

import type { Player } from './types';

/** 敗者復活に必要な正解数 */
const SECOND_STEP_WIN_CORRECT_COUNT = 5;
/** 敗者復活の枠数（1名だけ） */
const SECOND_STEP_WINNERS = 1;

export type SecondStepAction = 'correct' | 'wrong';

export type SecondStepScoringInput = {
    /** Second Step 出場者（extraRoundSecondStep === true の選手） */
    players: Player[];
    playerId: number;
    action: SecondStepAction;
};

/**
 * 採点を適用した出場者一覧を返す。引数の players は書き換えない。
 */
export function applySecondStepScore({ players, playerId, action }: SecondStepScoringInput): Player[] {
    const scored = players.map(p => {
        if (p.id !== playerId) return p;

        // すでに敗者復活（正の数）または失格（−1）が確定した選手は対象外。
        // UI 側でもボタンを無効化しているが、データが壊れないようここでも止める。
        if (p.extraRoundRank !== 0) return p;

        const next: Player = { ...p };

        if (action === 'correct') {
            next.extraRoundCorrectCount += 1;
            if (next.extraRoundCorrectCount >= SECOND_STEP_WIN_CORRECT_COUNT) {
                next.extraRoundRank = 1; // 枠は1つだけなので、5問正解した時点でそのまま1位
            }
        } else if (action === 'wrong') {
            next.extraRoundRank = -1; // 誤答は即失格
        }

        return next;
    });

    return finalizeLastActivePlayer(scored);
}

/**
 * 「残り人数＝残り枠」の終了判定（枠数1固定）。
 *
 * すでに敗者復活が決まっていたら何もしない。まだ決まっておらず、対戦中（rank === 0）
 * の選手が1名だけになっていたら、その1名を敗者復活にする。
 */
function finalizeLastActivePlayer(players: Player[]): Player[] {
    const winnersCount = players.filter(p => p.extraRoundRank > 0).length;
    if (winnersCount >= SECOND_STEP_WINNERS) return players;

    const active = players.filter(p => p.extraRoundRank === 0);
    if (active.length !== 1) return players;

    const lastPlayerId = active[0].id;
    return players.map(p => p.id === lastPlayerId ? { ...p, extraRoundRank: 1 } : p);
}
