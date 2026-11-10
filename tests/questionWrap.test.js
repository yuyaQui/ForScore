// 問題の通し番号の折り返し（lib/questionWrap.js）と、サーバでの折り返し（2026-11-11）
const test = require("node:test");
const assert = require("node:assert/strict");
const W = require("../lib/questionWrap.js");
const { startServer, stopServer, tmpStateFile, connect, settle } = require("./helpers/harness");

const B = { min: 1, max: 100 };

test("次・前の番号: 上限の次は最初、最初の前は上限。最初・上限が分からなければ折り返さない", () => {
    assert.equal(W.nextSerial(5, B), 6);
    assert.equal(W.nextSerial(100, B), 1);
    assert.equal(W.nextSerial(120, B), 1);            // 上限を超えた番号からも最初へ
    assert.equal(W.nextSerial(100, null), 101);
    assert.equal(W.nextSerial(100, { min: 5, max: 3 }), 101);   // 不正な最初・上限は使わない
    assert.equal(W.prevSerial(5, B), 4);
    assert.equal(W.prevSerial(1, B), 100);
    assert.equal(W.prevSerial(1, null), null);
    assert.equal(W.nextSerial(50, { min: 10, max: 50 }), 10);  // 最初が 1 でないとき
    assert.equal(W.continueFrom(100, B), 1);
    assert.equal(W.continueFrom(30, B), 31);
});

test("振り返り範囲: ふつうの範囲と、上限で折り返す範囲", () => {
    assert.deepEqual(W.rangeSerials({ from: 31, to: 33 }), { ok: true, serials: [31, 32, 33] });
    assert.deepEqual(W.rangeSerials({ from: 98, to: 3, min: 1, max: 100 }), { ok: true, serials: [98, 99, 100, 1, 2, 3] });
    assert.equal(W.describeRange({ from: 98, to: 3, min: 1, max: 100 }), "No.98〜No.100、No.1〜No.3（6問）");
    assert.equal(W.describeRange({ from: 31, to: 45 }), "No.31〜No.45（15問）");
    assert.equal(W.rangeSerials({ from: 98, to: 3 }).ok, false);                       // 最初・上限が無ければ折り返せない
    assert.match(W.rangeSerials({ from: 120, to: 3, min: 1, max: 100 }).error, /最後の問題（No.100）より大きく/);
    assert.match(W.rangeSerials({ from: 1, to: 301 }).error, /300問まで/);
    assert.match(W.rangeSerials({ from: 0, to: 3 }).error, /1以上の整数/);
});

test("サーバ: 上限の問題が終わったら次は最初。Undo で上限に戻る。最初・上限を送らなければ従来どおり", async () => {
    const server = await startServer(tmpStateFile());
    const a = await connect(server);
    await settle(a);
    const cursorIs = (n) => a.next("update_question_display", q => q.cursors.secondRound === n);
    let w = cursorIs(99); a.socket.emit("set_question_cursor", { round: "secondRound", serial: 99 }); await w;
    w = cursorIs(100); a.socket.emit("finish_question", { round: "secondRound", serial: 99, scope: "g1", scored: true, bounds: B }); await w;
    w = a.next("update_question_display", q => q.cursors.secondRound === 1 && q.serial === 100);
    a.socket.emit("finish_question", { round: "secondRound", serial: 100, scope: "g1", scored: true, bounds: B });
    await w;
    w = a.next("update_question_display", q => q.cursors.secondRound === 100 && q.serial === 99);
    a.socket.emit("undo_question_event", { round: "secondRound", scope: "g1", kind: "scored" });
    await w;
    w = cursorIs(101); a.socket.emit("finish_question", { round: "secondRound", serial: 100, scope: "g1", scored: true }); await w;
    assert.equal(server.crashed, null);
    a.close();
    await stopServer(server);
});

test("サーバ: Semi-Final の振り返り範囲は、折り返す範囲を最初・上限つきで受け付け、使えない範囲は捨てる", async () => {
    const server = await startServer(tmpStateFile());
    const a = await connect(server);
    await settle(a);
    let w = a.next("update_semifinal_state", s => s.reviewRanges[1] && s.reviewRanges[1].from === 98);
    a.socket.emit("change_semifinal_state", { reviewRange: { from: 98, to: 3, min: 1, max: 100 } });
    const s = await w;
    assert.deepEqual(s.reviewRanges[1], { from: 98, to: 3, min: 1, max: 100 });
    // 最初・上限の無い逆向きの範囲は受け付けない（前の範囲のまま）
    w = a.next("update_semifinal_state");
    a.socket.emit("change_semifinal_state", { reviewRange: { from: 50, to: 3 } });
    assert.deepEqual((await w).reviewRanges[1], { from: 98, to: 3, min: 1, max: 100 });
    // ふつうの範囲は min・max を持たない
    w = a.next("update_semifinal_state", x => x.reviewRanges[1].from === 31);
    a.socket.emit("change_semifinal_state", { reviewRange: { from: 31, to: 33, min: 1, max: 100 } });
    assert.deepEqual((await w).reviewRanges[1], { from: 31, to: 33 });
    assert.equal(server.crashed, null);
    a.close();
    await stopServer(server);
});
