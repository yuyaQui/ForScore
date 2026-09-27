import { Socket } from "socket.io-client";
import { useState, useEffect } from "react";
import type { ExtraRoundState, ExtraRoundQuestion, Player } from "@/lib/types";
import { getExtraRoundPhaseLabel } from "@/lib/extraRound";

type Props = {
    socket: Socket | null;
}

export default function MainExtraRound(props: Props) {
    const { socket } = props;

    // Main は独自の状態を持たない。配信された進行状態だけで表示が決まる。
    const [extraRoundState, setExtraRoundState] = useState<ExtraRoundState>({
        step: "firstStep",
        questionNumber: 1,
        answerRevealed: false,
        mode: "asking"
    });

    // 問題文・解答は取込済みのものを一度取得しておく
    const [questions, setQuestions] = useState<ExtraRoundQuestion[]>([]);

    // Second Step の出場者スコア表示に使う選手一覧
    const [players, setPlayers] = useState<Player[]>([]);

    useEffect(() => {
        fetch('/api/extraRound/questions').then(res => res.json()).then(data => {
            if (data.success) setQuestions(data.questions);
        });

        fetch('/api/secondRound/loadPlayers').then(res => res.json()).then(data => {
            if (data.success) setPlayers(data.allPlayers);
        });

        if (socket) {
            const handleStateUpdate = (state: ExtraRoundState) => setExtraRoundState(state);
            const handlePlayersUpdate = (allPlayers: Player[]) => setPlayers(allPlayers);

            socket.on("update_extra_round_state", handleStateUpdate);
            socket.on("update_players", handlePlayersUpdate);

            return () => {
                socket.off("update_extra_round_state", handleStateUpdate);
                socket.off("update_players", handlePlayersUpdate);
            };
        }
    }, [socket]);

    // 現在の問題番号に対応する問題文・解答を探す
    const currentQuestion = questions.find(q => q.number === extraRoundState.questionNumber);

    // Second Step 出場者だけを抜き出す
    const entrants = players.filter(p => p.extraRoundSecondStep);

    return (
        <div className="w-full max-w-7xl flex flex-col items-center justify-center min-h-[80vh] px-4 py-8 z-10">
            {/* 画面左上に「Extra Round」、右上に現在のステップ名（筆記/早押し）を固定表示。
                1st Round の Main 画面と同じ位置(top-[3vw] left/right-[3vw])に揃えている */}
            <div className="absolute top-[3vw] left-[3vw] text-[3vw] font-bold text-zinc-950 dark:text-white tracking-wider z-10">
                Extra Round
            </div>
            <div className="absolute top-[3vw] right-[3vw] text-[3vw] font-bold text-zinc-950 dark:text-white tracking-wider z-10">
                {extraRoundState.step === 'firstStep' ? '敗者復活 筆記クイズ' : '敗者復活 早押しクイズ'}
            </div>
            <div className="text-center animate-fade-in w-full">
                <span className="px-4 py-1.5 rounded-full text-xs font-bold tracking-widest uppercase bg-gradient-to-r from-orange-600 to-amber-600 text-white shadow-lg shadow-orange-500/30">
                    Extra Round
                </span>
                <h1 className="mt-4 text-5xl font-black tracking-tight text-zinc-950 dark:text-white">
                    {extraRoundState.step === 'firstStep' ? '敗者復活 筆記クイズ' : '敗者復活 早押しクイズ'}
                </h1>

                {/* firstStep は「問題だけ」と「問題＋解答」を別ブロックとして完全に分ける。
                    同じ入れ物の中で解答部分だけを足し引きすると、両者が同居して見えてしまうため */}
                {extraRoundState.step === 'firstStep' && !extraRoundState.answerRevealed && (
                    <div className="mt-12 p-12 bg-white/80 dark:bg-zinc-800/80 backdrop-blur-md border border-zinc-200/50 dark:border-zinc-700/50 rounded-3xl shadow-2xl max-w-3xl mx-auto min-h-[250px] flex flex-col items-center justify-center">
                        <div className="text-sm font-bold text-purple-600 dark:text-purple-400 tracking-widest">
                            {getExtraRoundPhaseLabel(extraRoundState.questionNumber)}
                        </div>
                        <div className="mt-2 text-2xl font-black text-zinc-500 dark:text-zinc-400">
                            第 {extraRoundState.questionNumber} 問
                        </div>
                        <p className="mt-8 text-4xl font-bold text-zinc-900 dark:text-white leading-relaxed">
                            {currentQuestion ? currentQuestion.text : '問題を準備中です'}
                        </p>
                    </div>
                )}

                {extraRoundState.step === 'firstStep' && extraRoundState.answerRevealed && (
                    <div className="mt-12 p-12 bg-white/80 dark:bg-zinc-800/80 backdrop-blur-md border border-zinc-200/50 dark:border-zinc-700/50 rounded-3xl shadow-2xl max-w-3xl mx-auto min-h-[250px] flex flex-col items-center justify-center">
                        <div className="text-sm font-bold text-purple-600 dark:text-purple-400 tracking-widest">
                            {getExtraRoundPhaseLabel(extraRoundState.questionNumber)}
                        </div>
                        <div className="mt-2 text-2xl font-black text-zinc-500 dark:text-zinc-400">
                            第 {extraRoundState.questionNumber} 問
                        </div>
                        <p className="mt-8 text-4xl font-bold text-zinc-900 dark:text-white leading-relaxed">
                            {currentQuestion ? currentQuestion.text : '問題を準備中です'}
                        </p>
                        <p className="mt-8 text-4xl font-black text-yellow-500">
                            {currentQuestion ? currentQuestion.answer : ''}
                        </p>
                    </div>
                )}

                {/* 2nd Round のクイズ画面（MainSecondRound）と同じ、縦書き名前のカードデザインに揃える。
                    1人あたりの横幅も 2nd Round と揃えるため、2nd Round と同じ
                    「max-w-6xl の中に12列」という枠をそのまま使う。
                    出場者数ぶんのカードしか描画しないので、12列のうち先頭から
                    埋まる形になり、カード自体の幅は常に2nd Roundと同じになる */}
                {extraRoundState.step === 'secondStep' && (
                    <div className="w-full flex justify-center mt-10">
                        <div className="max-w-6xl w-full grid grid-cols-12 gap-2">
                        {entrants.map(p => {
                            const isWinner = p.extraRoundRank >= 1;
                            const isEliminated = p.extraRoundRank < 0;
                            const isActive = p.extraRoundRank === 0;

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
                                    <div className="w-full flex flex-col items-center gap-1 text-[10px] font-mono font-bold opacity-60 mb-2 text-center">
                                        <span>No.{p.entryNo}</span>
                                    </div>

                                    <div
                                        className="text-xl font-black my-4 select-none tracking-widest leading-none text-zinc-800 dark:text-white"
                                        style={{ writingMode: 'vertical-rl' }}
                                    >
                                        {p.name}
                                    </div>

                                    {isActive && (
                                        <div className="flex flex-col items-center gap-2 mt-2 w-full">
                                            <div className="flex flex-col items-center justify-center bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/50 rounded-lg py-1.5 w-10">
                                                <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 tracking-wider">O</span>
                                                <div className="text-emerald-500 dark:text-emerald-400 font-mono font-black text-lg leading-none mt-0.5">
                                                    {p.extraRoundCorrectCount}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {isWinner && (
                                        <div className="text-sm font-black mt-2 text-amber-600 dark:text-amber-400 tracking-wider animate-pulse flex flex-col items-center gap-1">
                                            <span className="text-lg">🎉</span>
                                            <span>敗者復活</span>
                                        </div>
                                    )}

                                    {isEliminated && (
                                        <div className="text-sm font-black mt-2 tracking-widest uppercase opacity-70 flex flex-col items-center gap-1 text-zinc-400">
                                            <span>❌</span>
                                            <span>LOSE</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {entrants.length === 0 && (
                            <div className="col-span-full py-16 text-center text-zinc-500 dark:text-zinc-400 bg-white dark:bg-zinc-800/50 border border-dashed border-zinc-200 dark:border-zinc-700 rounded-3xl">
                                出場者を準備中です
                            </div>
                        )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
