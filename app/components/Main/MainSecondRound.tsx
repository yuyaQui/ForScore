import { Socket } from "socket.io-client";
import { useEffect, useState } from "react";

type Props = {
    players: any[],
    socket: Socket | null,
    setPlayers: (players: any[]) => void
}

export default function MainSecondRound(props: Props) {
    const { players, socket, setPlayers } = props
    const [secondRoundState, setSecondRoundState] = useState({ group: 1, view: 'turnOver' });

    useEffect(() => {
        fetch('/api/secondRound/loadPlayers')
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    setPlayers(data.allPlayers);
                }
            });
        if (socket) {
            socket.on("update_second_round_state", (state: any) => {
                setSecondRoundState(state);
            });
        }
    }, [socket])

    const groupPlayers = players
        .filter(p => {
            if (!p.paperRank) return false;
            const joinGroup = p.paperRank % 4;
            const nowGroup = secondRoundState.group === 4 ? 0 : secondRoundState.group;
            return joinGroup === nowGroup;
        })
        .sort((a, b) => (a.paperRank || 0) - (b.paperRank || 0));

    // 結果発表画面 (turnOver) のレンダリング
    if (secondRoundState.view === 'turnOver') {
        return (
            <div className="w-full max-w-6xl flex flex-col items-center justify-center min-h-[80vh] px-4 py-8 z-10">
                {/* 華やかなヘッダー部分 */}
                <div className="text-center mb-12 animate-fade-in">
                    <span className="px-4 py-1.5 rounded-full text-xs font-bold tracking-widest uppercase bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/30">
                        2nd Round 第 {secondRoundState.group} 組
                    </span>
                    <h1 className="mt-4 text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-zinc-900 to-zinc-700 dark:from-white dark:to-zinc-300">
                        結果発表・選手紹介
                    </h1>
                    <p className="mt-3 text-zinc-500 dark:text-zinc-400 text-lg font-medium">
                        1Rペーパークイズ通過者 12名
                    </p>
                </div>

                {/* 選手カードのグリッド (12列 x 1行) */}
                <div className="w-full grid grid-cols-12 gap-2">
                    {groupPlayers.map((p, idx) => (
                        <div
                            key={p.id}
                            className="group relative overflow-hidden rounded-2xl bg-white dark:bg-zinc-800/80 backdrop-blur-md border border-zinc-200/60 dark:border-zinc-700/50 py-6 px-1.5 shadow-lg transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:border-blue-500/50 dark:hover:border-blue-500/40 flex flex-col items-center justify-between min-h-[400px]"
                            style={{ animationDelay: `${idx * 80}ms` }}
                        >
                            {/* 背景のグローエフェクト */}
                            <div className="absolute -right-10 -bottom-10 h-20 w-20 rounded-full bg-blue-500/5 blur-xl transition-all duration-300 group-hover:bg-blue-500/10 group-hover:scale-150" />

                            {/* 上部のエントリーNo & ペーパー順位 (横書き) */}
                            <div className="flex flex-col items-center gap-1 w-full text-center">
                                <span className="font-mono font-black text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-100/50 dark:border-blue-900/40">
                                    rank {p.paperRank}
                                </span>
                            </div>

                            {/* 中央〜下部の縦書き表示 (右側に名前、左側に小さく学校名) */}
                            <div className="flex flex-row-reverse justify-center items-center h-64 my-4 gap-2 w-full">
                                {/* 氏名 (縦書き・大文字) */}
                                <h3 className="text-xl font-black text-zinc-800 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors tracking-widest leading-none select-none" style={{ writingMode: 'vertical-rl' }}>
                                    {p.name}
                                </h3>
                                {/* 学校名・学年 (縦書き・小さめ) */}
                                <div className="flex flex-col items-center text-zinc-500 dark:text-zinc-400 text-[10px] font-bold tracking-wider leading-none select-none" style={{ writingMode: 'vertical-rl' }}>
                                    <span className="truncate max-h-[150px]">{p.school || "未登録"}</span>
                                    <span className="text-zinc-400 mt-2">{p.grade || "-"}</span>
                                </div>
                            </div>
                        </div>
                    ))}

                    {groupPlayers.length === 0 && (
                        <div className="col-span-full py-16 text-center text-zinc-500 dark:text-zinc-400 bg-white dark:bg-zinc-800/50 border border-dashed border-zinc-200 dark:border-zinc-700 rounded-3xl">
                            選手データがありません。CSVから1st Round結果を登録してください。
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // クイズ画面 (quiz) のレンダリング
    return (
        <div className="w-full max-w-6xl flex flex-col items-center justify-center min-h-[80vh] px-4 py-8 z-10">
            {/* クイズヘッダー */}
            <div className="text-center mb-10">
                <span className="px-4 py-1.5 rounded-full text-xs font-bold tracking-widest uppercase bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-500/30">
                    2nd Round {secondRoundState.group}組目
                </span>
                <h1 className="mt-4 text-4xl font-black tracking-tight text-zinc-900 dark:text-white">
                    連答つき5○2×クイズ
                </h1>
            </div>

            {/* 得点スライドのカードグリッド (12列 x 1行) */}
            <div className="w-full grid grid-cols-12 gap-2">
                {groupPlayers.map((p) => {
                    // DB平坦化に伴うステータスの動的判定
                    const isWinner = p.secondRoundRank >= 1;
                    const isEliminated = p.secondRoundRank < 0;
                    const isActive = p.secondRoundRank === 0;

                    const point = p.secondRoundPoint || 0;
                    const wrongCount = p.secondRoundWrongCount || 0;

                    // ステータスに応じたカードのスタイルを変更 (プレミアム感のあるデザイン)
                    let cardStyle = "bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-lg";
                    if (isWinner) {
                        cardStyle = "bg-amber-50 dark:bg-amber-950/20 border-2 border-amber-400 dark:border-amber-500 scale-105 shadow-xl shadow-amber-500/10 ring-4 ring-amber-500/20 text-amber-900 dark:text-amber-100 z-20";
                    } else if (isEliminated) {
                        cardStyle = "bg-zinc-100/70 dark:bg-zinc-900/40 border border-zinc-300 dark:border-zinc-800 opacity-40 grayscale text-zinc-400 dark:text-zinc-600 shadow-none";
                    }

                    return (
                        <div
                            key={p.id}
                            className={`relative overflow-hidden rounded-2xl py-6 px-1 flex flex-col items-center justify-between min-h-[400px] transition-all duration-500 ${cardStyle}`}
                        >
                            {/* 左上のエントリーNoと右上のペーパー順位 */}
                            <div className="w-full flex flex-col items-center gap-1 text-[10px] font-mono font-bold opacity-60 mb-2 text-center">
                                <span>Rank {p.paperRank}</span>
                            </div>

                            {/* 選手名 (12列1行のため縦書き) */}
                            <div
                                className="text-xl font-black my-4 select-none tracking-widest leading-none text-zinc-800 dark:text-white"
                                style={{ writingMode: 'vertical-rl' }}
                            >
                                {p.name}
                            </div>

                            {/* 状態に応じたスコアまたはステータス表示 */}
                            {isActive && (
                                <div className="flex flex-col items-center gap-2 mt-2 w-full">
                                    {/* 正答数 (O) */}
                                    <div className="flex flex-col items-center justify-center bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/50 rounded-lg py-1.5 w-10">
                                        <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 tracking-wider">O</span>
                                        <div className="text-emerald-500 dark:text-emerald-400 font-mono font-black text-lg leading-none mt-0.5">
                                            {point}
                                        </div>
                                    </div>
                                    {/* 誤答数 (X) */}
                                    <div className="flex flex-col items-center justify-center bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/50 rounded-lg py-1.5 w-10">
                                        <span className="text-[9px] font-bold text-red-600 dark:text-red-400 tracking-wider">X</span>
                                        <div className="text-red-500 dark:text-red-400 font-mono font-black text-lg leading-none mt-0.5">
                                            {wrongCount}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* 勝ち抜け時 */}
                            {isWinner && (
                                <div className="text-sm font-black mt-2 text-amber-600 dark:text-amber-400 tracking-wider animate-pulse flex flex-col items-center gap-1">
                                    <span className="text-lg">👑</span>
                                    <span>WIN</span>
                                    {p.secondRoundRank && <span className="text-xs">({p.secondRoundRank}位)</span>}
                                </div>
                            )}

                            {/* 失格時 */}
                            {isEliminated && (
                                <div className="text-sm font-black mt-2 tracking-widest uppercase opacity-70 flex flex-col items-center gap-1 text-zinc-400">
                                    <span>❌</span>
                                    <span>LOSE</span>
                                </div>
                            )}
                        </div>
                    );
                })}

                {groupPlayers.length === 0 && (
                    <div className="col-span-full py-16 text-center text-zinc-500 dark:text-zinc-400 bg-white dark:bg-zinc-800/50 border border-dashed border-zinc-200 dark:border-zinc-700 rounded-3xl">
                        選手データがありません。
                    </div>
                )}
            </div>
        </div>
    );
}