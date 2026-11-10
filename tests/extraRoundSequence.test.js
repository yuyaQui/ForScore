// Extra Round First Step の進行順と、進出者を確認する地点（lib/extraRound.ts。2026-11-11 Survival を1問ずつに）
const test = require("node:test");
const assert = require("node:assert/strict");
const X = require("../lib/extraRound.ts");

const label = (i) => X.getFirstStepItemLabel(i);

test("進行順: Phase 1・2 はまとめて、Survival は1問ずつ出題 → 解答", () => {
    const seq = X.FIRST_STEP_SEQUENCE.map((_, i) => label(i));
    assert.equal(seq.length, 40);
    assert.deepEqual(seq.slice(0, 2), ["問題 1", "問題 2"]);
    assert.deepEqual(seq.slice(9, 11), ["問題 10", "解答 1"]);
    assert.deepEqual(seq.slice(20, 30), ["問題 11", "問題 12", "問題 13", "問題 14", "問題 15", "解答 11", "解答 12", "解答 13", "解答 14", "解答 15"]);
    assert.deepEqual(seq.slice(30), ["問題 16", "解答 16", "問題 17", "解答 17", "問題 18", "解答 18", "問題 19", "解答 19", "問題 20", "解答 20"]);
});

test("進出者を確認する地点: 解答10・解答15、Survival は解答16〜20 のすべて", () => {
    const points = X.FIRST_STEP_SEQUENCE.map((_, i) => i).filter(i => X.isDecisionAnswer(i)).map(label);
    assert.deepEqual(points, ["解答 10", "解答 15", "解答 16", "解答 17", "解答 18", "解答 19", "解答 20"]);
});

test("続ける先と文言: フェーズの終わりは「次のフェーズへ」、Survival は「次の問題へ（問題 n）」、解答20 の後は無し", () => {
    const at = (l) => X.FIRST_STEP_SEQUENCE.map((_, i) => i).find(i => label(i) === l);
    assert.equal(label(X.getContinueCursor(at("解答 10"))), "問題 11");
    assert.equal(X.getContinueLabel(at("解答 10")), "次のフェーズへ");
    assert.equal(label(X.getContinueCursor(at("解答 15"))), "問題 16");
    assert.equal(X.getContinueLabel(at("解答 15")), "次のフェーズへ");
    assert.equal(label(X.getContinueCursor(at("解答 16"))), "問題 17");
    assert.equal(X.getContinueLabel(at("解答 16")), "次の問題へ（問題 17）");
    assert.equal(X.getContinueCursor(at("解答 20")), null);
    assert.equal(X.getContinueLabel(at("解答 20")), null);
    assert.equal(X.getContinueCursor(at("問題 16")), null);   // 解答の前には続けるボタンを出さない
});
