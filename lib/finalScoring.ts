/**
 * 決勝（トリプルセブン）の採点ロジック
 *
 * 「正解 / 誤答が押されたときにどうなるか」と「セットの決着・優勝の自動確定」を
 * 扱う純粋な計算。DB の読み書きは app/api 側の仕事で、ここには持ち込まない
 * （3rd Round・準決勝と同じ形）。
 *
 * ## セット内の値とトーナメント全体の値は別物（設計メモ 3.1）
 *
 *   finalCorrectCount / finalWrongCount … 今のセットだけの値。次のセットへ進む
 *                                          ときにリセットする（resetForNextSet）
 *   finalSetsWon                        … トーナメント全体の累計。リセットしない
 *   finalRank                           … トーナメントが終わったときだけ確定する
 *                                          最終順位（1〜3）。セット内失格とは無関係
 *
 * ## 自動で確定するもの・しないもの（設計メモ 5.3〜5.5）
 *
 * 「7問正解」「セット内失格2名→残り1名が自動獲得」はどちらも同点・判定基準を
 * 必要としない一意な決着なので、ボタンを押した瞬間にここで確定させる
 * （3rd Round の10 up-downが10pt到達で即勝ち抜けにするのと同じ考え方）。
 * 「3セット先取で優勝」も同様に一意（複数人が同時に3勝目に達することはない）なので
 * ここで自動確定する。
 *
 * 準優勝・第3位も、優勝が決まったその操作の中でルールの判定基準で自動確定する
 * （2026-10-10 ユーザー決定。設計メモ 6.1。compareFinalStanding）。
 */

import type { Player } from './types';

export type FinalAction = 'correct' | 'wrong';

/** 1セットの獲得に必要な正解数 */
const SET_WIN_CORRECT_COUNT = 7;
/** セット内失格となる誤答数（そのセット限りの失格） */
const SET_ELIMINATE_WRONG_COUNT = 3;
/** 優勝に必要な獲得セット数 */
const CHAMPION_SETS_WON = 3;

/**
 * 今のセットがすでに決着しているか（7問正解 or セット内失格が2名）。
 * 決着後は「次のセットへ」を押すまで採点を受け付けない。
 */
export function isSetOver(players: Player[]): boolean {
    if (players.some(p => p.finalCorrectCount >= SET_WIN_CORRECT_COUNT)) return true;

    const eliminatedCount = players.filter(p => p.finalWrongCount >= SET_ELIMINATE_WRONG_COUNT).length;
    return eliminatedCount >= 2;
}

/**
 * 今のセットの勝者。決着していなければ null。
 * 7問正解した選手がいればその人。いなければ、セット内失格2名の残り1名。
 */
export function getSetWinner(players: Player[]): Player | null {
    const bySevenCorrect = players.find(p => p.finalCorrectCount >= SET_WIN_CORRECT_COUNT);
    if (bySevenCorrect) return bySevenCorrect;

    const eliminatedCount = players.filter(p => p.finalWrongCount >= SET_ELIMINATE_WRONG_COUNT).length;
    if (eliminatedCount >= 2) {
        return players.find(p => p.finalWrongCount < SET_ELIMINATE_WRONG_COUNT) ?? null;
    }

    return null;
}

export type FinalScoringInput = {
    players: Player[];
    playerId: number;
    action: FinalAction;
};

/**
 * 正解・誤答を適用した3名を返す。引数の players は書き換えない。
 */
export function applyFinalScore({ players, playerId, action }: FinalScoringInput): Player[] {
    // すでにこのセットが決着していたら何もしない（「次のセットへ」を待つ）
    if (isSetOver(players)) return players;

    const scored = players.map(p => {
        if (p.id !== playerId) return p;

        // 優勝が決まった選手、このセットですでに失格した選手は対象外。
        // UI 側でもボタンを無効化しているが、データが壊れないようここでも止める。
        if (p.finalRank !== 0) return p;
        if (p.finalWrongCount >= SET_ELIMINATE_WRONG_COUNT) return p;

        return action === 'correct'
            ? { ...p, finalCorrectCount: p.finalCorrectCount + 1 }
            : { ...p, finalWrongCount: p.finalWrongCount + 1 };
    });

    return applySetAndChampionResult(scored);
}

/**
 * 優勝者以外の最終順位の比較（ルール「決勝」節の判定基準）。a が上位なら負の数、同率なら 0。
 *
 *   (1) 獲得セット数が多い順
 *   (2) 最終セットでの正解数が多い順（そのセットで失格した選手の正解数も含む。
 *       セット内失格でも finalCorrectCount は止めないので、そのまま比べればよい）
 *   (3) 準決勝での勝ち抜けが早い順（semifinalRank = 勝ち抜けたセット番号が小さい順）
 */
export function compareFinalStanding(a: Player, b: Player): number {
    if (a.finalSetsWon !== b.finalSetsWon) return b.finalSetsWon - a.finalSetsWon;
    if (a.finalCorrectCount !== b.finalCorrectCount) return b.finalCorrectCount - a.finalCorrectCount;
    const sa = a.semifinalRank > 0 ? a.semifinalRank : Number.POSITIVE_INFINITY;
    const sb = b.semifinalRank > 0 ? b.semifinalRank : Number.POSITIVE_INFINITY;
    if (sa !== sb) return sa < sb ? -1 : 1;
    return 0;
}

/**
 * 優勝者を除く選手に 2位以下の順位を付ける。全基準が同じなら同率
 * （準決勝は各セット1名ずつ勝ち抜けるので、通常は(3)で必ず決着する）。
 */
function rankRunnersUp(players: Player[], championId: number): Player[] {
    const others = players.filter(p => p.id !== championId).sort(compareFinalStanding);
    const rankById = new Map<number, number>();
    others.forEach((p, i) => {
        const prev = others[i - 1];
        rankById.set(p.id, i > 0 && compareFinalStanding(prev, p) === 0 ? rankById.get(prev.id)! : i + 2);
    });
    return players.map(p => (rankById.has(p.id) ? { ...p, finalRank: rankById.get(p.id)! } : p));
}

/**
 * 採点直後に、セットの決着・優勝の確定を続けて判定する。
 *
 * 3rd Round の applyThirdRoundScore が「採点→トビ残り判定」と段階を分けているのと
 * 同じ構造。ここでセットの勝者が決まれば finalSetsWon を+1し、それで3勝に
 * 到達すればその選手を優勝（finalRank = 1）にし、残りの最終順位も同時に確定する。
 */
function applySetAndChampionResult(players: Player[]): Player[] {
    const winner = getSetWinner(players);
    if (!winner) return players;

    const withSetWon = players.map(p =>
        p.id === winner.id ? { ...p, finalSetsWon: p.finalSetsWon + 1 } : p
    );

    const isChampionDecided = withSetWon.some(
        p => p.id === winner.id && p.finalSetsWon >= CHAMPION_SETS_WON
    );
    if (!isChampionDecided) return withSetWon;

    const withChampion = withSetWon.map(p => (p.id === winner.id ? { ...p, finalRank: 1 } : p));
    return rankRunnersUp(withChampion, winner.id);
}

/**
 * 次のセットへ進む。正解数・誤答数を0に戻す（獲得セット数は引き継ぐ）。
 *
 * セットが決着していない、または優勝がすでに決まっている（次のセットが無い）
 * 場合は何もしない。採点の途中でリセットする事故や、優勝後の誤操作を防ぐ。
 */
export function resetForNextSet(players: Player[]): Player[] {
    if (players.some(p => p.finalRank !== 0)) return players;
    if (!isSetOver(players)) return players;

    return players.map(p => ({ ...p, finalCorrectCount: 0, finalWrongCount: 0 }));
}
