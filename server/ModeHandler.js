const { isResetTarget, fromOf } = require("./roundOrder");
const { MODES } = require("../constants.js");
const store = require("./stateStore");
const MainCover = require("./MainCoverHandler");
const MainReady = require("./MainReadyHandler");

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

// 2nd Round の表示（view）として受け付ける値（2026-10-30 に次点の発表 runnerUp を追加）
const SECOND_ROUND_VIEWS = ["turnOver", "quiz", "runnerUp"];
const TURN_OVER_PHASES = ["collapsed", "expanded"];

function isInt(v, min, max) {
    return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}
function own(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Admin から届いた部分更新を検証して、次の状態を返す（2026-11-04 検証を追加）。
 * 決まった値以外の項目は無視する。以前は組番号やステップに何でも入れられ、Main の画面が壊れえた。
 */
function applySecondRoundUpdate(prev, update) {
    if (!update || typeof update !== "object") return prev;
    const next = { ...prev };
    if (own(update, "group") && isInt(update.group, 1, 4)) next.group = update.group;
    if (own(update, "view") && SECOND_ROUND_VIEWS.includes(update.view)) next.view = update.view;
    // ターンオーバーのステップは 0〜3、全部発表し終えた状態が 4（Admin の turnOverDone）
    if (own(update, "turnOverStep") && isInt(update.turnOverStep, 0, 4)) next.turnOverStep = update.turnOverStep;
    if (own(update, "turnOverPhase") && TURN_OVER_PHASES.includes(update.turnOverPhase)) next.turnOverPhase = update.turnOverPhase;
    if (own(update, "turnOverFinalRevealed") && typeof update.turnOverFinalRevealed === "boolean") {
        next.turnOverFinalRevealed = update.turnOverFinalRevealed;
    }
    return next;
}

store.register(
    "mode",
    () => ({ currentMode, secondRoundState }),
    (saved) => {
        if (!saved || typeof saved !== "object") return;
        if (MODES.includes(saved.currentMode)) currentMode = saved.currentMode;
        secondRoundState = applySecondRoundUpdate({ ...INITIAL_SECOND_ROUND_STATE }, saved.secondRoundState);
    }
);

module.exports = function ModeHandler(io, socket) {
    // payload は文字列（モード名）か { mode, resume }。resume は「進行中のラウンドへ戻る」とき
    socket.on('change_mode', (payload) => {
        const mode = typeof payload === "string" ? payload : payload && typeof payload === "object" ? payload.mode : undefined;
        const resume = typeof payload === "object" && payload !== null && payload.resume === true;
        if (!MODES.includes(mode)) {
            console.log('Mode change rejected:', mode);
            socket.emit('mode_update', currentMode);
            return;
        }
        console.log('Mode changed to:', mode);
        // 覆いを先に配る。ラウンドの画面が覆いなしで一瞬だけ出るのを防ぐため
        if (mode !== currentMode) MainCover.onModeChange(io, mode, { resume });
        const changed = mode !== currentMode;
        currentMode = mode;
        io.emit('mode_update', currentMode);
        // Main の準備の確認をやり直す（「なしで進める」の許可はモードが変わったら消える。2026-11-06）
        if (changed) MainReady.onModeChange(io, mode);
    })

    socket.on('change_2nd_round_state', (newState) => {
        console.log('2nd Round State changed to:', newState);
        secondRoundState = applySecondRoundUpdate(secondRoundState, newState);
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

    // 画面を開いたときに現在の状態を取り直す（読み取りだけ。他のラウンドの request_*_sync と同じ）。
    // 接続直後の配信は、その画面がまだ無い（別のラウンドを表示中・覆われている）と受け取れずに失われるため
    socket.on('request_mode_sync', () => {
        socket.emit('mode_update', currentMode);
    });
    socket.on('request_second_round_sync', () => {
        socket.emit('update_second_round_state', secondRoundState);
    });

    socket.emit('mode_update', currentMode);
    socket.emit('update_second_round_state', secondRoundState);
}

module.exports.applySecondRoundUpdate = applySecondRoundUpdate;

/** いまのモード（server/MainReadyHandler.js が使う） */
module.exports.getCurrentMode = () => currentMode;
