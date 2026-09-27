let currentMode = "waiting";
// turnOverFinalRevealed: 4組目の最終ステップ(7〜12位)だけ、48位を他の5人より
// 後に単独発表するためのフラグ(lib/types.ts の SecondRoundState と同じ初期値を
// 持たせる。2026-09-27、ユーザー指示)。
let secondRoundState = {
    group: 1,
    view: "turnOver",
    turnOverStep: 0,
    turnOverPhase: "collapsed",
    turnOverFinalRevealed: false
};
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

    socket.emit('mode_update', currentMode);
    socket.emit('update_second_round_state', secondRoundState);
}