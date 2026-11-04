// 結合テストの道具: サーバを別プロセスで起動・停止し、Socket.IO のクライアントを作る。
const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { io } = require("socket.io-client");

/** サーバを起動する。stateFile を同じにして起動し直すと、保存された進行状態が戻る（再起動の再現） */
function startServer(stateFile) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, "testServer.js")], {
            env: { ...process.env, KQK_STATE_FILE: stateFile },
            stdio: ["ignore", "pipe", "pipe"],
        });
        const server = { child, port: 0, crashed: null, log: [] };
        let buf = "";
        child.stdout.on("data", (d) => {
            buf += d.toString();
            for (const line of buf.split("\n")) {
                if (line.startsWith("READY ") && !server.port) {
                    server.port = Number(line.slice(6));
                    resolve(server);
                }
                if (line.startsWith("CRASH ")) server.crashed = line;
            }
        });
        child.stderr.on("data", (d) => server.log.push(d.toString()));
        child.on("exit", (code) => { server.exited = code; });
        child.on("error", reject);
        setTimeout(() => reject(new Error("サーバが起動しません")), 8000).unref();
    });
}

function stopServer(server, signal = "SIGTERM") {
    return new Promise((resolve) => {
        if (server.exited !== undefined) return resolve();
        server.child.once("exit", () => resolve());
        server.child.kill(signal);
    });
}

function tmpStateFile() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kqk-state-"));
    return path.join(dir, "server-state.json");
}

/** クライアント。受け取った全イベントを履歴に残し、次のイベントを待つ道具を付ける */
function connect(server) {
    return new Promise((resolve, reject) => {
        const socket = io(`http://127.0.0.1:${server.port}`, { transports: ["websocket"], forceNew: true, reconnection: false });
        const events = [];
        const waiters = [];
        socket.onAny((name, ...args) => {
            const entry = { name, args, at: events.length };
            events.push(entry);
            for (const w of waiters.slice()) {
                if (w.name === name && (!w.pred || w.pred(...args))) {
                    waiters.splice(waiters.indexOf(w), 1);
                    clearTimeout(w.timer);
                    w.resolve(args[0]);
                }
            }
        });
        const client = {
            socket,
            events,
            /** 次に来るその名前のイベント（pred が真になるもの）の最初の引数 */
            next(name, pred, ms = 2000) {
                return new Promise((res, rej) => {
                    const w = { name, pred, resolve: res };
                    w.timer = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); rej(new Error(`${name} が来ません`)); }, ms);
                    waiters.push(w);
                });
            },
            /** これまでに受け取った中で、その名前の最後の値 */
            last(name) {
                for (let i = events.length - 1; i >= 0; i--) if (events[i].name === name) return events[i].args[0];
                return undefined;
            },
            count(name) { return events.filter(e => e.name === name).length; },
            emit(name, payload) { socket.emit(name, payload); },
            close() { socket.close(); },
        };
        socket.on("connect", () => resolve(client));
        socket.on("connect_error", reject);
    });
}

/**
 * このクライアントがそれまでに送った操作を、サーバが処理し終えるのを待つ（確認応答の往復）。
 * 他のクライアントへの配信も、その後に自分の settle を呼べば受け取り済みになる
 */
function settle(client) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("サーバから応答がありません")), 4000);
        client.socket.emit("test_ping", () => { clearTimeout(timer); resolve(); });
    });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = { startServer, stopServer, tmpStateFile, connect, settle, sleep };
