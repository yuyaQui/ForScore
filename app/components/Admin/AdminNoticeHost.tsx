"use client";
// Admin 画面の上に出す通知と接続状態（2026-11-04）。lib/adminNotice.ts の notify() を受けて出す。
//   ・サーバとの接続が切れている間は、赤い帯を出し続ける（つながったら消える）
//   ・操作が断られた・失敗したときは、帯を数秒出す（OK を押す必要はない。操作を止めない）
import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { NOTICE_EVENT, type NoticeDetail } from "@/lib/adminNotice";

type Shown = NoticeDetail & { id: number };
const SHOW_MS = 7000;

export default function AdminNoticeHost({ socket }: { socket: Socket | null }) {
    const [connected, setConnected] = useState(true);
    const [items, setItems] = useState<Shown[]>([]);
    const nextId = useRef(1);
    const last = useRef<{ text: string; at: number }>({ text: "", at: 0 });

    useEffect(() => {
        if (!socket) return;
        const sync = () => setConnected(socket.connected);
        // 初期値の反映は、受け取り口を付けた直後に1回だけ
        const first = setTimeout(sync, 0);
        socket.on("connect", sync);
        socket.on("disconnect", sync);
        socket.on("connect_error", sync);
        return () => {
            clearTimeout(first);
            socket.off("connect", sync);
            socket.off("disconnect", sync);
            socket.off("connect_error", sync);
        };
    }, [socket]);

    useEffect(() => {
        const onNotice = (e: Event) => {
            const d = (e as CustomEvent<NoticeDetail>).detail;
            if (!d || typeof d.text !== "string") return;
            // 同じ文が続けて来たら（画面の複数の部品が同じ知らせを受けたとき）1つにまとめる
            const now = Date.now();
            if (last.current.text === d.text && now - last.current.at < 1500) return;
            last.current = { text: d.text, at: now };
            const id = nextId.current++;
            setItems((prev) => [...prev.slice(-2), { ...d, id }]);
            setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), SHOW_MS);
        };
        window.addEventListener(NOTICE_EVENT, onNotice);
        return () => window.removeEventListener(NOTICE_EVENT, onNotice);
    }, []);

    const base = { fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, fontSize: 15, lineHeight: 1.5 } as const;
    return (
        <div style={{ position: "fixed", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 1000, display: "flex", flexDirection: "column", gap: 6, width: "min(760px, calc(100vw - 24px))", pointerEvents: "none" }}>
            {!connected && (
                <div role="alert" style={{ ...base, padding: "12px 16px", background: "#7A1626", border: "2px solid #FF6B81", borderRadius: 8, color: "#fff", pointerEvents: "auto" }}>
                    サーバとの接続が切れています。つながるまで操作は送られません。つながると自動で最新の状態に更新されます。
                </div>
            )}
            {items.map((n) => (
                <div key={n.id} role={n.tone === "error" ? "alert" : "status"}
                    style={{ ...base, padding: "10px 14px", background: n.tone === "error" ? "#3A2A0B" : "#0B2236", border: `2px solid ${n.tone === "error" ? "#F4B23E" : "#3CC8F2"}`, borderRadius: 8, color: "#fff", pointerEvents: "auto", cursor: "pointer" }}
                    onClick={() => setItems((prev) => prev.filter((x) => x.id !== n.id))}>
                    {n.text}
                </div>
            ))}
        </div>
    );
}
