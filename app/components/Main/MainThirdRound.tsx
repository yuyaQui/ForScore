import { Socket } from "socket.io-client";
import { useEffect, useState } from "react";

type Props = {
    players: any[],
    socket: Socket | null,
    setPlayers: (players: any[]) => void
}

export default function MainThirdRound(props: Props) {
    const { players, socket, setPlayers } = props;
    const [thirdRoundState, setThirdRoundState] = useState<{ stage: string | number }>({ stage: "courseSelect" });

    useEffect(() => {
        if (socket) {
            // 2nd Round 同様に update_third_round_state を購読
            const handleStateUpdate = (state: any) => {
                setThirdRoundState(state);
            };
            socket.on("update_third_round_state", handleStateUpdate);
            return () => {
                socket.off("update_third_round_state", handleStateUpdate);
            };
        }
    }, [socket]);

    const winners = players
        .filter(p => p.secondRoundRank >= 1)
        .sort((a, b) => {
            if (a.secondRoundRank !== b.secondRoundRank) {
                return a.secondRoundRank - b.secondRoundRank;
            }
            return a.paperRank - b.paperRank;
        });

    // 常に20枠（2行×10列）を維持するための配列を作成
    const gridItems = Array.from({ length: 20 }, (_, index) => winners[index] || null);

    return (
        <div className="w-full max-w-7xl flex flex-col items-center justify-center min-h-[80vh] px-4 py-8 z-10">
            {thirdRoundState.stage === 'courseSelect' ? (
                // コース選択画面
                <div className="text-center animate-fade-in w-full">
                    <span className="px-4 py-1.5 rounded-full text-xs font-bold tracking-widest uppercase bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-500/30">
                        3rd Round
                    </span>
                    <h1 className="mt-4 text-5xl font-black tracking-tight text-zinc-950 dark:text-white">
                        コース選択
                    </h1>
                    
                    <div className="mt-12 w-full mx-auto">
                        <div className="grid grid-cols-10 grid-rows-2 gap-3 w-full">
                            {gridItems.map((p, index) => {
                                if (p) {
                                    return (
                                        <div
                                            key={p.id}
                                            className="relative bg-white/80 dark:bg-zinc-800/80 backdrop-blur-md border border-zinc-200/50 dark:border-zinc-700/50 rounded-2xl p-3 shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300 flex flex-col items-center justify-between min-h-[300px]"
                                        >
                                            {/* 左上のエントリーNo、右上の2R順位 */}
                                            <div className="w-full flex justify-between items-center text-[9px] font-mono font-bold opacity-60 mb-2">
                                                <span>No.{p.entryNo}</span>
                                                <span className="text-amber-600 dark:text-amber-400">👑 {p.secondRoundRank}位</span>
                                            </div>

                                            {/* 選手名（縦書き）と学校名・学年（縦書き）を横に並べる */}
                                            <div className="flex justify-center items-stretch flex-grow my-3 gap-2">
                                                {/* 名前 (太字で大きく縦書き) */}
                                                <div
                                                    className="text-lg font-black tracking-widest leading-none text-zinc-900 dark:text-white select-none"
                                                    style={{ writingMode: 'vertical-rl' }}
                                                >
                                                    {p.name}
                                                </div>

                                                {/* 学校・学年 (小さく縦書き) */}
                                                <div 
                                                    className="flex flex-col items-center text-zinc-500 dark:text-zinc-400 text-[9px] font-bold tracking-wider leading-none select-none"
                                                    style={{ writingMode: 'vertical-rl' }}
                                                >
                                                    <span className="truncate max-h-[110px]">{p.school || "未登録"}</span>
                                                    <span className="text-zinc-400 mt-2">{p.grade || "-"}</span>
                                                </div>
                                            </div>

                                            {/* 下部のステータス */}
                                            <div className="w-full mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-700/50 flex flex-col items-center gap-1.5">
                                                <span className="text-[9px] font-mono text-zinc-400 dark:text-zinc-500">
                                                    Paper: {p.paperRank}位
                                                </span>
                                                <span className={`px-2 py-0.5 rounded text-[9px] font-black truncate w-full text-center ${
                                                    p.thirdRoundCourseName
                                                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                                        : "bg-zinc-100 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400"
                                                }`}>
                                                    {p.thirdRoundCourseName || "未選択"}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                } else {
                                    return (
                                        <div
                                            key={`empty-${index}`}
                                            className="border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50/20 dark:bg-zinc-900/10 rounded-2xl p-3 flex flex-col items-center justify-center min-h-[300px] opacity-30 select-none"
                                        >
                                            <span className="text-xs font-mono font-bold text-zinc-400 dark:text-zinc-600 mb-2">
                                                枠 {index + 1}
                                            </span>
                                            <span className="text-2xl text-zinc-300 dark:text-zinc-700 font-black">
                                                ?
                                            </span>
                                        </div>
                                    );
                                }
                            })}
                        </div>
                    </div>
                </div>
            ) : (
                // 各組のクイズ画面
                <div className="text-center animate-fade-in w-full">
                    <span className="px-4 py-1.5 rounded-full text-xs font-bold tracking-widest uppercase bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/30">
                        3rd Round 第 {thirdRoundState.stage} 組
                    </span>
                    <h1 className="mt-4 text-5xl font-black tracking-tight text-zinc-950 dark:text-white">
                        クイズバトル
                    </h1>
                    
                    <div className="mt-12 p-12 bg-white/80 dark:bg-zinc-800/80 backdrop-blur-md border border-zinc-200/50 dark:border-zinc-700/50 rounded-3xl shadow-2xl max-w-2xl mx-auto flex flex-col items-center justify-center min-h-[250px]">
                        <span className="text-4xl mb-4">⚡</span>
                        <p className="text-lg font-bold text-zinc-700 dark:text-zinc-300">
                            第 {thirdRoundState.stage} 組 のスコアボードを表示しています。
                        </p>
                        <p className="text-sm text-zinc-400 dark:text-zinc-500 mt-2 text-center max-w-md">
                            各組に参加するプレイヤーのスコア・勝ち抜け・失格の進行状況をここに表示する予定です。
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
