const { isResetTarget, fromOf } = require("./roundOrder");

let currentMode = "waiting";
// turnOverFinalRevealed: 4組目の最終ステップ(7〜12位)だけ、48位を他の5人より
// 後に単独発表するためのフラグ(lib/types.ts の SecondRoundState と同じ初期値を
// 持たせる。2026-09-27、ユーザー指示)。
const INITIAL_SECOND_ROUND_STATE = {
    group: 1,
    view: "turnOver",
    turnOverStep: 0,
    turnOverPhase: "collapsed",
    turnOverFinalRevealed: false
};
let secondRoundState = { ...INITIAL_SECOND_ROUND_STATE };
// 3rd Round の進行状態は server/ThirdRoundHandler.js が持つ

module.exports = function ModeHandler(io, socket) {
    socket.on('change_mode', (newMode) => {
        console.log('Mode changed to:', newMode);
        currentMode = newMode;
        io.emit('mode_update', currentMode);
    })

    socket.on('change_2nd_round_state', (newState) => {
        console.log('2nd Round State changed to:', newState);
        secondRoundState = { ...secondRoundState, ...newState };
        io.emit('update_second_round_state', secondRoundState);
    });

    // 進行状態のリセット（2026-10-22）。2nd Round は選手 CSV の取り込み（from: "all"）のときだけ
    // 1組目・ターンオーバーに戻す（組のリセットは from: "thirdRound" なので 2nd Round の進行は変えない）
    socket.on('reset_round_progress', (payload) => {
        const from = fromOf(payload);
        if (!from || !isResetTarget(from, "secondRound")) return;
        secondRoundState = { ...INITIAL_SECOND_ROUND_STATE };
        io.emit('update_second_round_state', secondRoundState);
    });

    // 大会の状態（DB の TournamentState。Extra Round の「敗者復活者なし」など）が変わった合図の中継（2026-10-22）。
    // 中身は送らない。各 Admin が /api/tournamentState を読み直す
    socket.on('tournament_state_changed', () => {
        io.emit('update_tournament_state');
    });

    socket.emit('mode_update', currentMode);
    socket.emit('update_second_round_state', secondRoundState);
}