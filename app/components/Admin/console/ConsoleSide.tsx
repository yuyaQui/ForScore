// 運営コンソールの右の列（2026-10-31）。Main に出ている問題の確認、問題番号の手動操作、操作の記録、ルール。
// 「次に読む問題」（水色・採点面の上）と取り違えないよう、Main に表示中の問題は黄色の枠で出す。
import { Socket } from "socket.io-client";
import { useState } from "react";
import type { ReactNode } from "react";
import type { QuestionDisplayState, QuestionRound } from "@/lib/types";
import { useQuestion } from "../AdminQuestionPanel";
import type { ActionEntry } from "./useActionLog";
import styles from "./console.module.css";

const TONE_CLASS: Record<ActionEntry['tone'], string> = {
    ok: styles.toneOk, ng: styles.toneNg, through: '', undo: styles.toneUndo, other: '',
};
const TONE_MARK: Record<ActionEntry['tone'], string> = { ok: '○', ng: '×', through: '—', undo: '↶', other: '·' };

/** 全角数字も受け付けて、1以上の整数なら返す */
function parseSerial(text: string): number | null {
    const v = Number(text.trim().replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
    return Number.isInteger(v) && v >= 1 ? v : null;
}

export function ConsoleSide({ socket, round, state, log, rules, children }: {
    socket: Socket | null;
    /** 問題表示を使わない画面（ターンオーバーなど）でも Main の問題は確認できるよう、ラウンドは渡す */
    round: QuestionRound;
    state: QuestionDisplayState;
    log: ActionEntry[];
    rules?: ReactNode;
    /** 列の上に足す物 */
    children?: ReactNode;
}) {
    const cursor = state.cursors[round] ?? null;
    const shownHere = state.round === round ? state.serial : null;
    const onAir = state.shown && shownHere !== null;
    const shownQ = useQuestion(shownHere);
    const [startInput, setStartInput] = useState('');
    const start = parseSerial(startInput);
    const setCursor = (serial: number) => { if (socket && serial >= 1) socket.emit('set_question_cursor', { round, serial }); };

    return (
        <>
            {children}
            <div className={onAir ? styles.onair : styles.onairOff}>
                <div className={styles.onairHead}>{onAir ? 'Main に表示中の問題' : 'Main に問題は出ていません'}{shownHere !== null && <b>No.{shownHere}</b>}</div>
                {shownHere !== null && shownQ?.question && (
                    <div className={styles.onairText}>{shownQ.question.text}　A. {shownQ.question.answer}</div>
                )}
            </div>
            <div className={styles.ctl}>
                <button type="button" className={styles.btn} onClick={() => cursor !== null && setCursor(cursor - 1)} disabled={cursor === null || cursor <= 1}>◀ 前の問題</button>
                <button type="button" className={styles.btn} onClick={() => cursor !== null && setCursor(cursor + 1)} disabled={cursor === null}>次の問題 ▶</button>
                {shownHere !== null && (
                    <button type="button" className={styles.btn} onClick={() => socket?.emit('change_question_display', { shown: !state.shown })}>
                        {state.shown ? 'Main で隠す' : 'Main に出す'}
                    </button>
                )}
            </div>
            <div className={styles.startRow}>
                <input id={`start-${round}`} className={styles.input} value={startInput} onChange={e => setStartInput(e.target.value)}
                    placeholder="開始番号" inputMode="numeric" aria-label="開始の通し番号" />
                <button type="button" className={start ? styles.btnOn : styles.btn} disabled={!start}
                    onClick={() => { if (start) { setCursor(start); setStartInput(''); } }}>開始番号にする</button>
            </div>
            <div className={styles.log}>
                <h3 className={styles.sideTitle} style={{ marginBottom: 6 }}>操作の記録（新しい順）</h3>
                {log.length === 0 && <div className={styles.logEmpty}>この画面で行った採点・スルー・Undo がここに並びます</div>}
                {log.slice(0, 8).map(e => (
                    <div key={e.id} className={styles.logRow} style={e.undone ? { opacity: .45, textDecoration: 'line-through' } : undefined}>
                        <em>{e.time}</em>
                        <span>{e.who && <b>{e.who} </b>}{e.what}</span>
                        <span className={TONE_CLASS[e.tone]}>{TONE_MARK[e.tone]}</span>
                    </div>
                ))}
            </div>
            {rules && <div className={styles.rules}>{rules}</div>}
        </>
    );
}
