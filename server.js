// 1. 必要なモジュール（部品）を読み込む
const { createServer } = require('http');     // HTTP 通信
const { parse } = require('url');             // URLを解析するための標準機能
const next = require('next');                 // Next.jsの本体
const { Server } = require('socket.io');      // リアルタイム通信をするためのSocket.io

// 2. サーバーの設定
const dev = process.env.NODE_ENV !== 'production'; // 開発環境かどうかを判定
const hostname = 'localhost';                      // ホスト名
const port = process.env.PORT || 3000;             // ポート番号（デフォルトは3000）

// 3. Next.jsの準備
const app = next({ dev });
const handle = app.getRequestHandler(); // 通常のWebアクセスを処理するNext.jsのハンドラー

// module の読み込み
const firstRoundHandlers = require("./server/FirstRoundHandler");
const registerTextHandlers = require("./server/TextHandler");
const ModeHandler = require("./server/ModeHandler");
const ThirdRoundHandler = require("./server/ThirdRoundHandler");
const ExtraRoundHandler = require("./server/ExtraRoundHandler");
const SemifinalHandler = require("./server/SemifinalHandler");
const FinalHandler = require("./server/FinalHandler");

// 4. アプリケーションの立ち上げ処理
console.log("Next.jsを起動しています。しばらくお待ちください");
app.prepare().then(() => {

    // HTTPサーバー
    const httpServer = createServer((req, res) => {
        try {
            const parsedUrl = parse(req.url, true);     // アクセスされたURLを解析
            handle(req, res, parsedUrl);                // URLの処理をNext.jsに丸投げする（これで画面が表示される）
        } catch (err) {
            console.error('Error occurred handling', req.url, err);
            res.statusCode = 500;
            res.end('internal server error');
        }
    });

    // HTTPサーバーの上に、Socket.ioのサーバーを相乗りさせる
    const io = new Server(httpServer, {
        cors: {
            origin: "*",                // どこからの通信でも許可する設定
            methods: ["GET", "POST"]    // 許可する通信メソッド
        }
    });

    // 【C】Socket.ioの通信イベント（やり取り）の定義
    // 'connection' はクライアント（ブラウザ）が繋がってきた時に呼ばれる
    io.on('connection', (socket) => {
        console.log('A client connected:', socket.id); // 繋がったユーザーのIDを表示

        // 各部品に、通信の処理を丸投げ
        firstRoundHandlers(io, socket);
        registerTextHandlers(io, socket);
        ModeHandler(io, socket);
        ThirdRoundHandler(io, socket);
        ExtraRoundHandler(io, socket);
        SemifinalHandler(io, socket);
        FinalHandler(io, socket);

        socket.on('broadcast_scores', (allPlayers) => {
            io.emit('update_players', allPlayers);
        });
        socket.on('disconnect', () => {
            console.log('A client disconnected:', socket.id);
        });
    });

    // 【D】サーバーを起動して待ち受け開始
    httpServer
        .once('error', (err) => {
            console.error(err);
            process.exit(1); // エラーが起きたら強制終了
        })
        .listen(port, () => {
            console.log(`> Ready on http://${hostname}:${port}`); // ここのポートで待っとるよ
        });
});