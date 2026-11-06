const { DEFAULT_COUNTDOWN } = require("../constants.js");

let countdown = DEFAULT_COUNTDOWN;
let timerInterval = null;

// 残り時間の保存と復元（2026-11-04）。止まった状態で戻す
const store = require("./stateStore");
store.register(
    "firstRound",
    () => ({ countdown }),
    (saved) => {
        const v = saved && typeof saved === "object" ? saved.countdown : undefined;
        if (typeof v === "number" && Number.isFinite(v)) countdown = Math.min(Math.max(Math.floor(v), 0), DEFAULT_COUNTDOWN);
    }
);

module.exports = function firstRoundHandlers(io, socket) {
    socket.emit('1R_update_timer', countdown);

    // 画面を開いたとき・つなぎ直したときに残り時間を取り直す（読み取りだけ。他のラウンドの request_*_sync と同じ。2026-11-05 追加）。
    // 接続した瞬間の送信は、画面がまだ受信の準備をしていないと失われる（再読み込み後に残り時間が 20:00 に見えていた）
    socket.on('request_first_round_sync', () => {
        socket.emit('1R_update_timer', countdown);
    });

    socket.on('1R_start_timer', () => {
        if (!timerInterval) { // 稼働しているタイマーがなかったら中に入る
            timerInterval = setInterval(() => {
                if (countdown > 0) {
                    countdown--;
                    io.emit('1R_update_timer', countdown); // 全員に新しい秒数を送信
                } else {
                    clearInterval(timerInterval); // 0秒になったらタイマーを止める
                    timerInterval = null;
                    io.emit('1R_finish_timer'); // 終了したことを全員に通知
                }
            }, 1000);
        }
    });

    socket.on('1R_stop_timer', () => {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
    })

    socket.on('1R_reset_timer', () => {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        countdown = DEFAULT_COUNTDOWN;
        io.emit('1R_update_timer', countdown);
        io.emit('1R_reset_timer'); // 終了状態もリセットするために通知
    });

    socket.on('1R_edit_timer', (newTime) => {
        countdown = newTime;
        io.emit('1R_update_timer', countdown);
        if (countdown > 0) {
            io.emit('1R_reset_timer');
        }
    });
};