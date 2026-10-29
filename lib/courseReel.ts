// 3rd Round のコース抽選ルーレットに流すコース名の並び（2026-10-29 追加。表示専用の純関数）
//
// - 流すのは、その抽選の時点でまだ抽選されていなかったコースだけ（ユーザー決定）。
//   順番は THIRD_ROUND_COURSE_NAMES の並びで固定する。
// - 以前は「全コースを周回させた後ろに当選コースを1つ付け足す」作りで、当選が最後のコース（10 by 10）
//   のとき同じ名前が2つ続き、他のコースでは順番が飛んでいた。周回の続きとして、
//   決まった順番のまま当選コースの位置まで進めて止める。
import { THIRD_ROUND_COURSE_NAMES } from './thirdRoundCourses';

type CourseRow = { name: string; playOrder: number | null };

/**
 * 当選コース target の抽選の時点で、まだ抽選されていなかったコース（target を含む）を固定の順番で返す。
 * target が無い（まだ1つも抽選していない）ときは、未抽選のコースすべて。
 */
export function reelPoolFor(courses: CourseRow[], target: string | null): string[] {
    const targetOrder = target === null ? null : courses.find(c => c.name === target)?.playOrder ?? null;
    return THIRD_ROUND_COURSE_NAMES.filter(name => {
        const course = courses.find(c => c.name === name);
        if (!course) return false;
        if (course.playOrder === null) return true;
        return targetOrder !== null && course.playOrder >= targetOrder;
    });
}

/**
 * 時系列（先に流れる順）の並び。pool を laps 周させ、続けて pool の先頭から target まで進めて終わる。
 * 最後の要素が target（止まる位置）。target が pool に無い異常時は、末尾に target を付けて必ずそこで止める。
 */
export function buildReelSequence(target: string | null, pool: string[], laps: number): string[] {
    const sequence: string[] = [];
    for (let lap = 0; lap < laps; lap++) sequence.push(...pool);
    if (target === null) return sequence;
    const index = pool.indexOf(target);
    if (index < 0) return [...sequence, target];
    sequence.push(...pool.slice(0, index + 1));
    return sequence;
}
