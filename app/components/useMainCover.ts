// Main を覆う表示（待機画面・ブランク）を Main / Admin で読む・変えるための小さなフック（2026-11-04）
import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import type { MainCover } from "@/lib/mainCover";
import { NO_COVER } from "@/lib/mainCover";

export function useMainCover(socket: Socket | null): [MainCover, (next: MainCover) => void] {
    const [cover, setCover] = useState<MainCover>(NO_COVER);
    useEffect(() => {
        if (!socket) return;
        const onCover = (next: MainCover) => setCover(next);
        socket.on("update_main_cover", onCover);
        // 接続直後の配信はこの部品が無いうちに届いて失われることがあるので、表示した時点で取り直す
        socket.emit("request_main_cover_sync");
        return () => { socket.off("update_main_cover", onCover); };
    }, [socket]);
    const change = (next: MainCover) => { if (socket) socket.emit("change_main_cover", next); };
    return [cover, change];
}
