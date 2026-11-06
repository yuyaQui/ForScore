// lib/mainReadiness.js の evaluate()（Main の表示の準備の判断）のテスト（2026-11-06）
const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluate, WAIT_GRACE_MS, STALE_MS } = require("../lib/mainReadiness.js");

const NOW = 1_000_000;
const base = { serverMode: "semifinal", modeChangedAt: NOW - 60_000, waivers: { mode: null, keys: [] }, now: NOW };
const main = (items, extra = {}) => ({ id: "m1", mode: "semifinal", items, receivedAt: NOW - 500, ...extra });
const item = (key, status, extra = {}) => ({ key, required: key !== "profiles", status, error: null, attempts: 0, waitMs: 0, ...extra });

test("Main がつながっていなければ、外せない（理由は未接続）", () => {
    const r = evaluate({ ...base, mains: [] });
    assert.equal(r.block, "Main 未接続");
    assert.equal(r.problems[0].id, "nomain");
});

test("全部そろっていれば、外せる", () => {
    const r = evaluate({ ...base, mains: [main([item("players", "ok"), item("profiles", "ok")])] });
    assert.equal(r.level, "ok");
    assert.equal(r.block, null);
});

test("読み込み中で短い間は「準備中」だけ（問題の帯は出さない）", () => {
    const r = evaluate({ ...base, mains: [main([item("players", "loading", { waitMs: 100 })])] });
    assert.equal(r.level, "wait");
    assert.equal(r.block, "Main 準備中…");
    assert.equal(r.problems.length, 0);
});

test("読み込みが長引いたら、原因と［再取得］を出す", () => {
    const r = evaluate({ ...base, mains: [main([item("players", "loading", { waitMs: WAIT_GRACE_MS + 10 })])] });
    assert.equal(r.level, "problem");
    assert.match(r.problems[0].cause, /選手データの読み込みに応答がありません/);
    assert.deepEqual(r.problems[0].buttons.map(b => b.kind), ["retry"]);
});

test("必須の失敗: 原因にエラーの中身、何度も失敗したらサーバの再起動まで案内。許可のボタンは出さない", () => {
    const r = evaluate({ ...base, mains: [main([item("players", "error", { error: "サーバの応答 500", attempts: 3 })])] });
    const p = r.problems[0];
    assert.match(p.cause, /選手データを読み込めません（サーバの応答 500）/);
    assert.match(p.action, /サーバを再起動/);
    assert.ok(!p.buttons.some(b => b.kind === "waive"));
    assert.equal(r.block, "Main：選手データを読み込めません");
});

test("通信エラーなら、ネットワークの確認を案内する", () => {
    const r = evaluate({ ...base, mains: [main([item("players", "error", { error: "通信エラー。サーバに届きません", attempts: 1 })])] });
    assert.match(r.problems[0].action, /ネットワークを確認/);
    assert.doesNotMatch(r.problems[0].action, /再起動/);
});

test("任意（写真）だけの失敗: ［なしで進める］を出し、許可されたら外せる", () => {
    const mains = [main([item("players", "ok"), item("profiles", "error", { error: "サーバの応答 500", attempts: 1 })])];
    const r = evaluate({ ...base, mains });
    assert.equal(r.problems[0].buttons[0].kind, "waive");
    assert.equal(r.problems[0].buttons[0].key, "profiles");
    assert.ok(r.block);
    const r2 = evaluate({ ...base, mains, waivers: { mode: "semifinal", keys: ["profiles"] } });
    assert.equal(r2.block, null);
    // 別のモードの許可は効かない
    const r3 = evaluate({ ...base, mains, waivers: { mode: "final", keys: ["profiles"] } });
    assert.ok(r3.block);
});

test("報告が途絶えたら「応答なし」で、再読み込みを案内する", () => {
    const r = evaluate({ ...base, mains: [main([], { receivedAt: NOW - STALE_MS - 1 })] });
    assert.equal(r.block, "Main 応答なし");
    assert.equal(r.problems[0].buttons[0].kind, "reload");
});

test("Main のモードが違う: 切り替えた直後は準備中、長引いたら再読み込みを案内", () => {
    const mains = [main([], { mode: "final" })];
    assert.equal(evaluate({ ...base, mains, modeChangedAt: NOW - 100 }).level, "wait");
    const r = evaluate({ ...base, mains, modeChangedAt: NOW - WAIT_GRACE_MS - 1 });
    assert.equal(r.level, "problem");
    assert.match(r.problems[0].cause, /Final/);
});

test("進行状態（Socket）が届かないときは再読み込みを案内する", () => {
    const r = evaluate({ ...base, mains: [main([item("state", "loading", { waitMs: WAIT_GRACE_MS + 1 })])] });
    assert.match(r.problems[0].cause, /進行状態がサーバから届きません/);
    assert.equal(r.problems[0].buttons[0].kind, "reload");
});

test("Main が2台なら、どちらの問題か分かるように書く", () => {
    const r = evaluate({ ...base, mains: [main([item("players", "ok")]), main([item("players", "error", { error: "x" })], { id: "m2" })] });
    assert.match(r.problems[0].title, /2台目/);
});

test("隠れている Main（別のタブなど）は判断に使わない。全部隠れていれば「前面に出す」を案内", () => {
    const visible = main([item("players", "ok")]);
    const hiddenBad = main([item("players", "error", { error: "x" })], { id: "m2", hidden: true, receivedAt: NOW - STALE_MS * 5 });
    assert.equal(evaluate({ ...base, mains: [visible, hiddenBad] }).block, null);
    const r = evaluate({ ...base, mains: [hiddenBad] });
    assert.equal(r.block, "Main が隠れています");
    assert.match(r.problems[0].action, /前面に出して/);
});
