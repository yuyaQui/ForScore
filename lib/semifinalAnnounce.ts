/**
 * 準決勝の点数発表（Main のポイントバー演出）の計算
 *
 * 2026-10-10 ユーザー決定（設計メモ 6.2）、2026-11-12 ユーザー指示で時間と高さの決め方を変更:
 *   ・高さ: 出場者の中の最低点を 10%、2位の点数を 75% として、その間を点数の比率で割り振る
 *     （0点以下の選手のバーも上がる。マイナスの点数の差も高さの差になる）。1位（単独）だけ最後に 100%
 *   ・時間: 点数に関係なく、全員が上がって2位が止まるまで 10 秒、そこから1位が 100% に達するまで 1 秒
 *
 * 動き方:
 *   1. 全員のバーが同じ速さで上がり、それぞれの高さで止まる（低い選手から順に止まる）。
 *      10 秒で2位が 75% に着く
 *   2. 単独の1位はそこから 1 秒で加速して 100% まで上がる（点数の表示も数え上がる）
 *   3. 1位が同点なら同点の選手を「2位」として 75% で並べて止め、続く 1 秒は同点の選手のバーを点滅させる
 *      （100% にはしない。判定でプレーオフになる）
 *   ・1位以外が全員同じ点数（最低点＝2位の点数）なら、その選手たちは2位として 10 秒で 75% に着く
 *   ・全員が同じ点数なら、全員が同点の1位として 75% で並んで止まる（続けて点滅）
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

/** 2位（同点の1位）のバーの高さ（%）。単独の1位だけが最後に 100% まで伸びる */
export const ANNOUNCE_SECOND_PCT = 75;
/** 最低点の選手のバーの高さ（%） */
export const ANNOUNCE_LOWEST_PCT = 10;
/** 全員が上がって2位が止まるまでの時間（点数に関係なく一定） */
const RISE_MS = 10000;
/** その後、単独の1位が 100% に達するまで（同点のときは同点の選手のバーが点滅する時間） */
const FINISH_MS = 1000;
/** 同点のときの点滅の切り替え間隔（1 秒で3回光る） */
const TIE_FLASH_STEP_MS = 1000 / 6;
/** 動き終わってから「判定」を押せるようになるまでの余白 */
const HOLD_MS = 400;

export type AnnounceContender = { id: number; semifinalPoint: number };

export type AnnouncePlan = {
    /** 単独の最高得点者。同点・対象なしなら null */
    topId: number | null;
    /** 1位が同点のときの同点の選手（2名以上）。単独なら空 */
    tiedIds: number[];
    /** 高さ 10% に当たる点数（出場者の最低点） */
    low: number;
    /** 高さ 75% に当たる点数（2位の点数。1位が同点ならその点数） */
    second: number;
    riseMs: number;
    /** 単独1位の加速、または同点の点滅の時間 */
    finishMs: number;
    totalMs: number;
    points: Record<number, number>;
};

export function buildAnnouncePlan(contenders: AnnounceContender[]): AnnouncePlan {
    const points: Record<number, number> = {};
    contenders.forEach(c => { points[c.id] = c.semifinalPoint; });
    if (contenders.length === 0) {
        return { topId: null, tiedIds: [], low: 0, second: 0, riseMs: 0, finishMs: 0, totalMs: 0, points };
    }
    const sorted = [...contenders].sort((a, b) => b.semifinalPoint - a.semifinalPoint);
    const top = sorted[0].semifinalPoint;
    const tied = sorted.filter(c => c.semifinalPoint === top);
    const unique = tied.length === 1;
    const topId = unique && sorted.length > 1 ? sorted[0].id : (sorted.length === 1 ? sorted[0].id : null);
    const second = unique && sorted.length > 1 ? sorted[1].semifinalPoint : top;
    const low = sorted[sorted.length - 1].semifinalPoint;
    return {
        topId, tiedIds: unique ? [] : tied.map(c => c.id), low, second,
        riseMs: RISE_MS, finishMs: FINISH_MS, totalMs: RISE_MS + FINISH_MS + HOLD_MS, points,
    };
}

/** 点数を高さ（%）にする（単独1位の最終の 100% は含まない）。最低点 10%・2位 75%、その間は比率 */
export function planPct(plan: Pick<AnnouncePlan, 'low' | 'second'>, point: number): number {
    if (plan.second <= plan.low) return ANNOUNCE_SECOND_PCT;
    const r = (point - plan.low) / (plan.second - plan.low);
    return Math.min(ANNOUNCE_SECOND_PCT, ANNOUNCE_LOWEST_PCT + Math.max(0, r) * (ANNOUNCE_SECOND_PCT - ANNOUNCE_LOWEST_PCT));
}

/** 高さ（%）に当たる点数（数え上げの表示用）。10% より下は最低点 */
function pctToPoint(plan: Pick<AnnouncePlan, 'low' | 'second'>, pct: number): number {
    if (plan.second <= plan.low || pct <= ANNOUNCE_LOWEST_PCT) return plan.low;
    return plan.low + ((pct - ANNOUNCE_LOWEST_PCT) / (ANNOUNCE_SECOND_PCT - ANNOUNCE_LOWEST_PCT)) * (plan.second - plan.low);
}

/** flash: 同点の選手のバーを光らせるフレーム */
export type AnnounceFrame = { pct: number; shownPoint: number; flash: boolean };

/**
 * 演出開始から elapsedMs 経ったときの、その選手のバーの高さと表示する点数。
 * elapsedMs が totalMs 以上なら最終状態（単独1位 100%、他は planPct）。
 */
export function getAnnounceFrame(plan: AnnouncePlan, id: number, elapsedMs: number): AnnounceFrame {
    const point = plan.points[id] ?? 0;
    const own = planPct(plan, point);
    const t = Math.max(0, elapsedMs);
    const riseFrac = plan.riseMs > 0 ? Math.min(1, t / plan.riseMs) : 1;
    const level = ANNOUNCE_SECOND_PCT * riseFrac; // 全員共通の「いまの高さ」

    if (id === plan.topId && t >= plan.riseMs) {
        const a = plan.finishMs > 0 ? Math.min(1, (t - plan.riseMs) / plan.finishMs) : 1;
        const eased = a * a * a; // 加速して伸びる
        const from = ANNOUNCE_SECOND_PCT;
        return {
            pct: from + (100 - from) * eased,
            shownPoint: a >= 1 ? point : Math.floor(plan.second + (point - plan.second) * eased),
            flash: false,
        };
    }
    const pct = Math.min(level, own);
    const stopped = level >= own;
    const inFinish = t >= plan.riseMs && t < plan.riseMs + plan.finishMs;
    const flash = inFinish && plan.tiedIds.includes(id) && Math.floor((t - plan.riseMs) / TIE_FLASH_STEP_MS) % 2 === 0;
    return { pct, shownPoint: stopped ? point : Math.floor(pctToPoint(plan, pct)), flash };
}
