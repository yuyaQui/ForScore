// Extra Round（敗者復活）のサーバ側処理
//
// このファイルが持つのは「進行状態」だけ。結果は DB（app/api 側）が持つ。
// サーバを再起動すると進行状態は初期値（stage: "setup"）に戻るが、Admin の
// 「手動操作」から段階を選び直せばよい。2nd / 3rd Round と同じ割り切り。
//
// 進行状態
//
//   stage  … 大きな段階
//              "setup"         … 問題CSVの取込。Main は「準備中」
//              "firstStep"     … 筆記クイズ（問題→解答の順に表示）
//              "entrantSelect" … 2nd Step 進出者の選択。Main は「準備中」
//              "secondStep"    … 進出者による早押し
//   cursor … First Step の進行位置 0〜39
//              （lib/extraRound.ts の FIRST_STEP_SEQUENCE の添字）
//   revealed … いまのステップの中身を Main に出したか
//              問題のステップなら問題文、解答のステップなら解答。false の間、Main は
//              問題番号と枠（解答のステップなら問題文まで）だけを出す。Admin の
//              「問題を表示する」「解答を表示」で true になり、Main は false → true の
//              瞬間にだけ文字が徐々に現れるアニメーションを流す。
//
// revealed の扱い（Main に未発表の問題・解答が出てしまう事故を防ぐため、安全側に倒す）:
//   - cursor または stage が変わる更新で revealed を明示しなければ、false に戻す
//     （次の問題に進めた瞬間に、中身が勝手に出ないようにする）
//   - revealed を明示した更新はその値を使う（「ひとつ戻る」は表示済みの内容に戻るので true）
//   - 「表示する」は専用イベント reveal_extra_round_step で受け、Admin が見ていた cursor が
//     いまの cursor と一致するときだけ true にする（別の Admin 画面で先に進んでいたとき、
//     古い画面の「表示する」が次の問題を出してしまわないように）
//   - 再接続・Main のリロードでは現在値をそのまま渡す。revealed が true なら Main は
//     アニメーションなしで即座に表示する（アニメーションは false → true を見たときだけ）
//
// あえて持たないもの:
//   - 問題番号／出題か解答発表か／フェーズ
//       cursor から導出できる（lib/extraRound.ts）
//   - 残り人数
//       First Step の採点はシステム外で行うため、システムは誰が残っているかを
//       知らない。会場では起立・着席で見えている
//   - Second Step の出場者・勝者
//       DB の Player.extraRoundSecondStep / extraRoundRank が持つ。スタッフが入力した
//       事実であり、進行中に消えると復元できないため
//
// Admin から届く値は検証してから取り込む。想定外の stage や範囲外の cursor が
// 紛れ込んでも、Main が存在しない問題番号を探して落ちないようにするため。

const {
    EXTRA_ROUND_FIRST_STEP_LENGTH,
    EXTRA_ROUND_STAGES
} = require("../constants.js");
const { isResetTarget, fromOf } = require("./roundOrder");

let extraRoundState = {
    stage: "setup",
    cursor: 0,
    revealed: false
};

function sanitizeUpdate(update) {
    const next = {};
    if (!update || typeof update !== "object") return next;

    // 自分自身のプロパティだけを見る（プロトタイプ経由で値が紛れ込むのを避ける）
    const own = (key) => Object.prototype.hasOwnProperty.call(update, key);

    if (own('stage') && EXTRA_ROUND_STAGES.includes(update.stage)) {
        next.stage = update.stage;
    }
    if (own('cursor') && Number.isInteger(update.cursor)) {
        next.cursor = Math.max(0, Math.min(EXTRA_ROUND_FIRST_STEP_LENGTH - 1, update.cursor));
    }
    // 真偽値だけを受け付ける（"false" などの文字列は真と解釈されてしまうため弾く）
    if (own('revealed') && typeof update.revealed === 'boolean') {
        next.revealed = update.revealed;
    }
    return next;
}

// 更新を現在の状態にマージする。revealed の扱いは上のコメントのとおり。
function applyUpdate(prev, update) {
    const patch = sanitizeUpdate(update);
    const next = { ...prev, ...patch };
    const moved = next.cursor !== prev.cursor || next.stage !== prev.stage;
    if (moved && !Object.prototype.hasOwnProperty.call(patch, 'revealed')) {
        next.revealed = false;
    }
    return next;
}

// 進行状態の保存と復元（2026-11-04）。復元で revealed を勝手に true にしないよう、保存された値をそのまま検証して戻す
const store = require("./stateStore");
store.register(
    "extraRound",
    () => extraRoundState,
    (saved) => {
        const base = { stage: "setup", cursor: 0, revealed: false };
        extraRoundState = applyUpdate(base, saved && typeof saved === "object" ? { ...saved, revealed: saved.revealed === true } : null);
    }
);

module.exports = function ExtraRoundHandler(io, socket) {
    // 進行状態の切り替え。
    // 部分更新できるよう、受け取った内容（検証済みの項目だけ）を既存の状態にマージする。
    socket.on('change_extra_round_state', (update) => {
        extraRoundState = applyUpdate(extraRoundState, update);
        console.log('Extra Round State:', extraRoundState);
        io.emit('update_extra_round_state', extraRoundState);
    });

    // 「問題を表示する」「解答を表示」。いまのステップの中身を Main に出す。
    // payload は { cursor }（Admin が見ていた位置）。いまの位置と違う、First Step ではない、
    // すでに表示済み、のいずれかなら何もしない（二重押しでも Main は再生し直さない）。
    socket.on('reveal_extra_round_step', (payload) => {
        const cursor = payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'cursor')
            ? payload.cursor
            : undefined;
        if (extraRoundState.stage !== 'firstStep') return;
        if (cursor !== extraRoundState.cursor) return;
        if (extraRoundState.revealed) return;
        extraRoundState = { ...extraRoundState, revealed: true };
        console.log('Extra Round State:', extraRoundState);
        io.emit('update_extra_round_state', extraRoundState);
    });

    // 進行状態のリセット（2026-10-22）。Extra Round 以前からのリセットなら問題取込（setup）に戻す。
    // 登録済みの問題は DB に残るので、「登録済みの問題を使う」で再開できる
    socket.on('reset_round_progress', (payload) => {
        const from = fromOf(payload);
        if (!from || !isResetTarget(from, "extraRound")) return;
        extraRoundState = { stage: "setup", cursor: 0, revealed: false };
        io.emit('update_extra_round_state', extraRoundState);
    });

    // 画面を開いたときに現在の状態を取り直す（読み取りだけ。他のラウンドの request_*_sync と同じ。2026-11-04 追加）。
    // 接続直後の配信は、Extra Round の画面がまだ無い（別のラウンドを表示中・覆われている）と受け取れずに失われる
    socket.on('request_extra_round_sync', () => {
        socket.emit('update_extra_round_state', extraRoundState);
    });

    // 接続直後、この1人にだけ現在の状態を渡す（io.emit ではなく socket.emit）
    socket.emit('update_extra_round_state', extraRoundState);
};
