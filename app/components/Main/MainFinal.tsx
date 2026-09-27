import { Socket } from "socket.io-client";
import { useState, useEffect } from "react";
import type { Player, FinalState } from "@/lib/types";

type Props = {
    socket: Socket | null;
}

// 決勝（トリプルセブン）の Main 画面。
//
// 設計メモ 決定事項5: 準決勝と違い quiz/results の切り替えは行わず、
// 正解数・誤答数・獲得セット数を常にリアルタイムで表示する。
// タイマーも持たない（決定事項3）ので、表示するのは「第Nセット」の
// バッジと3名の生データのみ。
//
// 対象3名は新しい列を持たず、準決勝の勝ち抜け（semifinalRank > 0）から
// 導出する。並び順は準決勝の勝ち抜け順（決定事項1）＝ semifinalRank 昇順。
//
// 7問正解・3誤答の上限値は lib/finalScoring.ts の非公開定数と同じ値を
// 表示用にここでも持つ（AdminFinal.tsx と同じ扱い）。
const SET_WIN_CORRECT_COUNT = 7;
const SET_ELIMINATE_WRONG_COUNT = 3;

const RANK_LABEL: Record<number, string> = {
    1: "🏆 優勝",
    2: "🥈 準優勝",
    3: "🥉 第3位",
};

export default function MainFinal(props: Props) {
    const { socket } = props;

    const [players, setPlayers] = useState<Player[]>([]);
    const [finalState, setFinalState] = useState<FinalState>({ set: 1 });

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

    const finalPlayers = players
        .filter(p => p.semifinalRank > 0)
        .sort((a, b) => a.semifinalRank - b.semifinalRank);

    return (
        <div className="w-full max-w-6xl flex flex-col items-center justify-center min-h-[80vh] px-4 py-8 z-10">
            {/* 画面左上に「決勝」、右上に具体的なルール名(トリプルセブン)を固定表示。
                1st Round の Main 画面と同じ位置(top-[3vw] left/right-[3vw])に揃えている */}
            <div className="absolute top-[3vw] left-[3vw] text-[3vw] font-bold text-zinc-900 dark:text-white tracking-wider z-10">
                決勝
            </div>
            <div className="absolute top-[3vw] right-[3vw] text-[3vw] font-bold text-zinc-900 dark:text-white tracking-wider z-10">
                トリプルセブン
            </div>
            <div className="text-center mb-12 animate-fade-in">
                <span className="px-4 py-1.5 rounded-full text-xs font-bold tracking-widest uppercase bg-gradient-to-r from-rose-600 to-orange-500 text-white shadow-lg shadow-rose-500/30">
                    決勝 第{finalState.set}セット
                </span>
                <h1 className="mt-4 text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-zinc-900 to-zinc-700 dark:from-white dark:to-zinc-300">
                    トリプルセブン
                </h1>
                <p className="mt-3 text-zinc-500 dark:text-zinc-400 text-lg font-medium">
                    7問正解 or 3セット先取
                </p>
            </div>

            <div className="w-full grid grid-cols-3 gap-6">
                {finalPlayers.map(player => {
                    const isEliminatedThisSet = player.finalWrongCount >= SET_ELIMINATE_WRONG_COUNT;
                    const rankLabel = RANK_LABEL[player.finalRank];

                    return (
                        <div
                            key={player.id}
                            className={`rounded-2xl backdrop-blur-md border py-8 px-4 shadow-lg flex flex-col items-center justify-between min-h-[420px] transition-all duration-500 ${rankLabel
                                ? "bg-amber-50 dark:bg-amber-950/20 border-2 border-amber-400 dark:border-amber-500 scale-105 shadow-xl shadow-amber-500/10 ring-4 ring-amber-500/20"
                                : isEliminatedThisSet
                                    ? "bg-zinc-100/70 dark:bg-zinc-900/40 border-zinc-300 dark:border-zinc-800 opacity-50 grayscale"
                                    : "bg-white dark:bg-zinc-800/80 border-zinc-200/60 dark:border-zinc-700/50"
                                }`}
                        >
                            {/* 名前の右上に所属教育機関・学年を小さく縦書きで添える（準決勝と同じ体裁） */}
                            <div className="flex flex-row-reverse justify-center items-center h-20 gap-1 w-full">
                                <span className="self-start text-[10px] font-bold text-zinc-400 dark:text-zinc-500 tracking-wider leading-none select-none" style={{ writingMode: 'vertical-rl' }}>
                                    {player.school} {player.grade}
                                </span>
                                <h3 className="text-2xl font-black text-zinc-800 dark:text-white tracking-widest leading-none select-none" style={{ writingMode: 'vertical-rl' }}>
                                    {player.name}
                                </h3>
                            </div>

                            {/* 正解数・誤答数・獲得セット数は常にリアルタイムで表示する（決定事項5） */}
                            <div className="flex flex-col items-center gap-4 my-4">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">⭕️正解</span>
                                    <span className="font-mono font-black text-4xl text-emerald-600 dark:text-emerald-400">
                                        {player.finalCorrectCount}
                                    </span>
                                    <span className="font-mono text-lg text-zinc-400">/{SET_WIN_CORRECT_COUNT}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-bold text-rose-600 dark:text-rose-400">❌誤答</span>
                                    <span className="font-mono font-black text-4xl text-rose-600 dark:text-rose-400">
                                        {player.finalWrongCount}
                                    </span>
                                    <span className="font-mono text-lg text-zinc-400">/{SET_ELIMINATE_WRONG_COUNT}</span>
                                </div>
                            </div>

                            <div className="flex flex-col items-center gap-1">
                                <span className="text-xs font-bold text-zinc-400 dark:text-zinc-500 tracking-widest">獲得セット数</span>
                                <span className="font-mono font-black text-3xl text-blue-600 dark:text-blue-400">
                                    {player.finalSetsWon}
                                </span>
                            </div>

                            {isEliminatedThisSet && !rankLabel && (
                                <span className="mt-2 text-xs font-black text-zinc-400">☠️ このセット失格</span>
                            )}
                            {rankLabel && (
                                <span className="mt-2 text-sm font-black text-amber-600 dark:text-amber-400">{rankLabel}</span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
