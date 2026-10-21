/**
 * 2nd Round の組分け
 *
 * ルール:
 *   1st Round 上位48名が 2nd Round に進出し、4つの組に12名ずつ分かれる。
 *   組分けは 1st Round 順位の輪番で決まる。
 *
 *     1組目: 1, 5,  9, ... （paperRank % 4 === 1）
 *     2組目: 2, 6, 10, ... （paperRank % 4 === 2）
 *     3組目: 3, 7, 11, ... （paperRank % 4 === 3）
 *     4組目: 4, 8, 12, ... （paperRank % 4 === 0）
 *
 * ## なぜ関数にするか
 *
 * この計算はこれまで取込・seed・画面の3箇所に散っていた。1st Round の参加者
 * 全員（約200名）を DB に入れるようになると、**49位以降を除く条件**が要る。
 * 条件を各所に足すと、どこかで足し忘れて「各組が50名になる」事故が起きる。
 *
 * 判断をこの関数だけに閉じ、DB には結果（組番号）を保存する。画面は列を見るだけに
 * なり、paperRank % 4 を自分で計算しない。
 */

/** 2nd Round に進出する人数（1st Round 上位48名） */
export const SECOND_ROUND_PLAYER_COUNT = 48;

/** 2nd Round の組の数 */
export const SECOND_ROUND_GROUP_COUNT = 4;

/** 1組あたりの勝ち抜け人数（app/api/secondRound/updateScores と同じ値） */
export const SECOND_ROUND_WINNERS_PER_GROUP = 5;

/**
 * 1st Round 順位から 2nd Round の組番号（1〜4）を返す。
 * 2nd Round に出ない選手（49位以降）は null。
 *
 * paperRank < 1 も弾く。CSV の解析に失敗して 0 が入った場合、
 * (0 % 4) || 4 は 4 を返すため、4組目に紛れ込んでしまう。
 *
 * @param paperRank 1st Round（筆記クイズ）の順位
 */
export function getSecondRoundGroup(paperRank: number): number | null {
    if (paperRank < 1 || paperRank > SECOND_ROUND_PLAYER_COUNT) return null;

    // 4の倍数は余りが 0 になるので 4組目に読み替える
    return (paperRank % SECOND_ROUND_GROUP_COUNT) || SECOND_ROUND_GROUP_COUNT;
}

/**
 * Turn Over（順位発表）画面の段階発表の区切り。
 * 1位のみ → 2・3位 → 4・5・6位 → 7〜12位、の4段階（Design アーティファクトの区切りをそのまま採用）。
 * secondRoundState.turnOverStep（0〜3）が配列のインデックスに対応する。
 *
 * ペーパー順位（昇順）でソート済みの組の選手配列に対して使うことを前提にしている
 * （＝配列の0番目が1位、1番目が2位、…）。
 */
export const TURN_OVER_STEP_BOUNDS = [0, 1, 3, 6, 12] as const;
export const TURN_OVER_STEP_LABELS = ['1位', '2・3位', '4・5・6位', '7〜12位'] as const;

/** ペーパー順位昇順でソート済みの組の選手配列から、指定ステップ(0〜3)の帯だけを取り出す */
export function getTurnOverStepSlice<T>(sortedGroupPlayers: T[], step: number): T[] {
    const start = TURN_OVER_STEP_BOUNDS[step] ?? 0;
    const end = TURN_OVER_STEP_BOUNDS[step + 1] ?? sortedGroupPlayers.length;
    return sortedGroupPlayers.slice(start, end);
}

/**
 * 4組目の最終ステップ「7〜12位」だけ、48位（そのステップの帯の中で最後の1人）を
 * 他の5人（28〜44位）より後に単独発表する。画面（レイヤー）は分けず、同じ帯の中に
 * 6人とも表示したまま、48位のカード1枚だけ collapsed/expanded を個別に切り替える
 * 必要があるため、「その帯の中で個別扱いする1人」の帯内インデックスを返す関数を
 * 用意する。対象外（4組目以外、または最終ステップ以外）は null を返し、
 * 呼び出し側は「全員一律で扱う」通常ロジックのままにする
 * （2026-09-27、ユーザー指示：48位の見た目自体は変えず、発表タイミングだけを分離する）。
 */
export function getTurnOverSecondaryIndex(group: number, step: number): number | null {
    const isLastStep = step === TURN_OVER_STEP_BOUNDS.length - 2;
    if (group !== SECOND_ROUND_GROUP_COUNT || !isLastStep) return null;
    const start = TURN_OVER_STEP_BOUNDS[step];
    const end = TURN_OVER_STEP_BOUNDS[step + 1];
    return end - start - 1;
}
