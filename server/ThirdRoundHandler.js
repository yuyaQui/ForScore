// 3rd Round「Number 10」のサーバ側処理
//
// このファイルが持つのは「進行状態」だけ。結果は DB（app/api 側）が持つ。
// サーバを再起動すると進行状態は初期値に戻るが、Admin から選び直せばよい。
// 2nd Round と同じ割り切り。

// 進行状態
//
//   phase     … 大きな区切り
//                 "courseSelect" … 20名の所属コースを決める
//                 "quiz"         … 4コースを順に実施する
//   step      … エントリーの進み具合（phase === "courseSelect" のときのみ意味を持つ）
//                 "entry"  … エントリータイム中（BGMで計測）。まだ締め切っていない
//                 "closed" … 締切済み。Admin のチェック欄が開く
//   quizOrder … クイズ実施フェーズで何番目のコースか 1〜4
//               （phase === "quiz" のときのみ意味を持つ）
//
// "抽選中" という step は持たない。抽選した瞬間に新しいコースが配信されるので、
// Main はそれを受けてルーレットを回し、止まったらそのままエントリー表示に移ればよい。
//
// あえて持たないもの:
//   - 抽選結果（実施順）      → DB の ThirdRoundCourse.playOrder
//   - 出場者が誰か            → DB の Player.thirdRoundCourseName
//   - 何回目の抽選か          → playOrder が入っている数から導出できる
//   - 出場者が確定済みか      → そのコースの割当が5名いるかで導出できる
//   - 現在のコース名          → playOrder が最大の行（コース選択中）
//   - エントリータイマー      → 専用BGMで計測するため作らない
let thirdRoundState = {
    phase: "courseSelect",
    step: "entry",
    quizOrder: 1
};

module.exports = function ThirdRoundHandler(io, socket) {
    // 進行状態の切り替え。
    // 部分更新できるよう、受け取った内容を既存の状態にマージする。
    socket.on('change_3rd_round_state', (newState) => {
        thirdRoundState = { ...thirdRoundState, ...newState };
        console.log('3rd Round State:', thirdRoundState);
        io.emit('update_third_round_state', thirdRoundState);
    });

    // 抽選結果の中継。
    // 抽選そのものは app/api/thirdRound/draw が実行済みで、
    // ここは受け取った結果を全員に配るだけ。乱数はここでは引かない。
    socket.on('broadcast_third_round_courses', (payload) => {
        io.emit('update_third_round_courses', payload);
    });

    // 接続直後、この1人にだけ現在の状態を渡す（io.emit ではなく socket.emit）
    socket.emit('update_third_round_state', thirdRoundState);
};
