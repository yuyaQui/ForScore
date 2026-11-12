// 問題表示のサーバ側処理（2026-10-22 追加。docs/question-display-design.md 3.3）
//
// 早押しの1問が終わる（正解・誤答・スルー）たびに、Admin が finish_question を送る。
// サーバは「その問題を表示中にして、次に読む番号を1つ進める」だけを行い、全員に配信する。
// 問題文・解答そのものは持たない（Main が通し番号で GET /api/questions から取得する）。
//
// 状態（型と意味は lib/types.ts の QuestionDisplayState）:
//   round   … 表示中の問題のラウンド（null = まだ何も出していない）
//   serial  … 表示中の問題の通し番号
//   shown   … Main に出しているか（Admin の「隠す」で false）
//   seq     … 表示する問題が変わった回数。Main はこれが増えた瞬間だけ演出する
//   cursor  … 「次に読む問題」の通し番号。大会全体で1つ（2026-11-12 ユーザー決定。以前はラウンドごと）。
//             2nd Round の各組・3rd Round の各コース・Extra Second Step・Semi-Final（セットの振り返りとサドンデス）・
//             Final で共有し、どの場面で1問終わっても同じ番号が進む。Admin の番号の入力・◀▶ はこの1つを直す
//   配信では、これまでの画面がそのまま使えるよう cursors（ラウンドごと）にも同じ番号を入れる
//
// 進行状態は stateStore に保存し、再起動の後も戻る（2026-11-04）。
let questionDisplay = {
    round: null,
    serial: null,
    shown: false,
    seq: 0,
    cursor: null
};

const { isResetTarget, fromOf } = require("./roundOrder");
const { nextSerial } = require("../lib/questionWrap.js");

// semifinal はサドンデスだけで使う（2026-10-30 追加）
const ROUNDS = ["secondRound", "thirdRound", "extraSecondStep", "semifinal", "final"];
// 問題表示のラウンド → 大会のラウンド（reset_round_progress の対象判定に使う）
const ROUND_OF = { secondRound: "secondRound", thirdRound: "thirdRound", extraSecondStep: "extraRound", semifinal: "semifinal", final: "final" };
const SERIAL_MAX = 100000;

function isSerial(v) {
    return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= SERIAL_MAX;
}

// ---- 操作の記録（2026-10-29 追加。Undo で問題も戻すため。docs/question-display-design.md 8章） ----
// ラウンドごとに、得点や問題を動かした操作を新しい順に積む。Admin の Undo は記録の最後を見て、
//   scored（採点。得点の Undo 履歴あり・問題あり）… 得点の Undo が成功したら問題も1つ戻す
//   through（スルー。得点なし・問題あり）       … 問題だけ戻す
//   other（問題と関係しない得点の操作）           … 得点だけ戻す（記録を1つ消すだけ）
// を決める。scope は「どの組・コースの操作か」で、Undo 側の組・コースと一致したときだけ戻す。
// 他の進行状態と同じくメモリだけに持ち、再起動で消える（そのときの Undo は得点だけ戻る＝従来どおり）。
const LOG_MAX = 200;
const SCOPE_MAX = 64;
const KINDS = ["scored", "through", "other"];
let logs = {};

function scopeOf(payload) {
    const s = payload && typeof payload.scope === "string" ? payload.scope : "";
    return s.slice(0, SCOPE_MAX);
}

function pushLog(round, entry) {
    const list = logs[round] ? logs[round].slice() : [];
    list.push(entry);
    if (list.length > LOG_MAX) list.shift();
    logs = { ...logs, [round]: list };
}

/** 配信用: ラウンドごとの記録の最後（種類と scope だけ） */
function lastEventsOf() {
    const out = {};
    for (const [round, list] of Object.entries(logs)) {
        if (list.length > 0) out[round] = { kind: list[list.length - 1].kind, scope: list[list.length - 1].scope };
    }
    return out;
}

// 進行状態の保存と復元（2026-11-04）。Undo の記録（logs）も戻すので、再起動の後も Undo で問題が一緒に戻る
const store = require("./stateStore");
store.register(
    "question",
    () => ({ questionDisplay, logs }),
    (saved) => {
        if (!saved || typeof saved !== "object") return;
        const q = saved.questionDisplay;
        if (q && typeof q === "object") {
            // 2026-11-12 より前の保存（ラウンドごとの cursors）は、一番先に進んでいる番号を引き継ぐ
            let cursor = isSerial(q.cursor) ? q.cursor : null;
            if (cursor === null && q.cursors && typeof q.cursors === "object") {
                for (const [round, serial] of Object.entries(q.cursors)) {
                    if (ROUNDS.includes(round) && isSerial(serial) && (cursor === null || serial > cursor)) cursor = serial;
                }
            }
            const roundOk = q.round === null || ROUNDS.includes(q.round);
            const serialOk = q.serial === null || isSerial(q.serial);
            questionDisplay = {
                round: roundOk ? q.round : null,
                serial: roundOk && serialOk ? q.serial : null,
                shown: q.shown === true && roundOk && serialOk && q.serial !== null,
                seq: Number.isInteger(q.seq) && q.seq >= 0 ? q.seq : 0,
                cursor,
            };
        }
        const restored = {};
        for (const [round, list] of Object.entries(saved.logs && typeof saved.logs === "object" ? saved.logs : {})) {
            if (!ROUNDS.includes(round) || !Array.isArray(list)) continue;
            restored[round] = list
                .filter(e => e && typeof e === "object" && KINDS.includes(e.kind) && typeof e.scope === "string")
                .slice(-LOG_MAX)
                .map(e => ({ ...e, scope: e.scope.slice(0, SCOPE_MAX) }));
        }
        logs = restored;
    }
);

/** 配信用: ラウンドごとの「次に読む問題」（全ラウンド同じ番号。未設定なら空） */
function cursorsOf() {
    const out = {};
    if (questionDisplay.cursor !== null) for (const round of ROUNDS) out[round] = questionDisplay.cursor;
    return out;
}

module.exports = function QuestionHandler(io, socket) {
    const snapshot = () => ({ ...questionDisplay, cursors: cursorsOf(), lastEvents: lastEventsOf() });
    const broadcast = () => io.emit("update_question_display", snapshot());

    // 「次に読む問題」を設定・修正する（開始番号の入力、◀ 前の問題 / 次の問題 ▶、Semi-Final の振り返りの確定）。
    // round はどの画面からの操作か（番号は大会全体で1つ。2026-11-12）
    socket.on("set_question_cursor", (payload) => {
        if (!payload || !ROUNDS.includes(payload.round) || !isSerial(payload.serial)) return;
        questionDisplay = { ...questionDisplay, cursor: payload.serial };
        // 番号を手で動かしたら、問題の記録は Undo と合わなくなるので消す（2026-10-29。番号の共有に合わせて全ラウンド）
        logs = {};
        broadcast();
    });

    // 1問が終わった（採点の API が成功した後に Admin が送る）。
    // serial がそのラウンドの「次に読む問題」と一致するときだけ受け付ける
    // （古い画面・二重送信で2問進んだり、違う問題を出したりしないように）。
    // 受け付けたら、その問題を表示中にして（自動表示。2026-10-22 ユーザー決定）、次に読む番号を1つ進める
    // 2026-10-29: payload に scope（組・コース）と scored（得点の Undo 履歴を積んだか。省略時 true）を足した。
    // 受け付けた問題は記録に積む。問題を受け付けなかった（開始番号が未設定など）が得点は動いたときは、
    // 得点の Undo と手数をそろえるため other を積む
    // 2026-11-11: payload.bounds（取り込んだ問題の最初と上限の通し番号）があれば、上限の問題が終わったら
    // 次に読む問題を最初に戻す（lib/questionWrap.js）。無ければ従来どおり 1 進める
    socket.on("finish_question", (payload) => {
        if (!payload || !ROUNDS.includes(payload.round)) return;
        const scope = scopeOf(payload);
        const scored = payload.scored !== false;
        if (!isSerial(payload.serial) || questionDisplay.cursor !== payload.serial) {
            if (scored) { pushLog(payload.round, { kind: "other", scope }); broadcast(); }
            return;
        }
        const next = nextSerial(payload.serial, payload.bounds);
        pushLog(payload.round, {
            kind: scored ? "scored" : "through", scope, serial: payload.serial, next,
            prev: { round: questionDisplay.round, serial: questionDisplay.serial, shown: questionDisplay.shown }
        });
        questionDisplay = {
            round: payload.round,
            serial: payload.serial,
            shown: true,
            seq: questionDisplay.seq + 1,
            cursor: next
        };
        broadcast();
    });

    // 問題と関係しない得点の操作（3rd Round のコース終了、Final の次のセットへ など）を記録する（2026-10-29）
    socket.on("record_question_event", (payload) => {
        if (!payload || !ROUNDS.includes(payload.round)) return;
        pushLog(payload.round, { kind: "other", scope: scopeOf(payload) });
        broadcast();
    });

    // Undo に合わせて記録を1つ戻す（2026-10-29）。記録の最後と kind・scope が一致するときだけ受け付ける
    // （Admin を複数開いていても二重に戻らない）。scored・through は「次に読む問題」をその問題に戻し、
    // Main は1つ前に表示していた問題（無ければ空）に戻す
    socket.on("undo_question_event", (payload) => {
        if (!payload || !ROUNDS.includes(payload.round) || !KINDS.includes(payload.kind)) return;
        const list = logs[payload.round] || [];
        const last = list[list.length - 1];
        if (!last || last.kind !== payload.kind || last.scope !== scopeOf(payload)) return;
        logs = { ...logs, [payload.round]: list.slice(0, -1) };
        // 番号は大会全体で1つなので、その問題の後にほかの場面で番号が進んでいたら戻さない（得点だけ戻る）。
        // next が無い記録（2026-11-12 より前）は従来どおり戻す
        const untouched = last.next === undefined || questionDisplay.cursor === last.next;
        if (last.kind !== "other" && untouched) {
            questionDisplay = {
                round: last.prev.round,
                serial: last.prev.serial,
                shown: last.prev.shown,
                seq: questionDisplay.seq + 1,
                cursor: last.serial
            };
        }
        broadcast();
    });

    // 表示する／隠す（手動）
    socket.on("change_question_display", (payload) => {
        if (!payload || typeof payload.shown !== "boolean") return;
        if (payload.shown && questionDisplay.serial === null) return;   // 出す問題が無い
        questionDisplay = { ...questionDisplay, shown: payload.shown };
        broadcast();
    });

    // 進行状態のリセット（2026-10-22）。表示中の問題がそのラウンドのものなら消す。
    // 「次に読む問題」は大会全体で1つなので、リセットしても変えない（やり直すときは Admin で手で直す。2026-11-12 ユーザー決定）
    socket.on("reset_round_progress", (payload) => {
        const from = fromOf(payload);
        if (!from) return;
        const clearShown = questionDisplay.round !== null && isResetTarget(from, ROUND_OF[questionDisplay.round]);
        // そのラウンド以降の操作の記録も消す（2026-10-29）
        const keptLogs = {};
        for (const [round, list] of Object.entries(logs)) {
            if (!isResetTarget(from, ROUND_OF[round])) keptLogs[round] = list;
        }
        logs = keptLogs;
        if (clearShown) questionDisplay = { ...questionDisplay, round: null, serial: null, shown: false };
        broadcast();
    });

    // 画面を開いたときに現在の状態を取り直す（読み取りだけ。他のラウンドの request_*_sync と同じ）
    socket.on("request_question_sync", () => {
        socket.emit("update_question_display", snapshot());
    });

    // 接続直後、この1人にだけ現在の状態を渡す
    socket.emit("update_question_display", snapshot());
};
