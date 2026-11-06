// バーに置くタイマー（時間・START・STOP）。3rd Round（15分）と Semi-Final（5分）で共通。
// urgentAt 秒以下になったら赤にする。サーバが唯一の時計で、ここは受け取った値を表示するだけ。
import { formatTime } from "@/lib/formatTime";
import styles from "./console.module.css";

export function TimerChip({ remaining, isRunning, onStart, onStop, urgentAt, label = "残り時間" }: {
    remaining: number; isRunning: boolean; onStart: () => void; onStop: () => void;
    urgentAt: number; label?: string;
}) {
    const urgent = remaining <= urgentAt;
    return (
        <div className={styles.timer} aria-label={label}>
            <span className={urgent ? styles.timerUrgent : styles.timerTime}>{formatTime(remaining)}</span>
            <button type="button" className={styles.btnOn} onClick={onStart} disabled={isRunning || remaining === 0}>START</button>
            <button type="button" className={styles.btnDanger} onClick={onStop} disabled={!isRunning}>STOP</button>
        </div>
    );
}
