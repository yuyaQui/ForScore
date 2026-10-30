import { Socket } from "socket.io-client";
import { useState, useEffect } from "react";
import type { Player, FinalState, FinalView } from "@/lib/types";
import { DEFAULT_FINAL_STATE } from "@/lib/types";
import { isSetOver, getSetWinner } from "@/lib/finalScoring";
import { getFinalists, finalPlaceLabel } from "@/lib/finalProfile";
import { photoUrl, displayNickname } from "@/lib/semifinalProfile";
import { NoPhoto } from "@/app/components/Main/SemifinalCard";
import { useSemifinalProfiles } from "./AdminSemifinalPrep";
import { useQuestionDisplay, AdminQuestionPanel } from "./AdminQuestionPanel";
import {
    MANUAL_LABEL_STYLE, manualBtnStyle, manualBtnTextStyle, neutralBtnStyle, NEUTRAL_BTN_TEXT,
    primaryButtonStyle, secondaryActionStyle, dangerBtnStyle, DANGER_BTN_TEXT,
} from "./adminCyberStyles";
import { broadcastAfterReset } from "./roundProgressContext";

type Props = {
    socket: Socket | null;
}

/** 優勝決定後に出す、最終成績の表示ボタン */
const RESULT_BUTTONS = [
    { rank: 1, label: '優勝者を表示' },
    { rank: 2, label: '準優勝者を表示' },
    { rank: 3, label: '3位を表示' },
];

/** 手動操作で切り替えられる Main 表示（最終成績は優勝決定後の3つのボタンから出す） */
const MANUAL_VIEWS: { key: string; label: string; update: { view: FinalView; introIndex?: number } }[] = [
    { key: 'standby', label: '待機', update: { view: 'standby' } },
    { key: 'intro0', label: '紹介（1人目）', update: { view: 'intro', introIndex: 0 } },
    { key: 'intro1', label: '紹介（2人目）', update: { view: 'intro', introIndex: 1 } },
    { key: 'intro2', label: '紹介（3人目）', update: { view: 'intro', introIndex: 2 } },
    { key: 'quiz', label: 'クイズ', update: { view: 'quiz' } },
];

// 決勝: トリプルセブン の管理画面。
//
// 準決勝と違いタイマーを一切持たない（設計メモ 決定事項4）。「セットが決着したか」
// も新しい状態を持たず、lib/finalScoring.ts の isSetOver / getSetWinner が
// 選手データ（finalCorrectCount・finalWrongCount）から都度判定する。
//
// 優勝（finalRank === 1）が決まった瞬間に、準優勝・第3位もルールの判定基準で
// 自動確定する（lib/finalScoring.ts compareFinalStanding。設計メモ 6.1）。
//
// 2026-10-17 追加（設計メモ 8章）: 画面上部の1本道ボタンで Main の表示を進める。
//   待機（何も表示しない）→ 選手紹介（1〜3人目。準決勝の勝ち抜け順）→ クイズ（下の採点画面）
//   → 優勝決定後に「優勝者を表示」「準優勝者を表示」「3位を表示」で最終成績を出す。
export default function AdminFinal(props: Props) {
    const { socket } = props;

    const [players, setPlayers] = useState<Player[]>([]);
    const [finalState, setFinalState] = useState<FinalState>(DEFAULT_FINAL_STATE);
    // 写真・二つ名（選手紹介の確認用）
    const { profiles } = useSemifinalProfiles(socket);
    // 問題表示（2026-10-22）。採点が成功したら、その問題を Main に表示して次の問題に進める
    const { state: questionState, finishQuestion, recordEvent, undoWithQuestion } = useQuestionDisplay(socket, 'final');
    // 問題表示の操作の記録で「どの操作か」を表す（Final の Undo 履歴はセットをまたいで1本。2026-10-29）
    const QUESTION_SCOPE = 'final';
    const [isBusy, setIsBusy] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");

    useEffect(() => {
        fetch('/api/secondRound/loadPlayers').then(res => res.json()).then(data => {
            if (data.success) setPlayers(data.allPlayers);
        });

        if (socket) {
            const handleStateUpdate = (state: FinalState) => setFinalState(state);
            const handlePlayersUpdate = (allPlayers: Player[]) => setPlayers(allPlayers);

            socket.on("update_final_state", handleStateUpdate);
            socket.on("update_players", handlePlayersUpdate);
            // 接続直後の配信はこの画面が無いうちに届いて失われるので、表示した時点で取り直す
            socket.emit("request_final_sync");

            return () => {
                socket.off("update_final_state", handleStateUpdate);
                socket.off("update_players", handlePlayersUpdate);
            };
        }
    }, [socket]);

    const changeState = (updates: Partial<FinalState>) => {
        if (socket) socket.emit('change_final_state', updates);
    };

    // ---- 表示に使う値を選手データから導出する ----

    // 決勝の3名。新しい列は持たないため、準決勝の勝ち抜け（semifinalRank > 0）から
    // 都度導出する。並び順は準決勝の勝ち抜け順（設計メモ 決定事項1）。
    const finalPlayers = getFinalists(players);

    const set = finalState.set;
    const setOver = isSetOver(finalPlayers);
    const setWinner = getSetWinner(finalPlayers);
    const champion = finalPlayers.find(p => p.finalRank === 1);

    const isTournamentFinished = finalPlayers.length > 0 && finalPlayers.every(p => p.finalRank !== 0);

    // ---- 操作 ----

    const handleScore = async (playerId: number, action: 'correct' | 'wrong') => {
        setIsBusy(true);
        setErrorMessage("");
        try {
            const res = await fetch('/api/final/updateScore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, playerId })
            });
            const data = await res.json();

            if (data.success && socket) {
                socket.emit('broadcast_scores', data.allPlayers);
                // 得点の Undo 履歴を積んだか（historyAdded）も問題表示の記録に残す（2026-10-29）
                finishQuestion(QUESTION_SCOPE, data.historyAdded !== false);
            } else {
                setErrorMessage(data.error || '更新に失敗しました');
            }
        } catch (error) {
            console.error('Final score update failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    // 次のセットへ。得点をリセットしたうえで、進行状態のセット番号も進める。
    const handleNextSet = async () => {
        if (!window.confirm(`第${set + 1}セットへ進みますか？`)) return;

        setIsBusy(true);
        setErrorMessage("");
        try {
            const res = await fetch('/api/final/updateScore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'nextSet' })
            });
            const data = await res.json();

            if (data.success && socket) {
                socket.emit('broadcast_scores', data.allPlayers);
                // 次のセットへ（得点が変わったとき）も Undo の1手になるので、問題と関係しない操作として記録する（2026-10-29）
                if (data.historyAdded) recordEvent(QUESTION_SCOPE);
                changeState({ set: set + 1 });
            } else {
                setErrorMessage(data.error || '更新に失敗しました');
            }
        } catch (error) {
            console.error('Final next set failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    // Undo。2026-10-29 から問題表示も一緒に戻す（直前がスルーなら問題だけ戻す。undoWithQuestion）
    const handleUndo = async () => {
        setIsBusy(true);
        setErrorMessage("");
        try {
            await undoWithQuestion(QUESTION_SCOPE, async () => {
                try {
                    const res = await fetch('/api/final/undo', { method: 'POST' });
                    const data = await res.json();

                    if (data.success && socket) {
                        socket.emit('broadcast_scores', data.allPlayers);
                        return true;
                    }
                    setErrorMessage(data.error || 'Undo に失敗しました');
                    return false;
                } catch (error) {
                    console.error('Final undo failed', error);
                    setErrorMessage('通信に失敗しました');
                    return false;
                }
            });
        } finally {
            setIsBusy(false);
        }
    };

    // 結果リセット（2026-10-22 新設。他のラウンドと同じ位置づけ）。
    // DB（正解数・誤答数・獲得セット数・最終順位・Undo 履歴）を API で戻し、進行（待機・第1セット）をサーバで戻す。
    // 二つ名・写真は消さない
    const handleReset = async () => {
        if (!window.confirm('Final の結果（正解数・誤答数・獲得セット数・最終順位）をリセットしますか？\n待機画面・第1セットに戻ります。（元に戻せません）')) return;
        setIsBusy(true);
        setErrorMessage("");
        try {
            const res = await fetch('/api/final/reset', { method: 'POST' });
            const data = await res.json();
            if (res.ok && data.success) {
                broadcastAfterReset(socket, 'final', data);
            } else {
                setErrorMessage(data.error || 'リセットに失敗しました');
            }
        } catch (error) {
            console.error('Final reset failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    // ---- 1本道ボタン ----
    const view = finalState.view;
    const introIndex = finalState.introIndex;
    let statusLabel = `FINAL · SET ${set}`;
    let primaryLabel = '';
    let primaryAction: (() => void) | null = null;
    let backLabel = '';
    let backAction: (() => void) | null = null;
    // 優勝が決まったら、クイズ中・最終成績の表示中は「優勝者を表示」などの3つのボタンを出す
    const showResultButtons = isTournamentFinished && (view === 'quiz' || view === 'result');

    if (finalPlayers.length < 3) {
        statusLabel = 'FINAL';
        primaryLabel = '決勝進出者が未確定です';
    } else if (view === 'standby') {
        statusLabel = 'FINAL · 待機（Main は何も表示しない）';
        primaryLabel = '選手紹介（1人目）▶';
        primaryAction = () => changeState({ view: 'intro', introIndex: 0 });
    } else if (view === 'intro') {
        statusLabel = `FINAL · 選手紹介 · ${introIndex + 1} / 3`;
        if (introIndex < 2) {
            primaryLabel = `選手紹介（${introIndex + 2}人目）▶`;
            primaryAction = () => changeState({ introIndex: introIndex + 1 });
        } else {
            primaryLabel = 'クイズ画面へ ▶';
            primaryAction = () => changeState({ view: 'quiz' });
        }
        backLabel = '◀ 戻る';
        backAction = introIndex > 0 ? () => changeState({ introIndex: introIndex - 1 }) : () => changeState({ view: 'standby' });
    } else if (view === 'result') {
        statusLabel = `FINAL · 最終成績 · ${finalPlaceLabel(finalState.resultRank)}`;
        backLabel = '◀ クイズ画面に戻る';
        backAction = () => changeState({ view: 'quiz' });
    } else if (isTournamentFinished) {
        statusLabel = 'FINAL · 終了 · 最終成績を表示する順位を選んでください';
    } else {
        statusLabel = `FINAL · SET ${set} · クイズ`;
        primaryLabel = '採点は下の画面で行います';
    }

    return (
        <div className="flex flex-col gap-6 bg-white dark:bg-zinc-800 p-8 rounded-xl shadow-md w-full max-w-5xl">
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-black text-zinc-900 dark:text-zinc-100">
                    Final 管理画面
                </h2>
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300">
                    第{set}セット
                </span>
            </div>

            {errorMessage && (
                <div className="px-4 py-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300 text-sm font-bold">
                    {errorMessage}
                </div>
            )}

            {/* 1本道ボタン（Main の表示を進める） */}
            <div className="flex flex-col items-center gap-3 bg-black py-5 rounded-none">
                <div className="text-xs tracking-[0.3em] text-[#5C7EA6] font-mono">{statusLabel}</div>
                <div className="flex flex-wrap items-center justify-center gap-4 px-4">
                    {backAction && (
                        <button onClick={backAction} style={{ ...neutralBtnStyle(), padding: '18px 28px' }}>
                            <span style={{ ...NEUTRAL_BTN_TEXT, fontSize: 16 }}>{backLabel}</span>
                        </button>
                    )}
                    {showResultButtons ? (
                        // 優勝決定後: 最終成績を出す順位を選ぶ（押した順位を Main に表示）
                        RESULT_BUTTONS.map(({ rank, label }) => (
                            <button key={rank} onClick={() => changeState({ view: 'result', resultRank: rank })}
                                style={view === 'result' && finalState.resultRank === rank ? secondaryActionStyle() : primaryButtonStyle(true)}>
                                {label}
                            </button>
                        ))
                    ) : (
                        <button onClick={primaryAction ?? undefined} disabled={!primaryAction || isBusy} style={primaryButtonStyle(!!primaryAction && !isBusy)}>
                            {primaryLabel}
                        </button>
                    )}
                </div>
            </div>

            {/* 選手紹介の順番（待機・紹介中） */}
            {(view === 'standby' || view === 'intro') && (
                <div className="flex flex-col gap-[8px] bg-black p-5">
                    <div style={MANUAL_LABEL_STYLE}>選手紹介の順番（準決勝の勝ち抜け順・Final の席順も同じ）</div>
                    <div className="grid gap-[10px]" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                        {finalPlayers.map((p, i) => {
                            const now = view === 'intro' && i === finalState.introIndex;
                            const done = view === 'intro' && i < finalState.introIndex;
                            const pr = profiles.find(x => x.playerId === p.id);
                            const photo = photoUrl(pr);
                            return (
                                <div key={p.id} style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '12px', background: now ? 'rgba(51,198,255,.10)' : 'rgba(12,22,40,.75)', borderTop: `3px solid ${now ? '#33C6FF' : done ? '#3A4B63' : 'rgba(79,216,255,.18)'}`, opacity: done ? 0.6 : 1 }}>
                                    <div style={{ width: 66, height: 88, flexShrink: 0, position: 'relative', overflow: 'hidden', background: '#0B0F16', border: '1px solid rgba(79,216,255,.3)' }}>
                                        {photo
                                            // eslint-disable-next-line @next/next/no-img-element
                                            ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                                            : <NoPhoto color="#5C7EA6" />}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                                        <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 12, color: now ? '#33C6FF' : '#7FA8D9' }}>
                                            {i + 1}人目 · SF {p.semifinalRank}セット目{now ? ' · NOW' : done ? ' · DONE' : ''}
                                        </span>
                                        <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: 16, color: '#F3FAFF' }}>{p.name}</span>
                                        <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, fontSize: 12, color: '#9FB4D6', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayNickname(p, pr) || '（二つ名なし）'}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* 手動操作: Main の表示を直接切り替える */}
            <details className="group">
                <summary className="flex cursor-pointer select-none items-center gap-[10px] bg-black px-5 py-4 [&::-webkit-details-marker]:hidden" style={{ listStyle: 'none' }}>
                    <span className="inline-block transition-transform duration-150 group-open:rotate-90" style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 15, letterSpacing: 2, color: '#7FA8D9' }}>▸</span>
                    <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 15, letterSpacing: 3, color: '#7FA8D9' }}>手動操作</span>
                </summary>
                <div className="flex flex-col gap-[10px] bg-black px-5 pb-5 pt-3">
                    <div style={MANUAL_LABEL_STYLE}>Main 表示</div>
                    <div className="flex flex-wrap gap-[10px]">
                        {MANUAL_VIEWS.map(({ key, label, update }) => {
                            const selected = view === update.view && (update.view !== 'intro' || finalState.introIndex === update.introIndex);
                            return (
                                <button key={key} onClick={() => changeState(update)} style={manualBtnStyle(selected)}>
                                    <span style={{ ...manualBtnTextStyle(selected), fontFamily: '"Noto Sans JP",sans-serif' }}>{label}</span>
                                </button>
                            );
                        })}
                    </div>
                    <div style={{ ...MANUAL_LABEL_STYLE, marginTop: 8 }}>データ操作</div>
                    <div className="flex flex-wrap gap-[10px]">
                        <button onClick={handleReset} disabled={isBusy} style={dangerBtnStyle()}>
                            <span style={DANGER_BTN_TEXT}>Final の結果をリセット</span>
                        </button>
                    </div>
                </div>
            </details>

            {(view === 'quiz' || view === 'result') && (<>
            {/* 出場者3名。正解数・誤答数・獲得セット数は常時リアルタイムで表示する
                （決勝には準決勝のような「クイズ中は隠す」区分がない、設計メモ 決定事項5） */}
            <div className="grid grid-cols-3 gap-4">
                {finalPlayers.map(p => {
                    const isEliminatedThisSet = p.finalWrongCount >= 3;
                    const isChampion = p.finalRank === 1;
                    const isRunnerUp = p.finalRank === 2;
                    const isThird = p.finalRank === 3;
                    const isSettled = p.finalRank !== 0;

                    return (
                        <div
                            key={p.id}
                            className={`p-4 border rounded-xl flex flex-col gap-2 transition-all ${isChampion
                                ? "border-amber-400 dark:border-amber-500 bg-amber-50 dark:bg-amber-950/20"
                                : isEliminatedThisSet
                                    ? "border-transparent bg-zinc-200 dark:bg-zinc-900 opacity-60"
                                    : "border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
                                }`}
                        >
                            <div className="flex justify-between text-xs font-mono text-zinc-500">
                                <span>No.{p.entryNo}</span>
                                <span>準決勝 第{p.semifinalRank}セット勝ち抜け</span>
                            </div>
                            <div className="text-center font-black text-lg truncate" title={p.name}>
                                {p.name}
                            </div>

                            <div className="flex justify-center gap-4 font-mono font-bold text-sm">
                                <span className="text-emerald-600 dark:text-emerald-400">
                                    ⭕️ {p.finalCorrectCount} / 7
                                </span>
                                <span className="text-red-600 dark:text-red-400">
                                    ❌ {p.finalWrongCount} / 3
                                </span>
                            </div>
                            <div className="text-center text-xs font-bold text-zinc-500 dark:text-zinc-400">
                                獲得セット数: {p.finalSetsWon}
                            </div>

                            {isSettled ? (
                                <div className={`text-center font-black py-2 text-sm ${isChampion
                                    ? "text-amber-600 dark:text-amber-400"
                                    : "text-zinc-500"
                                    }`}>
                                    {isChampion && "🏆 優勝"}
                                    {isRunnerUp && "🥈 準優勝"}
                                    {isThird && "🥉 第3位"}
                                </div>
                            ) : (
                                <>
                                    {isEliminatedThisSet && (
                                        <div className="text-center font-black py-1 text-sm text-zinc-500">
                                            このセットは失格
                                        </div>
                                    )}
                                    <div className="flex gap-2 w-full">
                                        <button
                                            onClick={() => handleScore(p.id, 'correct')}
                                            disabled={isBusy || setOver || isEliminatedThisSet}
                                            className="flex-1 bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-bold py-2 rounded-lg transition-colors text-sm"
                                        >
                                            正解
                                        </button>
                                        <button
                                            onClick={() => handleScore(p.id, 'wrong')}
                                            disabled={isBusy || setOver || isEliminatedThisSet}
                                            className="flex-1 bg-red-500 hover:bg-red-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-bold py-2 rounded-lg transition-colors text-sm"
                                        >
                                            誤答
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    );
                })}

                {finalPlayers.length === 0 && (
                    <div className="col-span-3 py-10 text-center text-zinc-500 dark:text-zinc-400 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl">
                        出場者が未確定です
                    </div>
                )}
            </div>

            {/* セット決着後、優勝がまだ決まっていなければ「次のセットへ」を出す */}
            {setOver && !champion && setWinner && (
                <div className="p-4 rounded-xl border-2 border-rose-400 dark:border-rose-600 bg-rose-50 dark:bg-rose-950/20 flex items-center justify-between gap-4">
                    <p className="font-black text-rose-700 dark:text-rose-300">
                        第{set}セット: {setWinner.name} が獲得
                    </p>
                    <button
                        onClick={handleNextSet}
                        disabled={isBusy}
                        className="px-5 py-2.5 rounded-lg font-bold bg-rose-600 hover:bg-rose-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white transition-colors"
                    >
                        第{set + 1}セットへ ▶
                    </button>
                </div>
            )}

            {isTournamentFinished && (
                <div className="p-4 rounded-xl border-2 border-amber-400 dark:border-amber-500 bg-amber-50 dark:bg-amber-950/20">
                    <p className="font-black text-amber-700 dark:text-amber-400">
                        Final 終了
                    </p>
                </div>
            )}

            {/* スルー（誰も解答しなかった）と問題パネル（2026-10-22）。スルーはスコアを変えず問題だけ進める */}
            {view === 'quiz' && !isTournamentFinished && (
                <button onClick={() => finishQuestion(QUESTION_SCOPE, false)} disabled={isBusy} className="w-full bg-sky-600 hover:bg-sky-700 disabled:bg-zinc-300 text-white font-bold py-3 rounded-lg transition-colors">
                    スルー
                </button>
            )}
            <AdminQuestionPanel socket={socket} round="final" state={questionState} />

            <button
                onClick={handleUndo}
                disabled={isBusy}
                className="w-full bg-yellow-500 hover:bg-yellow-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg transition-colors"
            >
                Undo
            </button>
            </>)}
        </div>
    );
}
