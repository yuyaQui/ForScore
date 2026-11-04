// 「処理中は次の操作を受け付けない」ためのフック（2026-11-04）。
//
// 採点・Undo・リセットは、API の応答を待ってから結果を配り、問題を進める。応答が遅いときに運営者が
// 「効いていない？」と押し直すと、同じ採点が2回入り、問題も2つ進んでいた。
// run() に渡した処理が終わるまで、次の run() は何もしない（捨てる）。採点と Undo のように、
// 種類の違う操作が同時に走るのも防ぐ（同じ useSingleFlight を共有する）。
import { useCallback, useRef, useState } from "react";

export function useSingleFlight() {
    const busyRef = useRef(false);
    const [pending, setPending] = useState(false);
    const run = useCallback(async <T,>(task: () => Promise<T>): Promise<T | undefined> => {
        if (busyRef.current) return undefined;
        busyRef.current = true;
        setPending(true);
        try {
            return await task();
        } finally {
            busyRef.current = false;
            setPending(false);
        }
    }, []);
    return { run, pending };
}
