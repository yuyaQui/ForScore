// サーバが持つ進行状態を「表示した時点」と「つなぎ直した時点」で必ず取り直すフック（2026-11-04）。
//
// 背景: サーバは接続した瞬間に現在の状態を送るが、その時点でその画面（2nd Round の Main など）がまだ
// 表示されていないと受け取れずに失われる。待機画面で覆われている間はラウンドの画面が作られないため、
// 覆いを外した瞬間に画面が初期値（1組目など）で描かれてしまっていた。
// 画面が表示されたら、サーバへ「今の状態をください」(request_*) を送る。つなぎ直したときも送り直す。
// request_* は読み取りだけで、何度送っても状態は変わらない。
import { useEffect } from "react";
import type { Socket } from "socket.io-client";

export function useSocketSync(socket: Socket | null, requests: readonly string[]) {
    const key = requests.join("|");
    useEffect(() => {
        if (!socket) return;
        const names = key.split("|").filter(Boolean);
        const send = () => names.forEach((name) => socket.emit(name));
        send();
        socket.on("connect", send);
        return () => { socket.off("connect", send); };
    }, [socket, key]);
}
