/**
 * 2nd Round のアドバンテージ計算
 *
 * ルール:
 *   各組の 1st Round 上位6名は、以下のポイントを持った状態でスタートする。
 *     各組1位  : 3ポイント
 *     各組2〜3位: 2ポイント
 *     各組4〜6位: 1ポイント
 *
 * 組分けが 1st Round 順位の輪番（1組目=1,5,9,... / 2組目=2,6,10,... ）で
 * 決まるため、「組内順位」は 1st Round 順位だけで一意に定まる。
 * したがって組番号を見る必要はなく、paperRank の範囲だけで判定できる。
 *
 *   1R  1〜 4位 → 各組1位   → 3pt
 *   1R  5〜12位 → 各組2〜3位 → 2pt
 *   1R 13〜24位 → 各組4〜6位 → 1pt
 *   1R 25〜48位 → 各組7位以降 → 0pt
 */

/** アドバンテージの配点表。resetScores から範囲条件としても再利用する。 */
export const ADVANTAGE_RANGES = [
    { maxPaperRank: 4, point: 3 },   // 各組1位
    { maxPaperRank: 12, point: 2 },  // 各組2〜3位
    { maxPaperRank: 24, point: 1 },  // 各組4〜6位
] as const;

/**
 * 1st Round 順位から、2nd Round 開始時のアドバンテージ点を返す。
 * @param paperRank 1st Round（筆記クイズ）の順位
 */
export function getAdvantage(paperRank: number): number {
    for (const range of ADVANTAGE_RANGES) {
        if (paperRank <= range.maxPaperRank) return range.point;
    }
    return 0;
}
