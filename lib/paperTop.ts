// ペーパークイズ上位100名の発表（2026-10-31 ユーザー承認・項目19）の画面の割り振り。
// DB は読むだけ。ペーパー順位（paperRank）から、その都度計算する。
//
//   1画面目 … 1〜4位（4人）
//   2画面目〜 … 6人ずつ（5〜10位、11〜16位 … 95〜100位）。全17画面
//
// 同順位が画面の境目をまたぐときは、同順位の人を前の画面に入れる（その画面だけ人数が増える）。
// 次の画面は続きから始め、本来の区切り（10位・16位 …）で終える。前の画面で区切りを越えて
// しまったときは、その画面を飛ばす。選手が100人に満たないときは、いる人数まで。
import {
    PAPER_TOP_COUNT, PAPER_TOP_FIRST_PAGE_SIZE, PAPER_TOP_PAGE_SIZE, PAPER_TOP_PAGE_MAX,
} from '../constants.js';

export { PAPER_TOP_COUNT, PAPER_TOP_PAGE_MAX };

/** k 画面目（0始まり）までの累計人数（区切り）: 4, 10, 16, … 100 */
function cumulativeEnd(k: number): number {
    return Math.min(PAPER_TOP_COUNT, PAPER_TOP_FIRST_PAGE_SIZE + k * PAPER_TOP_PAGE_SIZE);
}

/** 画面ごとの選手（ペーパー順位 → id の順）。空の画面は含めない */
export function getPaperTopPages<T extends { id: number; paperRank: number }>(players: T[]): T[][] {
    const sorted = players
        .filter(p => p.paperRank >= 1 && p.paperRank <= PAPER_TOP_COUNT)
        .sort((a, b) => a.paperRank - b.paperRank || a.id - b.id);
    const pages: T[][] = [];
    let start = 0;
    for (let k = 0; k < PAPER_TOP_PAGE_MAX && start < sorted.length; k++) {
        let end = Math.min(sorted.length, cumulativeEnd(k));
        if (end <= start) continue;   // 前の画面が同順位で区切りを越えた
        // 同順位を同じ画面に入れる
        while (end < sorted.length && sorted[end].paperRank === sorted[end - 1].paperRank) end++;
        pages.push(sorted.slice(start, end));
        start = end;
    }
    return pages;
}

/** 画面の順位の範囲の表示（例「5〜10位」「1位」） */
export function paperTopRangeLabel(page: { paperRank: number }[]): string {
    if (page.length === 0) return '';
    const first = page[0].paperRank, last = page[page.length - 1].paperRank;
    return first === last ? `${first}位` : `${first}〜${last}位`;
}
