// 大会準備: 大会名の入力（2026-11-02 追加）。
// 保存すると DB（TournamentState.tournamentName）に入り、Admin 左上に表示される。
// 保存後は tournament_state_changed を送り、開いている他の Admin も読み直す（roundProgressContext）。
// 2026-11-05: 運営コンソールの面（console/）の見た目に載せ替え。保存の処理は同じ。
//   変えたのは次の点: 押し直しで二重に保存しない（useSingleFlight）／結果は画面の上の通知（notify）／押すと開くプルダウンはやめて常に開いている
import { Socket } from "socket.io-client";
import { useState } from "react";
import { nameLengthLabel, validateTournamentName } from "@/lib/tournamentName";
import { notify, errorText } from "@/lib/adminNotice";
import { useRoundProgress } from "./roundProgressContext";
import { useSingleFlight } from "../useSingleFlight";
import styles from "./console/console.module.css";

export default function AdminTournamentName({ socket }: { socket: Socket | null }) {
    const progress = useRoundProgress();
    const saved = progress?.tournamentName ?? '';
    // 入力中の大会名。保存済みの値が変わったら（他の Admin で保存されたときも）入力欄を合わせる
    const [input, setInput] = useState(saved);
    const [savedSeen, setSavedSeen] = useState(saved);
    if (savedSeen !== saved) {
        setSavedSeen(saved);
        setInput(saved);
    }
    const flight = useSingleFlight();

    const check = validateTournamentName(input);
    // 保存済みの名前が今の上限（2026-11-06 に全角12文字分へ縮めた）を超えているときは、短くするよう知らせる
    const savedTooLong = saved !== '' && !validateTournamentName(saved).ok;
    const dirty = check.ok ? check.value !== saved : true;
    const canSave = check.ok && dirty && !flight.pending;

    const handleSave = () => flight.run(async () => {
        if (!check.ok) return;
        try {
            const res = await fetch('/api/tournamentState', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tournamentName: check.value }),
            });
            const data = await res.json();
            if (data.success) {
                // 開いている Admin（自分も含む）に読み直させる
                socket?.emit('tournament_state_changed');
                notify(check.value === '' ? '大会名を消しました' : '大会名を保存しました');
            } else {
                notify(errorText(data.error, '大会名を保存できません'), 'error');
            }
        } catch (e) {
            notify(errorText(e, '大会名を保存できませんでした。通信を確かめてください'), 'error');
        }
    });

    return (
        <section className={styles.pnl} aria-label="大会名">
            <div className={styles.pnlHead}>
                <span className={styles.pnlTitle}>大会名</span>
                <span className={saved ? styles.pnlOk : styles.pnlWarn}>{saved ? `✓ ${saved}` : '未設定'}</span>
            </div>
            <div className={styles.pnlRow}>
                <input id="tournament-name" type="text" value={input} onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && canSave) void handleSave(); }}
                    placeholder="例: abc Fortior" aria-label="大会名"
                    className={check.ok ? styles.pnlInput : styles.pnlInputBad} />
                <span className={check.ok ? styles.pnlCount : styles.pnlCountBad}>{nameLengthLabel(input.trim())}</span>
                <button type="button" className={canSave ? styles.btnOn : styles.btn} onClick={() => { void handleSave(); }} disabled={!canSave}>
                    {flight.pending ? '保存中…' : '保存'}
                </button>
            </div>
            {!check.ok && <div className={styles.pnlError}>{check.error}</div>}
            {check.ok && savedTooLong && <div className={styles.pnlError}>保存済みの大会名はクイズ画面の見出しに収まりません。全角12文字（半角24文字）までに短くして保存してください</div>}
        </section>
    );
}
