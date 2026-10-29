// 3rd Round「Number 10」のサーバ側処理
//
// このファイルが持つのは「進行状態」だけ。結果は DB（app/api 側）が持つ。
// サーバを再起動すると進行状態は初期値に戻るが、Admin から選び直せばよい。
// 2nd Round と同じ割り切り。

const { THIRD_ROUND_TIME_LIMIT } = require("../constants.js");
const { isResetTarget, fromOf } = require("./roundOrder");

// 進行状態
//
//   phase     … 大きな区切り
//                 "courseSelect" … 20名の所属コースを決める
//                 "quiz"         … 4コースを順に実施する
//                 "playoff"      … 判定基準で決着しなかった選手の早押しプレーオフ
//                                  quizOrder はそのまま使う（どのコースの分か）
//   step      … エントリーの進み具合（phase === "courseSelect" のときのみ意味を持つ）
//                 "entry"  … エントリータイム中（BGMで計測）。まだ締め切っていない
//                 "closed" … 締切済み。Admin のチェック欄が開く
//   quizOrder … クイズ実施フェーズで何番目のコースか 1〜4
//               （phase === "quiz" のときのみ意味を持つ）
//   finishedOrder … コース終了処理（15分経過時の順位確定）を走らせたコースの
//                   quizOrder。未実行なら null。
//                   「終了処理を走らせたか」は観測できる結果から復元できない。
//                   終了後は rank === 0 の選手が互いに同値になるが、コース開始
//                   直後も全員が同値なので区別がつかない。だから状態として持つ。
//                   quizOrder と比較する形なので、コースごとに持つ必要はない。
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
//   - プレーオフの対象者      → そのコースで thirdRoundRank === 0 の選手。
//                              コース終了処理で決着した人には順位が入るため導出できる
let thirdRoundState = {
    phase: "courseSelect",
    step: "entry",
    quizOrder: 1,
    finishedOrder: null
};

// 15分タイマー（コースごとに1本ずつ、計4本ぶんの残り秒数を持つ）
//
// キーは quizOrder(1〜4)。コース名をキーにしない理由は、server/ が DB に触らない
// ためコース名を知らないから。quizOrder は thirdRoundState として手元にある。
//
// 未登録のコースは「まだ一度も動かしていない＝15分のまま」とみなす。
// こうすると初期化ループも「コース数 = 4」という定数もここに要らない。
const remainings = {};

// いま走っているのはどのコースか。停止中は null。
// 「コース N が稼働中か」は runningOrder === N で導出できるので別に持たない。
// timerInterval は clearInterval のためのハンドルで、状態ではない。
// コースは1つずつ実施するルールなので、インターバルは常に1本しか持たない。
// コースごとにインターバルを持つと「別のコースに移ったのに前の時計が回りっぱなし」
// という事故が起こりうる。
let runningOrder = null;
let timerInterval = null;

// 0秒に到達しても専用のイベントは出さない。設計メモ 4.2 のとおり 0秒到達は
// コースの終了ではなく、その後も正解・誤答・スルーの操作を受け付け続ける。
// 画面が知りたいのは remaining === 0 という事実だけで、これは配信済みの値から分かる。

/** そのコースの残り秒数。一度も動かしていなければ制限時間そのまま */
function remainingOf(order) {
    return remainings[order] ?? THIRD_ROUND_TIME_LIMIT;
}

/** 配信するタイマー状態。running は保持せず、クライアント側で runningOrder から導出する */
function timerPayload() {
    return { remainings, runningOrder };
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    runningOrder = null;
}

module.exports = function ThirdRoundHandler(io, socket) {
    // 進行状態の切り替え。
    // 部分更新できるよう、受け取った内容を既存の状態にマージする。
    socket.on('change_3rd_round_state', (newState) => {
        const previous = thirdRoundState;
        thirdRoundState = { ...thirdRoundState, ...newState };
        console.log('3rd Round State:', thirdRoundState);
        io.emit('update_third_round_state', thirdRoundState);

        // 実施中のコースが変わった（またはクイズ実施フェーズから抜けた）ときは、
        // 走っている時計を止める。画面に出ていないコースの残り時間が減り続ける事故を防ぐ。
        // 再開はスタッフが明示的に「開始」を押す。
        const courseChanged =
            previous.quizOrder !== thirdRoundState.quizOrder ||
            previous.phase !== thirdRoundState.phase;

        if (courseChanged && runningOrder !== null) {
            stopTimer();
            io.emit('update_third_round_timer', timerPayload());
        }
    });

    // 3rd Round の進行を最初に戻す（2026-10-20 追加。2026-10-22 から reset_round_progress の1つとして受ける）。
    // 選手 CSV の取り込み・2nd Round の組のリセット・3rd Round の抽選のリセットのとき（DB は API が戻し済み）。
    // コース選択・エントリー中・1コース目、走っているタイマーを止め、4コース分を制限時間（15分）に戻す
    socket.on('reset_round_progress', (payload) => {
        const from = fromOf(payload);
        if (!from || !isResetTarget(from, "thirdRound")) return;
        stopTimer();
        for (const key of Object.keys(remainings)) delete remainings[key];
        thirdRoundState = { phase: "courseSelect", step: "entry", quizOrder: 1, finishedOrder: null };
        io.emit('update_third_round_state', thirdRoundState);
        io.emit('update_third_round_timer', timerPayload());
    });

    // 抽選結果の中継。
    // 抽選そのものは app/api/thirdRound/draw が実行済みで、
    // ここは受け取った結果を全員に配るだけ。乱数はここでは引かない。
    socket.on('broadcast_third_round_courses', (payload) => {
        io.emit('update_third_round_courses', payload);
    });

    // 15分タイマーの操作。
    // action で start / stop / reset / edit を区別する（イベントを分けない）。
    // edit のみ payload.seconds を使う。
    //
    // どのコースへの操作かは引数で受け取らず、サーバが thirdRoundState.quizOrder から
    // 判断する。クライアントに order を送らせると、Admin の状態が古いときに別のコースの
    // 時計を触ってしまう余地が残るため。
    socket.on('change_third_round_timer', (payload) => {
        const action = payload && payload.action;
        const order = thirdRoundState.quizOrder;

        if (action === 'start') {
            if (runningOrder === order) return;         // 二重起動を防ぐ
            if (remainingOf(order) <= 0) return;        // 0秒からは動かさない

            stopTimer();                                // 別のコースが走っていたら止める
            runningOrder = order;
            timerInterval = setInterval(() => {
                remainings[order] = remainingOf(order) - 1;
                if (remainings[order] <= 0) {
                    remainings[order] = 0;
                    stopTimer();        // 0秒で時計だけ止める。コースは終了させない
                }
                io.emit('update_third_round_timer', timerPayload());
            }, 1000);
        } else if (action === 'stop') {
            stopTimer();
        } else if (action === 'reset') {
            if (runningOrder === order) stopTimer();    // 別コースが走っていれば止めない
            remainings[order] = THIRD_ROUND_TIME_LIMIT;
        } else if (action === 'edit') {
            // 残り秒数の手動編集。疑義の申し立てで時間を戻す場合や、タイマーの
            // 開始を忘れたまま進行してしまった場合の復旧手段。
            //
            // 編集したら時計は止める。動いている最中に書き換えると、次の tick と
            // どちらが勝つか分かりにくくなるため。再開はスタッフの明示操作。
            const seconds = Number(payload.seconds);
            if (!Number.isFinite(seconds)) return;

            stopTimer();
            remainings[order] = Math.min(
                Math.max(Math.floor(seconds), 0),
                THIRD_ROUND_TIME_LIMIT
            );
        } else {
            return;                                     // 未知の action では何もしない
        }

        io.emit('update_third_round_timer', timerPayload());
    });

    // 接続直後、この1人にだけ現在の状態を渡す（io.emit ではなく socket.emit）
    socket.emit('update_third_round_state', thirdRoundState);
    socket.emit('update_third_round_timer', timerPayload());

    // 画面（Main / Admin の 3rd Round）を開いたときに、現在の状態を取り直すための要求。
    // 接続直後の配信は、Socket がつながった時点ではまだ 3rd Round の画面が無い
    // （別のラウンドを表示中だった）と受け取れずに失われる。そのため画面側が表示された
    // タイミングでこの要求を送り、その1人にだけ現在の状態とタイマーを返す。
    // 読み取りだけで、状態は変えない（2026-10-11 追加）。
    socket.on('request_third_round_sync', () => {
        socket.emit('update_third_round_state', thirdRoundState);
        socket.emit('update_third_round_timer', timerPayload());
    });
};
