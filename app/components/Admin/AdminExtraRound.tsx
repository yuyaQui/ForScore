import { Socket } from "socket.io-client";
import { useState, useEffect } from "react";
import type { ExtraRoundState, ExtraRoundQuestion } from "@/lib/types";
import { getExtraRoundPhase, getExtraRoundPhaseLabel, getExtraRoundPhaseRange } from "@/lib/extraRound";
import AdminExtraRoundEntrants from "./AdminExtraRoundEntrants";
import AdminExtraRoundSecondStep from "./AdminExtraRoundSecondStep";

type Props = {
    socket: Socket | null;
}

export default function AdminExtraRound(props: Props) {
    const { socket } = props;

    // 進行状態はサーバが持つ。ここは配信された値を映すだけ。
    // 初期値は配信が届くまでの仮置き。
    const [extraRoundState, setExtraRoundState] = useState<ExtraRoundState>({
        step: "firstStep",
        questionNumber: 1,
        answerRevealed: false,
        mode: "asking"
    });

    // 問題文・解答は取込済みのものを一度取得しておく（進行中に変わらない前提）
    const [questions, setQuestions] = useState<ExtraRoundQuestion[]>([]);
    const [isResetting, setIsResetting] = useState(false);

    useEffect(() => {
        fetch('/api/extraRound/questions').then(res => res.json()).then(data => {
            if (data.success) setQuestions(data.questions);
        });

        if (socket) {
            const handleStateUpdate = (state: ExtraRoundState) => setExtraRoundState(state);

            socket.on("update_extra_round_state", handleStateUpdate);

            return () => {
                socket.off("update_extra_round_state", handleStateUpdate);
            };
        }
    }, [socket]);

    // 進行状態の変更。部分更新できるので、変えたい項目だけを送る。
    // 自分の画面も配信（update_extra_round_state）経由で更新される。
    const changeState = (updates: Partial<ExtraRoundState>) => {
        if (socket) socket.emit('change_extra_round_state', updates);
    };

    // 現在の問題番号に対応する問題文・解答を探す
    const currentQuestion = questions.find(q => q.number === extraRoundState.questionNumber);
    const [phaseStart, phaseEnd] = getExtraRoundPhaseRange(extraRoundState.questionNumber);

    // 前の問題へ。解答表示は新しい問題に引き継がない
    const goToPrevQuestion = () => {
        const prev = Math.max(1, extraRoundState.questionNumber - 1);
        changeState({ questionNumber: prev, answerRevealed: false });
    };

    // 次の問題へ。解答表示は新しい問題に引き継がない
    const goToNextQuestion = () => {
        const next = Math.min(20, extraRoundState.questionNumber + 1);
        changeState({ questionNumber: next, answerRevealed: false });
    };

    // Phase1・Phase2 の最後の問題まで解答表示が済んでいるか。
    // このときだけ「次の問題へ」を「次のフェーズの出題へ」に差し替える
    const phase = getExtraRoundPhase(extraRoundState.questionNumber);
    const isPhaseEndRevealed =
        (phase === 'phase1' || phase === 'phase2') &&
        extraRoundState.questionNumber === phaseEnd &&
        extraRoundState.answerRevealed;

    // 次のフェーズの最初の問題へ。出題（asking）から始める
    const goToNextPhase = () => {
        changeState({ questionNumber: phaseEnd + 1, mode: 'asking', answerRevealed: false });
    };

    // Phase1・Phase2 の最後の問題まで出題が進んでいるか（まだ解答表示はしていない）。
    // このときだけ「次の問題へ」を「解答確認へ」に差し替える
    const isPhaseEndAsking =
        (phase === 'phase1' || phase === 'phase2') &&
        extraRoundState.questionNumber === phaseEnd &&
        extraRoundState.mode === 'asking';

    // このフェーズの最初の問題に戻り、解答表示ができる周（revealing）に切り替える
    const goToPhaseRevealing = () => {
        changeState({ questionNumber: phaseStart, mode: 'revealing', answerRevealed: false });
    };

    // Extra Round の結果（extraRoundRank・extraRoundCorrectCount・
    // extraRoundSecondStep）を全選手ぶんリセットする。テストデータの矛盾を直す、
    // または大会本番前にやり直すための操作。進行状態（問題番号など）は変えない。
    const handleReset = async () => {
        if (!window.confirm('Extra Round の結果を全選手分リセットしますか？（元に戻せません）')) return;

        setIsResetting(true);
        try {
            const res = await fetch('/api/extraRound/reset', { method: 'POST' });
            const data = await res.json();

            if (data.success && socket) {
                socket.emit('broadcast_scores', data.allPlayers);
                alert('Extra Round の結果をリセットしました');
            } else {
                alert(data.error || 'リセットに失敗しました');
            }
        } catch (error) {
            console.error('Extra Round reset failed', error);
            alert('通信に失敗しました');
        } finally {
            setIsResetting(false);
        }
    };

    return (
        <div className="flex flex-col gap-6 bg-white dark:bg-zinc-800 p-8 rounded-xl shadow-md w-full max-w-5xl">
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-black text-zinc-900 dark:text-zinc-100">
                    Extra Round
                </h2>
                <button
                    onClick={handleReset}
                    disabled={isResetting}
                    className="px-4 py-1.5 rounded-lg text-xs font-bold bg-red-100 hover:bg-red-200 dark:bg-red-950/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-400 border border-red-200/50 dark:border-red-900/30 disabled:opacity-40 transition-colors"
                >
                    結果をリセット
                </button>
            </div>

            {/* Step の切り替え。Second Step へはどのタイミングでも切り替えられる
                （スタッフが参加者の解答状況を見て判断するため、システム側に条件は持たせない） */}
            <div className="flex gap-3">
                <button
                    onClick={() => changeState({ step: 'firstStep' })}
                    className={`flex-1 px-5 py-3 rounded-lg font-bold transition-all ${extraRoundState.step === 'firstStep'
                        ? "bg-purple-600 text-white ring-2 ring-purple-500/50"
                        : "bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-800 dark:text-zinc-200"
                        }`}
                >
                    First Step（脱落式筆記）
                </button>
                <button
                    onClick={() => changeState({ step: 'secondStep' })}
                    className={`flex-1 px-5 py-3 rounded-lg font-bold transition-all ${extraRoundState.step === 'secondStep'
                        ? "bg-blue-600 text-white ring-2 ring-blue-500/50"
                        : "bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-800 dark:text-zinc-200"
                        }`}
                >
                    Second Step（早押し）
                </button>
            </div>

            {extraRoundState.step === 'firstStep' && (
                <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <span className="px-3 py-1 rounded-full text-xs font-bold bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
                            {getExtraRoundPhaseLabel(extraRoundState.questionNumber)}
                        </span>
                        <span className="text-sm text-zinc-500 dark:text-zinc-400">
                            {getExtraRoundPhaseLabel(extraRoundState.questionNumber)}: {phaseStart}〜{phaseEnd}問
                        </span>
                    </div>

                    {/* 出題のみの周／解答表示ができる周の切り替え。
                        asking のときは「解答を表示」ボタン自体を出さない */}
                    <div className="flex gap-3">
                        <button
                            onClick={() => changeState({ mode: 'asking', answerRevealed: false })}
                            className={`flex-1 px-4 py-2 rounded-lg text-sm font-bold transition-all ${extraRoundState.mode === 'asking'
                                ? "bg-emerald-600 text-white ring-2 ring-zinc-500/50"
                                : "bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-800 dark:text-zinc-200"
                                }`}
                        >
                            出題
                        </button>
                        <button
                            onClick={() => changeState({ mode: 'revealing', questionNumber: phaseStart, answerRevealed: false })}
                            className={`flex-1 px-4 py-2 rounded-lg text-sm font-bold transition-all ${extraRoundState.mode === 'revealing'
                                ? "bg-emerald-600 text-white ring-2 ring-emerald-500/50"
                                : "bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-800 dark:text-zinc-200"
                                }`}
                        >
                            解答確認
                        </button>
                    </div>

                    {/* 進行中の問題文・解答をスタッフ確認用に表示する。
                        「問題だけ」と「問題＋解答」を別ブロックとして完全に分ける */}
                    {!extraRoundState.answerRevealed && (
                        <div className="p-6 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-700">
                            <div className="text-xs text-zinc-500 mb-2">第 {extraRoundState.questionNumber} 問</div>
                            {currentQuestion ? (
                                <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{currentQuestion.text}</p>
                            ) : (
                                <p className="text-zinc-400 dark:text-zinc-500">
                                    この番号の問題が登録されていません（Extra Round 問題取込を確認してください）
                                </p>
                            )}
                        </div>
                    )}

                    {extraRoundState.answerRevealed && (
                        <div className="p-6 rounded-xl bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-900/30">
                            <div className="text-xs text-zinc-500 mb-2">第 {extraRoundState.questionNumber} 問</div>
                            {currentQuestion ? (
                                <>
                                    <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{currentQuestion.text}</p>
                                    <p className="mt-3 text-lg font-bold text-yellow-600 dark:text-yellow-400">
                                        解答: {currentQuestion.answer}
                                    </p>
                                </>
                            ) : (
                                <p className="text-zinc-400 dark:text-zinc-500">
                                    この番号の問題が登録されていません（Extra Round 問題取込を確認してください）
                                </p>
                            )}
                        </div>
                    )}

                    {/* 解答表示ボタンは revealing（2周目）のときだけ出す。
                        asking（1周目）の間は、そもそも解答を出す手段を見せない。
                        フェーズ先頭へ戻る操作は「解答確認」ボタンに統合済み */}
                    {extraRoundState.mode === 'revealing' && (
                        <button
                            onClick={() => changeState({ answerRevealed: !extraRoundState.answerRevealed })}
                            className={`px-5 py-3 rounded-lg font-bold transition-colors ${extraRoundState.answerRevealed
                                ? "bg-yellow-500 hover:bg-yellow-600 text-white"
                                : "bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:hover:bg-emerald-800/60 text-emerald-700 dark:text-emerald-300"
                                }`}
                        >
                            {extraRoundState.answerRevealed ? "解答を隠す" : "解答を表示"}
                        </button>
                    )}

                    {/* 問題の行き来 */}
                    <div className="flex gap-3">
                        <button
                            onClick={goToPrevQuestion}
                            disabled={extraRoundState.questionNumber <= 1}
                            className="flex-1 px-5 py-3 rounded-lg font-bold bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-800 dark:text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            前の問題へ
                        </button>
                        {isPhaseEndRevealed ? (
                            <button
                                onClick={goToNextPhase}
                                className="flex-1 px-5 py-3 rounded-lg font-bold bg-orange-500 hover:bg-orange-600 text-white transition-colors"
                            >
                                次のフェーズの出題へ
                            </button>
                        ) : isPhaseEndAsking ? (
                            <button
                                onClick={goToPhaseRevealing}
                                className="flex-1 px-5 py-3 rounded-lg font-bold bg-orange-500 hover:bg-orange-600 text-white transition-colors"
                            >
                                解答確認へ
                            </button>
                        ) : (
                            <button
                                onClick={goToNextQuestion}
                                disabled={
                                    extraRoundState.questionNumber >= 20 ||
                                    // revealing 中は、解答を表示するまで次の問題へ進めない
                                    (extraRoundState.mode === 'revealing' && !extraRoundState.answerRevealed)
                                }
                                className="flex-1 px-5 py-3 rounded-lg font-bold bg-purple-100 hover:bg-purple-200 dark:bg-purple-900/40 dark:hover:bg-purple-800/60 text-purple-700 dark:text-purple-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                                次の問題へ
                            </button>
                        )}
                    </div>
                </div>
            )}

            {extraRoundState.step === 'secondStep' && (
                <div className="flex flex-col gap-6">
                    <AdminExtraRoundEntrants socket={socket} />
                    <hr className="border-zinc-200 dark:border-zinc-700" />
                    <AdminExtraRoundSecondStep socket={socket} />
                </div>
            )}
        </div>
    );
}
