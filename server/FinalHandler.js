// 決勝「トリプルセブン」のサーバ側処理
//
// このファイルが持つのは「進行状態」だけ。結果は DB（app/api 側）が持つ。
// サーバを再起動すると進行状態は初期値に戻るが、Admin から選び直せばよい。
// 準決勝・3rd Round と同じ割り切り。
//
// 決勝はタイマーを持たない（設計メモ 決定事項4）。3rd Round / 準決勝の
// remainings・runningOrder に相当するものはないため、持つのは現在のセット番号だけ。
//
// あえて持たないもの:
//   - 出場者が誰か        → DB の Player（semifinalRank > 0 から導出。準決勝の3名）
//   - セットが決着したか  → lib/finalScoring.ts の isSetOver が選手データから都度判定する
let finalState = {
    set: 1 // 現在のセット番号。上限は設けない（3勝先取で終わるため）
};

module.exports = function FinalHandler(io, socket) {
    // 進行状態の切り替え。
    // 部分更新できるよう、受け取った内容を既存の状態にマージする。
    socket.on('change_final_state', (newState) => {
        finalState = { ...finalState, ...newState };
        console.log('Final State:', finalState);
        io.emit('update_final_state', finalState);
    });

    // 接続直後、この1人にだけ現在の状態を渡す（io.emit ではなく socket.emit）
    socket.emit('update_final_state', finalState);
};
