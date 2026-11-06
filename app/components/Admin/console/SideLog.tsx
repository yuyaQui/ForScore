// 右の列（操作の記録だけ）。問題を出さない画面（1st Round のタイマー・名簿取り込み）で使う。
// 問題欄のあるラウンドは ConsoleSide を使う。
import type { ReactNode } from "react";
import type { ActionEntry } from "./useActionLog";
import styles from "./console.module.css";

const TONE_CLASS: Record<ActionEntry['tone'], string> = {
    ok: styles.toneOk, ng: styles.toneNg, through: '', undo: styles.toneUndo, other: '',
};
const TONE_MARK: Record<ActionEntry['tone'], string> = { ok: '○', ng: '×', through: '—', undo: '↶', other: '·' };

export function SideLog({ log, empty, children }: { log: ActionEntry[]; empty: string; children?: ReactNode }) {
    return (
        <>
            {children}
            <div className={styles.log}>
                <h3 className={styles.sideTitle} style={{ marginBottom: 6 }}>操作ログ（新着順）</h3>
                {log.length === 0 && <div className={styles.logEmpty}>{empty}</div>}
                {log.slice(0, 8).map(e => (
                    <div key={e.id} className={styles.logRow} style={e.undone ? { opacity: .45, textDecoration: 'line-through' } : undefined}>
                        <em>{e.time}</em>
                        <span>{e.who && <b>{e.who} </b>}{e.what}</span>
                        <span className={TONE_CLASS[e.tone]}>{TONE_MARK[e.tone]}</span>
                    </div>
                ))}
            </div>
        </>
    );
}
