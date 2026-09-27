// 準決勝（Nine Hundred）で使う定数・純関数の置き場。
// 採点そのものは lib/semifinalScoring.ts（S-4）に分ける。

// server/ と app/ の両方が使うため、値の定義元は constants.js（唯一の窓口）。
export { SEMIFINAL_SET_TIME_LIMIT as SET_TIME_LIMIT_SECONDS } from '../constants.js';

import type { Player, ThirdRoundCourse } from './types';
import { SEMIFINAL_SEATS } from './thirdRoundCourses';

export type SemifinalSeatAssignment = {
    seat: number;
    player: Player;
};

/**
 * 3rd Round 通過8名の「通過順位」(1〜8) を求める。
 *
 * 設計メモ「実施したコースの順 → コース内の順位」の通り、コースの実施順
 * （course.playOrder）→ コース内の順位（thirdRoundRank、1か2）の順でソートする。
 * 通過順位そのものは列として持たず、ここで都度導出する。
 */
function getThirdRoundPassOrder(players: Player[], courses: ThirdRoundCourse[]): Player[] {
    const playOrderByCourseName = new Map(courses.map(c => [c.name, c.playOrder]));

    return players
        .filter(p => p.thirdRoundRank > 0)
        .sort((a, b) => {
            const orderA = playOrderByCourseName.get(a.thirdRoundCourseName ?? '') ?? 0;
            const orderB = playOrderByCourseName.get(b.thirdRoundCourseName ?? '') ?? 0;
            if (orderA !== orderB) return orderA - orderB;
            return a.thirdRoundRank - b.thirdRoundRank;
        });
}

/**
 * 準決勝9席の割り当てを導出する（設計メモ 3.4）。
 *
 * 新しい列は持たない。3rd Round 通過8名（thirdRoundRank > 0）は SEMIFINAL_SEATS で
 * 1〜8番席へ、Extra Round 敗者復活者（extraRoundRank === 1）は5番席へ、その都度計算する。
 */
export function getSemifinalSeats(players: Player[], courses: ThirdRoundCourse[]): SemifinalSeatAssignment[] {
    const passOrder = getThirdRoundPassOrder(players, courses);

    const seats: SemifinalSeatAssignment[] = passOrder.map((player, index) => ({
        seat: SEMIFINAL_SEATS[index],
        player
    }));

    const extraRoundWinner = players.find(p => p.extraRoundRank === 1);
    if (extraRoundWinner) {
        seats.push({ seat: 5, player: extraRoundWinner });
    }

    return seats.sort((a, b) => a.seat - b.seat);
}
