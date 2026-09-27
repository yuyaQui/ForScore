import { Socket } from "socket.io-client";
import { useState, useEffect } from "react";
import type { Player, FinalState } from "@/lib/types";
import { isSetOver, getSetWinner } from "@/lib/finalScoring";

type Props = {
    socket: Socket | null;
}

// 決勝: トリプルセブン の管理画面。
//
// 準決勝と違いタイマーを一切持たない（設計メモ 決定事項4）。「セットが決着したか」
// も新しい状態を持たず、lib/finalScoring.ts の isSetOver / getSetWinner が
// 選手データ（finalCorrectCount・finalWrongCount）から都度判定する。
//
// 優勝（finalRank === 1）はシステムが自動で確定するが、準優勝・第3位は
// タイブレークをシステムでは行わず、Adminが手動で選ぶ（設計メモ 5.5）。
export default function AdminFinal(props: Props) {
    const { socket } = props;

    const [players, setPlayers] = useState<Player[]>([]);
    const [finalState, setFinalState] = useState<FinalState>({ set: 1 });
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
    const finalPlayers = players
        .filter(p => p.semifinalRank > 0)
        .sort((a, b) => a.semifinalRank - b.semifinalRank);

    const set = finalState.set;
    const setOver = isSetOver(finalPlayers);
    const setWinner = getSetWinner(finalPlayers);
    const champion = finalPlayers.find(p => p.finalRank === 1);

    // 優勝決定後、準優勝・第3位がまだ決まっていない残り2名
    const undecidedAfterChampion = champion
        ? finalPlayers.filter(p => p.finalRank === 0)
        : [];

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
            } else {
                setErrorMessage(data.error || 'スコアの更新に失敗しました');
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
        if (!window.confirm(`第${set}セットを終え、第${set + 1}セットへ進みますか？`)) return;

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
                changeState({ set: set + 1 });
            } else {
                setErrorMessage(data.error || '次のセットへの移行に失敗しました');
            }
        } catch (error) {
            console.error('Final next set failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    // 準優勝を選ぶ。もう一方は自動的に第3位になる（lib/finalScoring.ts setRunnerUp）。
    const handleSetRunnerUp = async (runnerUpId: number) => {
        if (!window.confirm('この選手を準優勝に確定しますか？（もう一方が自動的に第3位になります）')) return;

        setIsBusy(true);
        setErrorMessage("");
        try {
            const res = await fetch('/api/final/updateScore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'setRunnerUp', runnerUpId })
            });
            const data = await res.json();

            if (data.success && socket) {
                socket.emit('broadcast_scores', data.allPlayers);
            } else {
                setErrorMessage(data.error || '準優勝の確定に失敗しました');
            }
        } catch (error) {
            console.error('Final set runner-up failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    const handleUndo = async () => {
        setIsBusy(true);
        setErrorMessage("");
        try {
            const res = await fetch('/api/final/undo', { method: 'POST' });
            const data = await res.json();

            if (data.success && socket) {
                socket.emit('broadcast_scores', data.allPlayers);
            } else {
                setErrorMessage(data.error || 'Undo に失敗しました');
            }
        } catch (error) {
            console.error('Final undo failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    return (
        <div className="flex flex-col gap-6 bg-white dark:bg-zinc-800 p-8 rounded-xl shadow-md w-full max-w-5xl">
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-black text-zinc-900 dark:text-zinc-100">
                    決勝: トリプルセブン
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
                                            ☠️ このセットは失格
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
                        決勝進出者（準決勝の勝ち抜け3名）がまだ確定していません。
                    </div>
                )}
            </div>

            {/* セット決着後、優勝がまだ決まっていなければ「次のセットへ」を出す */}
            {setOver && !champion && setWinner && (
                <div className="p-4 rounded-xl border-2 border-rose-400 dark:border-rose-600 bg-rose-50 dark:bg-rose-950/20 flex items-center justify-between gap-4">
                    <p className="font-black text-rose-700 dark:text-rose-300">
                        第{set}セット決着: {setWinner.name} が獲得
                    </p>
                    <button
                        onClick={handleNextSet}
                        disabled={isBusy}
                        className="px-5 py-2.5 rounded-lg font-bold bg-rose-600 hover:bg-rose-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white transition-colors"
                    >
                        次のセットへ
                    </button>
                </div>
            )}

            {/* 優勝決定後、準優勝・第3位をAdminが手動で選ぶ（タイブレークの計算はしない） */}
            {champion && undecidedAfterChampion.length === 2 && (
                <div className="p-4 rounded-xl border-2 border-purple-400 dark:border-purple-600 bg-purple-50 dark:bg-purple-950/20 flex flex-col gap-3">
                    <p className="font-black text-purple-700 dark:text-purple-300">
                        🏆 {champion.name} の優勝が決定しました。準優勝を選んでください（もう一方が自動的に第3位になります）。
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                        {undecidedAfterChampion.map(p => (
                            <div key={p.id} className="p-3 border border-purple-300 dark:border-purple-700 bg-white dark:bg-zinc-800 rounded-xl flex flex-col gap-2">
                                <div className="text-center font-black text-sm truncate">{p.name}</div>
                                <div className="text-center text-[11px] font-mono text-zinc-500">
                                    獲得セット数 {p.finalSetsWon} / 最終セット正解数 {p.finalCorrectCount} / 準決勝 第{p.semifinalRank}セット勝ち抜け
                                </div>
                                <button
                                    onClick={() => handleSetRunnerUp(p.id)}
                                    disabled={isBusy}
                                    className="bg-purple-600 hover:bg-purple-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white font-bold py-2 rounded-lg transition-colors text-sm"
                                >
                                    準優勝にする
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {isTournamentFinished && (
                <div className="p-4 rounded-xl border-2 border-amber-400 dark:border-amber-500 bg-amber-50 dark:bg-amber-950/20">
                    <p className="font-black text-amber-700 dark:text-amber-400">
                        決勝終了。最終順位が確定しました。
                    </p>
                </div>
            )}

            <button
                onClick={handleUndo}
                disabled={isBusy}
                className="w-full bg-yellow-500 hover:bg-yellow-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg transition-colors"
            >
                Undo（1手戻す）
            </button>
        </div>
    );
}
