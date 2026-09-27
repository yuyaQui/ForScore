import { Socket } from "socket.io-client";
import { useState, useEffect } from "react";
import type { Player } from "@/lib/types";

type Props = {
    socket: Socket | null;
}

// Second Step（早押し）の採点画面。
// 出場者は extraRoundSecondStep === true の選手（AdminExtraRoundEntrants で選ばれた最大12名）
export default function AdminExtraRoundSecondStep(props: Props) {
    const { socket } = props;
    const [players, setPlayers] = useState<Player[]>([]);

    useEffect(() => {
        fetch('/api/secondRound/loadPlayers').then(res => res.json()).then(data => {
            if (data.success) setPlayers(data.allPlayers);
        });

        if (socket) {
            const handlePlayersUpdate = (allPlayers: Player[]) => setPlayers(allPlayers);
            socket.on("update_players", handlePlayersUpdate);
            return () => {
                socket.off("update_players", handlePlayersUpdate);
            };
        }
    }, [socket]);

    const handleScoreAction = async (playerId: number, action: 'correct' | 'wrong') => {
        try {
            const res = await fetch('/api/extraRound/secondStep/updateScore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerId, action })
            });
            const data = await res.json();

            if (data.success && socket) {
                socket.emit('broadcast_scores', data.allPlayers);
            }
        } catch (error) {
            console.error('Extra Round Second Step score update failed', error);
        }
    };

    const handleUndo = async () => {
        try {
            const res = await fetch('/api/extraRound/secondStep/undo', {
                method: 'POST'
            });
            const data = await res.json();

            if (data.success && socket) {
                socket.emit('broadcast_scores', data.allPlayers);
            } else if (data.error) {
                alert('Undoできません: ' + data.error);
            }
        } catch (error) {
            console.error('Extra Round Second Step undo failed', error);
        }
    };

    // 出場者だけを抜き出す
    const entrants = players.filter(p => p.extraRoundSecondStep);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <label className="text-lg font-bold text-zinc-800 dark:text-zinc-200">
                    Second Step
                </label>
                <button
                    onClick={handleUndo}
                    className="px-4 py-2 rounded-lg font-bold bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-600 transition-colors"
                >
                    Undo
                </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {entrants.map(p => {
                    const isActive = p.extraRoundRank === 0;
                    return (
                        <div key={p.id} className={`p-4 border rounded-xl flex flex-col justify-between transition-all duration-300 ${isActive ? 'border-zinc-300 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700/50' : 'border-transparent opacity-60 bg-zinc-200 dark:bg-zinc-900'}`}>
                            <div>
                                <div className="text-xs text-zinc-500 font-mono mb-1">No.{p.entryNo}</div>
                                <div className="text-center font-black text-lg mb-2 truncate" title={p.name}>{p.name}</div>
                            </div>
                            {isActive ? (
                                <>
                                    <div className="text-center mb-4 text-base font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                        {p.extraRoundCorrectCount} / 5
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleScoreAction(p.id, 'correct')}
                                            className="flex-1 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:hover:bg-emerald-800/60 text-emerald-700 dark:text-emerald-300 font-bold py-2 rounded-lg transition-colors"
                                        >
                                            正解
                                        </button>
                                        <button
                                            onClick={() => handleScoreAction(p.id, 'wrong')}
                                            className="flex-1 bg-red-100 hover:bg-red-200 dark:bg-red-900/40 dark:hover:bg-red-800/60 text-red-700 dark:text-red-300 font-bold py-2 rounded-lg transition-colors"
                                        >
                                            誤答
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <div className="text-center font-bold mt-4 mb-2">
                                    {p.extraRoundRank > 0 ? (
                                        <span className="text-yellow-600 dark:text-yellow-400 font-black">🎉 敗者復活</span>
                                    ) : (
                                        <span className="text-zinc-500 dark:text-zinc-600 font-black">☠️ 失格</span>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
                {entrants.length === 0 && (
                    <div className="col-span-full py-8 text-center text-zinc-500">
                        Second Step 出場者が選ばれていません。
                    </div>
                )}
            </div>
        </div>
    );
}
