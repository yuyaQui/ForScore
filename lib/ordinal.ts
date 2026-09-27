/**
 * 数値を英語の序数表記にする（1 → "1st", 2 → "2nd", 3 → "3rd", 4 → "4th", ...）。
 *
 * 11・12・13 は「〜teen」なので、下1桁が1・2・3でも例外的に "th"
 * （11th・12th・13th、111th・112th・113th も同様）。
 */
export function toOrdinal(n: number): string {
    const remainder100 = n % 100;
    if (remainder100 >= 11 && remainder100 <= 13) return `${n}th`;

    switch (n % 10) {
        case 1: return `${n}st`;
        case 2: return `${n}nd`;
        case 3: return `${n}rd`;
        default: return `${n}th`;
    }
}
