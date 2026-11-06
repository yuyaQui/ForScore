// Main の表示の準備（必要なデータがそろっているか）を Admin に知らせる（2026-11-06 ユーザー承認）。
//
// このファイルが持つのは、接続中の Main からの最新の報告と、「任意のデータなしで進める」の許可だけ。
// DB は読みも書きもしない。保存もしない（サーバを再起動したら、Main が報告し直し、許可は取り直す）。
// 原因と対処の決め方は lib/mainReadiness.js の evaluate()。
//
// 受け付けるもの
//   main_ready_report { mode, items }   … Main から（変わったときと、3秒ごと）
//   main_retry_now                     … Admin の［再取得］。全 Main に「すぐ取り直す」を配る
//   main_reload                        … Admin の［Main を再読み込み］。全 Main にページの読み直しを配る
//   main_waive { key }                 … Admin の［○○なしで進める］。いまのモードの間だけ有効
//   request_main_readiness_sync        … 取り直し
// 配るもの
//   update_main_readiness { level, block, problems, mains, waivers }
const R = require("../lib/mainReadiness.js");

const reports = new Map();   // socket.id → { id, mode, items, receivedAt }
let waivers = { mode: null, keys: [] };
let modeChangedAt = Date.now();
let ioRef = null;
let ticker = null;

function serverMode() {
    // ModeHandler がこのファイルを読むので、ここでは使うときに読む（読み込みの循環を避ける）
    return require("./ModeHandler").getCurrentMode();
}

function payload() {
    return R.evaluate({ mains: [...reports.values()], serverMode: serverMode(), modeChangedAt, waivers, now: Date.now() });
}

function broadcast() {
    if (ioRef) ioRef.emit("update_main_readiness", payload());
}

/** モードが変わったとき（ModeHandler から）。許可はそのモードの間だけなので消す */
function onModeChange(io, mode) {
    ioRef = io;
    modeChangedAt = Date.now();
    if (waivers.mode !== mode) waivers = { mode: null, keys: [] };
    broadcast();
}

/** 報告の形を確かめて、決まった項目だけ残す */
function cleanReport(r) {
    if (!r || typeof r !== "object" || typeof r.mode !== "string" || !Array.isArray(r.items)) return null;
    const items = r.items.slice(0, 20)
        .filter(it => it && typeof it.key === "string" && ["loading", "error", "ok"].includes(it.status))
        .map(it => ({
            key: it.key.slice(0, 40),
            required: it.required !== false,
            status: it.status,
            error: typeof it.error === "string" ? it.error.slice(0, 120) : null,
            attempts: Number.isInteger(it.attempts) ? it.attempts : 0,
            waitMs: typeof it.waitMs === "number" && it.waitMs >= 0 ? it.waitMs : 0,
        }));
    return { mode: r.mode.slice(0, 40), items, hidden: r.hidden === true };
}

module.exports = function MainReadyHandler(io, socket) {
    ioRef = io;
    // 応答なしの判定と、待ち時間の表示を進めるために、2秒ごとに配り直す（Main がいるときだけ）
    if (!ticker) {
        ticker = setInterval(() => { if (reports.size > 0) broadcast(); }, 2000);
        if (ticker.unref) ticker.unref();
    }

    socket.on("main_ready_report", (r) => {
        const clean = cleanReport(r);
        if (!clean) return;
        const now = Date.now();
        const prev = reports.get(socket.id);
        // 同じモードを報告し続けている時刻（開いた直後・切り替えた直後のずれを「問題」にしないため）
        const modeSeenSince = prev && prev.mode === clean.mode ? prev.modeSeenSince : now;
        reports.set(socket.id, { id: socket.id, ...clean, receivedAt: now, modeSeenSince });
        broadcast();
    });

    socket.on("main_retry_now", () => io.emit("main_retry_now"));
    socket.on("main_reload", () => io.emit("main_reload"));

    socket.on("main_waive", (req) => {
        const key = req && typeof req === "object" ? req.key : undefined;
        if (!R.MAIN_OPTIONAL_KEYS.includes(key)) return;   // 必須のデータは許可できない
        const mode = serverMode();
        const keys = waivers.mode === mode ? waivers.keys : [];
        if (!keys.includes(key)) waivers = { mode, keys: [...keys, key] };
        console.log("Main: 任意のデータなしで進める許可:", mode, key);
        broadcast();
    });

    socket.on("request_main_readiness_sync", () => {
        socket.emit("update_main_readiness", payload());
    });

    socket.on("disconnect", () => {
        if (reports.delete(socket.id)) broadcast();
    });

    socket.emit("update_main_readiness", payload());
};

module.exports.onModeChange = onModeChange;
/** テスト用: 状態を初めに戻す */
module.exports._reset = () => { reports.clear(); waivers = { mode: null, keys: [] }; modeChangedAt = Date.now(); };
