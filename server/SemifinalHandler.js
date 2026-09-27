// 準決勝「3セット制タイムレース Nine Hundred」のサーバ側処理
//
// このファイルが持つのは「進行状態」だけ。結果は DB（app/api 側）が持つ。
// サーバを再起動すると進行状態は初期値に戻るが、Admin から選び直せばよい。
// 2nd / 3rd Round と同じ割り切り。

const { SEMIFINAL_SET_TIME_LIMIT } = require("../constants.js");

// 進行状態
//
//   set         … 現在のセット 1〜3
//   phase       … "quiz"（通常の採点） | "playoff"（境界の同点を早押しで決める）
//   view        … Main の表示切り替え。"quiz"（クイズ中、何も出さない）
//                  | "results"（セット終了後の点数発表、ポイントのみ表示）
//   finishedSet … セット終了処理（勝ち抜け/失格の確定）を走らせたセット番号。
//                 未実行なら null。「終了処理を走らせたか」は結果から復元できない
//                 （終了直後は set === 0 の選手が互いに同値になるが、セット開始直後も
//                 全員が同値なので区別がつかない）。3rd Round の finishedOrder と同じ理由。
//
// あえて持たないもの:
//   - 出場者が誰か      → DB の Player（thirdRoundRank 1〜8 / extraRoundRank === 1 から導出）
//   - 席番号            → 上と同じデータから都度導出する（lib/semifinal.ts、S-3で追加）
//   - プレーオフの対象者 → そのセットで semifinalRank === 0 の選手のうち、境界の同点者
let semifinalState = {
    set: 1,
    phase: "quiz",
    view: "quiz",
    finishedSet: null
};

// 5分タイマー（セットごとに1本ずつ、計3本ぶんの残り秒数を持つ）
//
// キーは set(1〜3)。未登録のセットは「まだ一度も動かしていない＝5分のまま」とみなす。
const remainings = {};

// いま走っているのはどのセットか。停止中は null。
// セットは1つずつ実施するルールなので、インターバルは常に1本しか持たない。
let runningSet = null;
let timerInterval = null;

/** そのセットの残り秒数。一度も動かしていなければ制限時間そのまま */
function remainingOf(set) {
    return remainings[set] ?? SEMIFINAL_SET_TIME_LIMIT;
}

/** 配信するタイマー状態 */
function timerPayload() {
    return { remainings, runningSet };
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    runningSet = null;
}

module.exports = function SemifinalHandler(io, socket) {
    // 進行状態の切り替え。
    // 部分更新できるよう、受け取った内容を既存の状態にマージする。
    socket.on('change_semifinal_state', (newState) => {
        const previous = semifinalState;
        semifinalState = { ...semifinalState, ...newState };
        console.log('Semifinal State:', semifinalState);
        io.emit('update_semifinal_state', semifinalState);

        // セットが変わった（またはクイズ実施フェーズから抜けた）ときは、
        // 走っている時計を止める。画面に出ていないセットの残り時間が減り続ける事故を防ぐ。
        // 再開はスタッフが明示的に「開始」を押す。
        const setChanged =
            previous.set !== semifinalState.set ||
            previous.phase !== semifinalState.phase;

        if (setChanged && runningSet !== null) {
            stopTimer();
            io.emit('update_semifinal_timer', timerPayload());
        }
    });

    // 5分タイマーの操作。
    // action で start / stop / reset / edit を区別する（3rd Round と同じ形）。
    //
    // どのセットへの操作かは引数で受け取らず、サーバが semifinalState.set から判断する。
    socket.on('change_semifinal_timer', (payload) => {
        const action = payload && payload.action;
        const set = semifinalState.set;

        if (action === 'start') {
            if (runningSet === set) return;          // 二重起動を防ぐ
            if (remainingOf(set) <= 0) return;        // 0秒からは動かさない

            stopTimer();                              // 別のセットが走っていたら止める
            runningSet = set;
            timerInterval = setInterval(() => {
                remainings[set] = remainingOf(set) - 1;
                if (remainings[set] <= 0) {
                    remainings[set] = 0;
                    stopTimer();        // 0秒で時計だけ止める。セットは終了させない
                }
                io.emit('update_semifinal_timer', timerPayload());
            }, 1000);
        } else if (action === 'stop') {
            stopTimer();
        } else if (action === 'reset') {
            if (runningSet === set) stopTimer();
            remainings[set] = SEMIFINAL_SET_TIME_LIMIT;
        } else if (action === 'edit') {
            const seconds = Number(payload.seconds);
            if (!Number.isFinite(seconds)) return;

            stopTimer();
            remainings[set] = Math.min(
                Math.max(Math.floor(seconds), 0),
                SEMIFINAL_SET_TIME_LIMIT
            );
        } else {
            return;                                   // 未知の action では何もしない
        }

        io.emit('update_semifinal_timer', timerPayload());
    });

    // 接続直後、この1人にだけ現在の状態を渡す（io.emit ではなく socket.emit）
    socket.emit('update_semifinal_state', semifinalState);
    socket.emit('update_semifinal_timer', timerPayload());
};
