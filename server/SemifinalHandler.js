// 準決勝「3セット制タイムレース Nine Hundred」のサーバ側処理
//
// このファイルが持つのは「進行状態」だけ。結果は DB（app/api 側）が持つ。
// サーバを再起動すると進行状態は初期値に戻るが、Admin から選び直せばよい。
// 2nd / 3rd Round と同じ割り切り。

const { SEMIFINAL_SET_TIME_LIMIT } = require("../constants.js");
const { isResetTarget, fromOf } = require("./roundOrder");

// 進行状態（型と意味は lib/types.ts の SemifinalState。設計メモ 6.2）
//
//   set           … 現在のセット 1〜3
//   view          … Main の表示 "standby" | "intro" | "lineup" | "quiz" | "review" | "tally"（得点集計）| "results" | "playoff"
//   reviewRanges  … セットごとの振り返り範囲（通し番号）{ [set]: { from, to } }
//   reviewPage    … 振り返りのページ（0始まり、1ページ3問）
//   pointsEntered … このセットの得点を入力済みか
//   announceSeq   … 点数発表の回数。Admin の announce_semifinal_results でだけ増える
//   playoff       … サドンデスの進行（lib/semifinalPlayoff.ts。コード上の名前は playoff）。行っていなければ null
//   introIndex    … 進出者紹介で表示中の選手（紹介順の何番目か。0始まり）
//   introStep     … 進出者紹介の段階 "nickname"（二つ名）| "profile"（写真・学校名・学年・名前）
//   lineupSeq     … 選手カード表示を始めた回数。Admin の start_semifinal_lineup でだけ増える
//
// 2026-10-15: 準決勝は "standby"（準備中）から始まる。準備 → 進出者紹介 → 選手カード表示 → 第1セット
//
// あえて持たないもの（DB の Player から導出する）:
//   - 出場者・席番号・ポイント・勝ち抜け／失格
let semifinalState = {
    set: 1,
    view: "standby",
    reviewRanges: {},
    reviewPage: 0,
    pointsEntered: false,
    announceSeq: 0,
    playoff: null,
    introIndex: 0,
    introStep: "nickname",
    lineupSeq: 0
};

const VIEWS = ["standby", "intro", "lineup", "quiz", "review", "tally", "results", "playoff"];
const INTRO_STEPS = ["nickname", "profile"];
const INTRO_INDEX_MAX = 8;        // 紹介するのは敗者復活者＋3rd Round 通過の8名（0〜8。2026-10-31 項目13）
const REVIEW_RANGE_MAX = 300;   // lib/questionPool.ts の QUESTION_RANGE_MAX と同じ
const REVIEW_PAGE_MAX = 100;
const PLAYOFF_ACTIONS_MAX = 100;

function own(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}
function isInt(v, min, max) {
    return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/** プレーオフの形が正しければ複製を返す。不正なら undefined */
function sanitizePlayoff(value, set) {
    if (value === null) return null;
    if (!value || typeof value !== "object") return undefined;
    const { purpose, candidateIds, slots, actions } = value;
    if (purpose !== "advance" && purpose !== "eliminate") return undefined;
    if (value.set !== set) return undefined;
    if (!Array.isArray(candidateIds) || candidateIds.length < 2 || candidateIds.length > 9) return undefined;
    if (!candidateIds.every(id => isInt(id, 1, Number.MAX_SAFE_INTEGER))) return undefined;
    if (new Set(candidateIds).size !== candidateIds.length) return undefined;
    if (!isInt(slots, 1, candidateIds.length - 1)) return undefined;
    if (!Array.isArray(actions) || actions.length > PLAYOFF_ACTIONS_MAX) return undefined;
    const cleanActions = [];
    for (const a of actions) {
        if (!a || typeof a !== "object") return undefined;
        if (!candidateIds.includes(a.playerId)) return undefined;
        if (a.action !== "correct" && a.action !== "wrong") return undefined;
        cleanActions.push({ playerId: a.playerId, action: a.action });
    }
    return { purpose, set, candidateIds: [...candidateIds], slots, actions: cleanActions };
}

/**
 * Admin から届いた部分更新を検証して、次の状態を返す。不正な項目は無視する。
 *
 *   - set が変わったら、そのセットの進行（view・ページ・入力済み・プレーオフ）を初期化する
 *   - reviewRange（現在のセットの振り返り範囲）が変わったらページを先頭に戻す
 *   - view: "playoff" はプレーオフがあるとき、"review"・"tally" は振り返り範囲があるときだけ。
 *     プレーオフを消したら results に戻す
 */
function applyUpdate(prev, update) {
    if (!update || typeof update !== "object") return prev;
    let next = { ...prev };

    if (own(update, "set") && isInt(update.set, 1, 3) && update.set !== prev.set) {
        next = { ...next, set: update.set, view: "quiz", reviewPage: 0, pointsEntered: false, playoff: null };
    }
    if (own(update, "reviewRange")) {
        const r = update.reviewRange;
        if (r && typeof r === "object" && isInt(r.from, 1, Number.MAX_SAFE_INTEGER) && isInt(r.to, 1, Number.MAX_SAFE_INTEGER)
            && r.from <= r.to && r.to - r.from < REVIEW_RANGE_MAX) {
            const old = next.reviewRanges[next.set];
            next.reviewRanges = { ...next.reviewRanges, [next.set]: { from: r.from, to: r.to } };
            if (!old || old.from !== r.from || old.to !== r.to) next.reviewPage = 0;
        }
    }
    if (own(update, "reviewPage") && isInt(update.reviewPage, 0, REVIEW_PAGE_MAX)) {
        next.reviewPage = update.reviewPage;
    }
    // 進出者紹介で表示する選手と段階
    if (own(update, "introIndex") && isInt(update.introIndex, 0, INTRO_INDEX_MAX)) {
        next.introIndex = update.introIndex;
    }
    if (own(update, "introStep") && INTRO_STEPS.includes(update.introStep)) {
        next.introStep = update.introStep;
    }
    if (own(update, "pointsEntered") && typeof update.pointsEntered === "boolean") {
        next.pointsEntered = update.pointsEntered;
    }
    if (own(update, "playoff")) {
        const playoff = sanitizePlayoff(update.playoff, next.set);
        if (playoff !== undefined) {
            next.playoff = playoff;
            if (playoff === null && next.view === "playoff") next.view = "results";
        }
    }
    if (own(update, "view") && VIEWS.includes(update.view)) {
        // playoff はプレーオフがあるとき、review・tally（得点集計）はこのセットの振り返り範囲があるときだけ
        const allowed = update.view === "playoff" ? next.playoff !== null
            : update.view === "review" || update.view === "tally" ? Boolean(next.reviewRanges[next.set])
            : true;
        if (allowed) next.view = update.view;
    }
    return next;
}

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

// 進行状態の保存と復元（2026-11-04）。タイマーは止まった状態で戻す
const store = require("./stateStore");
store.register(
    "semifinal",
    () => ({ state: semifinalState, remainings }),
    (saved) => {
        if (!saved || typeof saved !== "object") return;
        semifinalState = applyUpdate(semifinalState, saved.state);
        const r = saved.remainings && typeof saved.remainings === "object" ? saved.remainings : {};
        for (const set of [1, 2, 3]) {
            const v = r[set];
            if (typeof v === "number" && Number.isFinite(v)) remainings[set] = Math.min(Math.max(Math.floor(v), 0), SEMIFINAL_SET_TIME_LIMIT);
        }
    }
);

module.exports = function SemifinalHandler(io, socket) {
    // 進行状態の切り替え（部分更新。applyUpdate で検証する）
    socket.on('change_semifinal_state', (update) => {
        const previous = semifinalState;
        semifinalState = applyUpdate(semifinalState, update);
        io.emit('update_semifinal_state', semifinalState);

        // セットが変わったら走っている時計を止める（画面に出ていないセットの残り時間が
        // 減り続ける事故を防ぐ。再開はスタッフが明示的に「開始」を押す）
        if (previous.set !== semifinalState.set && runningSet !== null) {
            stopTimer();
            io.emit('update_semifinal_timer', timerPayload());
        }
    });

    // 点数発表。Main はこの回数が増えた瞬間にだけポイントバーの演出を再生する
    // （リロードや途中から開いた Main は演出せず最終状態を出す）。
    // 対象のセットが一致し、得点集計中かつ得点入力済みのときだけ受け付ける（古い画面・
    // 二重送信で演出が2回流れないように。発表し直すときは得点集計に戻してから押す）。
    // 2026-10-17: 発表の前の画面を「振り返り」から「得点集計（tally）」に変更
    socket.on('announce_semifinal_results', (payload) => {
        if (!payload || typeof payload !== 'object' || !own(payload, 'set') || payload.set !== semifinalState.set) return;
        if (semifinalState.view !== 'tally') return;
        if (!semifinalState.pointsEntered) return;
        semifinalState = { ...semifinalState, view: 'results', announceSeq: semifinalState.announceSeq + 1 };
        io.emit('update_semifinal_state', semifinalState);
    });

    // 結果リセットに合わせて進行を最初に戻す（2026-10-17 追加。2026-10-22 から reset_round_progress の1つとして受ける）。
    // DB のリセットは API が行い済み。第1セットにし、3セット分のタイマー・振り返り範囲・得点入力済みの印・サドンデスを消す。
    // - Semi-Final 自身のリセット（from: "semifinal"）: 準備・紹介・カード表示の途中なら表示はそのまま、
    //   それ以外は第1セットのクイズ画面に戻す（出場者は変わらない）。
    // - それより前のラウンドからのリセット: 出場者が変わり得るので準備（standby）に戻し、紹介も1人目からにする。
    //   二つ名・写真は API が消し済みなので、各画面に読み直させる。
    // 紹介・カード表示・点数発表の回数は変えない（回数は増える一方にしておく）
    socket.on('reset_round_progress', (payload) => {
        const from = fromOf(payload);
        if (!from || !isResetTarget(from, "semifinal")) return;
        stopTimer();
        for (const key of Object.keys(remainings)) delete remainings[key];
        const own = from === "semifinal";
        const keepView = own && ["standby", "intro", "lineup"].includes(semifinalState.view);
        semifinalState = {
            ...semifinalState,
            set: 1,
            view: own ? (keepView ? semifinalState.view : "quiz") : "standby",
            reviewRanges: {},
            reviewPage: 0,
            pointsEntered: false,
            playoff: null,
            ...(own ? {} : { introIndex: 0, introStep: "nickname" })
        };
        io.emit('update_semifinal_state', semifinalState);
        io.emit('update_semifinal_timer', timerPayload());
        if (!own) io.emit('update_semifinal_profiles');
    });

    // 選手カード表示を始める（2026-10-15 追加）。Main はこの回数が増えた瞬間にだけ、カードを
    // 紹介順 → 敗者復活者の順に1枚ずつ出す演出を再生する（リロード・途中から開いた Main は全員を出す）
    socket.on('start_semifinal_lineup', () => {
        semifinalState = { ...semifinalState, view: 'lineup', lineupSeq: semifinalState.lineupSeq + 1 };
        io.emit('update_semifinal_state', semifinalState);
    });

    // 写真・二つ名を保存した Admin からの合図。DB は API が書き換え済みなので、ここでは
    // 「取り直して」とだけ全員に伝える（中身は送らない。各画面が /api/semifinal/profiles を読み直す）
    socket.on('semifinal_profiles_changed', () => {
        io.emit('update_semifinal_profiles');
    });

    // 画面（Main / Admin の準決勝）を開いたときに現在の状態を取り直すための要求。
    // 接続直後の配信は、準決勝の画面がまだ無い（別のラウンドを表示中）と受け取れずに失われるため。
    // 読み取りだけで、状態は変えない（3rd Round の request_third_round_sync と同じ）
    socket.on('request_semifinal_sync', () => {
        socket.emit('update_semifinal_state', semifinalState);
        socket.emit('update_semifinal_timer', timerPayload());
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
