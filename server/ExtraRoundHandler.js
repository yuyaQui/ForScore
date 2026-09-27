// Extra Round（敗者復活）のサーバ側処理
//
// このファイルが持つのは「進行状態」だけ。結果は DB（app/api 側）が持つ。
// サーバを再起動すると進行状態は初期値に戻るが、Admin から選び直せばよい。
// 2nd / 3rd Round と同じ割り切り。

// 進行状態
//
//   step           … 大きな区切り
//                      "firstStep"  … 筆記クイズ。問題と解答の表示だけを行う
//                      "secondStep" … 通過者最大12名による早押し
//   questionNumber … 現在の問題番号 1〜20。Admin が手動で前後させる
//   answerRevealed … 現在の問題の解答を表示しているか
//   mode           … "asking"（出題のみの周。解答表示ボタンを出さない）
//                      | "revealing"（解答表示ができる周）
//
// First Step は「1〜10問を出題だけ進める1周目」→「1〜10問をもう一度、解答表示
// ありで進める2周目」という流れになる。この2周構成をシステムは管理しない。
// Admin が mode を revealing に切り替える操作で2周目を始める。
//
// あえて持たないもの:
//   - フェーズ（フェーズ1 / フェーズ2 / サバイバル）
//       questionNumber から導出できる。1〜10 / 11〜15 / 16〜20
//   - 残り人数
//       First Step の採点はシステム外で行うため、システムは誰が残っているかを
//       知らない。会場では起立・着席で見えている
//   - Second Step の出場者
//       DB の Player.extraRoundSecondStep が持つ。スタッフが入力した事実であり、
//       進行中に消えると復元できないため
let extraRoundState = {
    step: "firstStep",
    questionNumber: 1,
    answerRevealed: false,
    mode: "asking"
};

module.exports = function ExtraRoundHandler(io, socket) {
    // 進行状態の切り替え。
    // 部分更新できるよう、受け取った内容を既存の状態にマージする。
    socket.on('change_extra_round_state', (newState) => {
        extraRoundState = { ...extraRoundState, ...newState };
        console.log('Extra Round State:', extraRoundState);
        io.emit('update_extra_round_state', extraRoundState);
    });

    // 接続直後、この1人にだけ現在の状態を渡す（io.emit ではなく socket.emit）
    socket.emit('update_extra_round_state', extraRoundState);
};
