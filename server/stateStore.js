// サーバの進行状態をファイルに保存し、起動時に戻す小さな仕組み（2026-11-04）。
//
// 背景: 進行状態（今のモード・2nd Round の組・覆い・問題番号・タイマーの残り時間など）は各ハンドラのメモリに
// あり、サーバが再起動すると初期値に戻っていた。大会中にプロセスが落ちると、運営者が組や問題番号を手で合わせ直す
// ことになる。ここで保存しておけば、再起動しても「落ちる前の続き」から再開できる。
//
// 使い方（各ハンドラのファイルの先頭レベルで1回だけ）:
//   store.register("名前", () => 保存したい値, (保存されていた値) => メモリに戻す)
// restore に渡る値は信用しない（ファイルが壊れている・古い形のことがある）。各ハンドラが検証してから戻す。
//
// 保存の時機:
//   ・Socket の操作を受けた直後（200ms まとめて）と、1秒ごとの見直し（タイマーの減りなど操作なしの変化）
//   ・値が前回と同じなら書かない。書くときは一時ファイルに書いてから置き換える（途中で落ちても壊れない）
//   ・プロセスを止めるとき（SIGINT / SIGTERM）に最後の保存
// 復元: 読めないファイルは .corrupt-時刻 に退避して、初期値で起動する。1つの名前の復元に失敗しても他は戻す。
const fs = require("fs");
const path = require("path");

const FILE = process.env.KQK_STATE_FILE || path.join(__dirname, "..", ".state", "server-state.json");
const VERSION = 1;

const providers = new Map();
let lastWritten = "";
let pending = null;

function register(name, snapshot, restore) {
    providers.set(name, { snapshot, restore });
}

function collect() {
    const data = {};
    for (const [name, p] of providers) {
        try {
            data[name] = p.snapshot();
        } catch (err) {
            console.error(`[stateStore] ${name} の保存内容を作れませんでした:`, err.message);
        }
    }
    return data;
}

/** 前回と変わっていれば書く。書いたら true */
function saveIfChanged() {
    const body = JSON.stringify(collect());
    if (body === lastWritten) return false;
    try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        const tmp = `${FILE}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ version: VERSION, savedAt: new Date().toISOString(), data: JSON.parse(body) }));
        fs.renameSync(tmp, FILE);
        lastWritten = body;
        return true;
    } catch (err) {
        console.error("[stateStore] 保存に失敗しました（進行は続けられます）:", err.message);
        return false;
    }
}

/** 操作の直後に呼ぶ。200ms まとめて1回だけ保存する */
function scheduleSave() {
    if (pending) return;
    pending = setTimeout(() => {
        pending = null;
        saveIfChanged();
    }, 200);
}

/** 起動時に1回。戻した名前の一覧を返す */
function loadAll() {
    let raw;
    try {
        raw = fs.readFileSync(FILE, "utf8");
    } catch {
        return []; // 初回起動（ファイルなし）
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || parsed.version !== VERSION || typeof parsed.data !== "object" || parsed.data === null) {
            throw new Error("形式が違います");
        }
    } catch (err) {
        const moved = `${FILE}.corrupt-${Date.now()}`;
        try { fs.renameSync(FILE, moved); } catch { /* 退避できなくても初期値で起動する */ }
        console.error(`[stateStore] 保存ファイルを読めないため初期値で起動します（${err.message}）。退避先: ${moved}`);
        return [];
    }
    const restored = [];
    for (const [name, p] of providers) {
        if (!(name in parsed.data)) continue;
        try {
            p.restore(parsed.data[name]);
            restored.push(name);
        } catch (err) {
            console.error(`[stateStore] ${name} を戻せませんでした（初期値のまま）:`, err.message);
        }
    }
    lastWritten = JSON.stringify(collect());
    return restored;
}

/** 1秒ごとの見直しと、終了時の最後の保存を始める */
function start(intervalMs = 1000) {
    const timer = setInterval(saveIfChanged, intervalMs);
    timer.unref();
    const flush = () => { saveIfChanged(); };
    process.once("SIGINT", () => { flush(); process.exit(0); });
    process.once("SIGTERM", () => { flush(); process.exit(0); });
    return timer;
}

module.exports = { register, loadAll, scheduleSave, saveIfChanged, start, FILE };
