// 採点面の上の問題欄（2026-10-31。Main の問題欄と同じ位置に「次に読む問題」を出す）。
// 採点（正解・誤答・スルー）すると、この問題が Main に出て次の問題に進む（server/QuestionHandler.js）。
import type { QuestionDisplayState, QuestionRound } from "@/lib/types";
import { useQuestion } from "../AdminQuestionPanel";
import styles from "./console.module.css";

export function QuestionStrip({ round, state }: { round: QuestionRound; state: QuestionDisplayState }) {
    const cursor = state.cursors[round] ?? null;
    const q = useQuestion(cursor);
    return (
        <div className={styles.qstrip}>
            <div className={styles.qLabel}>
                次に読む問題 {cursor !== null && <b>No.{cursor}</b>}
                {q?.question?.altAnswer && <span className={styles.qAlt}>別解・判定: {q.question.altAnswer}</span>}
            </div>
            {cursor === null ? (
                <div className={styles.qWarn}>開始番号（このラウンドで最初に読む問題の通し番号）を右の列で入れてください。入れるまで Main に問題は出ません。</div>
            ) : !q ? (
                <div className={styles.qText}>読み込み中…</div>
            ) : q.error ? (
                <div className={styles.qWarn}>{q.error}</div>
            ) : q.question && (
                <>
                    <div className={styles.qText}>{q.question.text}</div>
                    <div className={styles.qAns}><small>A.</small>{q.question.answer}</div>
                </>
            )}
        </div>
    );
}
