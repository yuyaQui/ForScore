// Semi-Final 点数発表のバー演出（2026-11-12: 2位まで10秒・1位まで1秒、最低点10%・2位75%、同点は点滅）
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../lib/semifinalAnnounce.ts");

const c = (...pts) => pts.map((p, i) => ({ id: i + 1, semifinalPoint: p }));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≒ ${b}`);

test("時間は点数に関係なく 10秒 ＋ 1秒（＋余白0.4秒）", () => {
    for (const pts of [[3, 1, 0], [40, 25, -2], [5, 5, 1]]) {
        const plan = A.buildAnnouncePlan(c(...pts));
        assert.equal(plan.riseMs, 10000);
        assert.equal(plan.finishMs, 1000);
        assert.equal(plan.totalMs, 11400);
    }
});

test("高さ: 最低点 10%・2位 75%、その間は比率（0点以下も上がる）", () => {
    const plan = A.buildAnnouncePlan(c(20, 12, 0, -3));
    assert.equal(plan.topId, 1);
    near(A.planPct(plan, -3), 10);
    near(A.planPct(plan, 12), 75);
    near(A.planPct(plan, 0), 10 + (3 / 15) * 65);
    // 10秒で2位が 75%、最下位は途中で止まっている
    near(A.getAnnounceFrame(plan, 2, 10000).pct, 75);
    near(A.getAnnounceFrame(plan, 4, 10000).pct, 10);
    assert.equal(A.getAnnounceFrame(plan, 4, 10000).shownPoint, -3);
    // 2位は 10 秒より前には止まらない
    assert.ok(A.getAnnounceFrame(plan, 2, 9000).pct < 75);
    // 1位は 10 秒まで2位と一緒、その後 1 秒で 100%
    near(A.getAnnounceFrame(plan, 1, 10000).pct, 75);
    near(A.getAnnounceFrame(plan, 1, 11000).pct, 100);
    assert.equal(A.getAnnounceFrame(plan, 1, 11000).shownPoint, 20);
    assert.ok(A.getAnnounceFrame(plan, 1, 10500).pct < 100);
});

test("1位が同点: 同点の選手は 75% で並んで止まり、続く1秒は点滅。100% にはしない", () => {
    const plan = A.buildAnnouncePlan(c(9, 9, 4, 1));
    assert.equal(plan.topId, null);
    assert.deepEqual(plan.tiedIds, [1, 2]);
    near(A.getAnnounceFrame(plan, 1, 10000).pct, 75);
    near(A.getAnnounceFrame(plan, 2, 12000).pct, 75);
    assert.equal(A.getAnnounceFrame(plan, 1, 10050).flash, true);
    assert.equal(A.getAnnounceFrame(plan, 1, 10250).flash, false);
    assert.equal(A.getAnnounceFrame(plan, 3, 10050).flash, false);
    assert.equal(A.getAnnounceFrame(plan, 1, 11500).flash, false);
    assert.equal(A.getAnnounceFrame(plan, 1, 9000).flash, false);
});

test("1位以外が全員同じ点数: 2位として 10秒で 75%", () => {
    const plan = A.buildAnnouncePlan(c(10, 3, 3, 3));
    assert.equal(plan.topId, 1);
    for (const id of [2, 3, 4]) {
        assert.ok(A.getAnnounceFrame(plan, id, 9000).pct < 75);
        near(A.getAnnounceFrame(plan, id, 10000).pct, 75);
    }
    near(A.getAnnounceFrame(plan, 1, 11000).pct, 100);
});

test("全員が同じ点数: 全員 75% で並んで止まり、点滅する", () => {
    const plan = A.buildAnnouncePlan(c(4, 4, 4));
    assert.equal(plan.topId, null);
    assert.deepEqual(plan.tiedIds, [1, 2, 3]);
    for (const id of [1, 2, 3]) {
        near(A.getAnnounceFrame(plan, id, 10000).pct, 75);
        near(A.getAnnounceFrame(plan, id, 11400).pct, 75);
        assert.equal(A.getAnnounceFrame(plan, id, 10050).flash, true);
    }
});

test("対象なしなら時間 0", () => {
    assert.equal(A.buildAnnouncePlan([]).totalMs, 0);
});
