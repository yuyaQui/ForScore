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
 * 現在はコース共通の「正解数 +1」「誤答数 +1」だけ。コースごとのルール（up-down の
 * ポイント、Freeze の休み、Swedish の×、10 by 10 の総合pt）と勝ち抜け・失格の判定は
 * 工程7-3〜7-6 でこの関数の中に足していく。
 */

import type { Player } from './types';
import type { ThirdRoundCourseName } from './thirdRoundCourses';

/** 進行卓が押すボタン。through（スルー）は Freeze 10 でのみ使う */
export type ThirdRoundAction = 'correct' | 'wrong' | 'through';

export type ScoringInput = {
    /** どのコースのルールで採点するか。工程7-3 以降で分岐に使う */
    course: ThirdRoundCourseName;
    /** そのコースの出場者5名 */
    players: Player[];
    /** 対象の選手。スルーは選手に紐づかないので null */
    playerId: number | null;
    action: ThirdRoundAction;
};

/**
 * 採点を適用した5名を返す。引数の players は書き換えない。
 */
export function applyThirdRoundScore(input: ScoringInput): Player[] {
    const { players, playerId, action } = input;

    return players.map(p => {
        if (p.id !== playerId) return p;

        if (action === 'correct') {
            return { ...p, thirdRoundCorrectCount: p.thirdRoundCorrectCount + 1 };
        }

        if (action === 'wrong') {
            // 誤答数の加算は4コース共通。
            // コース別の効果（up-down のポイント0戻し、Freeze の休み、Swedish の×）と
            // 失格判定は工程7-3 以降でここに足す。
            return { ...p, thirdRoundWrongCount: p.thirdRoundWrongCount + 1 };
        }

        // スルーは Freeze 10 でのみ意味を持つ。工程7-6 で実装する
        return p;
    });
}
