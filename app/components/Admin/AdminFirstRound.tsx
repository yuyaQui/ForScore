// 1st Round（ペーパークイズ）の Admin。タイマーだけの画面。
// 2026-11-05: 運営コンソール（console/）に載せ替え。2nd Round 以降と同じ枠に揃えた。
//   上のバー … Main に出ている画面・Main を覆う操作・次の操作（1本道）
//   作業面   … 残り時間（大きく）・開始/停止
//   引き出し … 「表示の切り替え」（集計結果の入力へ）と「データ修正」（時間の増減・リセット）
// 載せ替え前と同じ Socket イベント（1R_*）を使う。変えたのは次の点:
//   ・タイマーが動いているか（running）を、1秒ごとの更新が届いているかで見分ける（再読み込み後・別の画面で操作したときも合う）
//   ・「終了」は残り 0 で判定する（再読み込みで終了状態が消えて、結果入力へ進めなくなるのを防ぐ）
//   ・時間の直しは数字の入力ではなくボタン（±10秒・±1分）にして、クリックだけで済むようにした
//   ・イベントの解除を自分の関数だけにした（他の画面の受信を巻き込まない）
import { useState, useEffect, useRef } from "react";
import { Socket } from "socket.io-client";
// constants.js は CommonJS（module.exports）だが、名前付き import で読める（AdminFirstRound の従来と同じ）
import { DEFAULT_COUNTDOWN } from "../../../constants.js";
import { formatTime } from "@/lib/formatTime";
import { coverBlocksRound, describeCover } from "@/lib/mainCover";
import { ConsoleFrame, WorkHead, MetaItem, Drawer, DrawerGroup } from "./console/ConsoleFrame";
import { SideLog } from "./console/SideLog";
import { useActionLog } from "./console/useActionLog";
import styles from "./console/console.module.css";
import { useMainCover } from "../useMainCover";
import { coverStartPrimary, CoverButtons } from "./MainCoverControls";
import { useSocketSync } from "../useSocketSync";

interface Props {
    socket: Socket | null,
    onGoToResult: () => void
}

/** 更新が途切れてから「止まった」とみなすまで（サーバは1秒ごとに送る） */
const STALE_MS = 2500;
const URGENT_AT = 60;

export default function AdminFirstRound({ socket, onGoToResult }: Props) {
    const [timer, setTimer] = useState(DEFAULT_COUNTDOWN);
    const [running, setRunning] = useState(false);
    const [drawer, setDrawer] = useState<null | 'view' | 'data'>(null);
    const [cover, setCover, coverControls] = useMainCover(socket);
    const actionLog = useActionLog();
    const prevRef = useRef<number | null>(null);
    const lastTickRef = useRef(0);

    useEffect(() => {
        if (!socket) return;
        const onUpdate = (time: number) => {
            // 1 減った更新が届いたら動いている。編集・リセットの更新（値が飛ぶ）では動いている扱いにしない
            if (prevRef.current !== null && time === prevRef.current - 1) {
                lastTickRef.current = Date.now();
                setRunning(time > 0);
            }
            prevRef.current = time;
            setTimer(time);
        };
        const onFinish = () => { setRunning(false); lastTickRef.current = 0; };
        const onReset = () => { setRunning(false); lastTickRef.current = 0; };
        socket.on("1R_update_timer", onUpdate);
        socket.on("1R_finish_timer", onFinish);
        socket.on("1R_reset_timer", onReset);
        return () => {
            socket.off("1R_update_timer", onUpdate);
            socket.off("1R_finish_timer", onFinish);
            socket.off("1R_reset_timer", onReset);
        };
    }, [socket]);

    // 画面を開いた時・つなぎ直した時に残り時間を取り直す（上の受信の準備ができた後に送る）
    useSocketSync(socket, ['request_first_round_sync']);

    // 更新が途切れたら止まった扱いにする（STOP・切断・サーバ再起動）
    useEffect(() => {
        const id = setInterval(() => {
            if (lastTickRef.current !== 0 && Date.now() - lastTickRef.current > STALE_MS) { lastTickRef.current = 0; setRunning(false); }
        }, 500);
        return () => clearInterval(id);
    }, []);

    const finished = timer <= 0;
    const isRunning = running && !finished;
    const elapsed = timer < DEFAULT_COUNTDOWN;
    const blocked = coverBlocksRound(cover);

    const start = () => {
        if (!socket || finished || blocked) return;
        lastTickRef.current = Date.now();
        setRunning(true);
        socket.emit("1R_start_timer");
        actionLog.add({ who: '', what: elapsed ? 'タイマー再開' : 'タイマー開始', tone: 'other', scope: 'first' });
    };
    const stop = () => {
        if (!socket) return;
        lastTickRef.current = 0;
        setRunning(false);
        socket.emit("1R_stop_timer");
        actionLog.add({ who: '', what: `タイマー停止（${formatTime(timer)}）`, tone: 'other', scope: 'first' });
    };
    const reset = () => {
        if (!socket) return;
        if (!window.confirm(`タイマーを ${formatTime(DEFAULT_COUNTDOWN)} に戻します。よろしいですか？`)) return;
        socket.emit("1R_reset_timer");
        actionLog.add({ who: '', what: 'タイマーをリセット', tone: 'other', scope: 'first' });
    };
    const adjust = (delta: number) => {
        if (!socket) return;
        const next = Math.min(Math.max(timer + delta, 0), DEFAULT_COUNTDOWN);
        if (next === timer) return;
        socket.emit("1R_edit_timer", next);
        actionLog.add({ who: '', what: `時間を ${delta > 0 ? '+' : '−'}${formatTime(Math.abs(delta))} → ${formatTime(next)}`, tone: 'other', scope: 'first' });
    };

    // 次の操作（1本道）
    let primaryLabel: string;
    let primaryAction: (() => void) | null = null;
    const coverStart = coverStartPrimary(cover, setCover);
    if (coverStart) {
        primaryLabel = coverStart.label;
        primaryAction = coverStart.action;
    } else if (finished) {
        primaryLabel = '集計結果の入力へ ▶';
        primaryAction = onGoToResult;
    } else if (isRunning) {
        primaryLabel = `計測中（残り ${formatTime(timer)}）`;
    } else {
        primaryLabel = elapsed ? 'タイマーを再開 ▶' : 'タイマーを開始 ▶';
        primaryAction = start;
    }

    const stateLabel = finished ? 'TIME UP' : isRunning ? '計測中' : elapsed ? '停止中' : '開始前';
    const urgent = timer <= URGENT_AT;
    const ratio = Math.min(Math.max(timer / DEFAULT_COUNTDOWN, 0), 1);

    return (
        <ConsoleFrame
            onAir="1st Round"
            onAirDetail={cover.kind !== 'none' ? describeCover(cover) : 'タイマー'}
            barExtra={<CoverButtons cover={cover} setCover={setCover} forceRelease={coverControls.forceRelease} className={styles.btn} />}
            undo={null}
            next={{ label: primaryLabel, onClick: primaryAction }}
            side={<SideLog log={actionLog.entries} empty="この画面で行ったタイマーの操作がここに並びます" />}
        >
            <WorkHead
                meta={<>
                    <MetaItem label="制限時間 " value={formatTime(DEFAULT_COUNTDOWN)} />
                    <MetaItem label="状態 " value={stateLabel} />
                </>}
                tools={<>
                    <button type="button" className={drawer === 'view' ? styles.btnOn : styles.btn} onClick={() => setDrawer(drawer === 'view' ? null : 'view')}>表示の切り替え</button>
                    <button type="button" className={drawer === 'data' ? styles.btnOn : styles.btn} onClick={() => setDrawer(drawer === 'data' ? null : 'data')}>データ修正</button>
                </>}
            />
            <div className={styles.bigTimer}>
                <span className={styles.bigTimerState}>{stateLabel}</span>
                <span className={urgent ? styles.bigTimerNumUrgent : styles.bigTimerNum} role="timer" aria-label="残り時間">{formatTime(timer)}</span>
                <div className={styles.bigTimerBar}><div className={urgent ? styles.bigTimerFillUrgent : styles.bigTimerFill} style={{ width: `${ratio * 100}%` }} /></div>
                <div className={styles.bigTimerBtns}>
                    <button type="button" className={styles.btnOn} onClick={start} disabled={isRunning || finished || blocked}>START</button>
                    <button type="button" className={styles.btnDanger} onClick={stop} disabled={!isRunning}>STOP</button>
                </div>
                {blocked && <div className={styles.waitNote}>Main が待機画面・ブランクの間は開始できません（上のバーで先に外してください）</div>}
            </div>
            <div className={styles.hint}>Main には、このタイマーの残り時間だけが大きく出ます。0 になったら「集計結果の入力へ」で名簿（CSV）の取り込みに進みます。</div>

            {drawer === 'view' && (
                <Drawer title="表示の切り替え" onClose={() => setDrawer(null)}>
                    <DrawerGroup label="画面" note="時間が残っていても、集計結果の入力に進めます（タイマーはそのまま残ります）">
                        <button type="button" className={styles.btn} onClick={() => { setDrawer(null); onGoToResult(); }}>集計結果の入力へ</button>
                    </DrawerGroup>
                </Drawer>
            )}
            {drawer === 'data' && (
                <Drawer title="データ修正" onClose={() => setDrawer(null)}>
                    <DrawerGroup label="時間を直す" note={`いまの残り時間を増減します（0:00〜${formatTime(DEFAULT_COUNTDOWN)}）`}>
                        {[-60, -10, 10, 60].map(d => (
                            <button key={d} type="button" className={styles.btn} onClick={() => adjust(d)}>{d > 0 ? '+' : '−'}{Math.abs(d) >= 60 ? `${Math.abs(d) / 60}分` : `${Math.abs(d)}秒`}</button>
                        ))}
                    </DrawerGroup>
                    <DrawerGroup label="リセット" note={`残り時間を ${formatTime(DEFAULT_COUNTDOWN)} に戻します`}>
                        <button type="button" className={styles.btnDanger} onClick={() => { setDrawer(null); reset(); }}>タイマーをリセット</button>
                    </DrawerGroup>
                </Drawer>
            )}
        </ConsoleFrame>
    );
}
