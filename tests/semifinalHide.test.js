// Semi-Final: 前のセットまでに決着した選手を Main から消す判定と、敗退したセットの記録（2026-11-11）
// Node 22 の型の取り除き（.ts をそのまま読む）を使う
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../lib/semifinalScoring.ts");

const p = (id, extra = {}) => ({ id, semifinalPoint: 0, semifinalRank: 0, semifinalLostSet: 0, ...extra });

test("applyElimination は敗退したセットを記録する（決着済みの選手は変えない）", () => {
    const players = [p(1), p(2), p(3, { semifinalRank: 1 })];
    const out = S.applyElimination(players, 2, [1, 3]);
    assert.deepEqual(out[0], p(1, { semifinalRank: -1, semifinalLostSet: 2 }));
    assert.equal(out[1], players[1]);
    assert.equal(out[2], players[2]);
});

test("planSemifinalJudgement の敗退もそのセットで記録される", () => {
    const players = [p(1, { semifinalPoint: 9 }), p(2, { semifinalPoint: 5 }), p(3, { semifinalPoint: 4 }), p(4, { semifinalPoint: 1 })];
    const plan = S.planSemifinalJudgement(players, 1);
    assert.equal(plan.error, null);
    assert.deepEqual(plan.steps.map(s => s.action), ["judgeAdvance", "judgeEliminate"]);
});

test("isDecidedBeforeSet: 前のセットまでの勝ち抜け・敗退だけ true", () => {
    // 勝ち抜け
    assert.equal(S.isDecidedBeforeSet(p(1, { semifinalRank: 1 }), 1), false);   // そのセットのうちは出す
    assert.equal(S.isDecidedBeforeSet(p(1, { semifinalRank: 1 }), 2), true);
    assert.equal(S.isDecidedBeforeSet(p(1, { semifinalRank: 2 }), 2), false);
    assert.equal(S.isDecidedBeforeSet(p(1, { semifinalRank: 2 }), 3), true);
    // 敗退
    assert.equal(S.isDecidedBeforeSet(p(1, { semifinalRank: -1, semifinalLostSet: 1 }), 1), false);
    assert.equal(S.isDecidedBeforeSet(p(1, { semifinalRank: -1, semifinalLostSet: 1 }), 2), true);
    assert.equal(S.isDecidedBeforeSet(p(1, { semifinalRank: -1, semifinalLostSet: 2 }), 3), true);
    assert.equal(S.isDecidedBeforeSet(p(1, { semifinalRank: -1, semifinalLostSet: 2 }), 2), false);
    // 敗退したセットが記録されていない（列を足す前の敗退）ときは出したまま
    assert.equal(S.isDecidedBeforeSet(p(1, { semifinalRank: -1, semifinalLostSet: 0 }), 3), false);
    assert.equal(S.isDecidedBeforeSet({ semifinalRank: -1 }, 3), false);
    // 未決着
    assert.equal(S.isDecidedBeforeSet(p(1), 3), false);
});
