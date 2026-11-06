// Main のラウンドの画面を、必要なデータがそろうまで出さないためのフック（2026-11-06。同日、必須・任意に分けた）。
//
// 覆い（ブランク・待機画面）を外した瞬間にラウンドの画面がマウントされるが、サーバの状態や選手データは
// そのあとに届く。届くまでの間に既定の状態の画面が映らないよう、そろうまでは黒い舞台（BlankScreen）だけを出す。
//   const gate = useReadyGate(['state', 'players'], ['profiles']);   // 必須, 任意
//   gate.load('players', '/api/…', data => …)   … 成功するまで取り直す。成功したら自動で mark
//   gate.mark('state')                          … Socket で届いたもの
//   if (!gate.ready) return <BlankScreen />;
// ・必須がそろうまでは、どれだけ待っても出さない（勝手に既定の画面で進めない）。待っている状況は
//   MainReadyContext を通じてサーバに報告され、Admin に原因と対処が出る（lib/mainReadiness.js）。
// ・任意（写真・二つ名、大会名・ロゴ）は、届くか、Admin で「なしで進める」が許可されたら、そろったものとする。
//   'brand'（大会名・ロゴ。クイズ画面の見出し）は Main のページがまとめて読むので、ここでは読み込み済みかを見るだけ。
//   許可して出した後に届いたら、そのまま画面に入る。
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { MainReadyContext, loadJsonUntilOk } from "./Main/mainReadiness";

/** Main のページ（useMainReadinessHost）が読むデータ。画面ごとには登録しない */
const HOST_KEYS = ["brand"];

export type ReadyGate = {
    ready: boolean;
    mark: (key: string) => void;
    /** url を成功するまで取り直し、届いたら onData を呼んで mark する。戻り値は中止する関数 */
    load: (key: string, url: string, onData: (data: any) => void) => () => void;  // eslint-disable-line @typescript-eslint/no-explicit-any
};

export function useReadyGate(required: string[], optional: string[] = []): ReadyGate {
    const ctx = useContext(MainReadyContext);
    const [done, setDone] = useState<ReadonlySet<string>>(() => new Set());
    const doneRef = useRef(done);
    useEffect(() => { doneRef.current = done; }, [done]);
    const reqKey = required.join(",");
    const optKey = optional.join(",");
    const isRequired = useCallback((key: string) => !optKey.split(",").includes(key), [optKey]);
    const { setItem } = ctx;

    // 待っているものを登録する（画面を出す前から Admin に「準備中」と分かるように）
    useEffect(() => {
        const keys = [...(reqKey ? reqKey.split(",") : []), ...(optKey ? optKey.split(",") : [])].filter(k => !HOST_KEYS.includes(k));
        const now = Date.now();
        for (const k of keys) {
            if (!doneRef.current.has(k)) setItem(k, isRequired(k), { status: "loading", attempts: 0, startedAt: now });
        }
        return () => { for (const k of keys) setItem(k, isRequired(k), null); };
    }, [reqKey, optKey, isRequired, setItem]);

    const mark = useCallback((key: string) => {
        setDone(prev => (prev.has(key) ? prev : new Set(prev).add(key)));
        setItem(key, isRequired(key), { status: "ok", attempts: 1, startedAt: Date.now() });
    }, [isRequired, setItem]);

    const load = useCallback((key: string, url: string, onData: (data: any) => void) =>  // eslint-disable-line @typescript-eslint/no-explicit-any
        loadJsonUntilOk(url, (data) => { onData(data); mark(key); }, (s) => { if (s.status !== "ok") setItem(key, isRequired(key), s); }),
    [mark, isRequired, setItem]);

    const isDone = (k: string) => (k === "brand" ? ctx.brand.ready : done.has(k));
    const ready = required.every(isDone) && optional.every(k => isDone(k) || ctx.waived.has(k));
    return { ready, mark, load };
}
