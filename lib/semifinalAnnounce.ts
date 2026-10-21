/**
 * 準決勝の点数発表（Main のポイントバー演出）の計算
 *
 * 2026-10-10 ユーザー決定（設計メモ 6.2）:
 *   各選手のポイントバーが「そのセットまでの合計得点」に向かって上昇する。最も点数が
 *   高い選手が決まったら、その選手のバーだけ上昇速度が上がり、最終的な高さは
 *   それまでのラウンドで勝ち抜けたときと同じ高さ（100%）になる。
 *
 * 動き方:
 *   1. 全員のバーが同じ速さで上がり、それぞれの合計得点の高さで止まる
 *      （0点以下の選手のバーは空のまま）
 *   2. 2番目に高い選手が止まった時点で、残った1名（最高得点者）が決まる。
 *      その選手だけ加速して 100% まで上がる
 *   3. 最高得点が同点なら加速はしない（同じ高さで止まり、判定でプレーオフになる）
 *
 * Main（演出）と Admin（演出が終わるまで「判定」を押せないようにする）が
 * 同じ計算を使えるよう、時間と高さはすべてここで決める。
 */

/**
 * 点数発表に切り替わってから、バーが動き始めるまでの時間（ms）。
 * 2026-10-17: 発表の前に「得点集計」でカードを出しておくようにしたので、開扉演出（約2秒）を
 * 待つ必要がなくなった。切り替わったことが分かる程度の短い間だけ置く。
 */
export const ANNOUNCE_START_DELAY_MS = 800;

/** 最高得点者以外のバーの最大の高さ（%）。最高得点者だけが 100% まで伸びる */
export const ANNOUNCE_MAX_NON_TOP_PCT = 75;
/** 1点ぶん上がるのにかかる時間（ms） */
const RISE_MS_PER_POINT = 220;
const RISE_MIN_MS = 1500;
const RISE_MAX_MS = 5000;
/** 最高得点者が加速して 100% に達するまでの時間 */
const ACCEL_MS = 1200;
/** 動き終わってから「判定」を押せるようになるまでの余白 */
const HOLD_MS = 400;

export type AnnounceContender = { id: number; semifinalPoint: number };

export type AnnouncePlan = {
    /** 単独の最高得点者。同点・対象なしなら null */
    topId: number | null;
    /** 高さ 75% に当たる点数（最高得点。1未満なら1） */
    scale: number;
    /** 全員が一緒に上がる区間の到達点（点） */
    riseTarget: number;
    riseMs: number;
    accelMs: number;
    totalMs: number;
    points: Record<number, number>;
};

export function buildAnnouncePlan(contenders: AnnounceContender[]): AnnouncePlan {
    const points: Record<number, number> = {};
    contenders.forEach(c => { points[c.id] = c.semifinalPoint; });
    if (contenders.length === 0) {
        return { topId: null, scale: 1, riseTarget: 0, riseMs: 0, accelMs: 0, totalMs: 0, points };
    }
    const sorted = [...contenders].sort((a, b) => b.semifinalPoint - a.semifinalPoint);
    const top = sorted[0].semifinalPoint;
    const unique = sorted.length === 1 || sorted[1].semifinalPoint < top;
    const topId = unique ? sorted[0].id : null;
    const second = sorted.length > 1 ? sorted[1].semifinalPoint : 0;
    const riseTarget = Math.max(0, unique ? second : top);
    const riseMs = Math.min(RISE_MAX_MS, Math.max(RISE_MIN_MS, riseTarget * RISE_MS_PER_POINT));
    const accelMs = topId === null ? 0 : ACCEL_MS;
    return { topId, scale: Math.max(1, top), riseTarget, riseMs, accelMs, totalMs: riseMs + accelMs + HOLD_MS, points };
}

/** 点数を高さ（%）にする。0点以下は空、最大 ANNOUNCE_MAX_NON_TOP_PCT */
export function pointToPct(point: number, scale: number): number {
    if (point <= 0) return 0;
    return Math.min(ANNOUNCE_MAX_NON_TOP_PCT, (point / scale) * ANNOUNCE_MAX_NON_TOP_PCT);
}

export type AnnounceFrame = { pct: number; shownPoint: number };

/**
 * 演出開始から elapsedMs 経ったときの、その選手のバーの高さと表示する点数。
 * elapsedMs が totalMs 以上なら最終状態（最高得点者 100%、他は得点どおり）。
 */
export function getAnnounceFrame(plan: AnnouncePlan, id: number, elapsedMs: number): AnnounceFrame {
    const point = plan.points[id] ?? 0;
    const t = Math.max(0, elapsedMs);
    const riseFrac = plan.riseMs > 0 ? Math.min(1, t / plan.riseMs) : 1;
    const level = plan.riseTarget * riseFrac; // 全員共通の「いま何点の高さまで来たか」

    if (id === plan.topId) {
        if (t < plan.riseMs) {
            return { pct: pointToPct(Math.min(level, point), plan.scale), shownPoint: Math.floor(Math.min(level, point)) };
        }
        const a = plan.accelMs > 0 ? Math.min(1, (t - plan.riseMs) / plan.accelMs) : 1;
        const eased = a * a * a; // 加速して伸びる
        const fromPct = pointToPct(plan.riseTarget, plan.scale);
        const fromPoint = Math.max(0, plan.riseTarget);
        return {
            pct: fromPct + (100 - fromPct) * eased,
            shownPoint: a >= 1 ? point : Math.floor(fromPoint + (point - fromPoint) * eased),
        };
    }
    if (point <= 0) return { pct: 0, shownPoint: point };
    const reached = Math.min(level, point);
    return { pct: pointToPct(reached, plan.scale), shownPoint: reached >= point ? point : Math.floor(reached) };
}
