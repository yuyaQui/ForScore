// 結合テスト用のサーバ。本番の server.js と同じハンドラ登録（server/registerHandlers.js）を使い、Next.js だけ省く。
// 環境変数: KQK_STATE_FILE … 進行状態の保存先（テストごとに別の一時ファイル）
// 起動すると標準出力に "READY <ポート番号>" を1行出す。
const { createServer } = require("http");
const { Server } = require("socket.io");
const { registerHandlers, startPersistence } = require("../../server/registerHandlers");

startPersistence();
const httpServer = createServer();
const io = new Server(httpServer, { cors: { origin: "*" } });
io.on("connection", (socket) => {
    registerHandlers(io, socket);
    // テスト専用: これより前に届いた操作をすべて処理し終えたことを、確認応答で知らせる
    socket.on("test_ping", (ack) => { if (typeof ack === "function") ack(); });
});
httpServer.listen(0, "127.0.0.1", () => {
    console.log(`READY ${httpServer.address().port}`);
});
process.on("uncaughtException", (err) => {
    console.log(`CRASH ${err && err.stack ? err.stack.split("\n").slice(0, 3).join(" | ") : err}`);
    process.exit(1);
});
