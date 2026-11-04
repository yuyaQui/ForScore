// Main を覆う表示（待機画面・ブランク）のサーバ側処理（2026-11-04 ユーザー承認）
//
// このファイルが持つのは「いま Main を覆っているか・何で覆っているか」だけ（メモリ）。DB は読みも書きもしない。
// サーバを再起動すると「覆わない」に戻る（各ラウンドの進行状態と同じ扱い）。
//
// 状態（型と意味は lib/mainCover.ts の MainCover）:
//   kind      … "none" | "blank" | "standby"
//   at        … "start" | "end" | "manual"
//   title     … 待機画面の NEXT のあとに出すラウンド名（例 "2nd Round"）。manual のときは null
//   sub       … ラウンド名の下に出す組・コース・Step（例 "Set 2" "Freeze 10" "Second Step"）。無ければ null
//   startLabel… ブランクから次の画面を出すボタンの名前（例 "ターンオーバーを始める"）。無ければ null
//
// ラウンドを切り替えたとき（change_mode）は、そのラウンドの待機画面を自動で出す（MAIN_COVER_ON_MODE）。
const { MAIN_COVER_KINDS, MAIN_COVER_ATS, MAIN_COVER_ON_MODE } = require("../constants.js");

const NONE = { kind: "none", at: null, title: null, sub: null, startLabel: null };
let cover = { ...NONE };
// 直前のモード。同じモードを選び直しただけでは待機画面を出さない
let lastMode = "waiting";

const TEXT_MAX = 40;
function text(v) {
    return typeof v === "string" && v.trim() !== "" && v.length <= TEXT_MAX ? v : null;
}

/** Admin から届いた覆いを検証して、次の状態を返す。決まった値以外なら今のまま */
function normalize(prev, next) {
    if (!next || typeof next !== "object" || !MAIN_COVER_KINDS.includes(next.kind)) return prev;
    if (next.kind === "none") return { ...NONE };
    const at = MAIN_COVER_ATS.includes(next.at) ? next.at : "start";
    return {
        kind: next.kind,
        at,
        title: at === "manual" ? null : text(next.title),
        sub: at === "manual" ? null : text(next.sub),
        startLabel: text(next.startLabel),
    };
}

module.exports = function MainCoverHandler(io, socket) {
    socket.on("change_main_cover", (next) => {
        cover = normalize(cover, next);
        io.emit("update_main_cover", cover);
    });

    socket.on("request_main_cover_sync", () => {
        socket.emit("update_main_cover", cover);
    });

    // ラウンドを切り替えたら、そのラウンドの待機画面を出す（ModeHandler の change_mode と同じ合図を聞く）。
    // 対象外のモード（大会準備・1st Round・集計中・上位100名）では覆いを外す
    socket.on("change_mode", (mode) => {
        if (typeof mode !== "string" || mode === lastMode) return;
        lastMode = mode;
        const auto = MAIN_COVER_ON_MODE[mode];
        cover = auto
            ? { kind: "standby", at: "start", title: auto.title, sub: null, startLabel: auto.startLabel }
            : { ...NONE };
        io.emit("update_main_cover", cover);
    });

    socket.emit("update_main_cover", cover);
};
