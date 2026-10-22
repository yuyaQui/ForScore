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
//   cursors … ラウンドごとの「次に読む問題」の通し番号（Admin が開始番号を決める）
//
// 他の進行状態と同じく、サーバを再起動すると初期値に戻る（Admin で番号を合わせ直す）。
let questionDisplay = {
    round: null,
    serial: null,
    shown: false,
    seq: 0,
    cursors: {}
};

const ROUNDS = ["secondRound", "thirdRound", "extraSecondStep", "final"];
const SERIAL_MAX = 100000;

function isSerial(v) {
    return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= SERIAL_MAX;
}

module.exports = function QuestionHandler(io, socket) {
    const broadcast = () => io.emit("update_question_display", questionDisplay);

    // ラウンドの「次に読む問題」を設定・修正する（開始番号の入力、◀ 前の問題 / 次の問題 ▶）
    socket.on("set_question_cursor", (payload) => {
        if (!payload || !ROUNDS.includes(payload.round) || !isSerial(payload.serial)) return;
        questionDisplay = { ...questionDisplay, cursors: { ...questionDisplay.cursors, [payload.round]: payload.serial } };
        broadcast();
    });

    // 1問が終わった（採点の API が成功した後に Admin が送る）。
    // serial がそのラウンドの「次に読む問題」と一致するときだけ受け付ける
    // （古い画面・二重送信で2問進んだり、違う問題を出したりしないように）。
    // 受け付けたら、その問題を表示中にして（自動表示。2026-10-22 ユーザー決定）、次に読む番号を1つ進める
    socket.on("finish_question", (payload) => {
        if (!payload || !ROUNDS.includes(payload.round) || !isSerial(payload.serial)) return;
        if (questionDisplay.cursors[payload.round] !== payload.serial) return;
        questionDisplay = {
            round: payload.round,
            serial: payload.serial,
            shown: true,
            seq: questionDisplay.seq + 1,
            cursors: { ...questionDisplay.cursors, [payload.round]: payload.serial + 1 }
        };
        broadcast();
    });

    // 表示する／隠す（手動）
    socket.on("change_question_display", (payload) => {
        if (!payload || typeof payload.shown !== "boolean") return;
        if (payload.shown && questionDisplay.serial === null) return;   // 出す問題が無い
        questionDisplay = { ...questionDisplay, shown: payload.shown };
        broadcast();
    });

    // 画面を開いたときに現在の状態を取り直す（読み取りだけ。他のラウンドの request_*_sync と同じ）
    socket.on("request_question_sync", () => {
        socket.emit("update_question_display", questionDisplay);
    });

    // 接続直後、この1人にだけ現在の状態を渡す
    socket.emit("update_question_display", questionDisplay);
};
