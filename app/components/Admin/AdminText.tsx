// 大会準備: 案内テキスト（待機中の Main に出す文言）。
// 2026-11-05: 運営コンソールの面（console/）の見た目に載せ替え。送る処理（update_text）は同じ。
//   変えたのは次の点: Main に出ている文言を右の「いま出している案内」に出す（text_updated を受け取る）／
//   送る前の確認と、未反映の変更の表示／最大 2000 字（サーバと同じ）
import { useEffect, useState } from "react";
import { Socket } from "socket.io-client";
import { notify } from "@/lib/adminNotice";
import { useSocketSync } from "../useSocketSync";
import styles from "./console/console.module.css";

type Props = {
    socket: Socket | null;
}

const TEXT_MAX = 2000;

export default function AdminText({ socket }: Props) {
    const [text, setText] = useState("");
    // いま Main に出ている案内（サーバが持つ値）
    const [live, setLive] = useState("");

    useEffect(() => {
        if (!socket) return;
        const onText = (t: string) => setLive(typeof t === 'string' ? t : '');
        socket.on('text_updated', onText);
        return () => { socket.off('text_updated', onText); };
    }, [socket]);

    // 画面を開いた時・つなぎ直した時に、いま出している案内を取り直す（接続した瞬間の送信は受信の準備前だと失われる）
    useSocketSync(socket, ['request_text_sync']);

    const canSend = !!socket && text.trim() !== "" && text !== live;

    const handleSend = () => {
        if (!socket) { notify('サーバにつながっていません', 'error'); return; }
        if (text.trim() === "") return;
        socket.emit("update_text", text);
        notify('案内テキストを反映しました');
    };

    return (
        <section className={styles.pnl} aria-label="案内テキスト">
            <div className={styles.pnlHead}>
                <span className={styles.pnlTitle}>案内テキスト</span>
                <span className={live ? styles.pnlOk : styles.pnlWarn}>{live ? '✓ Main に表示中' : 'なし'}</span>
            </div>
            {live && <div className={styles.pnlLive} aria-label="いま出している案内">{live}</div>}
            <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, TEXT_MAX))}
                className={styles.pnlTextarea} placeholder="案内テキスト（待機中の Main に出す文言）" aria-label="案内テキスト" />
            <div className={styles.pnlRow}>
                <span className={styles.pnlCount}>{text.length}/{TEXT_MAX}</span>
                <button type="button" className={canSend ? styles.btnOn : styles.btn} onClick={handleSend} disabled={!canSend}>反映する</button>
            </div>
        </section>
    );
}
