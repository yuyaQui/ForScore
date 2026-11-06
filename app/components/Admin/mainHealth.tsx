"use client";
// Admin で、Main の表示の準備の状況を見る・対処する（2026-11-06 ユーザー承認。決まりは lib/mainReadiness.js）。
//   ・useMainHealthSource … admin/page.tsx が1つ持ち、MainHealthContext で配る
//   ・useMainHealth       … 各部品が読む（useMainCover は block を見て、覆いを外すボタンを止める）
//   ・MainHealthPanel     … 問題があるときだけ、上のバーの下に「原因」と「対処」とボタンを出す（ConsoleFrame が置く）
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Socket } from "socket.io-client";
import styles from "./console/console.module.css";

export type MainProblem = {
    id: string;
    short: string;
    title: string;
    cause: string;
    action: string;
    buttons: { kind: "retry" | "reload" | "waive"; key?: string; label: string }[];
};
export type MainReadiness = {
    level: "ok" | "wait" | "problem";
    /** 覆いを外せない理由（短い言葉）。null なら外してよい */
    block: string | null;
    problems: MainProblem[];
    mains: number;
};

type Health = {
    readiness: MainReadiness | null;
    retry: () => void;
    reload: () => void;
    waive: (key: string) => void;
};

const MainHealthContext = createContext<Health | null>(null);
export const MainHealthProvider = MainHealthContext.Provider;

/** admin/page.tsx が1つ持つ */
export function useMainHealthSource(socket: Socket | null): Health {
    const [readiness, setReadiness] = useState<MainReadiness | null>(null);
    useEffect(() => {
        if (!socket) return;
        const onUpdate = (r: MainReadiness) => setReadiness(r);
        const sync = () => socket.emit("request_main_readiness_sync");
        socket.on("update_main_readiness", onUpdate);
        socket.on("connect", sync);
        sync();
        return () => {
            socket.off("update_main_readiness", onUpdate);
            socket.off("connect", sync);
        };
    }, [socket]);
    const retry = useCallback(() => { socket?.emit("main_retry_now"); }, [socket]);
    const reload = useCallback(() => {
        if (window.confirm("Main の画面を読み込み直します。数秒のあいだ会場の画面が黒くなります。よろしいですか？")) socket?.emit("main_reload");
    }, [socket]);
    const waive = useCallback((key: string) => { socket?.emit("main_waive", { key }); }, [socket]);
    return useMemo(() => ({ readiness, retry, reload, waive }), [readiness, retry, reload, waive]);
}

/** Main の準備の状況。Admin の外（Main の画面）では null */
export function useMainHealth(): Health | null {
    return useContext(MainHealthContext);
}

/**
 * 覆いを外せない理由。サーバから状況がまだ届いていないときも外させない（確かめられないため）。
 * Admin の外（Main の画面）では null
 */
export function useMainBlock(): string | null {
    const h = useContext(MainHealthContext);
    if (!h) return null;
    if (!h.readiness) return "Main の状況を確認中…";
    return h.readiness.block;
}

/** 問題があるときだけ出す帯（原因と対処）。ConsoleFrame が上のバーの下に置く */
export function MainHealthPanel() {
    const h = useContext(MainHealthContext);
    const problems = h?.readiness?.problems ?? [];
    if (!h || problems.length === 0) return null;
    const shown = problems.slice(0, 3);
    return (
        <section className={styles.health} role="alert" aria-label="Main の表示の問題">
            {shown.map(p => (
                <div key={p.id} className={styles.healthItem}>
                    <div className={styles.healthText}>
                        <b className={styles.healthTitle}>{p.title}</b>
                        <span><em>原因</em>{p.cause}</span>
                        <span><em>対処</em>{p.action}</span>
                    </div>
                    <div className={styles.healthBtns}>
                        {p.buttons.map(b => (
                            <button key={b.kind + (b.key ?? "")} type="button"
                                className={b.kind === "waive" ? styles.healthWaive : styles.btn}
                                onClick={() => (b.kind === "retry" ? h.retry() : b.kind === "reload" ? h.reload() : h.waive(b.key ?? ""))}>
                                {b.label}
                            </button>
                        ))}
                    </div>
                </div>
            ))}
            {problems.length > shown.length && <div className={styles.healthMore}>ほか {problems.length - shown.length}件</div>}
        </section>
    );
}
