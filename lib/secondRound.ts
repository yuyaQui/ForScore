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

/** 次点のペーパー順位（2nd Round に進めなかった最上位。2026-10-30 追加） */
export const RUNNER_UP_RANK = SECOND_ROUND_PLAYER_COUNT + 1;

/**
 * 次点（ペーパー49位）の選手を返す。同順位が複数いれば全員。いなければ空。
 * DB には何も書かず、ペーパー順位からその都度探すだけ（2026-10-30 ユーザー承認・項目6）
 */
export function getRunnerUps<T extends { id: number; paperRank: number }>(players: T[]): T[] {
    return players.filter(p => p.paperRank === RUNNER_UP_RANK).sort((a, b) => a.id - b.id);
}

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
 * Turn Over（順位発表）画面の段階発表の並び。組ごとに表で持つ（2026-11-12 ユーザー承認）。
 *
 * 基本は 1位のみ → 2・3位 → 4・5・6位 → 7〜12位 の4段階（Design アーティファクトの区切り）。
 * 1組目だけ、ペーパー1位の発表の後に「間」（選手のいない段階）を挟む。1位の帯が縮んでフェードアウトした後、
 * 何も出ない黒い画面で止まり、Admin の「2・3位を表示 ▶」で 2・3位の帯がフェードインする。
 * 段階の切り替え（前の帯のフェードアウト → 次の帯のフェードイン）の仕組みはどの段階も同じで、
 * 「間」も選手がいないだけの普通の段階として扱う（1組目かどうかを画面側で場合分けしない）。
 *
 * secondRoundState.turnOverStep が配列のインデックス。配列の長さを超えたら全部発表し終えた状態。
 * from・to は、ペーパー順位（昇順）でソート済みの組の選手配列に対する範囲（to は含まない）。
 */
export type TurnOverStepDef = {
    /** 段階の名前（Admin のボタン・表示に使う） */
    label: string;
    from: number;
    to: number;
    /** 選手を出さない「間」の段階 */
    pause?: boolean;
};

const BASE_TURN_OVER_STEPS: TurnOverStepDef[] = [
    { label: '1位', from: 0, to: 1 },
    { label: '2・3位', from: 1, to: 3 },
    { label: '4・5・6位', from: 3, to: 6 },
    { label: '7〜12位', from: 6, to: 12 },
];

/** 組ごとの段階の並び。ここだけを書き換えれば、Admin・Main の段階発表がそのとおりに動く */
const TURN_OVER_STEPS_BY_GROUP: Record<number, TurnOverStepDef[]> = {
    1: [
        BASE_TURN_OVER_STEPS[0],
        { label: '1位の後の間', from: 1, to: 1, pause: true },
        ...BASE_TURN_OVER_STEPS.slice(1),
    ],
};

/** その組の発表の段階の並び（1〜4組目。それ以外は基本の4段階） */
export function getTurnOverSteps(group: number): TurnOverStepDef[] {
    return TURN_OVER_STEPS_BY_GROUP[group] ?? BASE_TURN_OVER_STEPS;
}

/** 段階がいくつあるか（turnOverStep がこの値以上なら全部発表し終えた状態）。どの組でもこの値以下 */
export const TURN_OVER_MAX_STEPS = Math.max(...[1, 2, 3, 4].map(g => getTurnOverSteps(g).length));

/** ペーパー順位昇順でソート済みの組の選手配列から、その組の指定段階の帯だけを取り出す（間の段階は空） */
export function getTurnOverStepSlice<T>(sortedGroupPlayers: T[], group: number, step: number): T[] {
    const def = getTurnOverSteps(group)[step];
    if (!def) return [];
    return sortedGroupPlayers.slice(def.from, def.to);
}

/**
 * 4組目の最終段階「7〜12位」だけ、48位（その段階の帯の中で最後の1人）を
 * 他の5人（28〜44位）より後に単独発表する。画面（レイヤー）は分けず、同じ帯の中に
 * 6人とも表示したまま、48位のカード1枚だけ collapsed/expanded を個別に切り替える
 * 必要があるため、「その帯の中で個別扱いする1人」の帯内インデックスを返す関数を
 * 用意する。対象外（4組目以外、または最終段階以外）は null を返し、
 * 呼び出し側は「全員一律で扱う」通常ロジックのままにする
 * （2026-09-27、ユーザー指示：48位の見た目自体は変えず、発表タイミングだけを分離する）。
 */
export function getTurnOverSecondaryIndex(group: number, step: number): number | null {
    const steps = getTurnOverSteps(group);
    if (group !== SECOND_ROUND_GROUP_COUNT || step !== steps.length - 1) return null;
    const def = steps[step];
    return def.to - def.from - 1;
}
