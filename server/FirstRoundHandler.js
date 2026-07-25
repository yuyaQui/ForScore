const { count } = require("node:console");
const { DEFAULT_COUNTDOWN } = require("../constants.js");

let countdown = DEFAULT_COUNTDOWN;
let timerInterval = null;

module.exports = function firstRoundHandlers(io, socket) {
    socket.emit('1R_update_timer', countdown);

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