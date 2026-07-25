import { Socket } from "socket.io-client";
import { useState, useEffect } from "react";

type Props = {
    socket: Socket | null;
}

export default function AdminSecondRound(props: Props) {
    const { socket } = props;
    const [players, setPlayers] = useState<any[]>([]);
    const [secondRoundState, setSecondRoundState] = useState({ group: 1, view: 'turnOver' });

    useEffect(() => {
        // プレイヤーデータを持ってくる
        fetch('/api/secondRound/loadPlayers').then(res => res.json()).then(data => {
            if (data.success) setPlayers(data.allPlayers);
        })

        if (socket) {
            // プレイヤーデータ更新命令が来た時の処理
            socket.on("update_players", (allPlayers: any[]) => {
                setPlayers(allPlayers);
            });
            // ラウンド状態更新命令が来た時の処理
            socket.on("update_second_round_state", (state: any) => {
                setSecondRoundState(state);
            });
            return () => {
                socket.off("update_players");
                socket.off("update_second_round_state");
            }
        }
    }, [socket])

    const handleScoreAction = async (playerId: number, action: 'correct' | 'wrong') => {
        try {
            const res = await fetch('/api/secondRound/updateScores', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerId, action })
            });
            const data = await res.json();

            if (data.success && socket) {
                socket.emit('broadcast_scores', data.allPlayers);
            }
        } catch (error) {
            console.error('Score update failed', error);
        }
    };

    const handleGroupReset = async (secondRoundState: { group: number, view: string }) => {
        try {
            const res = await fetch('/api/secondRound/resetScores', {
                method: 'POST', // DB を書き換えるため POST
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ secondRoundState })
            });
            const data = await res.json();

            if (data.success && socket) {
                socket.emit('broadcast_scores', data.allPlayers);
            }
        } catch (error) {
            console.error('Reset scores failed', error);
        }
    };

    const handleGroupUndo = async (secondRoundState: { group: number, view: string }) => {
        try {
            const res = await fetch('/api/secondRound/undo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ secondRoundState })
            });
            const data = await res.json();

            if (data.success && socket) {
                socket.emit('broadcast_scores', data.allPlayers);
            } else if (data.error) {
                alert('Undoできません: ' + data.error);
            }
        } catch (error) {
            console.error('Undo scores failed', error);
        }
    };

    const handleStateChange = (updates: Partial<typeof secondRoundState>) => {
        if (socket) {
            socket.emit('change_2nd_round_state', { ...secondRoundState, ...updates });
        }
    };

    // 割当ルールに従ってフィルタリング
    // 1組目: paperRank % 4 === 1
    // 2組目: paperRank % 4 === 2
    // 3組目: paperRank % 4 === 3
    // 4組目: paperRank % 4 === 0
    const filteredPlayers = players
        .filter(p => {
            if (!p.paperRank) return false;
            const remainder = p.paperRank % 4;
            const targetRemainder = secondRoundState.group === 4 ? 0 : secondRoundState.group;
            return remainder === targetRemainder;
        })
        .sort((a, b) => (a.paperRank || 0) - (b.paperRank || 0));

    return (
        <div className="flex flex-col gap-6 bg-white dark:bg-zinc-800 p-8 rounded-xl shadow-md w-full max-w-5xl">
            {/* コントロールUI */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                {/* 組の選択 */}
                <div className="flex flex-col gap-2">
                    <span className="text-sm font-bold text-zinc-700 dark:text-zinc-300">組の選択</span>
                    <div className="flex gap-2">
                        {[1, 2, 3, 4].map((g) => (
                            <button
                                key={g}
                                onClick={() => handleStateChange({ group: g })}
                                className={`px-4 py-2 rounded-lg font-bold transition-colors ${secondRoundState.group === g
                                    ? "bg-blue-500 text-white"
                                    : "bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-800 dark:text-zinc-200"
                                    }`}
                            >
                                {g}組目
                            </button>
                        ))}
                    </div>
                </div>

                {/* 画面表示の選択 */}
                <div className="flex flex-col gap-2">
                    <span className="text-sm font-bold text-zinc-700 dark:text-zinc-300">表示画面の選択</span>
                    <div className="flex gap-2">
                        <button
                            onClick={() => handleStateChange({ view: 'turnOver' })}
                            className={`px-5 py-2 rounded-lg font-bold transition-colors ${secondRoundState.view === 'turnOver'
                                ? "bg-emerald-500 text-white"
                                : "bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-800 dark:text-zinc-200"
                                }`}
                        >
                            Turn Over
                        </button>
                        <button
                            onClick={() => handleStateChange({ view: 'quiz' })}
                            className={`px-5 py-2 rounded-lg font-bold transition-colors ${secondRoundState.view === 'quiz'
                                ? "bg-emerald-500 text-white"
                                : "bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-800 dark:text-zinc-200"
                                }`}
                        >
                            Quiz View
                        </button>
                    </div>
                </div>

                {/* スコアのリセット */}
                <div className="flex flex-col gap-2">
                    <span className="text-sm font-bold text-zinc-700 dark:text-zinc-300">データ操作</span>
                    <div className="flex gap-2">
                        <button
                            onClick={() => {
                                if (window.confirm(`現在の 第 ${secondRoundState.group} 組のスコアを本当にリセットしますか？`)) {
                                    handleGroupReset(secondRoundState);
                                }
                            }}
                            className="px-5 py-2 rounded-lg font-bold bg-red-100 hover:bg-red-200 dark:bg-red-950/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-400 border border-red-200/50 dark:border-red-900/30 transition-colors"
                        >
                            Reset
                        </button>
                        <button
                            onClick={() => handleGroupUndo(secondRoundState)}
                            className="px-5 py-2 rounded-lg font-bold bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-600 transition-colors"
                        >
                            Undo
                        </button>
                    </div>
                </div>
            </div>

            <hr className="border-zinc-200 dark:border-zinc-700" />

            {/* 結果発表 (選手紹介) 画面用の管理者ビュー */}
            {secondRoundState.view === 'turnOver' && (
                <div className="flex flex-col gap-4">
                    <div className="flex justify-between items-center">
                        <label className="text-lg font-bold text-zinc-800 dark:text-zinc-200">
                            2nd Round 第 {secondRoundState.group} 組 選手紹介リスト
                        </label>
                        <span className="text-sm text-zinc-500 dark:text-zinc-400">計 {filteredPlayers.length} 名</span>
                    </div>
                    <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-700 rounded-xl">
                        <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700 text-left text-sm text-zinc-800 dark:text-zinc-200">
                            <thead className="bg-zinc-50 dark:bg-zinc-900/50 font-bold">
                                <tr>
                                    <th className="px-6 py-3">No</th>
                                    <th className="px-6 py-3">ペーパー順位</th>
                                    <th className="px-6 py-3">エントリーNo</th>
                                    <th className="px-6 py-3">氏名</th>
                                    <th className="px-6 py-3">学校・学年</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700 bg-white dark:bg-zinc-800">
                                {filteredPlayers.map((p, idx) => (
                                    <tr key={p.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/30">
                                        <td className="px-6 py-4 font-mono">{idx + 1}</td>
                                        <td className="px-6 py-4 font-mono">{p.paperRank}位</td>
                                        <td className="px-6 py-4 font-mono">No.{p.entryNo}</td>
                                        <td className="px-6 py-4 font-bold">{p.name}</td>
                                        <td className="px-6 py-4">{p.school || "未登録"} ({p.grade || "-"})</td>
                                    </tr>
                                ))}
                                {filteredPlayers.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-8 text-center text-zinc-500">
                                            選手データがありません。CSVから1st Round結果を登録してください。
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* クイズ画面用の管理者ビュー (正誤判定ボタン) */}
            {secondRoundState.view === 'quiz' && (
                <div className="flex flex-col gap-4">
                    <label className="text-lg font-bold text-zinc-800 dark:text-zinc-200">
                        2nd Round 第 {secondRoundState.group} 組 クイズ正誤判定
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {filteredPlayers.map(p => {
                            const isActive = p.secondRoundRank === 0;
                            return (
                                <div key={p.id} className={`p-4 border rounded-xl flex flex-col justify-between transition-all duration-300 ${isActive ? 'border-zinc-300 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700/50' : 'border-transparent opacity-60 bg-zinc-200 dark:bg-zinc-900'}`}>
                                    <div>
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="text-xs text-zinc-500 font-mono">Rank {p.paperRank}</span>
                                            <span className="text-xs text-zinc-500 font-mono">No.{p.entryNo}</span>
                                        </div>
                                        <div className="text-center font-black text-lg mb-2 truncate" title={p.name}>{p.name}</div>
                                    </div>
                                    {isActive ? (
                                        <>
                                            <div className="flex justify-between mb-4 px-4 text-base font-mono font-bold">
                                                <span className="text-emerald-600 dark:text-emerald-400">⭕️ {p.secondRoundPoint || 0}</span>
                                                <span className="text-red-600 dark:text-red-400">❌ {p.secondRoundWrongCount || 0}</span>
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
                                            {p.secondRoundRank > 0 ? (
                                                <span className="text-yellow-600 dark:text-yellow-400 font-black">🎉 勝ち抜け</span>
                                            ) : (
                                                <span className="text-zinc-500 dark:text-zinc-600 font-black">☠️ 失格</span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        {filteredPlayers.length === 0 && (
                            <div className="col-span-full py-8 text-center text-zinc-500">
                                選手データがありません。
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}