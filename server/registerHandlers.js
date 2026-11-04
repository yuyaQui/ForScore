// Socket.IO の各ハンドラの登録と、進行状態の保存・復元（2026-11-04）。
// server.js（本番・開発）と tests/helpers/testServer.js（自動テスト）が同じ登録を使う。
// ここに無いハンドラは動かない、という一覧にもなっている。
const store = require("./stateStore");

const firstRoundHandlers = require("./FirstRoundHandler");
const registerTextHandlers = require("./TextHandler");
const ModeHandler = require("./ModeHandler");
const ThirdRoundHandler = require("./ThirdRoundHandler");
const ExtraRoundHandler = require("./ExtraRoundHandler");
const SemifinalHandler = require("./SemifinalHandler");
const FinalHandler = require("./FinalHandler");
const QuestionHandler = require("./QuestionHandler");       // 問題表示（2026-10-22）
const PaperTopHandler = require("./PaperTopHandler");       // ペーパー上位100名の発表（2026-10-31）
const MainCoverHandler = require("./MainCoverHandler");     // Main を覆う待機画面・ブランク（2026-11-04）

/** 選手の一覧として配ってよい値か（中身の細部は見ない。配列で、各要素がオブジェクトで、多すぎないこと） */
function isPlayerList(v) {
    return Array.isArray(v) && v.length <= 2000 && v.every(p => p && typeof p === "object" && Number.isInteger(p.id));
}

/** 起動時に1回。保存されていた進行状態を戻し、自動保存を始める */
function startPersistence() {
    const restored = store.loadAll();
    if (restored.length > 0) console.log("保存されていた進行状態を戻しました:", restored.join(", "));
    store.start();
}

/** 接続してきた1つの Socket に、全ハンドラを結びつける */
function registerHandlers(io, socket) {
    firstRoundHandlers(io, socket);
    registerTextHandlers(io, socket);
    ModeHandler(io, socket);
    ThirdRoundHandler(io, socket);
    ExtraRoundHandler(io, socket);
    SemifinalHandler(io, socket);
    FinalHandler(io, socket);
    QuestionHandler(io, socket);
    PaperTopHandler(io, socket);
    MainCoverHandler(io, socket);

    // 選手データの更新の中継。形が違う値は配らない（Main の画面が壊れるのを防ぐ）
    socket.on('broadcast_scores', (allPlayers) => {
        if (!isPlayerList(allPlayers)) {
            console.log('broadcast_scores rejected');
            return;
        }
        io.emit('update_players', allPlayers);
    });

    // 操作を受けたら、すぐ後に保存する（ハンドラが状態を変え終わった後になるよう、少し待ってから）
    socket.onAny(() => store.scheduleSave());
}

module.exports = { registerHandlers, startPersistence, isPlayerList };
