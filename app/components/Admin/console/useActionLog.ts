// 運営コンソールの「操作の記録」（2026-10-31 ユーザー承認。改善案 Step 1）。
// この Admin の画面の中だけで持つ（再読み込みで消える。サーバ・DB は変えない）。
// Undo ボタンに「何が取り消されるか」を出すのと、直前の数手を見返すのに使う。
import { useCallback, useState } from "react";

export type ActionTone = 'ok' | 'ng' | 'through' | 'undo' | 'other';

export type ActionEntry = {
    id: number;
    /** 記録した時刻（HH:MM） */
    time: string;
    /** 誰の操作か（スルーなどは空） */
    who: string;
    /** 何をしたか（例「正解（勝ち抜け）」） */
    what: string;
    tone: ActionTone;
    /** Undo の単位（2nd Round は組 `g2` など）。Undo はこの単位で最後の操作を戻す */
    scope: string;
    /** Undo で取り消されたか */
    undone?: boolean;
};

const LOG_MAX = 40;
let nextId = 1;

function hhmm(d: Date): string {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function useActionLog() {
    const [entries, setEntries] = useState<ActionEntry[]>([]);

    /** 操作を1つ記録する（新しい順に並べる） */
    const add = useCallback((entry: Omit<ActionEntry, 'id' | 'time'>) => {
        const row = { ...entry, id: nextId++, time: hhmm(new Date()) };
        setEntries(prev => [row, ...prev].slice(0, LOG_MAX));
    }, []);

    /** Undo が成功したら、その単位の最後の操作に「取り消し」を付け、取り消しの行を足す */
    const markUndone = useCallback((scope: string) => {
        const id = nextId++;
        const time = hhmm(new Date());
        setEntries(prev => {
            const idx = prev.findIndex(e => e.scope === scope && e.tone !== 'undo' && !e.undone);
            const target = idx >= 0 ? prev[idx] : null;
            const marked = prev.map((e, i) => i === idx ? { ...e, undone: true } : e);
            const row: ActionEntry = { id, time, who: target?.who ?? '', what: target ? `取り消し（${target.what}）` : '取り消し', tone: 'undo', scope };
            return [row, ...marked].slice(0, LOG_MAX);
        });
    }, []);

    /** Undo ボタンに出す説明。その単位でまだ取り消していない最後の操作 */
    const lastLabel = useCallback((scope: string): string | null => {
        const e = entries.find(x => x.scope === scope && x.tone !== 'undo' && !x.undone);
        if (!e) return null;
        return `直前: ${e.who ? `${e.who} ` : ''}${e.what}`;
    }, [entries]);

    return { entries, add, markUndone, lastLabel };
}
