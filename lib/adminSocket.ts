// Admin 用の Socket（2026-11-04）。通常の socket.io-client の Socket に、次の1点だけ足す。
//
//   つながっていない間の「操作」は、送らずに捨てて、画面に知らせる。
//
// 理由: socket.io-client は、切断中に emit した内容をためておき、つながり直した瞬間にまとめて送る。
// 運営者が「押しても何も起きない」と思って押し直した分も、つながった瞬間に全部実行され、
// 採点が二重に入ったり、画面が何段も進んだりする。操作は「今つながっているときだけ」効くのが安全。
// 状態の取り直し(request_*)は何度送っても害がないので、ためてよい。
import { io, type Socket } from 'socket.io-client';
import { notify } from './adminNotice';

const READ_ONLY = /^request_/;

export function createAdminSocket(): Socket {
    const socket = io();
    const rawEmit = socket.emit.bind(socket) as (ev: string, ...args: unknown[]) => Socket;
    // emit を差し替える（型は socket.io の定義が厳密なので、この1か所だけ緩める）
    (socket as unknown as { emit: (ev: string, ...args: unknown[]) => Socket }).emit = (ev, ...args) => {
        if (!socket.connected && !READ_ONLY.test(ev)) {
            notify('サーバと接続できていないため、この操作は送られませんでした。接続が戻ってから、画面を確かめてもう一度操作してください。', 'error');
            return socket;
        }
        return rawEmit(ev, ...args);
    };
    return socket;
}
