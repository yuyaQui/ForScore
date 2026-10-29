/**
 * 3rd Round の採点ロジック
 *
 * 「正解 / 誤答 / スルーが押されたとき、そのコースの5名がどう変わるか」だけを扱う。
 * DB の読み書きは app/api 側の仕事で、ここには持ち込まない。純粋な計算なので、
 * 値を渡すだけで検算できる。
 *
 * ## なぜ5名まとめて受け取るのか
 *
 * Freeze 10 だけは1人の操作が他人に波及するため。1問終わるたびに休み中の全員の
 * 残り問数を1減らす必要がある（設計メモ 3.3）。1人ぶんを受け取る関数にすると
 * このコースが書けない。
 *
 * 処理の順序も決まっている。
 *   ① その問題ぶんの休みカウントを全員分減らす
 *   ② 今回の正誤を反映する
 * 逆にすると「1度目の誤答で1問休み」が1問ずれる。
 *
 * ## 元の配列を書き換えない
 *
 * 常に新しいオブジェクトを返す。2nd Round では、終了時処理が取得済みの配列を直接
 * 書き換えたせいで Undo 用スナップショットが「更新後」の状態になるバグが出た。
 * ここで書き換えないようにしておけば、呼び出し側が順序を気にしなくてよい。
 *
 */

import type { Player } from './types';
import {
    THIRD_ROUND_COURSES,
    WINNERS_PER_COURSE,
    PLAYERS_PER_COURSE,
    type ThirdRoundCourseName
} from './thirdRoundCourses';

/** 進行卓が押すボタン。through（スルー）は Freeze 10 でのみ使う */
export type ThirdRoundAction = 'correct' | 'wrong' | 'through';

export type ScoringInput = {
    /** どのコースのルールで採点するか */
    course: ThirdRoundCourseName;
    /** そのコースの出場者5名 */
    players: Player[];
    /** 対象の選手。スルーは選手に紐づかないので null */
    playerId: number | null;
    action: ThirdRoundAction;
};

/** 10 up-down: 勝ち抜けに必要なポイント */
const UP_DOWN_WIN_POINT = 10;
/** 10 up-down: 失格となる通算誤答回数 */
const UP_DOWN_LOSE_WRONG_COUNT = 2;

/** Freeze 10: 勝ち抜けに必要な正解数 */
const FREEZE_WIN_CORRECT_COUNT = 10;

/** Swedish 10: 勝ち抜けに必要な正解数 */
const SWEDISH_WIN_CORRECT_COUNT = 10;
/** Swedish 10: 失格となる × の合計 */
const SWEDISH_LOSE_CROSS = 10;

// Swedish10
export function getSwedishCrossToAdd(correctCount: number): number {
    if (correctCount <= 0) return 1;
    if (correctCount <= 2) return 2;
    if (correctCount <= 5) return 3;
    return 4;
}

/** 10 by 10: 誤答ポイントの初期値。誤答のたびに1減る */
export const TEN_BY_TEN_WRONG_POINT_START = 10;
/** 10 by 10: 勝ち抜けとなる総合ポイント */
const TEN_BY_TEN_WIN_TOTAL = 100;
/** 10 by 10: 失格となる通算誤答回数 */
const TEN_BY_TEN_LOSE_WRONG_COUNT = 6;

/**
 * 10 by 10 の誤答ポイント（= 10 − 誤答数）。
 * 「誤答ポイント: 10 から始まり、誤答のたびに1減る」というルールの表現で、
 * 誤答数から常に導出できるため列としては持たない。
 */
export function getTenByTenWrongPoint(player: Player): number {
    return TEN_BY_TEN_WRONG_POINT_START - player.thirdRoundWrongCount;
}

/**
 * 10 by 10 の総合ポイント（= 正解数 × 誤答ポイント）。
 *
 * 設計メモ 6.3 の「導出できるものは列にしない」に従い、列として保持しない。
 * 二重管理になるとどこかで必ずずれる。
 */
export function getTenByTenTotal(player: Player): number {
    return player.thirdRoundCorrectCount * getTenByTenWrongPoint(player);
}

/**
 * そのコースで次に勝ち抜ける人が受け取る順位。
 *
 * 順位フィールドの規約は「勝ち抜け → 正の数、失格 → −1、未決着 → 0」。
 * すでに勝ち抜けている人数から導出するので、別途カウンタを持たない。
 */
function nextWinnerRank(players: Player[]): number {
    return players.filter(p => p.thirdRoundRank > 0).length + 1;
}

/**
 * 採点を適用した5名を返す。引数の players は書き換えない。
 */
export function applyThirdRoundScore(input: ScoringInput): Player[] {
    // 0段目: Freeze 10 のみ。1問が終わったので休み中の全員の残り問数を1減らす。
    //
    // **採点より先に実行することがこのコースの肝。**（設計メモ 3.3）
    // 誤答したその問題自体は休みに数えない。「1度目の誤答で1問休み」は次の1問を
    // 休む意味なので、誤答処理でセットした直後に同じ問題で減算すると1問ずれる。
    // 段を分けることで、あとから順序を間違えようがない形にしている。
    const rested = decrementFreezeRest(input.course, input.players);

    // 1段目: 対象の選手だけを採点する
    const scored = scoreTargetPlayer({ ...input, players: rested });

    // 2段目: 終了条件2 が成立していたら、解答席に残っている全員を勝ち抜けにする。
    // この処理は対象者以外の順位も変えるため、全員を見る別の段が要る。
    const finalized = finalizeRemainingWinners(input.course, scored);

    // 3段目: 勝ち抜け枠が埋まったら、その瞬間にコースを終える（2026-10-29 ユーザー指示）
    return closeCourseIfSeatsFilled(finalized);
}

/**
 * 勝ち抜け枠（2名）が埋まったら、まだ解答席にいる選手を全員失格（−1）にしてコースを終える。
 * 失格者が何人いても関係なく、枠が0になった瞬間に終わる（2026-10-29 ユーザー指示）。
 * これをしないと、2名勝ち抜けた後に残りの選手へ「正解」を押すと3人目の勝ち抜けができてしまう。
 * 通常のクイズとサドンデスの両方の最後で呼ぶ。
 * Main は 2nd Round と同じく、ルールで失格した選手だけを LOST にする（isEliminatedByCourseRule）。
 */
export function closeCourseIfSeatsFilled(players: Player[]): Player[] {
    const winnersCount = players.filter(p => p.thirdRoundRank > 0).length;
    if (winnersCount < WINNERS_PER_COURSE) return players;
    return players.map(p => (p.thirdRoundRank === 0 ? { ...p, thirdRoundRank: -1 } : p));
}

/**
 * 1問終わったぶん、休み中の選手の残り問数を1減らす（Freeze 10 のみ）。
 *
 * 正解・誤答・スルーのいずれでも1問は終わっているので、action は問わない。
 * スルーを記録するのが Freeze 10 だけなのはこのためで、他の3コースでは
 * スルーが何にも影響しない（設計メモ 3.3）。
 */
function decrementFreezeRest(course: ThirdRoundCourseName, players: Player[]): Player[] {
    if (course !== THIRD_ROUND_COURSES.FREEZE) return players;

    return players.map(p =>
        p.thirdRoundFreezeRest > 0
            ? { ...p, thirdRoundFreezeRest: p.thirdRoundFreezeRest - 1 }
            : p
    );
}

function scoreTargetPlayer({ course, players, playerId, action }: ScoringInput): Player[] {
    return players.map(p => {
        if (p.id !== playerId) return p;

        // すでに勝ち抜け（正の数）または失格（−1）が確定した選手は解答席にいない。
        // UI 側でもボタンを無効化しているが、データが壊れないようここでも止める。
        if (p.thirdRoundRank !== 0) return p;

        // ---- ここから共通処理 ----
        // 正解数・誤答数は4コース共通で記録する。
        // 10 up-down は判定にポイントしか使わないので正解数を読まないが、
        // 「共通部分は常に同じことをする」形を保つために例外を作らない。
        // （正解数はポイントから導出できないため、記録として残す価値もある）
        let next: Player = { ...p };

        if (action === 'correct') {
            next.thirdRoundCorrectCount += 1;
        } else if (action === 'wrong') {
            next.thirdRoundWrongCount += 1;
        }

        // ---- ここからコース別 ----
        if (course === THIRD_ROUND_COURSES.UP_DOWN) {
            next = applyUpDown(next, action, players);
        } else if (course === THIRD_ROUND_COURSES.TEN_BY_TEN) {
            next = applyTenByTen(next, action, players);
        } else if (course === THIRD_ROUND_COURSES.SWEDISH) {
            next = applySwedish(next, action, players);
        } else if (course === THIRD_ROUND_COURSES.FREEZE) {
            next = applyFreeze(next, action, players);
        }

        return next;
    });
}

/** 終了条件の判定結果。満たしていなければ reason は null */
export type CourseFinishState = {
    finished: boolean;
    /** allWinnersDecided = 2名勝ち抜け、seatsMatchRemaining = 残り人数が残り枠と一致 */
    reason: 'allWinnersDecided' | 'seatsMatchRemaining' | null;
    winnersCount: number;
    eliminatedCount: number;
    /** まだ解答席にいる人数（未決着） */
    activeCount: number;
};

/**
 * コースの終了条件を判定する（設計メモ 4.1）。データは変えない。
 *
 *   条件1 … 2名が勝ち抜けた
 *   条件2 … 3名が失格した ＝「残り人数 === 残り枠」
 *   条件3 … 15分経過（判定基準が必要なので工程8）
 *
 * 条件2 を失格者数ではなく `残り人数 === 残り枠` で書くのは 2nd Round と同じ形。
 * 勝ち抜け w 名・失格3名なら残りは 5−w−3 = 2−w 名で、これは残り枠と一致する。
 *
 * Freeze 10 には失格が存在しないため、このコースでは条件2 が発生しない。
 * 式のうえでは失格が0のまま残り人数が残り枠を下回れないので、コース別の分岐は要らない。
 *
 * この関数は判定するだけで、データは変えない。条件2 が成立したときに残りを
 * 勝ち抜けにするのは finalizeRemainingWinners の仕事。
 * コースを実際に締めて次へ進むのはスタッフの明示操作（決定事項5）。
 */
export function getCourseFinishState(players: Player[]): CourseFinishState {
    const winnersCount = players.filter(p => p.thirdRoundRank > 0).length;
    const eliminatedCount = players.filter(p => p.thirdRoundRank < 0).length;
    const activeCount = players.length - winnersCount - eliminatedCount;
    const remainingSeats = WINNERS_PER_COURSE - winnersCount;

    if (winnersCount >= WINNERS_PER_COURSE) {
        return { finished: true, reason: 'allWinnersDecided', winnersCount, eliminatedCount, activeCount };
    }

    // 条件2 が成立した時点で残り全員が勝ち抜けになるので、4名以上の失格は到達しない。
    // したがって設計メモどおり === でよい。
    //
    // この式は出場者が5名揃っていることを前提にしている。割当の途中（例: 2名しかいない）
    // だと開始前でも成立してしまうため、人数を確認する。
    if (players.length === PLAYERS_PER_COURSE && activeCount === remainingSeats) {
        return { finished: true, reason: 'seatsMatchRemaining', winnersCount, eliminatedCount, activeCount };
    }

    return { finished: false, reason: null, winnersCount, eliminatedCount, activeCount };
}

/**
 * コース内の順位づけに使う比較（判定基準。プレーオフの手前まで）。
 *
 * 戻り値が負なら a が上位。**0 を返す＝判定基準では決着しない（完全同値）** で、
 * 呼び出し側がその先をどう扱うかを決める。
 *
 *   終了条件2（3名失格） … 席順で決着させる
 *   終了条件3（15分経過） … プレーオフへ送る
 *
 * 同じ「同値」でも扱いが違うので、この関数自体は席順を見ない。
 */
export function compareByCourseCriteria(course: ThirdRoundCourseName, a: Player, b: Player): number {
    if (course === THIRD_ROUND_COURSES.UP_DOWN) {
        // 判定基準①はポイント多い順。累計正解数ではない（設計メモ 3.2）
        return b.thirdRoundUpDownPoint - a.thirdRoundUpDownPoint;
    }

    if (course === THIRD_ROUND_COURSES.TEN_BY_TEN) {
        // 判定基準①は総合pt多い順（設計メモ 3.1）
        return getTenByTenTotal(b) - getTenByTenTotal(a);
    }

    if (course === THIRD_ROUND_COURSES.SWEDISH) {
        // 判定基準は2段。①正解数多い順 ②×少ない順（設計メモ 3.1）
        if (a.thirdRoundCorrectCount !== b.thirdRoundCorrectCount) {
            return b.thirdRoundCorrectCount - a.thirdRoundCorrectCount;
        }
        return a.thirdRoundSwedishCross - b.thirdRoundSwedishCross;
    }

    if (course === THIRD_ROUND_COURSES.FREEZE) {
        // 判定基準は2段。①正解数多い順 ②誤答数少ない順（設計メモ 3.1）
        if (a.thirdRoundCorrectCount !== b.thirdRoundCorrectCount) {
            return b.thirdRoundCorrectCount - a.thirdRoundCorrectCount;
        }
        return a.thirdRoundWrongCount - b.thirdRoundWrongCount;
    }

    return 0;
}

// トビ残り判定
function finalizeRemainingWinners(course: ThirdRoundCourseName, players: Player[]): Player[] {
    const state = getCourseFinishState(players);

    if (state.reason !== 'seatsMatchRemaining' || state.activeCount === 0) {
        return players;
    }

    const ordered = players
        .filter(p => p.thirdRoundRank === 0)
        .sort((a, b) => {
            const byCriteria = compareByCourseCriteria(course, a, b);
            if (byCriteria !== 0) return byCriteria;

            // 同点なら席順（2R勝ち抜け順 → 1R順位）
            return a.secondRoundRank !== b.secondRoundRank
                ? a.secondRoundRank - b.secondRoundRank
                : a.paperRank - b.paperRank;
        });

    // 既存の勝ち抜け者の続きから番号を振る
    const newRanks = new Map<number, number>();
    ordered.forEach((p, index) => newRanks.set(p.id, state.winnersCount + index + 1));

    return players.map(p => {
        const rank = newRanks.get(p.id);
        return rank === undefined ? p : { ...p, thirdRoundRank: rank };
    });
}

// サドンデス
// 組参加者5名を入力・出力
export function applyPlayoffScore(
    course: ThirdRoundCourseName,
    players: Player[],
    playerId: number,
    action: 'correct' | 'wrong'
): Player[] {
    const target = players.find(p => p.id === playerId);
    if (!target || target.thirdRoundRank !== 0) return players;
    const scored = players.map(p => {
        if (p.id !== playerId) return p;
        // 正解 or 誤答したプレイヤーへの処理
        return action === 'correct'
            // p を複製した上で、 thirdRoundRank を更新し p を出力
            ? { ...p, thirdRoundRank: nextWinnerRank(players) }
            : { ...p, thirdRoundRank: -1 }
    });

    // トビ残りが発生した時の処理
    const finalized = finalizeRemainingWinners(course, scored);

    // 勝ち抜け枠が埋まったら、残りのサドンデス参加者は失格にしてコースを終える（2026-10-29 ユーザー指示）
    return closeCourseIfSeatsFilled(finalized);
}

// 「コース終了」を押した時に呼ぶ関数
export function finalizeCourseByStandings(
    course: ThirdRoundCourseName,
    players: Player[]
): Player[] {
    const state = getCourseFinishState(players);
    const remainingSeats = WINNERS_PER_COURSE - state.winnersCount;

    const actives = players
        .filter(p => p.thirdRoundRank === 0)
        .sort((a, b) => compareByCourseCriteria(course, a, b));

    if (actives.length === 0) return players;

    // 枠が余っている（または過不足なし）なら、残った全員が通過する。
    // このとき順位は判定基準 → 同点なら席順で決める（終了条件2 と同じ扱い）。
    if (actives.length <= remainingSeats) {
        return finalizeRemainingWinners(course, players);
    }

    // 境界（n位と n+1位）が判定基準で完全同値なら、決着させずプレーオフへ送る
    const isTieAtBoundary =
        compareByCourseCriteria(course, actives[remainingSeats - 1], actives[remainingSeats]) === 0;

    const newRanks = new Map<number, number>();

    if (isTieAtBoundary) {
        // 境界と同値な選手をすべて集める。3名以上が並ぶこともある
        const boundary = actives[remainingSeats - 1];
        const tied = actives.filter(p => compareByCourseCriteria(course, p, boundary) === 0);
        const tiedIds = new Set(tied.map(p => p.id));

        // 同値グループより上位は確定通過、下位は敗退。グループ自身は rank = 0 のまま
        let nextRank = state.winnersCount + 1;
        for (const p of actives) {
            if (tiedIds.has(p.id)) continue;

            if (nextRank <= WINNERS_PER_COURSE && compareByCourseCriteria(course, p, boundary) < 0) {
                newRanks.set(p.id, nextRank);
                nextRank += 1;
            } else {
                newRanks.set(p.id, -1);
            }
        }
    } else {
        actives.forEach((p, index) => {
            newRanks.set(p.id, index < remainingSeats ? state.winnersCount + index + 1 : -1);
        });
    }

    return players.map(p => {
        const rank = newRanks.get(p.id);
        return rank === undefined ? p : { ...p, thirdRoundRank: rank };
    });
}

/**
 * その選手がコースの失格条件を満たしているか（表示の出し分け用）。
 *
 * 敗退（15分経過で通過できなかった）と失格は DB 上どちらも rank = −1 で、
 * 区別が要るのは画面だけ。コースの失格条件から導出できるので列を増やさない。
 */
export function isEliminatedByCourseRule(course: ThirdRoundCourseName, player: Player): boolean {
    if (course === THIRD_ROUND_COURSES.UP_DOWN) {
        return player.thirdRoundWrongCount >= UP_DOWN_LOSE_WRONG_COUNT;
    }
    if (course === THIRD_ROUND_COURSES.TEN_BY_TEN) {
        return player.thirdRoundWrongCount >= TEN_BY_TEN_LOSE_WRONG_COUNT;
    }
    if (course === THIRD_ROUND_COURSES.SWEDISH) {
        return player.thirdRoundSwedishCross >= SWEDISH_LOSE_CROSS;
    }
    // Freeze 10 に失格は存在しない（設計メモ 3.3）
    return false;
}

/**
 * 10 up-down（設計メモ 3.2）
 *
 *   正解 … 1pt。10pt 先取で勝ち抜け
 *   誤答 … 現在のポイントが 0 に戻る。通算2回で失格
 *
 * ポイントは誤答で 0 に戻るため、正解数から復元できない。だから列として持つ。
 *
 * @param player 共通処理まで済んだ状態
 * @param others 勝ち抜け順位を数えるための5名（更新前で構わない。
 *               自分はまだ未決着なので、自分の分がカウントに混ざることはない）
 */
function applyUpDown(player: Player, action: ThirdRoundAction, others: Player[]): Player {
    const next = { ...player };

    if (action === 'correct') {
        next.thirdRoundUpDownPoint += 1;
        if (next.thirdRoundUpDownPoint >= UP_DOWN_WIN_POINT) {
            next.thirdRoundRank = nextWinnerRank(others);
        }
    } else if (action === 'wrong') {
        next.thirdRoundUpDownPoint = 0;   // 誤答で0に戻る
        if (next.thirdRoundWrongCount >= UP_DOWN_LOSE_WRONG_COUNT) {
            next.thirdRoundRank = -1;
        }
    }

    // スルーは 10 up-down では何も起こさない

    return next;
}

/**
 * 10 by 10（設計メモ 3.5）
 *
 *   正解 … 正解ポイント +1。総合pt（正解pt × 誤答pt）が100以上で勝ち抜け
 *   誤答 … 誤答ポイント −1。通算6回で失格
 *
 * このコースは**専用の列を1つも使わない**。正解数と誤答数は共通処理がすでに
 * 動かしており、誤答ポイントも総合ポイントもそこから導出できるため。
 *
 *   誤答pt = 10 − 誤答数
 *   総合pt = 正解数 × 誤答pt
 *
 * 勝ち抜け判定を正解のときだけ見るのは、誤答では総合ptが下がる一方だから。
 * 誤答で新たに100に到達することはない。
 */
function applyTenByTen(player: Player, action: ThirdRoundAction, others: Player[]): Player {
    const next = { ...player };

    if (action === 'correct') {
        if (getTenByTenTotal(next) >= TEN_BY_TEN_WIN_TOTAL) {
            next.thirdRoundRank = nextWinnerRank(others);
        }
    } else if (action === 'wrong') {
        if (next.thirdRoundWrongCount >= TEN_BY_TEN_LOSE_WRONG_COUNT) {
            next.thirdRoundRank = -1;
        }
    }

    // スルーは 10 by 10 では何も起こさない

    return next;
}

/**
 * Swedish 10（設計メモ 3.4）
 *
 *   正解 … 10問正解で勝ち抜け
 *   誤答 … その時点の正解数に応じて × が付く。合計10以上で失格
 *
 * × は「誤答した時点の正解数」に依存するため、現在の正解数と誤答数からは復元できない。
 * 誤答2回・正解数5の人は、5正解のあとに2回誤答したなら 3+3=6×、0正解時と3正解時に
 * 誤答したなら 1+3=4× になる。履歴が無いと決まらないので列として持つ（設計メモ 6.3）。
 *
 * 「その時点の正解数」は共通処理を通ったあとの値をそのまま使う。誤答は正解数を
 * 増やさないため、共通処理の前後でこの値は変わらない（順序に依存しない）。
 */
function applySwedish(player: Player, action: ThirdRoundAction, others: Player[]): Player {
    const next = { ...player };

    if (action === 'correct') {
        if (next.thirdRoundCorrectCount >= SWEDISH_WIN_CORRECT_COUNT) {
            next.thirdRoundRank = nextWinnerRank(others);
        }
    } else if (action === 'wrong') {
        next.thirdRoundSwedishCross += getSwedishCrossToAdd(next.thirdRoundCorrectCount);
        if (next.thirdRoundSwedishCross >= SWEDISH_LOSE_CROSS) {
            next.thirdRoundRank = -1;
        }
    }

    // スルーは Swedish 10 では何も起こさない

    return next;
}

/**
 * Freeze 10（設計メモ 3.3）
 *
 *   正解 … 10問正解で勝ち抜け
 *   誤答 … その時点の通算誤答回数を「残り休み問数」にセットする
 *          （1度目の誤答で1問休み、2度目で2問休み …）
 *   失格 … **存在しない**
 *
 * 休みの減算は 0段目（decrementFreezeRest）で済んでいる。ここでセットした値は
 * この問題では減らないので、「誤答したその問題自体は休みに数えない」が守られる。
 *
 * 通算誤答回数は共通処理で加算済みなので、その値をそのまま残り問数にする。
 * 残り問数は出題の進行に依存するため、誤答回数からは導出できない（設計メモ 6.3）。
 */
function applyFreeze(player: Player, action: ThirdRoundAction, others: Player[]): Player {
    const next = { ...player };

    if (action === 'correct') {
        if (next.thirdRoundCorrectCount >= FREEZE_WIN_CORRECT_COUNT) {
            next.thirdRoundRank = nextWinnerRank(others);
        }
    } else if (action === 'wrong') {
        next.thirdRoundFreezeRest = next.thirdRoundWrongCount;
    }

    // スルーは0段目の減算だけで、対象選手そのものには何も起こさない

    return next;
}
