// 「次に読む問題」を大会全体で1つにする（2026-11-12 ユーザー決定）。
// ラウンド・ルール・セット・サドンデスをまたいで、同じ番号が続きから進む
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { startServer, stopServer, tmpStateFile, connect, settle } = require("./helpers/harness");

const ALL = ["secondRound", "thirdRound", "extraSecondStep", "semifinal", "final"];

test("どの画面で1問終わっても同じ番号が進み、全ラウンドに同じ番号が配られる", async () => {
    const server = await startServer(tmpStateFile());
    const a = await connect(server);
    await settle(a);
    let w = a.next("update_question_display", q => q.cursor === 10);
    a.socket.emit("set_question_cursor", { round: "secondRound", serial: 10 });
    let q = await w;
    for (const r of ALL) assert.equal(q.cursors[r], 10, r);
    // 2nd Round で1問 → 3rd Round はその続き（11）から
    w = a.next("update_question_display", q => q.cursor === 11);
    a.socket.emit("finish_question", { round: "secondRound", serial: 10, scope: "g1", scored: true });
    await w;
    w = a.next("update_question_display", q => q.cursor === 12 && q.round === "thirdRound" && q.serial === 11);
    a.socket.emit("finish_question", { round: "thirdRound", serial: 11, scope: "10 up-down", scored: false });
    q = await w;
    for (const r of ALL) assert.equal(q.cursors[r], 12, r);
    // 古い番号（10）での finish は受け付けない（二重送信・古い画面）
    a.socket.emit("finish_question", { round: "final", serial: 10, scope: "", scored: false });
    await settle(a);
    assert.equal(a.last("update_question_display").cursor, 12);
    assert.equal(server.crashed, null);
    a.close();
    await stopServer(server);
});

test("Undo: 後でほかの場面の番号が進んでいたら、番号は戻さない（得点だけ戻る）", async () => {
    const server = await startServer(tmpStateFile());
    const a = await connect(server);
    await settle(a);
    let w = a.next("update_question_display", q => q.cursor === 20);
    a.socket.emit("set_question_cursor", { round: "thirdRound", serial: 20 });
    await w;
    w = a.next("update_question_display", q => q.cursor === 21);
    a.socket.emit("finish_question", { round: "thirdRound", serial: 20, scope: "c1", scored: true });
    await w;
    // すぐの Undo は番号も戻る
    w = a.next("update_question_display", q => q.cursor === 20);
    a.socket.emit("undo_question_event", { round: "thirdRound", scope: "c1", kind: "scored" });
    await w;
    // 3rd Round で1問 → Final で1問進んだ後に、3rd Round の Undo
    w = a.next("update_question_display", q => q.cursor === 21);
    a.socket.emit("finish_question", { round: "thirdRound", serial: 20, scope: "c1", scored: true });
    await w;
    w = a.next("update_question_display", q => q.cursor === 22);
    a.socket.emit("finish_question", { round: "final", serial: 21, scope: "", scored: true });
    await w;
    w = a.next("update_question_display", q => !q.lastEvents || !q.lastEvents.thirdRound);
    a.socket.emit("undo_question_event", { round: "thirdRound", scope: "c1", kind: "scored" });
    q = await w;
    assert.equal(q.cursor, 22, "Final で進んだ番号は戻らない");
    assert.equal(server.crashed, null);
    a.close();
    await stopServer(server);
});

test("ラウンドのリセットでは番号は変えない（やり直すときは手で直す）", async () => {
    const server = await startServer(tmpStateFile());
    const a = await connect(server);
    await settle(a);
    let w = a.next("update_question_display", q => q.cursor === 31);
    a.socket.emit("set_question_cursor", { round: "secondRound", serial: 30 });
    a.socket.emit("finish_question", { round: "secondRound", serial: 30, scope: "g1", scored: true });
    await w;
    a.socket.emit("reset_round_progress", { from: "secondRound" });
    await settle(a);
    const q = a.last("update_question_display");
    assert.equal(q.cursor, 31);
    assert.equal(q.serial, null, "表示中の問題（2nd Round）は消える");
    assert.equal(server.crashed, null);
    a.close();
    await stopServer(server);
});

test("再起動: 番号は大会全体の1つとして戻る。古い保存（ラウンドごと）は一番先の番号を引き継ぐ", async () => {
    const stateFile = tmpStateFile();
    fs.writeFileSync(stateFile, JSON.stringify({
        version: 1,
        data: { question: { questionDisplay: { round: null, serial: null, shown: false, seq: 3, cursors: { secondRound: 40, thirdRound: 95, final: 7 } }, logs: {} } },
    }));
    const server = await startServer(stateFile);
    const a = await connect(server);
    await settle(a);
    const q = a.last("update_question_display");
    assert.equal(q.cursor, 95);
    for (const r of ALL) assert.equal(q.cursors[r], 95, r);
    assert.equal(server.crashed, null);
    a.close();
    await stopServer(server);
});
