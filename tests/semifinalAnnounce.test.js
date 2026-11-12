// Semi-Final 点数発表のバー演出（2026-11-12: 2位まで一定時間・1位まで一定時間、最低点・2位の高さは固定、同点は点滅、
// 得点は確定するまで「?」）。時間と高さは lib/semifinalAnnounce.ts の値（調整されうる）から読む
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../lib/semifinalAnnounce.ts");

const c = (...pts) => pts.map((p, i) => ({ id: i + 1, semifinalPoint: p }));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≒ ${b}`);
const LOW = A.ANNOUNCE_LOWEST_PCT, SECOND = A.ANNOUNCE_SECOND_PCT;

test("時間は点数に関係なく同じ", () => {
    const plans = [[3, 1, 0], [40, 25, -2], [5, 5, 1]].map(pts => A.buildAnnouncePlan(c(...pts)));
    for (const plan of plans) {
        assert.ok(plan.riseMs > 0 && plan.finishMs > 0);
        assert.equal(plan.riseMs, plans[0].riseMs);
        assert.equal(plan.finishMs, plans[0].finishMs);
        assert.equal(plan.totalMs, plans[0].totalMs);
        assert.ok(plan.totalMs >= plan.riseMs + plan.finishMs);
    }
});

test("高さ: 最低点・2位は決まった高さ、その間は比率（0点以下も上がる）", () => {
    const plan = A.buildAnnouncePlan(c(20, 12, 0, -3));
    const R = plan.riseMs, F = plan.finishMs;
    assert.equal(plan.topId, 1);
    near(A.planPct(plan, -3), LOW);
    near(A.planPct(plan, 12), SECOND);
    near(A.planPct(plan, 0), LOW + (3 / 15) * (SECOND - LOW));
    near(A.getAnnounceFrame(plan, 2, R).pct, SECOND);
    near(A.getAnnounceFrame(plan, 4, R).pct, LOW);
    assert.equal(A.getAnnounceFrame(plan, 4, R).shownPoint, -3);
    assert.ok(A.getAnnounceFrame(plan, 2, R * 0.9).pct < SECOND);
    near(A.getAnnounceFrame(plan, 1, R).pct, SECOND);
    near(A.getAnnounceFrame(plan, 1, R + F).pct, 100);
    assert.equal(A.getAnnounceFrame(plan, 1, R + F).shownPoint, 20);
    assert.ok(A.getAnnounceFrame(plan, 1, R + F / 2).pct < 100);
});

test("得点の確定: 止まった選手から順に確定。単独1位は 100% に達するまで確定しない", () => {
    const plan = A.buildAnnouncePlan(c(20, 12, 0, -3));
    const R = plan.riseMs, F = plan.finishMs;
    assert.equal(A.getAnnounceFrame(plan, 4, 0).decided, false);
    // 最下位は高さ LOW に着いた時点で確定（2位より先）
    const tLow = R * (LOW / SECOND);
    assert.equal(A.getAnnounceFrame(plan, 4, tLow + 1).decided, true);
    assert.equal(A.getAnnounceFrame(plan, 2, tLow + 1).decided, false);
    assert.equal(A.getAnnounceFrame(plan, 2, R).decided, true);
    // 1位は 2位と同じ高さに来ても、まだ確定ではない
    assert.equal(A.getAnnounceFrame(plan, 1, R).decided, false);
    assert.equal(A.getAnnounceFrame(plan, 1, R + F / 2).decided, false);
    assert.equal(A.getAnnounceFrame(plan, 1, R + F).decided, true);
});

test("1位が同点: 同点の選手は2位の高さで並んで止まり、続く時間は点滅。100% にはしない", () => {
    const plan = A.buildAnnouncePlan(c(9, 9, 4, 1));
    const R = plan.riseMs, F = plan.finishMs;
    assert.equal(plan.topId, null);
    assert.deepEqual(plan.tiedIds, [1, 2]);
    near(A.getAnnounceFrame(plan, 1, R).pct, SECOND);
    near(A.getAnnounceFrame(plan, 2, plan.totalMs).pct, SECOND);
    assert.equal(A.getAnnounceFrame(plan, 1, R).decided, true);
    assert.equal(A.getAnnounceFrame(plan, 1, R + 1).flash, true);
    assert.equal(A.getAnnounceFrame(plan, 3, R + 1).flash, false);
    assert.equal(A.getAnnounceFrame(plan, 1, R + F + 1).flash, false);
    assert.equal(A.getAnnounceFrame(plan, 1, R * 0.9).flash, false);
});

test("1位以外が全員同じ点数: 2位として同じ時刻に2位の高さ", () => {
    const plan = A.buildAnnouncePlan(c(10, 3, 3, 3));
    const R = plan.riseMs, F = plan.finishMs;
    assert.equal(plan.topId, 1);
    for (const id of [2, 3, 4]) {
        assert.ok(A.getAnnounceFrame(plan, id, R * 0.9).pct < SECOND);
        near(A.getAnnounceFrame(plan, id, R).pct, SECOND);
    }
    near(A.getAnnounceFrame(plan, 1, R + F).pct, 100);
});

test("全員が同じ点数: 全員2位の高さで並んで止まり、点滅する", () => {
    const plan = A.buildAnnouncePlan(c(4, 4, 4));
    const R = plan.riseMs;
    assert.equal(plan.topId, null);
    assert.deepEqual(plan.tiedIds, [1, 2, 3]);
    for (const id of [1, 2, 3]) {
        near(A.getAnnounceFrame(plan, id, R).pct, SECOND);
        near(A.getAnnounceFrame(plan, id, plan.totalMs).pct, SECOND);
        assert.equal(A.getAnnounceFrame(plan, id, R + 1).flash, true);
    }
});

test("対象なしなら時間 0", () => {
    assert.equal(A.buildAnnouncePlan([]).totalMs, 0);
});
