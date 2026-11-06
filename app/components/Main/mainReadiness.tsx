"use client";
// Main の「表示の準備」の仕組み（2026-11-06 ユーザー承認）。決まりは lib/mainReadiness.js。
//
//   ・loadJsonUntilOk … API を、成功するまで間隔を広げながら取り直し続ける（1→2→4→5秒…）。
//                       Admin の［再取得］が届いたら、待たずにすぐ取り直す（retryAllNow）。
//   ・useMainReadinessHost … Main のページ（app/main/page.tsx）が1つ持つ。
//       - 各画面が「何を待っているか」を集めて、サーバに報告する（変わったときと3秒ごと）
//       - 覆っている間に、そのラウンドの API を先に確かめる（覆いを外せるかの判断に使う）
//       - Admin の［再取得］［Main を再読み込み］と、「任意のデータなしで進める」の許可を受け取る
//   ・MainReadyContext … 上の情報を各画面の useReadyGate に渡す
import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { MAIN_BRAND_MODES, MAIN_OPTIONAL_KEYS, MAIN_PREFLIGHT, REPORT_INTERVAL_MS } from "../../../lib/mainReadiness.js";
import { logoUrl, type TournamentLogoInfo } from "@/lib/tournamentLogo";

export type ItemStatus = { status: "loading" | "error" | "ok"; error?: string | null; attempts: number; startedAt: number };

/**
 * クイズ画面の下部に出す大会名・大会ロゴ（2026-11-06。11-07 に見出しの中央から下部へ）。
 * ready … 読み込みが終わったか（ロゴは画像の展開まで終えてから true。画面が出てからロゴだけ遅れて出ないように）
 */
export type MainBrand = { ready: boolean; name: string; logo: TournamentLogoInfo | null };
const NO_BRAND: MainBrand = { ready: false, name: "", logo: null };

export type MainReadyCtx = {
    /** 大会名・大会ロゴ（クイズ画面の見出し） */
    brand: MainBrand;
    /** 運営者が「なしで進める」を許可した任意のデータ（いまのモードの分だけ） */
    waived: ReadonlySet<string>;
    /** 待っているデータの状況を登録する。null で取り消し */
    setItem: (key: string, required: boolean, s: ItemStatus | null) => void;
};

const NO_WAIVERS: ReadonlySet<string> = new Set();
export const MainReadyContext = createContext<MainReadyCtx>({ brand: NO_BRAND, waived: NO_WAIVERS, setItem: () => {} });

// ---- 成功するまで取り直す ----
const kicks = new Set<() => void>();
/** 取り直しを待っているものを、すぐ取り直させる（Admin の［再取得］） */
export function retryAllNow() {
    for (const k of [...kicks]) k();
}

/** 1回の取得の待ち時間の上限。応答がないまま止まらないようにする */
const FETCH_TIMEOUT_MS = 8000;

/**
 * url を、成功する（HTTP 200 で success: true）まで取り直し続ける。戻り値は中止する関数。
 * 状況は onStatus で知らせる（取り直しの間も、最後の失敗の理由を持ったまま 'error' にしておく）。
 */
export function loadJsonUntilOk(
    url: string,
    onOk: (data: unknown) => void,
    onStatus: (s: ItemStatus) => void,
): () => void {
    let cancelled = false;
    let attempts = 0;
    let wake: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ctrl: AbortController | null = null;
    const startedAt = Date.now();
    let lastError: string | null = null;

    const run = async () => {
        while (!cancelled) {
            attempts++;
            onStatus({ status: lastError ? "error" : "loading", error: lastError, attempts: attempts - 1, startedAt });
            ctrl = new AbortController();
            const abortTimer = setTimeout(() => ctrl?.abort(), FETCH_TIMEOUT_MS);
            try {
                const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
                if (!res.ok) throw new Error(`サーバの応答 ${res.status}`);
                let data: { success?: boolean; error?: string } | null;
                try { data = await res.json(); } catch { throw new Error("サーバの応答の形が正しくありません"); }
                if (!data || data.success !== true) throw new Error(data && data.error ? `サーバのエラー: ${data.error}` : "サーバが失敗を返しました");
                clearTimeout(abortTimer);
                if (cancelled) return;
                onStatus({ status: "ok", attempts, startedAt });
                onOk(data);
                return;
            } catch (e) {
                clearTimeout(abortTimer);
                if (cancelled) return;
                const aborted = e instanceof DOMException && e.name === "AbortError";
                lastError = aborted ? `${FETCH_TIMEOUT_MS / 1000}秒待っても応答がありません`
                    : e instanceof TypeError ? "通信エラー。サーバに届きません"
                    : e instanceof Error ? e.message : "不明なエラー";
                console.error(`Failed to load ${url}:`, lastError);
                onStatus({ status: "error", error: lastError, attempts, startedAt });
            }
            const delay = Math.min(1000 * 2 ** (attempts - 1), 5000);
            await new Promise<void>((resolve) => {
                wake = resolve;
                kicks.add(resolve);
                timer = setTimeout(resolve, delay);
            });
            if (wake) kicks.delete(wake);
            if (timer) clearTimeout(timer);
        }
    };
    void run();
    return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
        ctrl?.abort();
        if (wake) { kicks.delete(wake); (wake as () => void)(); }
    };
}

type Entry = { required: boolean } & ItemStatus;
type Readiness = { waivers?: { mode: string | null; keys: string[] } };
/** 誰が登録したか。覆っている間の先の確認（preflight）と、表示中の画面（screen）。同じデータは画面の方を使う */
type Owner = "preflight" | "screen" | "brand";

/** Main のページが1つ持つ。戻り値を MainReadyContext.Provider に渡す */
export function useMainReadinessHost(socket: Socket | null, mode: string, covered: boolean): MainReadyCtx {
    const entries = useRef<Record<Owner, Map<string, Entry>>>({ preflight: new Map(), screen: new Map(), brand: new Map() });
    const modeRef = useRef(mode);
    const [waived, setWaived] = useState<ReadonlySet<string>>(NO_WAIVERS);
    const lastWaivers = useRef<{ mode: string | null; keys: string[] }>({ mode: null, keys: [] });
    const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const send = useCallback(() => {
        if (!socket || !socket.connected) return;
        const now = Date.now();
        const merged = new Map([...entries.current.preflight, ...entries.current.brand]);
        for (const [k, e] of entries.current.screen) merged.set(k, e);
        const items = [...merged.entries()].map(([key, e]) => ({
            key, required: e.required, status: e.status, error: e.error ?? null, attempts: e.attempts,
            waitMs: e.status === "ok" ? 0 : Math.max(0, now - e.startedAt),
        }));
        // hidden … 別のタブ・最小化で見えていない（ブラウザが報告の間隔を延ばすので、応答なしと区別する）
        socket.emit("main_ready_report", { mode: modeRef.current, items, hidden: document.hidden });
    }, [socket]);

    const scheduleSend = useCallback(() => {
        if (sendTimer.current) return;
        sendTimer.current = setTimeout(() => { sendTimer.current = null; send(); }, 60);
    }, [send]);

    const setOwned = useCallback((owner: Owner, key: string, required: boolean, s: ItemStatus | null) => {
        if (s === null) entries.current[owner].delete(key);
        else entries.current[owner].set(key, { required, ...s });
        scheduleSend();
    }, [scheduleSend]);
    const setItem = useCallback((key: string, required: boolean, s: ItemStatus | null) => setOwned("screen", key, required, s), [setOwned]);

    const applyWaivers = useCallback(() => {
        const w = lastWaivers.current;
        const keys = w.mode === modeRef.current ? w.keys : [];
        setWaived(prev => (prev.size === keys.length && keys.every(k => prev.has(k)) ? prev : new Set(keys)));
    }, []);

    // モードが変わったら、許可を選び直して報告し直す
    useEffect(() => {
        modeRef.current = mode;
        applyWaivers();
        scheduleSend();
    }, [mode, applyWaivers, scheduleSend]);

    // サーバとのやり取り
    useEffect(() => {
        if (!socket) return;
        const onReadiness = (r: Readiness) => {
            if (r && r.waivers) lastWaivers.current = r.waivers;
            applyWaivers();
        };
        const onRetry = () => retryAllNow();
        const onReload = () => window.location.reload();
        socket.on("update_main_readiness", onReadiness);
        socket.on("main_retry_now", onRetry);
        socket.on("main_reload", onReload);
        socket.on("connect", send);
        document.addEventListener("visibilitychange", send);
        socket.emit("request_main_readiness_sync");
        send();
        const beat = setInterval(send, REPORT_INTERVAL_MS);
        return () => {
            clearInterval(beat);
            socket.off("update_main_readiness", onReadiness);
            socket.off("main_retry_now", onRetry);
            socket.off("main_reload", onReload);
            socket.off("connect", send);
            document.removeEventListener("visibilitychange", send);
        };
    }, [socket, send, applyWaivers]);

    // 覆っている間に、そのラウンドの API を先に確かめる。覆いを外すと、各画面が自分で読み込んで報告する
    useEffect(() => {
        const needs: { key: string; url: string }[] = covered ? (MAIN_PREFLIGHT as Record<string, { key: string; url: string }[]>)[mode] ?? [] : [];
        const optional = MAIN_OPTIONAL_KEYS as string[];
        const cancels = needs.map(n => loadJsonUntilOk(n.url, () => {}, s => setOwned("preflight", n.key, !optional.includes(n.key), s)));
        const preflight = entries.current.preflight;
        return () => {
            cancels.forEach(c => c());
            preflight.clear();
            scheduleSend();
        };
    }, [covered, mode, setOwned, scheduleSend]);

    useEffect(() => () => { if (sendTimer.current) clearTimeout(sendTimer.current); }, []);

    // ---- 大会名・大会ロゴ（クイズ画面の見出し。2026-11-06）----
    // クイズ画面のモードの間だけ読む（覆っている間も読むので、覆いを外す前に Admin が状況を知れる）。
    // 任意のデータ: 読めなくても Admin で「なしで進める」を許可すれば画面を出せる。
    // 変わった合図（update_tournament_state）で読み直し、新しいロゴは展開を終えてから差し替える。
    const [brand, setBrand] = useState<MainBrand>(NO_BRAND);
    const [brandTick, setBrandTick] = useState(0);
    const brandMode = (MAIN_BRAND_MODES as string[]).includes(mode);
    useEffect(() => {
        if (!socket) return;
        const bump = () => setBrandTick(t => t + 1);
        socket.on("update_tournament_state", bump);
        return () => { socket.off("update_tournament_state", bump); };
    }, [socket]);
    useEffect(() => {
        const brandEntries = entries.current.brand;
        if (!brandMode) { brandEntries.clear(); scheduleSend(); return; }
        let alive = true;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        const report = (s: ItemStatus) => setOwned("brand", "brand", false, s);
        const stop = loadJsonUntilOk("/api/tournamentState", (data) => {
            const st = (data as { state?: { tournamentName?: unknown; logo?: TournamentLogoInfo | null } }).state ?? {};
            const name = typeof st.tournamentName === "string" ? st.tournamentName : "";
            const logo = st.logo && st.logo.version ? st.logo : null;
            if (!logo) { setBrand({ ready: true, name, logo: null }); return; }
            // ロゴは画像を読み込んで展開し終えてから出す
            const startedAt = Date.now();
            report({ status: "loading", attempts: 1, startedAt });
            const img = new Image();
            img.src = logoUrl(logo);
            img.decode().then(() => {
                if (!alive) return;
                report({ status: "ok", attempts: 1, startedAt });
                setBrand({ ready: true, name, logo });
            }).catch(() => {
                if (!alive) return;
                report({ status: "error", error: "大会ロゴの画像を読み込めません", attempts: 1, startedAt: Date.now() });
                // 少し待って（または［再取得］で）最初から読み直す
                retryTimer = setTimeout(() => setBrandTick(t => t + 1), 5000);
            });
        }, report);
        return () => {
            alive = false;
            stop();
            if (retryTimer) clearTimeout(retryTimer);
        };
    }, [brandMode, brandTick, setOwned, scheduleSend]);
    // ［再取得］が来たら大会名・ロゴも読み直す
    useEffect(() => {
        if (!socket) return;
        const bump = () => setBrandTick(t => t + 1);
        socket.on("main_retry_now", bump);
        return () => { socket.off("main_retry_now", bump); };
    }, [socket]);

    return useMemo(() => ({ brand, waived, setItem }), [brand, waived, setItem]);
}
