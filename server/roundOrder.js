// 進行状態のリセット（reset_round_progress）の対象判定（2026-10-22 追加。docs/linear-progress-design.md 2.3）
//
// 大会は 2nd Round → 3rd Round → Extra Round → Semi-Final → Final の順に進む（lib/roundProgress.ts と同じ順）。
// Admin が DB のリセット（連鎖つき）に成功した後、reset_round_progress { from } を送る。
// 各ハンドラは「自分のラウンドが from 以降なら」メモリの進行状態とタイマーを最初に戻す。
// from: "all"（選手 CSV の取り込み。2nd Round も含めてすべて）| 下の ROUND_ORDER の1つ
const ROUND_ORDER = ["secondRound", "thirdRound", "extraRound", "semifinal", "final"];

/** 受け取った from が正しい値か */
function isValidFrom(from) {
    return from === "all" || ROUND_ORDER.includes(from);
}

/** from からのリセットで round を初期化するか */
function isResetTarget(from, round) {
    if (from === "all") return true;
    const f = ROUND_ORDER.indexOf(from);
    return f >= 0 && ROUND_ORDER.indexOf(round) >= f;
}

/** payload から from を取り出す（不正なら null） */
function fromOf(payload) {
    const from = payload && typeof payload === "object" ? payload.from : undefined;
    return isValidFrom(from) ? from : null;
}

module.exports = { ROUND_ORDER, isResetTarget, fromOf };
