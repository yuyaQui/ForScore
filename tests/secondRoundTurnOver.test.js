// 2nd Round ターンオーバーの段階の並び（組ごとの表。2026-11-12: 1組目だけ 1位の後に「間」を挟む）
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../lib/secondRound.ts");

const players = Array.from({ length: 12 }, (_, i) => ({ id: i + 1 }));
const ids = (arr) => arr.map(p => p.id);

test("1組目は 1位 → 間 → 2・3位 → 4・5・6位 → 7〜12位", () => {
    const steps = S.getTurnOverSteps(1);
    assert.deepEqual(steps.map(s => s.label), ["1位", "1位の後の間", "2・3位", "4・5・6位", "7〜12位"]);
    assert.equal(steps[1].pause, true);
    assert.deepEqual(ids(S.getTurnOverStepSlice(players, 1, 0)), [1]);
    assert.deepEqual(ids(S.getTurnOverStepSlice(players, 1, 1)), []);          // 間は選手なし
    assert.deepEqual(ids(S.getTurnOverStepSlice(players, 1, 2)), [2, 3]);
    assert.deepEqual(ids(S.getTurnOverStepSlice(players, 1, 4)), [7, 8, 9, 10, 11, 12]);
    assert.deepEqual(ids(S.getTurnOverStepSlice(players, 1, 5)), []);          // 発表し終えた後
});

test("2〜4組目は従来どおりの4段階。4組目の最終段階だけ 48位（帯の最後）を別に発表", () => {
    for (const g of [2, 3, 4]) {
        assert.deepEqual(S.getTurnOverSteps(g).map(s => s.label), ["1位", "2・3位", "4・5・6位", "7〜12位"]);
        assert.deepEqual(ids(S.getTurnOverStepSlice(players, g, 1)), [2, 3]);
    }
    assert.equal(S.getTurnOverSecondaryIndex(4, 3), 5);
    assert.equal(S.getTurnOverSecondaryIndex(4, 2), null);
    assert.equal(S.getTurnOverSecondaryIndex(1, 4), null);
    assert.equal(S.getTurnOverSecondaryIndex(3, 3), null);
});

test("段階の数の上限（サーバの検証 TURN_OVER_STEP_MAX = 5 と合わせる）", () => {
    assert.equal(S.TURN_OVER_MAX_STEPS, 5);
});
