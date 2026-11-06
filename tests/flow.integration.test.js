// 実サーバ(別プロセス)＋複数クライアントでの結合テスト。実行: node --test "tests/*.test.js"
// 「運営者がしうる操作」を、連打・二人の Admin・遅れて開いた画面・再起動・不正な値の形で浴びせて、
// 意図した状態になるか、サーバが落ちないかを確かめる。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { startServer, stopServer, tmpStateFile, connect, settle, sleep } = require("./helpers/harness");

const SS = { kind: "standby", at: "start", title: "2nd Round", sub: "Set 2", startLabel: "ターンオーバーを始める" };
const BS = { kind: "blank", at: "start", startLabel: "クイズを始める" };
const BE = { kind: "blank", at: "end" };
const N = { kind: "none" };
const MANUAL = { kind: "standby", at: "manual" };

/** サーバ1台と、Main・Admin2つのクライアントを用意して body を実行し、片付ける */
async function withServer(body, { stateFile = tmpStateFile() } = {}) {
    const server = await startServer(stateFile);
    const clients = [];
    const mk = async () => { const c = await connect(server); clients.push(c); return c; };
    try {
        const main = await mk();
        const adminA = await mk();
        const adminB = await mk();
        await settle(main); await settle(adminA); await settle(adminB);
        await body({ server, main, adminA, adminB, mk, stateFile });
        assert.equal(server.crashed, null, "サーバが落ちた: " + server.crashed);
    } finally {
        clients.forEach(c => c.close());
        await stopServer(server);
    }
}

const coverReq = (client, cover, expectRev) => client.emit("change_main_cover", { cover, expectRev });

test("覆いの基本: 変えると全員に配られ、版が1つ進む", async () => {
    await withServer(async ({ main, adminA, adminB }) => {
        const c0 = adminA.last("update_main_cover");
        assert.equal(c0.kind, "none");
        const seen = main.next("update_main_cover", (c) => c.rev === c0.rev + 1);
        coverReq(adminA, SS, c0.rev);
        const c1 = await seen;
        assert.equal(c1.kind, "standby");
        assert.equal(c1.title, "2nd Round");
        await settle(adminB);
        assert.equal(adminB.last("update_main_cover").rev, c0.rev + 1, "もう一人の Admin にも届く");
    });
});

test("連打: 同じ操作を同時に5回送っても、1回分しか効かない", async () => {
    await withServer(async ({ main, adminA }) => {
        const rev = adminA.last("update_main_cover").rev;
        for (let i = 0; i < 5; i++) coverReq(adminA, SS, rev);
        await settle(adminA);
        assert.equal(adminA.last("update_main_cover").rev, rev + 1);
        assert.equal(adminA.count("main_cover_rejected"), 4, "残り4回は断られて、Admin に伝わる");
        const rejected = adminA.events.find(e => e.name === "main_cover_rejected");
        assert.equal(rejected.args[0].reason, "stale");
        await settle(main);
        assert.equal(main.events.filter(e => e.name === "update_main_cover" && e.args[0].rev === rev + 1).length, 1, "Main への配信も1回");
    });
});

test("「次へ」型の二度押し: 待機画面→ブランクの二段を飛ばさない", async () => {
    await withServer(async ({ adminA }) => {
        let rev = adminA.last("update_main_cover").rev;
        coverReq(adminA, SS, rev); rev++;
        await settle(adminA);
        // 「待機画面を消す ▶」を、画面が更新される前に二度押しする
        coverReq(adminA, BS, rev);
        coverReq(adminA, N, rev);          // 二度目に押された時点の古い画面は「○○を始める ▶」ではない。同じ版なので断られる
        await settle(adminA);
        const c = adminA.last("update_main_cover");
        assert.equal(c.kind, "blank");
        assert.equal(c.at, "start", "ブランクで止まっている（本編まで飛ばない）");
    });
});

test("二人の Admin: 同じ版から別々の操作を送ると、先の1つだけが通り、後の人は最新の画面を受け取る", async () => {
    await withServer(async ({ adminA, adminB }) => {
        const rev = adminA.last("update_main_cover").rev;
        coverReq(adminA, SS, rev);
        coverReq(adminB, BE, rev);
        await settle(adminA); await settle(adminB);
        assert.equal(adminA.last("update_main_cover").kind, "standby");
        assert.equal(adminB.last("update_main_cover").kind, "standby", "B の画面も勝った側に揃う");
        assert.equal(adminB.count("main_cover_rejected"), 1);
        assert.equal(adminA.count("main_cover_rejected"), 0);
    });
});

test("不正な覆い・許されない遷移は、状態を変えずに断る", async () => {
    await withServer(async ({ adminA }) => {
        let rev = adminA.last("update_main_cover").rev;
        const before = adminA.count("main_cover_rejected");
        for (const bad of [{ kind: "foo" }, { kind: "blank", at: "manual" }, null, "x", 5, {}]) {
            coverReq(adminA, bad, rev);
        }
        adminA.emit("change_main_cover", null);
        adminA.emit("change_main_cover", "x");
        adminA.emit("change_main_cover", { cover: SS });                 // 版なし
        adminA.emit("change_main_cover", { cover: SS, expectRev: "0" }); // 版が文字列
        await settle(adminA);
        assert.equal(adminA.count("main_cover_rejected") - before, 10);
        assert.equal(adminA.last("update_main_cover").rev, rev, "版は進まない");
        // N → N は許可表にない（意味のない操作）。ブランクの終了後 → 本編 (N) は許される
        coverReq(adminA, N, rev);
        await settle(adminA);
        assert.equal(adminA.last("update_main_cover").rev, rev, "覆っていないのに N への要求は何も起こさない");
        rev = adminA.last("update_main_cover").rev;
    });
});

test("手動の待機画面: どの覆いの上にも出せて、外すと元の覆いに戻る", async () => {
    await withServer(async ({ adminA }) => {
        let rev = adminA.last("update_main_cover").rev;
        coverReq(adminA, SS, rev); rev++;
        coverReq(adminA, BS, rev); rev++;           // 「○○を始める」を待つブランク
        await settle(adminA);
        coverReq(adminA, MANUAL, rev); rev++;       // 手動で PLEASE STAND BY
        await settle(adminA);
        assert.equal(adminA.last("update_main_cover").at, "manual");
        coverReq(adminA, BE, rev);                  // 割り込み中に裏で進めようとしても通らない
        await settle(adminA);
        assert.equal(adminA.last("update_main_cover").at, "manual");
        coverReq(adminA, N, rev); rev++;            // 外す
        await settle(adminA);
        const c = adminA.last("update_main_cover");
        assert.deepEqual([c.kind, c.at, c.startLabel], ["blank", "start", "クイズを始める"], "割り込む前の「クイズを始める」待ちに戻る");
    });
});

test("強制解除: どの覆いからでも、1操作で本編に戻れる（行き止まりがない）", async () => {
    await withServer(async ({ adminA }) => {
        for (const first of [SS, BE, BS]) {
            let rev = adminA.last("update_main_cover").rev;
            // 一旦きれいにする
            adminA.emit("change_main_cover", { force: true, expectRev: rev });
            await settle(adminA);
            rev = adminA.last("update_main_cover").rev;
            coverReq(adminA, first, rev);
            await settle(adminA);
            rev = adminA.last("update_main_cover").rev;
            adminA.emit("change_main_cover", { force: true, expectRev: rev });
            await settle(adminA);
            assert.equal(adminA.last("update_main_cover").kind, "none");
        }
    });
});

test("ラウンド切替: 覆いを先に配ってからモードを配る。同じモードの選び直しは覆いを変えない", async () => {
    await withServer(async ({ main, adminA }) => {
        const m0 = main.events.length;
        adminA.emit("change_mode", "secondRound");
        await main.next("mode_update", (m) => m === "secondRound");
        const fresh = main.events.slice(m0).map(e => e.name);
        assert.ok(fresh.indexOf("update_main_cover") < fresh.indexOf("mode_update"), "覆いが先: " + fresh.join(","));
        const cover = main.last("update_main_cover");
        assert.deepEqual([cover.kind, cover.at, cover.title], ["standby", "start", "2nd Round"]);

        const before = main.count("update_main_cover");
        adminA.emit("change_mode", "secondRound");
        await main.next("mode_update", (m) => m === "secondRound");
        await settle(adminA);
        assert.equal(main.count("update_main_cover"), before, "同じモードの選び直しで、待機画面を出し直さない");
    });
});

test("モード: 知らない値・型違いは受け付けず、送った人に今のモードを返す", async () => {
    await withServer(async ({ adminA }) => {
        adminA.emit("change_mode", "secondRound");
        await adminA.next("mode_update", (m) => m === "secondRound");
        for (const bad of ["hackedRound", "", null, 5, {}, { mode: "zzz" }, [], undefined]) {
            const p = adminA.next("mode_update");
            adminA.emit("change_mode", bad);
            assert.equal(await p, "secondRound", JSON.stringify(bad));
        }
    });
});

test("ラウンドへ戻る(resume): 「NEXT ○○」ではなく、ブランクから「この画面を表示する」で出す", async () => {
    await withServer(async ({ adminA }) => {
        adminA.emit("change_mode", { mode: "thirdRound", resume: true });
        await adminA.next("mode_update", (m) => m === "thirdRound");
        const c = adminA.last("update_main_cover");
        assert.deepEqual([c.kind, c.at, c.startLabel], ["blank", "start", "この画面を表示する"]);
    });
});

test("ラウンド切替は手動の待機画面を置き換える（古い割り込みが残らない）", async () => {
    await withServer(async ({ adminA }) => {
        const rev = adminA.last("update_main_cover").rev;
        coverReq(adminA, MANUAL, rev);
        await settle(adminA);
        adminA.emit("change_mode", "thirdRound");
        await adminA.next("mode_update", (m) => m === "thirdRound");
        assert.equal(adminA.last("update_main_cover").at, "start");
        // 戻る先(under)が無いので、これ以降 N への遷移は「割り込みを外す」ではなく開始待ちの操作として動く
        const c = adminA.last("update_main_cover");
        coverReq(adminA, BS, c.rev);
        await settle(adminA);
        assert.equal(adminA.last("update_main_cover").kind, "blank");
    });
});

test("遅れて開いた画面: 取り直しの要求に、今のモード・2nd Round・Extra Round・覆いが返る", async () => {
    await withServer(async ({ adminA, mk }) => {
        adminA.emit("change_mode", "secondRound");
        adminA.emit("change_2nd_round_state", { group: 3, view: "quiz" });
        adminA.emit("change_extra_round_state", { stage: "firstStep", cursor: 4 });
        await settle(adminA);
        const late = await mk();
        // 返事の順番は決まっていないので、両方を先に待ち始めてから要求する（2026-11-06。順番しだいで落ちていた）
        const extra = late.next("update_extra_round_state", (s) => s.stage === "firstStep" && s.cursor === 4);
        const second = late.next("update_second_round_state", (s) => s.group === 3 && s.view === "quiz");
        const mode = late.next("mode_update", (m) => m === "secondRound");
        const cover = late.next("update_main_cover", (c) => c.title === "2nd Round");
        late.emit("request_mode_sync");
        late.emit("request_second_round_sync");
        late.emit("request_extra_round_sync");
        late.emit("request_main_cover_sync");
        await Promise.all([extra, second, mode, cover]);
    });
});

test("2nd Round の状態: 不正な組・画面・ステップ・型は無視し、正しい項目だけ反映する", async () => {
    await withServer(async ({ adminA }) => {
        const send = async (payload) => { adminA.emit("change_2nd_round_state", payload); await settle(adminA); adminA.emit("request_second_round_sync"); return adminA.next("update_second_round_state"); };
        let s = await send({ group: 99, view: "hacked", turnOverStep: -5, turnOverPhase: "zzz", turnOverFinalRevealed: "yes" });
        assert.deepEqual(s, { group: 1, view: "turnOver", turnOverStep: 0, turnOverPhase: "collapsed", turnOverFinalRevealed: false });
        s = await send({ group: 2, view: "quiz", extra: "ignored", turnOverStep: 4 });
        assert.deepEqual([s.group, s.view, s.turnOverStep, "extra" in s], [2, "quiz", 4, false]);
        for (const junk of [null, 5, "x", [], undefined]) {
            s = await send(junk);
            assert.equal(s.group, 2, "壊れた更新で状態が変わらない");
        }
    });
});

test("3rd Round の状態: 知らない項目・範囲外の値は無視する", async () => {
    await withServer(async ({ adminA }) => {
        adminA.emit("change_3rd_round_state", { phase: "quiz", quizOrder: 2 });
        await adminA.next("update_third_round_state", (s) => s.phase === "quiz" && s.quizOrder === 2);
        adminA.emit("change_3rd_round_state", { phase: "hacked", quizOrder: 99, step: 3, finishedOrder: "x", evil: true });
        const s = await adminA.next("update_third_round_state");
        assert.deepEqual([s.phase, s.quizOrder, s.step, "evil" in s], ["quiz", 2, "entry", false]);
    });
});

test("選手データの中継: 形が違う値は配らない", async () => {
    await withServer(async ({ main, adminA }) => {
        for (const bad of [null, "x", 5, {}, [1, 2], [{ name: "id なし" }], new Array(2001).fill({ id: 1 })]) adminA.emit("broadcast_scores", bad);
        await settle(adminA); await settle(main);
        assert.equal(main.count("update_players"), 0);
        adminA.emit("broadcast_scores", [{ id: 1, name: "a" }]);
        const got = await main.next("update_players");
        assert.equal(got.length, 1);
    });
});

test("再接続: つなぎ直した画面には、切れている間に起きた変更を含む最新の状態が届く", async () => {
    await withServer(async ({ adminA, mk }) => {
        const dropped = await mk();
        dropped.close();
        adminA.emit("change_mode", "semifinal");
        adminA.emit("change_2nd_round_state", { group: 4 });
        await settle(adminA);
        const back = await mk();
        await settle(back);
        assert.equal(back.last("mode_update"), "semifinal");
        assert.equal(back.last("update_second_round_state").group, 4);
        assert.equal(back.last("update_main_cover").title, "Semi-Final");
    });
});

test("乱暴な入力: 全イベントに壊れた値を浴びせても、サーバは落ちず、覆いの不変条件を保つ", async () => {
    await withServer(async ({ server, adminA, main }) => {
        const names = [
            "change_mode", "change_2nd_round_state", "change_3rd_round_state", "change_extra_round_state", "change_semifinal_state",
            "change_final_state", "change_paper_top_state", "change_main_cover", "update_text", "broadcast_scores",
            "reset_round_progress", "set_question_cursor", "finish_question", "set_question_shown", "change_third_round_timer",
            "change_semifinal_timer", "reveal_extra_round_step", "1R_start_timer", "1R_stop_timer", "tournament_state_changed",
            "request_main_cover_sync", "request_second_round_sync", "request_extra_round_sync", "request_mode_sync",
        ];
        const junk = [
            undefined, null, 0, -1, NaN, 1e309, "", "x".repeat(5000), true, [], [null], {}, { __proto__: { a: 1 } },
            { action: null }, { action: "start", seconds: "abc" }, { cover: { kind: "standby", at: "start", title: 5 }, expectRev: 0 },
            { group: {}, view: [] }, { mode: { toString: 1 } }, { from: ["all"] }, { round: "secondRound", serial: 1.5 },
        ];
        let seed = 7;
        const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
        for (let i = 0; i < 1500; i++) adminA.emit(names[rnd(names.length)], junk[rnd(junk.length)]);
        await settle(adminA);
        await settle(main);
        const c = main.last("update_main_cover");
        assert.ok(["none", "blank", "standby"].includes(c.kind));
        assert.ok(Number.isInteger(c.rev));
        assert.equal(server.exited, undefined, "サーバのプロセスが生きている");
    });
});

// ---- 再起動 ----

test("再起動: モード・2nd Round の組・覆い・3rd Round の進行と残り時間が、落ちる前のまま戻る（タイマーは止まって）", async () => {
    const stateFile = tmpStateFile();
    // 1回目: 進める
    {
        const server = await startServer(stateFile);
        const a = await connect(server);
        await settle(a);
        a.emit("change_mode", "secondRound");
        a.emit("change_2nd_round_state", { group: 3, view: "quiz" });
        a.emit("change_3rd_round_state", { phase: "quiz", quizOrder: 2 });
        a.emit("set_question_cursor", { round: "secondRound", serial: 17 });
        a.emit("update_text", "開会までお待ちください");
        const rev = (await a.next("update_main_cover")).rev;
        a.emit("change_main_cover", { cover: SS, expectRev: rev });
        a.emit("change_third_round_timer", { action: "start" });
        await sleep(2300);                 // 2秒ぶん減らす
        a.emit("change_third_round_timer", { action: "stop" });
        await sleep(300);
        await settle(a);
        const t = a.last("update_third_round_timer");
        assert.equal(t.runningOrder, null);
        assert.ok(t.remainings[2] <= 900 - 2, "2コース目の時計が進んだ");
        a.close();
        await stopServer(server);          // SIGTERM で最後の保存
        assert.ok(fs.existsSync(stateFile), "保存ファイルがある");
    }
    // 2回目: 同じ保存先で起動し直す
    {
        const server = await startServer(stateFile);
        const b = await connect(server);
        await settle(b);
        assert.equal(b.last("mode_update"), "secondRound");
        const s2 = b.last("update_second_round_state");
        assert.deepEqual([s2.group, s2.view], [3, "quiz"]);
        const s3 = b.last("update_third_round_state");
        assert.deepEqual([s3.phase, s3.quizOrder], ["quiz", 2]);
        const t = b.last("update_third_round_timer");
        assert.equal(t.runningOrder, null, "時計は止まった状態で戻る");
        assert.ok(t.remainings[2] < 900 && t.remainings[2] > 800);
        const cover = b.last("update_main_cover");
        assert.deepEqual([cover.kind, cover.at, cover.sub], ["standby", "start", "Set 2"]);
        assert.equal(b.last("update_question_display").cursors.secondRound, 17);
        assert.equal(b.last("text_updated"), "開会までお待ちください");
        // 戻った後の覆いの操作が、保存された版で通る
        b.emit("change_main_cover", { cover: BS, expectRev: cover.rev });
        await b.next("update_main_cover", (c) => c.kind === "blank");
        assert.equal(server.crashed, null);
        b.close();
        await stopServer(server);
    }
});

test("再起動: 強制終了(SIGKILL)でも、直前の操作から1秒以内のものは残る", async () => {
    const stateFile = tmpStateFile();
    const server = await startServer(stateFile);
    const a = await connect(server);
    await settle(a);
    a.emit("change_mode", "thirdRound");
    a.emit("change_3rd_round_state", { phase: "quiz", quizOrder: 3 });
    await settle(a);
    await sleep(700);                      // 200ms まとめの保存が走るのに十分な時間
    a.close();
    await stopServer(server, "SIGKILL");
    const server2 = await startServer(stateFile);
    const b = await connect(server2);
    await settle(b);
    assert.equal(b.last("mode_update"), "thirdRound");
    assert.equal(b.last("update_third_round_state").quizOrder, 3);
    b.close();
    await stopServer(server2);
});

test("再起動: 保存ファイルが壊れていても起動し、初期値で動く(壊れたファイルは退避)", async () => {
    const stateFile = tmpStateFile();
    fs.writeFileSync(stateFile, "{ これはJSONではない");
    const server = await startServer(stateFile);
    const a = await connect(server);
    await settle(a);
    assert.equal(a.last("mode_update"), "waiting");
    assert.equal(a.last("update_main_cover").kind, "none");
    const dir = require("path").dirname(stateFile);
    assert.ok(fs.readdirSync(dir).some(f => f.includes(".corrupt-")), "壊れたファイルを退避した");
    a.close();
    await stopServer(server);
});

test("再起動: 形式は合っていても中身が不正な保存は、項目ごとに捨てて残りを戻す", async () => {
    const stateFile = tmpStateFile();
    fs.writeFileSync(stateFile, JSON.stringify({
        version: 1,
        data: {
            mode: { currentMode: "hacked", secondRoundState: { group: 9, view: "quiz" } },
            mainCover: { cover: { kind: "blank", at: "manual" }, rev: -3 },
            thirdRound: { state: { phase: "playoff", quizOrder: 4 }, remainings: { 1: "abc", 2: -50, 3: 99999, 4: 600 } },
            question: { questionDisplay: { round: "nope", serial: "x", shown: true, cursors: { secondRound: 5, bad: 7 } }, logs: { secondRound: [{ kind: "zzz", scope: "g1" }, { kind: "scored", scope: "g1" }] } },
        },
    }));
    const server = await startServer(stateFile);
    const a = await connect(server);
    await settle(a);
    assert.equal(a.last("mode_update"), "waiting", "不正なモードは捨てる");
    assert.equal(a.last("update_second_round_state").group, 1, "不正な組は捨てる");
    assert.equal(a.last("update_second_round_state").view, "quiz", "正しい項目は残す");
    assert.equal(a.last("update_main_cover").kind, "none");
    const t = a.last("update_third_round_timer");
    assert.deepEqual([t.remainings[2], t.remainings[3], t.remainings[4], t.remainings[1]], [0, 900, 600, undefined]);
    const q = a.last("update_question_display");
    assert.deepEqual([q.round, q.serial, q.shown, q.cursors], [null, null, false, { secondRound: 5 }]);
    assert.deepEqual(q.lastEvents, { secondRound: { kind: "scored", scope: "g1" } });
    assert.equal(server.crashed, null);
    a.close();
    await stopServer(server);
});
