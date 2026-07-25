let currentMode = "waiting";
let secondRoundState = {
    group: 1,
    view: "turnOver"
};
let thirdRoundState = {
    stage: "courseSelect"
};

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

    socket.on('change_3rd_round_state', (newState) => {
        console.log('3rd Round State changed to:', newState);
        thirdRoundState = { ...thirdRoundState, ...newState };
        io.emit('update_third_round_state', thirdRoundState);
    });

    socket.emit('mode_update', currentMode);
    socket.emit('update_second_round_state', secondRoundState);
    socket.emit('update_third_round_state', thirdRoundState);
}