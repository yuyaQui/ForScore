// Main を覆う表示（待機画面・ブランク）のサーバ側処理（2026-11-04 ユーザー承認。同日、遷移表に作り直し）
//
// このファイルが持つのは「いま Main を覆っているか・何で覆っているか」だけ。DB は読みも書きもしない。
// 遷移の決まり（何から何へ変えてよいか・版の照合・割り込み）は lib/coverFlow.js の純関数が持ち、ここは
// Socket.IO と保存への橋渡しだけをする。
//
// 配信する覆い（update_main_cover）: { kind, at, title, sub, startLabel, rev }
//   rev … 覆いが変わるたびに1つ増える版番号。Admin は操作に「自分が見ていた rev」を添える。
//         サーバの rev と違えば受け付けない（連打・古い画面・2つ目の Admin の操作を通さない）。
//
// 受け付ける要求（change_main_cover）: { cover, expectRev } または { force: true, expectRev }
//   断った場合は、その1人にだけ main_cover_rejected { reason } と最新の覆いを返す。
//
// ラウンドを切り替えたとき（ModeHandler が onModeChange を呼ぶ）は、そのラウンドの待機画面を自動で出す。
// 覆いの決め方はこの2つ（Admin の要求・モードの切り替え）だけで、どちらもこのファイルを通る。
const F = require("../lib/coverFlow.js");
const store = require("./stateStore");
const { MAIN_COVER_ON_MODE } = require("../constants.js");

let flow = F.initialState();

store.register(
    "mainCover",
    () => flow,
    (saved) => { flow = F.restoreState(saved); }
);

/** 配信する形 */
function payload() {
    return { ...flow.cover, rev: flow.rev };
}

/**
 * ラウンドを切り替えたときの覆いを決めて、全員に配る。
 * options.resume … すでに進行中のラウンドへ戻るとき。「NEXT ○○」ではなく、ブランクから「この画面を表示する」で出す
 */
function onModeChange(io, mode, options = {}) {
    const auto = MAIN_COVER_ON_MODE[mode];
    let target = null;
    if (auto && options.resume) {
        target = { kind: "blank", at: "start", title: null, sub: null, startLabel: "この画面を表示する" };
    } else if (auto) {
        target = { kind: "standby", at: "start", title: auto.title, sub: null, startLabel: auto.startLabel };
    }
    flow = F.applyAuto(flow, target);
    io.emit("update_main_cover", payload());
}

module.exports = function MainCoverHandler(io, socket) {
    socket.on("change_main_cover", (req) => {
        const before = flow;
        const r = F.applyRequest(flow, req);
        flow = r.state;
        if (!r.ok) {
            console.log("Main cover rejected:", r.reason);
            socket.emit("main_cover_rejected", { reason: r.reason });
            socket.emit("update_main_cover", payload());
            return;
        }
        if (flow !== before) io.emit("update_main_cover", payload());
    });

    socket.on("request_main_cover_sync", () => {
        socket.emit("update_main_cover", payload());
    });

    socket.emit("update_main_cover", payload());
};

module.exports.onModeChange = onModeChange;
