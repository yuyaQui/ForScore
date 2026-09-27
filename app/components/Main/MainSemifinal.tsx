import { Socket } from "socket.io-client";
import { useState, useEffect } from "react";
import type { Player, ThirdRoundCourse, SemifinalState } from "@/lib/types";
import { getSemifinalSeats } from "@/lib/semifinal";
import { toOrdinal } from "@/lib/ordinal";

type Props = {
    socket: Socket | null;
}

// 準決勝の Main 画面。
//
// 設計メモ 4.2: クイズ中はポイントを一切出さず、セット終了後の点数発表でのみ
// ポイントを見せる。「問題のみ表示」と「問題＋解答表示」を同居させない Extra Round
// と同じ方針で、quiz と results は完全に別ブロックとして描画する。
//
// 勝ち抜け（👑）・失格（☠️）は過去に確定した結果なので、view に関わらず常に出す。
// 隠す必要があるのは「今まさに進行中のセットの得点」だけ。
//
// 並び順はどちらの画面も席順（getSemifinalSeats）のまま。点数発表でも
// ポイント順に並べ替えない（決定事項）。
export default function MainSemifinal(props: Props) {
    const { socket } = props;

    const [players, setPlayers] = useState<Player[]>([]);
    const [courses, setCourses] = useState<ThirdRoundCourse[]>([]);
    const [semifinalState, setSemifinalState] = useState<SemifinalState>({
        set: 1,
        phase: "quiz",
        view: "quiz",
        finishedSet: null
    });

    useEffect(() => {
        fetch('/api/secondRound/loadPlayers').then(res => res.json()).then(data => {
            if (data.success) setPlayers(data.allPlayers);
        });
        fetch('/api/thirdRound/courses').then(res => res.json()).then(data => {
            if (data.success) setCourses(data.courses);
        });

        if (socket) {
            const handleStateUpdate = (state: SemifinalState) => setSemifinalState(state);
            const handlePlayersUpdate = (allPlayers: Player[]) => setPlayers(allPlayers);

            socket.on("update_semifinal_state", handleStateUpdate);
            socket.on("update_players", handlePlayersUpdate);

            return () => {
                socket.off("update_semifinal_state", handleStateUpdate);
                socket.off("update_players", handlePlayersUpdate);
            };
        }
    }, [socket]);

    const seats = getSemifinalSeats(players, courses);

    return (
        <div className="w-full max-w-6xl flex flex-col items-center justify-center min-h-[80vh] px-4 py-8 z-10">
            {/* 画面左上に「準決勝」、右上に具体的なルール名(Nine Hundred)を固定表示。
                1st Round の Main 画面と同じ位置(top-[3vw] left/right-[3vw])に揃えている */}
            <div className="absolute top-[3vw] left-[3vw] text-[3vw] font-bold text-zinc-900 dark:text-white tracking-wider z-10">
                準決勝
            </div>
            <div className="absolute top-[3vw] right-[3vw] text-[3vw] font-bold text-zinc-900 dark:text-white tracking-wider z-10">
                Nine Hundred
            </div>
            <div className="text-center mb-12 animate-fade-in">
                <span className="px-4 py-1.5 rounded-full text-xs font-bold tracking-widest uppercase bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/30">
                    準決勝 第{semifinalState.set}セット
                </span>
                <h1 className="mt-4 text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-zinc-900 to-zinc-700 dark:from-white dark:to-zinc-300">
                    Nine Hundred
                </h1>
                <p className="mt-3 text-zinc-500 dark:text-zinc-400 text-lg font-medium">
                    {semifinalState.view === 'results' ? '得点発表' : '9名 → 3名'}
                </p>
            </div>

            {/* ===== クイズ中: 得点は一切出さない ===== */}
            {semifinalState.view === 'quiz' && (
                <div className="w-full grid grid-cols-9 gap-2">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(seatNumber => {
                        const entry = seats.find(s => s.seat === seatNumber);
                        const isAdvanced = entry && entry.player.semifinalRank > 0;
                        const isEliminated = entry && entry.player.semifinalRank === -1;

                        return (
                            <div
                                key={seatNumber}
                                className={`rounded-2xl backdrop-blur-md border py-6 px-1.5 shadow-lg flex flex-col items-center justify-between min-h-[360px] transition-all duration-500 ${isAdvanced
                                    ? "bg-amber-50 dark:bg-amber-950/20 border-2 border-amber-400 dark:border-amber-500"
                                    : isEliminated
                                        ? "bg-zinc-100/70 dark:bg-zinc-900/40 border-zinc-300 dark:border-zinc-800 opacity-40 grayscale"
                                        : "bg-white dark:bg-zinc-800/80 border-zinc-200/60 dark:border-zinc-700/50"
                                    }`}
                            >
                                {/* 席番号ではなく 1st Round の順位を出す */}
                                <span className="font-mono font-black text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border border-indigo-100/50 dark:border-indigo-900/40">
                                    {entry ? toOrdinal(entry.player.paperRank) : `seat ${seatNumber}`}
                                </span>

                                <div className="flex flex-row-reverse justify-center items-center h-56 my-4 gap-1 w-full">
                                    {entry ? (
                                        <>
                                            {/* 名前の右上に所属教育機関・学年を小さく縦書きで添える */}
                                            <span className="self-start text-[9px] font-bold text-zinc-400 dark:text-zinc-500 tracking-wider leading-none select-none" style={{ writingMode: 'vertical-rl' }}>
                                                {entry.player.school} {entry.player.grade}
                                            </span>
                                            <h3 className="text-lg font-black text-zinc-800 dark:text-white tracking-widest leading-none select-none" style={{ writingMode: 'vertical-rl' }}>
                                                {entry.player.name}
                                            </h3>
                                        </>
                                    ) : (
                                        <span className="text-xs text-zinc-400">未確定</span>
                                    )}
                                </div>

                                {isAdvanced && (
                                    <span className="text-[10px] font-black text-amber-600 dark:text-amber-400 animate-pulse">👑 勝ち抜け</span>
                                )}
                                {isEliminated && (
                                    <span className="text-[10px] font-black text-zinc-400">☠️ 失格</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ===== 点数発表: 席順のまま、ポイントを追加表示する ===== */}
            {semifinalState.view === 'results' && (
                <div className="w-full grid grid-cols-9 gap-2">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(seatNumber => {
                        const entry = seats.find(s => s.seat === seatNumber);
                        const isAdvanced = entry && entry.player.semifinalRank > 0;
                        const isEliminated = entry && entry.player.semifinalRank === -1;

                        return (
                            <div
                                key={seatNumber}
                                className={`rounded-2xl backdrop-blur-md border py-6 px-1.5 shadow-lg flex flex-col items-center justify-between min-h-[360px] transition-all duration-500 ${isAdvanced
                                    ? "bg-amber-50 dark:bg-amber-950/20 border-2 border-amber-400 dark:border-amber-500 scale-105 shadow-xl shadow-amber-500/10 ring-4 ring-amber-500/20"
                                    : isEliminated
                                        ? "bg-zinc-100/70 dark:bg-zinc-900/40 border-zinc-300 dark:border-zinc-800 opacity-40 grayscale"
                                        : "bg-white dark:bg-zinc-800/80 border-zinc-200/60 dark:border-zinc-700/50"
                                    }`}
                            >
                                {/* 席番号ではなく 1st Round の順位を出す */}
                                <span className="font-mono font-black text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border border-indigo-100/50 dark:border-indigo-900/40">
                                    {entry ? toOrdinal(entry.player.paperRank) : `seat ${seatNumber}`}
                                </span>

                                <div className="flex flex-row-reverse justify-center items-center h-48 my-3 gap-1 w-full">
                                    {entry ? (
                                        <>
                                            {/* 名前の右上に所属教育機関・学年を小さく縦書きで添える */}
                                            <span className="self-start text-[9px] font-bold text-zinc-400 dark:text-zinc-500 tracking-wider leading-none select-none" style={{ writingMode: 'vertical-rl' }}>
                                                {entry.player.school} {entry.player.grade}
                                            </span>
                                            <h3 className="text-lg font-black text-zinc-800 dark:text-white tracking-widest leading-none select-none" style={{ writingMode: 'vertical-rl' }}>
                                                {entry.player.name}
                                            </h3>
                                        </>
                                    ) : (
                                        <span className="text-xs text-zinc-400">未確定</span>
                                    )}
                                </div>

                                {entry && (
                                    <div className="font-mono font-black text-2xl text-blue-600 dark:text-blue-400">
                                        {entry.player.semifinalPoint}pt
                                    </div>
                                )}

                                {isAdvanced && (
                                    <span className="mt-1 text-[10px] font-black text-amber-600 dark:text-amber-400">👑 勝ち抜け</span>
                                )}
                                {isEliminated && (
                                    <span className="mt-1 text-[10px] font-black text-zinc-400">☠️ 失格</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
