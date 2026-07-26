/**
 * 3rd Round コース選択の割当ロジック
 *
 * ルール:
 *   ネームプレートを掲げている人が5名以上の場合、掲げている人のうち
 *   「優先順位」上位の5名が出場となる。4名以下の場合は、まず掲げている人の
 *   出場が確定する。5名に足りなかった人数分は、その他のプレートを下げていた
 *   人の中から、優先順位下位の人をそのコースへ強制的に出場とすることで補充する。
 *
 *   優先順位は「2nd Round での勝ち抜け順 → 1st Round 順位」により決定する。
 *
 * 非対称性が制度の肝である。人気コースには優先順位上位者が入り、不人気コースには
 * 下位者が押し込まれる。優先順位が高いほど「行きたいコースに行ける」かつ
 * 「行きたくないコースを避けられる」という二重の利得になる。
 */

/** 優先順位の判定に必要な最小限の情報 */
export type PrioritizedPlayer = {
    id: number;
    secondRoundRank: number;
    paperRank: number;
};

/**
 * コース選択の優先順位で並べる。
 * 2nd Round の勝ち抜け順が絶対優先で、1st Round 順位は同着のときのみ効く。
 * 配列の先頭が最上位。
 */
export function sortByCoursePriority<T extends PrioritizedPlayer>(players: T[]): T[] {
    return [...players].sort((a, b) =>
        a.secondRoundRank !== b.secondRoundRank
            ? a.secondRoundRank - b.secondRoundRank
            : a.paperRank - b.paperRank
    );
}

export type SelectionResult<T> = {
    /** 出場が決まった選手（優先順位順） */
    participants: T[];
    /** そのうち強制出場となった選手のID */
    forcedIds: number[];
};

/**
 * 出場者を選抜する。
 *
 * @param unassigned まだどのコースにも属していない選手（順序は問わない）
 * @param raisedIds  プレートを掲げていた選手のID
 * @param capacity   1コースの定員（通常5）
 */
export function selectCourseParticipants<T extends PrioritizedPlayer>(
    unassigned: T[],
    raisedIds: number[],
    capacity: number
): SelectionResult<T> {
    // 優先順位順に並べてから分ける。この並びが上位/下位の判定の基準になる。
    const byPriority = sortByCoursePriority(unassigned);

    const raised = byPriority.filter(p => raisedIds.includes(p.id));
    const notRaised = byPriority.filter(p => !raisedIds.includes(p.id));

    if (raised.length >= capacity) {
        // 掲げた人が定員以上 → 優先順位が上の人から定員まで
        return {
            participants: raised.slice(0, capacity),
            forcedIds: []
        };
    }

    // 掲げた人は全員出場。不足分は掲げなかった人から補充する。
    // slice(-n) で末尾から取るのがポイント。末尾＝優先順位が最も低い人たち。
    const shortage = capacity - raised.length;
    const forced = notRaised.slice(-shortage);

    return {
        // 出場者リストも優先順位順に整えて返す（表示でそのまま使えるように）
        participants: sortByCoursePriority([...raised, ...forced]),
        forcedIds: forced.map(p => p.id)
    };
}
