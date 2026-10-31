// ペーパークイズ上位100名の発表のサーバ側処理（2026-10-31 追加。項目19）
//
// このファイルが持つのは「何画面目か・名前を出したか」だけ（メモリ）。DB は読みも書きもしない。
// 画面ごとの選手は、各画面（Main / Admin）が lib/paperTop.ts の getPaperTopPages で計算する。
// サーバを再起動すると1画面目に戻るが、Admin から選び直せばよい。
//
// 進行状態（型と意味は lib/types.ts の PaperTopState）:
//   page  … 何画面目か（0始まり。0〜PAPER_TOP_PAGE_MAX-1）
//   phase … "collapsed"（順位だけ）| "expanded"（名前まで公開）
const { PAPER_TOP_PAGE_MAX } = require("../constants.js");
const { fromOf } = require("./roundOrder");

const INITIAL_PAPER_TOP_STATE = { page: 0, phase: "collapsed" };
let paperTopState = { ...INITIAL_PAPER_TOP_STATE };

const PHASES = ["collapsed", "expanded"];

function own(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}
function isInt(v, min, max) {
    return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/** Admin から届いた部分更新を検証して、次の状態を返す。決まった値以外は無視する */
function applyUpdate(prev, update) {
    if (!update || typeof update !== "object") return prev;
    const next = { ...prev };
    if (own(update, "page") && isInt(update.page, 0, PAPER_TOP_PAGE_MAX - 1)) next.page = update.page;
    if (own(update, "phase") && PHASES.includes(update.phase)) next.phase = update.phase;
    return next;
}

module.exports = function PaperTopHandler(io, socket) {
    // 進行状態の切り替え（部分更新。applyUpdate で検証する）
    socket.on("change_paper_top_state", (newState) => {
        paperTopState = applyUpdate(paperTopState, newState);
        io.emit("update_paper_top_state", paperTopState);
    });

    // 画面を開いたときに現在の状態を取り直す（読み取りだけ。決勝の request_final_sync と同じ）
    socket.on("request_paper_top_sync", () => {
        socket.emit("update_paper_top_state", paperTopState);
    });

    // 選手 CSV の取り込み（from: "all"）で1画面目に戻す
    socket.on("reset_round_progress", (payload) => {
        if (fromOf(payload) !== "all") return;
        paperTopState = { ...INITIAL_PAPER_TOP_STATE };
        io.emit("update_paper_top_state", paperTopState);
    });

    socket.emit("update_paper_top_state", paperTopState);
};

module.exports.applyPaperTopUpdate = applyUpdate;
