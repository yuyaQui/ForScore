// Main を覆う表示（待機画面・ブランク）を Main / Admin で読む・変えるための小さなフック（2026-11-04）
//
// 覆いの持ち主はサーバ（server/MainCoverHandler.js）。ここでは受け取った覆い（版つき）を持ち、
// 変えるときは「自分が見ていた版」を添えて要求する。遷移の決まりは lib/coverFlow.js（サーバと共通）。
//   [cover, setCover, controls]
//     cover    … いまの覆い（rev つき）
//     setCover … 覆いを変える要求。サーバが断ったら、画面の上に理由を出して、最新の覆いに更新される
//     controls.forceRelease … 強制解除。どんな覆いでも外して本編に戻す（行き止まりの脱出口）
//
// 二度押しの防止: 覆いが変わった直後(COOLDOWN_MS)の要求は捨てる。覆いを変えると進行ボタンの意味が
// 次の手順に変わるので、二度押しが「次の手順」まで実行してしまう（待機画面を飛ばす等）のを防ぐ。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import type { CoverTarget, MainCover } from "@/lib/mainCover";
import { INITIAL_COVER } from "@/lib/mainCover";
import { notify } from "@/lib/adminNotice";
import { useMainBlock } from "./Admin/mainHealth";

const COOLDOWN_MS = 450;

/**
 * mainBlock … Main の準備ができていないとき、その理由（Admin だけ。lib/mainReadiness.js）。
 *             あるあいだは、覆いを外す進行ボタンを押せない（coverStartPrimary）
 */
export type AdminCover = MainCover & { mainBlock: string | null };

export function useMainCover(socket: Socket | null): [AdminCover, (next: CoverTarget) => void, { forceRelease: () => void }] {
    const [cover, setCover] = useState<MainCover>(INITIAL_COVER);
    const revRef = useRef(0);
    const changedAt = useRef(0);

    useEffect(() => {
        if (!socket) return;
        const onCover = (next: MainCover) => {
            if (next.rev !== revRef.current) changedAt.current = Date.now();
            revRef.current = next.rev;
            setCover(next);
        };
        const onRejected = (info: { reason?: string }) => {
            notify(
                info && info.reason === "stale"
                    ? "別の操作が先に行われていたため、この操作は実行せず、画面を最新の状態に更新しました。表示を確かめてからもう一度操作してください。"
                    : "この操作は今の状態では行えません。画面を最新の状態に更新しました。",
                "error"
            );
        };
        socket.on("update_main_cover", onCover);
        socket.on("main_cover_rejected", onRejected);
        // 接続直後の配信はこの部品が無いうちに届いて失われることがあるので、表示した時点とつなぎ直したときに取り直す
        const sync = () => socket.emit("request_main_cover_sync");
        sync();
        socket.on("connect", sync);
        return () => {
            socket.off("update_main_cover", onCover);
            socket.off("main_cover_rejected", onRejected);
            socket.off("connect", sync);
        };
    }, [socket]);

    const change = useCallback((next: CoverTarget) => {
        if (!socket) return;
        if (Date.now() - changedAt.current < COOLDOWN_MS) return;   // 二度押し
        socket.emit("change_main_cover", { cover: next, expectRev: revRef.current });
    }, [socket]);

    const forceRelease = useCallback(() => {
        if (!socket) return;
        socket.emit("change_main_cover", { force: true, expectRev: revRef.current });
    }, [socket]);

    const mainBlock = useMainBlock();
    const withBlock = useMemo(() => ({ ...cover, mainBlock }), [cover, mainBlock]);
    return [withBlock, change, { forceRelease }];
}
