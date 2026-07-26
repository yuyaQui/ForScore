let currentMode = "waiting";
let secondRoundState = {
    group: 1,
    view: "turnOver"
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