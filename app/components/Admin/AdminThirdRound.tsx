import { Socket } from "socket.io-client";
import { useState, useEffect } from "react";

type Props = {
    socket: Socket | null;
}

export default function AdminThirdRound(props: Props) {
    const { socket } = props;
    const [thirdRoundState, setThirdRoundState] = useState<{ stage: string | number }>({ stage: "courseSelect" });
    const [winners, setWinners] = useState<any[]>([]);

    useEffect(() => {
        // 1. 2R勝ち抜けプレイヤーの初期取得
        fetch('/api/thirdRound/courseSelect')
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    setWinners(data.winners);
                }
            })
            .catch(err => console.error("Failed to load 3rd round winners", err));

        if (socket) {
            // 2. 3R進行状況の同期
            socket.on("update_third_round_state", (state: any) => {
                setThirdRoundState(state);
            });

            // 3. リアルタイムでのプレイヤーデータ同期
            const handlePlayersUpdate = (allPlayers: any[]) => {
                const sortedWinners = allPlayers
                    .filter(p => p.secondRoundRank >= 1)
                    .sort((a, b) => {
                        if (a.secondRoundRank !== b.secondRoundRank) {
                            return a.secondRoundRank - b.secondRoundRank;
                        }
                        return a.paperRank - b.paperRank;
                    });
                setWinners(sortedWinners);
            };

            socket.on("update_players", handlePlayersUpdate);

            return () => {
                socket.off("update_third_round_state");
                socket.off("update_players", handlePlayersUpdate);
            }
        }
    }, [socket]);

    const handleStateChange = (stage: string | number) => {
        if (socket) {
            socket.emit('change_3rd_round_state', { stage });
        }
    };

    return (
        <div className="flex flex-col gap-6 bg-white dark:bg-zinc-800 p-8 rounded-xl shadow-md w-full max-w-5xl">
            <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 border-b pb-4 border-zinc-200 dark:border-zinc-700">
                3rd Round 管理画面
            </h2>

            {/* ナビゲーションUI */}
            <div className="flex flex-col gap-2">
                <span className="text-sm font-bold text-zinc-700 dark:text-zinc-300">進行ステージの選択</span>
                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={() => handleStateChange('courseSelect')}
                        className={`px-5 py-2.5 rounded-lg font-bold transition-all shadow-sm ${
                            thirdRoundState.stage === 'courseSelect'
                                ? "bg-purple-600 text-white ring-2 ring-purple-500/50"
                                : "bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-800 dark:text-zinc-200"
                        }`}
                    >
                        コース選択
                    </button>
                    {[1, 2, 3, 4].map((g) => (
                        <button
                            key={g}
                            onClick={() => handleStateChange(g)}
                            className={`px-5 py-2.5 rounded-lg font-bold transition-all shadow-sm ${
                                thirdRoundState.stage === g
                                    ? "bg-blue-600 text-white ring-2 ring-blue-500/50"
                                    : "bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-800 dark:text-zinc-200"
                            }`}
                        >
                            {g}組目
                        </button>
                    ))}
                </div>
            </div>

            <hr className="border-zinc-200 dark:border-zinc-700" />

            {/* 各ステージのコンテンツ */}
            <div className="p-6 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-zinc-800 min-h-[200px] flex items-center justify-center w-full">
                {thirdRoundState.stage === 'courseSelect' ? (
                    <div className="w-full">
                        <div className="flex justify-between items-center mb-6 border-b pb-3 border-zinc-200 dark:border-zinc-700">
                            <div>
                                <h3 className="text-xl font-bold text-zinc-800 dark:text-zinc-200">3rd Round 進出者 (コース選択中)</h3>
                                <p className="text-zinc-500 dark:text-zinc-400 text-xs mt-1">2nd Round勝ち抜け順位 ➔ 1Rペーパー順位の優先度順で表示しています。</p>
                            </div>
                            <span className="bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300 px-3 py-1 rounded-full text-xs font-bold font-mono">
                                Total: {winners.length}名
                            </span>
                        </div>

                        {/* 2行×10列のグリッド表示 */}
                        <div className="grid grid-cols-10 grid-rows-2 gap-2 w-full">
                            {Array.from({ length: 20 }).map((_, index) => {
                                const p = winners[index] || null;
                                if (p) {
                                    return (
                                        <div
                                            key={p.id}
                                            className="relative bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-2.5 flex flex-col justify-between min-h-[220px] shadow-sm"
                                        >
                                            {/* 上部情報 */}
                                            <div className="flex justify-between items-center text-[8px] font-mono opacity-60">
                                                <span>No.{p.entryNo}</span>
                                                <span className="text-amber-600 dark:text-amber-400 font-bold">👑 {p.secondRoundRank}</span>
                                            </div>

                                            {/* 名前・学校 (縦書きで横並び) */}
                                            <div className="flex justify-center items-stretch flex-grow my-2 gap-1">
                                                <div
                                                    className="text-sm font-black tracking-wider leading-none text-zinc-900 dark:text-white"
                                                    style={{ writingMode: 'vertical-rl' }}
                                                >
                                                    {p.name}
                                                </div>
                                                <div 
                                                    className="flex flex-col items-center text-zinc-500 dark:text-zinc-400 text-[8px] leading-none scale-90"
                                                    style={{ writingMode: 'vertical-rl' }}
                                                >
                                                    <span className="truncate max-h-[70px]">{p.school || "未登録"}</span>
                                                </div>
                                            </div>

                                            {/* 下部 */}
                                            <div className="w-full pt-1.5 border-t border-zinc-100 dark:border-zinc-700/50 flex flex-col items-center gap-1">
                                                <span className="text-[8px] font-mono text-zinc-400">P:{p.paperRank}位</span>
                                                <span className={`px-1 py-0.5 rounded text-[8px] font-bold w-full text-center ${
                                                    p.thirdRoundCourse 
                                                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                                        : "bg-zinc-100 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400"
                                                }`}>
                                                    {p.thirdRoundCourse || "未選択"}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                } else {
                                    return (
                                        <div
                                            key={`empty-${index}`}
                                            className="border border-dashed border-zinc-200 dark:border-zinc-700 bg-zinc-100/10 rounded-xl p-2.5 flex flex-col items-center justify-center min-h-[220px] opacity-30 select-none"
                                        >
                                            <span className="text-[8px] font-mono text-zinc-400">枠 {index + 1}</span>
                                            <span className="text-lg text-zinc-300 dark:text-zinc-600 font-bold mt-1">?</span>
                                        </div>
                                    );
                                }
                            })}
                        </div>
                    </div>
                ) : (
                    <div className="text-center">
                        <h3 className="text-xl font-bold text-zinc-800 dark:text-zinc-200 mb-2">
                            第 {thirdRoundState.stage} 組 クイズ画面 (操作中)
                        </h3>
                        <p className="text-zinc-500 dark:text-zinc-400 text-sm">
                            第 {thirdRoundState.stage} 組のクイズスコア操作UIをここに作成します。
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
