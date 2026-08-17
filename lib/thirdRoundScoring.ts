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
 * ## 実装状況
 *
 * 実装済みは共通処理（正解数 +1 / 誤答数 +1）と 10 up-down、および終了条件2
 * （残り人数 === 残り枠 で残り全員を勝ち抜け）。
 * Freeze 10 / Swedish 10 / 10 by 10 は工程7-4〜7-6 で足す。
 *
 * 15分経過時の順位決定とプレーオフ（終了条件3）は工程8。
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
    // 1段目: 対象の選手だけを採点する
    const scored = scoreTargetPlayer(input);

    // 2段目: 終了条件2 が成立していたら、解答席に残っている全員を勝ち抜けにする。
    // この処理は対象者以外の順位も変えるため、全員を見る別の段が要る。
    return finalizeRemainingWinners(input.course, scored);
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
        }

        // Freeze 10 / Swedish 10 / 10 by 10 は工程7-4〜7-6 で実装する

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
 * コース内の順位づけに使う比較（判定基準の第1条件）。
 *
 * 戻り値が負なら a が上位。コースごとに「多い順」で見る値が違う。
 * 未実装のコースは 0 を返すので、呼び出し側の同点処理（席順）に落ちる。
 */
function compareByCourseCriteria(course: ThirdRoundCourseName, a: Player, b: Player): number {
    if (course === THIRD_ROUND_COURSES.UP_DOWN) {
        // 判定基準①はポイント多い順。累計正解数ではない（設計メモ 3.2）
        return b.thirdRoundUpDownPoint - a.thirdRoundUpDownPoint;
    }

    // Freeze 10 / Swedish 10 / 10 by 10 は工程7-4〜7-6 で足す
    return 0;
}

/**
 * 終了条件2（残り人数 === 残り枠）が成立していたら、解答席に残っている全員を
 * 勝ち抜けにする（設計メモ 4.1 の条件2）。
 *
 * 順位は「判定基準（ポイント多い順）→ 同点なら席順」で決める。
 * 席順＝コース選択と同じ優先順位（2R勝ち抜け順 → 1R順位）。
 *
 * 設計メモ 4.3 は同点をプレーオフとしているが、条件2 は**残った全員がどのみち
 * 勝ち抜ける**場面で順位の付け方だけの問題なので、席順で決着させる。
 * 誰が通過するかを決める15分経過（条件3）とは重みが違うため区別している。
 *
 * 並び順は配列の順序に頼らずフィールドから決める。API は paperRank 順で読んで
 * おり優先順位順ではないため、順序に依存すると読み方を変えた瞬間に壊れる。
 */
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
