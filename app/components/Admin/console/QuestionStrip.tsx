// 採点面の上の問題欄（2026-10-31。2026-11-04 にキャンバスの改善案へ変更）。
//   左（大きく・黄色の枠）: Main に表示中の問題
//   右（小さく・水色の枠）: 次に読む問題（◀前・次▶ で通し番号を動かす）
// 採点（正解・誤答・スルー）すると、右の問題が Main に出て次の問題に進む（server/QuestionHandler.js）。
import type { Socket } from "socket.io-client";
import type { QuestionDisplayState, QuestionRound } from "@/lib/types";
import { useQuestion } from "../AdminQuestionPanel";
import styles from "./console.module.css";

export function QuestionStrip({ socket, round, state }: { socket: Socket | null; round: QuestionRound; state: QuestionDisplayState }) {
    const cursor = state.cursors[round] ?? null;
    const next = useQuestion(cursor);
    const shownHere = state.round === round ? state.serial : null;
    const onAir = state.shown && shownHere !== null;
    const shown = useQuestion(onAir ? shownHere : null);
    const setCursor = (serial: number) => { if (socket && serial >= 1) socket.emit('set_question_cursor', { round, serial }); };

    return (
        <div className={styles.qstrip}>
            <div className={onAir ? styles.qOn : styles.qOnOff}>
                <div className={styles.qLabel}>
                    表示中 {onAir && <b>No.{shownHere}</b>}
                </div>
                {!onAir ? (
                    <div className={styles.qNone}>Main に問題は出ていません</div>
                ) : !shown ? (
                    <div className={styles.qText}>読み込み中…</div>
                ) : shown.error ? (
                    <div className={styles.qWarn}>{shown.error}</div>
                ) : shown.question && (
                    <div className={styles.qBody}>
                        <div className={styles.qText}>{shown.question.text}</div>
                        <div className={styles.qAns}><small>A.</small>{shown.question.answer}</div>
                    </div>
                )}
            </div>
            <div className={styles.qNext}>
                <div className={styles.qLabel}>
                    次に読む問題 {cursor !== null && <b>No.{cursor}</b>}
                    <span className={styles.qNav}>
                        <button type="button" className={styles.btn} onClick={() => cursor !== null && setCursor(cursor - 1)} disabled={cursor === null || cursor <= 1}>◀ 前</button>
                        <button type="button" className={styles.btn} onClick={() => cursor !== null && setCursor(cursor + 1)} disabled={cursor === null}>次 ▶</button>
                    </span>
                </div>
                {cursor === null ? (
                    <div className={styles.qWarn}>開始番号（このラウンドで最初に読む問題の通し番号）を右の列で入れてください。入れるまで Main に問題は出ません。</div>
                ) : !next ? (
                    <div className={styles.qTextSm}>読み込み中…</div>
                ) : next.error ? (
                    <div className={styles.qWarn}>{next.error}</div>
                ) : next.question && (
                    <>
                        <div className={styles.qTextSm}>{next.question.text}</div>
                        <div className={styles.qAnsSm}><small>A.</small>{next.question.answer}
                            {next.question.altAnswer && <span className={styles.qAlt}>別解・判定: {next.question.altAnswer}</span>}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
