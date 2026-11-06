// Main の「表示の準備ができているか」を判断する決まり（2026-11-06 ユーザー承認）。
// app/ と server/ の両方から使うので CommonJS で書く（constants.js・coverFlow.js と同じ）。
//
// 考え方
//   ・Main は、画面に必要なデータがそろうまで黒い舞台のまま待つ（勝手に既定の画面を出さない）。
//     取得に失敗したら自動で取り直し続ける。
//   ・データには「必須」と「任意」がある。任意（写真・二つ名）だけが足りないときは、
//     運営者が許可すれば、それなしで進める。
//   ・Main は「何を待っているか」をサーバに報告する。サーバはこのファイルの evaluate() で
//     原因と対処を決めて Admin に配る。必須が足りない間、Admin は覆いを外すボタンを押せない。
//
// 報告の形（Main → サーバ。main_ready_report）
//   { mode, items: [{ key, required, status: 'loading'|'error'|'ok', error, attempts, waitMs }] }

/** データの名前（Admin に出す言葉） */
const MAIN_DATA_LABELS = {
    state: "進行状態",
    timer: "タイマー",
    players: "選手データ",
    courses: "3rd Round のコース",
    profiles: "写真・二つ名",
    questions: "Extra Round の問題",
    brand: "大会名・ロゴ",
};

/** 任意のデータ（運営者の許可があれば、なしで進めてよいもの） */
const MAIN_OPTIONAL_KEYS = ["profiles", "brand"];

/** クイズ画面の見出しに大会名・ロゴを出すモード（Main はこの間だけ大会名・ロゴを読む。2026-11-06） */
const MAIN_BRAND_MODES = ["secondRound", "thirdRound", "extraRound", "semifinal", "final"];

/** ラウンドごとに、覆っている間に先に確かめておくデータ（API）。進行状態などの Socket で届くものは含めない */
const MAIN_PREFLIGHT = {
    secondRound: [{ key: "players", url: "/api/secondRound/loadPlayers" }],
    thirdRound: [{ key: "players", url: "/api/secondRound/loadPlayers" }, { key: "courses", url: "/api/thirdRound/courses" }],
    extraRound: [{ key: "players", url: "/api/secondRound/loadPlayers" }],
    semifinal: [
        { key: "players", url: "/api/secondRound/loadPlayers" },
        { key: "courses", url: "/api/thirdRound/courses" },
        { key: "profiles", url: "/api/semifinal/profiles" },
    ],
    final: [{ key: "players", url: "/api/secondRound/loadPlayers" }, { key: "profiles", url: "/api/semifinal/profiles" }],
    paperTop100: [{ key: "players", url: "/api/secondRound/loadPlayers" }],
};

/** 読み込み中を「問題」として知らせるまでの時間。これより短い間は「準備中」とだけ出す */
const WAIT_GRACE_MS = 4000;
/** Main からの報告がこれより長く途絶えたら「応答なし」 */
const STALE_MS = 10000;
/** 報告の間隔（Main 側） */
const REPORT_INTERVAL_MS = 3000;
/** 何回失敗したら、サーバの再起動まで案内するか */
const MANY_ATTEMPTS = 3;

const MODE_LABELS = {
    waiting: "大会準備", "1stRound": "1st Round", "1stRoundResult": "1st Round 集計", secondRound: "2nd Round",
    thirdRound: "3rd Round", extraRound: "Extra Round", semifinal: "Semi-Final", final: "Final", paperTop100: "上位100名発表",
};

const SERVER_RESTART = "失敗が続くなら、サーバの PC の画面（ターミナル）のエラーを確認し、サーバを再起動してください（進行状態は戻ります）。";

function labelOf(key) {
    return MAIN_DATA_LABELS[key] || key;
}

/**
 * Admin に配る形を決める。
 * @param {object} p
 * @param {{ id: string, mode: string, items: object[], receivedAt: number, modeSeenSince?: number }[]} p.mains 接続中の Main の最新の報告
 *   modeSeenSince … その Main が同じモードを報告し始めた時刻（開いた直後のずれを問題にしない）
 *   hidden … 別のタブ・最小化で見えていない Main。会場の画面ではない（確認用に開いた物など）とみなし、判断に使わない
 * @param {string} p.serverMode いまのモード
 * @param {number} p.modeChangedAt モードが変わった時刻
 * @param {{ mode: string|null, keys: string[] }} p.waivers 運営者が「なしで進める」を許可したデータ
 * @param {number} p.now
 * @returns {{ level: 'ok'|'wait'|'problem', block: string|null, problems: object[], mains: number, waivers: object }}
 *   block … 覆いを外せない理由（短い言葉。進行ボタンの所に出る）。null なら外してよい
 *   problems … [{ id, title, cause, action, buttons: [{ kind: 'retry'|'reload'|'waive', key?, label }] }]
 */
function evaluate({ mains, serverMode, modeChangedAt, waivers, now }) {
    const problems = [];
    let waiting = false;
    const waived = waivers && waivers.mode === serverMode ? waivers.keys : [];

    if (!mains || mains.length === 0) {
        problems.push({
            id: "nomain",
            short: "Main 未接続",
            title: "Main の画面がつながっていません",
            cause: "Main の画面（/main）がサーバにつながっていません。",
            action: "会場の PC で Main の画面を開いてください。開いているなら、その PC のネットワークを確認してください。",
            buttons: [],
        });
    }

    const shown = (mains || []).filter(m => !m.hidden);
    if (mains && mains.length > 0 && shown.length === 0) {
        problems.push({
            id: "hidden",
            short: "Main が隠れています",
            title: "Main の画面が表示されていません",
            cause: "Main の画面は開いていますが、別のタブの裏や最小化で隠れています。",
            action: "会場の PC で Main の画面を前面に出してください（全画面表示）。",
            buttons: [],
        });
    }

    shown.forEach((m, i) => {
        const who = shown.length > 1 ? `Main（${i + 1}台目）` : "Main";
        const age = now - m.receivedAt;
        if (age > STALE_MS) {
            problems.push({
                id: `stale:${m.id}`,
                short: `${who} 応答なし`,
                title: `${who} から応答がありません`,
                cause: `${Math.floor(age / 1000)}秒間、報告が届いていません（画面が固まっている可能性があります）。`,
                action: "［Main を再読み込み］を押してください。直らなければ会場の PC のブラウザを確認してください。",
                buttons: [{ kind: "reload", label: "Main を再読み込み" }],
            });
            return;
        }
        if (m.mode !== serverMode) {
            const since = Math.max(modeChangedAt, m.modeSeenSince || 0);
            if (now - since < WAIT_GRACE_MS) { waiting = true; return; }
            problems.push({
                id: `mode:${m.id}`,
                short: `${who} 切り替え待ち`,
                title: `${who} が ${MODE_LABELS[serverMode] || serverMode} に切り替わっていません`,
                cause: `${who} はまだ「${MODE_LABELS[m.mode] || m.mode}」を表示しています。`,
                action: "［Main を再読み込み］を押してください。",
                buttons: [{ kind: "reload", label: "Main を再読み込み" }],
            });
            return;
        }
        for (const item of m.items || []) {
            if (item.status === "ok") continue;
            const optional = !item.required;
            if (optional && waived.includes(item.key)) continue;
            const waitMs = (item.waitMs || 0) + age;
            if (item.status === "loading" && waitMs < WAIT_GRACE_MS) { waiting = true; continue; }
            const label = labelOf(item.key);
            const viaSocket = item.key === "state" || item.key === "timer";
            let cause;
            let action;
            const buttons = [];
            if (viaSocket) {
                cause = `${label}がサーバから届きません（${Math.floor(waitMs / 1000)}秒）。`;
                action = "［Main を再読み込み］を押してください。";
                buttons.push({ kind: "reload", label: "Main を再読み込み" });
            } else {
                cause = item.status === "error" && item.error
                    ? `${label}を読み込めません（${item.error}）。`
                    : `${label}の読み込みに応答がありません（${Math.floor(waitMs / 1000)}秒）。`;
                const network = typeof item.error === "string" && item.error.includes("通信");
                action = "自動で取り直し中です（［再取得］ですぐ取り直せます）。"
                    + (network ? "会場の PC とサーバの間のネットワークを確認してください。" : "")
                    + ((item.attempts || 0) >= MANY_ATTEMPTS ? SERVER_RESTART : "");
                buttons.push({ kind: "retry", label: "再取得" });
            }
            if (optional) {
                action = `なしで進めるなら［${label}なしで進める］（後から届けば自動で入ります）。` + action;
                buttons.unshift({ kind: "waive", key: item.key, label: `${label}なしで進める` });
            }
            problems.push({
                id: `item:${m.id}:${item.key}`,
                short: optional ? `${who}：${label}の確認待ち` : `${who}：${label}を読み込めません`,
                title: optional ? `${who}：${label}を読み込めていません（任意）` : `${who}：${label}を読み込めていません`,
                cause, action, buttons,
            });
        }
    });

    const level = problems.length > 0 ? "problem" : waiting ? "wait" : "ok";
    const block = problems.length > 0 ? problems[0].short : waiting ? "Main 準備中…" : null;
    return { level, block, problems, mains: (mains || []).length, waivers: { mode: waivers ? waivers.mode : null, keys: waivers ? waivers.keys : [] } };
}

module.exports = {
    MAIN_DATA_LABELS, MAIN_OPTIONAL_KEYS, MAIN_PREFLIGHT, MAIN_BRAND_MODES,
    WAIT_GRACE_MS, STALE_MS, REPORT_INTERVAL_MS, evaluate,
};
