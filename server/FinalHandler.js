// 決勝「トリプルセブン」のサーバ側処理
//
// このファイルが持つのは「進行状態」だけ。結果は DB（app/api 側）が持つ。
// サーバを再起動すると進行状態は初期値に戻るが、Admin から選び直せばよい。
// 準決勝・3rd Round と同じ割り切り。
//
// 決勝はタイマーを持たない（設計メモ 決定事項4）。3rd Round / 準決勝の
// remainings・runningOrder に相当するものはない。
//
// 進行状態（型と意味は lib/types.ts の FinalState）:
//   set         … 現在のセット番号。上限は設けない（3勝先取で終わるため）
//   view        … Main の表示 "standby"（待機）| "intro"（選手紹介）| "quiz" | "result"（最終成績）
//   introIndex  … 選手紹介で表示中の選手（準決勝の勝ち抜け順の何番目か。0〜2）
//   resultRank  … 最終成績を表示中の順位（1〜3）。表示していなければ 0
//
// 2026-10-17: 決勝は待機画面から始まり、選手紹介（3名）→ クイズ → 最終成績の表示、の順に進む。
//
// あえて持たないもの:
//   - 出場者が誰か        → DB の Player（semifinalRank > 0 から導出。準決勝の3名）
//   - セットが決着したか  → lib/finalScoring.ts の isSetOver が選手データから都度判定する
let finalState = {
    set: 1,
    view: "standby",
    introIndex: 0,
    resultRank: 0
};

const VIEWS = ["standby", "intro", "quiz", "result"];
const FINALIST_COUNT = 3;
const SET_MAX = 99;

function own(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}
function isInt(v, min, max) {
    return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/**
 * Admin から届いた部分更新を検証して、次の状態を返す。不正な項目は無視する。
 * view: "result" は表示する順位（resultRank 1〜3）が決まっているときだけ受け付ける。
 * result 以外に切り替えたら resultRank は 0 に戻す。
 */
function applyUpdate(prev, update) {
    if (!update || typeof update !== "object") return prev;
    const next = { ...prev };
    if (own(update, "set") && isInt(update.set, 1, SET_MAX)) next.set = update.set;
    if (own(update, "introIndex") && isInt(update.introIndex, 0, FINALIST_COUNT - 1)) next.introIndex = update.introIndex;
    if (own(update, "resultRank") && isInt(update.resultRank, 0, FINALIST_COUNT)) next.resultRank = update.resultRank;
    if (own(update, "view") && VIEWS.includes(update.view)) {
        if (update.view !== "result" || next.resultRank > 0) next.view = update.view;
    }
    if (next.view !== "result") next.resultRank = 0;
    return next;
}

module.exports = function FinalHandler(io, socket) {
    // 進行状態の切り替え（部分更新。applyUpdate で検証する）
    socket.on('change_final_state', (newState) => {
        finalState = applyUpdate(finalState, newState);
        console.log('Final State:', finalState);
        io.emit('update_final_state', finalState);
    });

    // 画面（Main / Admin の決勝）を開いたときに現在の状態を取り直すための要求（2026-10-15 追加）。
    // 接続直後の配信は、決勝の画面がまだ無い（別のラウンドを表示中）と受け取れずに失われるため。
    // 読み取りだけで、状態は変えない（3rd Round の request_third_round_sync と同じ）
    socket.on('request_final_sync', () => {
        socket.emit('update_final_state', finalState);
    });

    // 接続直後、この1人にだけ現在の状態を渡す（io.emit ではなく socket.emit）
    socket.emit('update_final_state', finalState);
};
