import { Socket } from "socket.io-client";
import { useState, useEffect } from "react";
import type { Player, ThirdRoundCourse, SemifinalState, SemifinalTimer } from "@/lib/types";
import { getSemifinalSeats, SET_TIME_LIMIT_SECONDS } from "@/lib/semifinal";
import { getAdvanceTieGroup, getEliminateTieGroup } from "@/lib/semifinalScoring";
import { formatTime } from "@/lib/formatTime";

type Props = {
    socket: Socket | null;
}

// 準決勝: 3セット制タイムレース Nine Hundred の管理画面。
//
// 「今どの段階か」（得点入力中／勝ち抜け確定待ち／失格確定待ち／プレーオフ／
// セット終了）は新しい状態を持たず、選手データ（semifinalRank・semifinalPoint）
// から都度導出する。各セットは必ず3名減る（勝ち抜け1＋失格2）ので、
// 「残り人数 === 出場者数 − 3 × セット数」という式だけでセット完了が判定できる。
export default function AdminSemifinal(props: Props) {
    const { socket } = props;

    const [players, setPlayers] = useState<Player[]>([]);
    const [courses, setCourses] = useState<ThirdRoundCourse[]>([]);
    const [semifinalState, setSemifinalState] = useState<SemifinalState>({
        set: 1,
        phase: "quiz",
        view: "quiz",
        finishedSet: null
    });
    const [timer, setTimer] = useState<SemifinalTimer>({ remainings: {}, runningSet: null });
    const [isBusy, setIsBusy] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");

    // セット終了後にまとめて入力する得点変動。選手IDごとの入力中の文字列を持つ。
    // 反映後（handleSubmitPoints）にクリアする。
    const [pointInputs, setPointInputs] = useState<Record<number, string>>({});

    // タイマーの手動編集（3rd Round と同じ形）
    const [isEditingTimer, setIsEditingTimer] = useState(false);
    const [editMinutes, setEditMinutes] = useState(0);
    const [editSeconds, setEditSeconds] = useState(0);

    useEffect(() => {
        fetch('/api/secondRound/loadPlayers').then(res => res.json()).then(data => {
            if (data.success) setPlayers(data.allPlayers);
        });
        fetch('/api/thirdRound/courses').then(res => res.json()).then(data => {
            if (data.success) setCourses(data.courses);
        });

        if (socket) {
            const handleStateUpdate = (state: SemifinalState) => setSemifinalState(state);
            const handleTimerUpdate = (next: SemifinalTimer) => setTimer(next);
            const handlePlayersUpdate = (allPlayers: Player[]) => setPlayers(allPlayers);

            socket.on("update_semifinal_state", handleStateUpdate);
            socket.on("update_semifinal_timer", handleTimerUpdate);
            socket.on("update_players", handlePlayersUpdate);

            return () => {
                socket.off("update_semifinal_state", handleStateUpdate);
                socket.off("update_semifinal_timer", handleTimerUpdate);
                socket.off("update_players", handlePlayersUpdate);
            };
        }
    }, [socket]);

    const changeState = (updates: Partial<SemifinalState>) => {
        if (socket) socket.emit('change_semifinal_state', updates);
    };

    const changeTimer = (action: 'start' | 'stop' | 'reset') => {
        if (socket) socket.emit('change_semifinal_timer', { action });
    };

    const handleTimerReset = () => {
        if (window.confirm('タイマーを5分に戻しますか？')) changeTimer('reset');
    };

    const handleTimerEditStart = () => {
        setEditMinutes(Math.floor(remaining / 60));
        setEditSeconds(remaining % 60);
        setIsEditingTimer(true);
    };

    const handleTimerEditSave = () => {
        if (socket) {
            socket.emit('change_semifinal_timer', {
                action: 'edit',
                seconds: editMinutes * 60 + editSeconds
            });
        }
        setIsEditingTimer(false);
    };

    // ---- 表示に使う値を選手データから導出する ----

    // 準決勝9名。新しい列は持たないため、席と同じ導出で求める（S-3 と同じ）
    const seats = getSemifinalSeats(players, courses);
    const entrants = seats.map(s => s.player);

    const set = semifinalState.set;

    // まだ決着していない（semifinalRank === 0）対象。ポイント降順に並べる
    const activeEntrants = entrants
        .filter(p => p.semifinalRank === 0)
        .sort((a, b) => b.semifinalPoint - a.semifinalPoint);

    // このセットの勝ち抜けが決まったか（勝ち抜けたセット番号 === 現在のセット）
    const hasAdvanced = entrants.some(p => p.semifinalRank === set);

    // 各セットは必ず3名減る。残り人数がこの式に一致したら、そのセットは完了している
    const expectedActiveAfterSet = entrants.length - 3 * set;
    const isSetComplete = entrants.length > 0 && activeEntrants.length === expectedActiveAfterSet;

    const advanceTieGroup = getAdvanceTieGroup(entrants);
    const eliminateTieGroup = getEliminateTieGroup(entrants);

    const advancedPlayers = entrants
        .filter(p => p.semifinalRank > 0)
        .sort((a, b) => a.semifinalRank - b.semifinalRank);

    const remaining = timer.remainings[set] ?? SET_TIME_LIMIT_SECONDS;
    const isTimerRunning = timer.runningSet === set;

    // ---- 操作 ----

    const handleSubmitPoints = async () => {
        const entries = activeEntrants
            .map(p => ({ playerId: p.id, delta: Number(pointInputs[p.id] ?? 0) }))
            .filter(e => Number.isFinite(e.delta) && e.delta !== 0);

        if (entries.length === 0) return;
        if (!window.confirm(`${entries.length}名分の得点変動を反映しますか？`)) return;

        setIsBusy(true);
        setErrorMessage("");
        try {
            const res = await fetch('/api/semifinal/updateScore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'points', entries })
            });
            const data = await res.json();

            if (data.success && socket) {
                socket.emit('broadcast_scores', data.allPlayers);
                setPointInputs({});
            } else {
                setErrorMessage(data.error || '得点の反映に失敗しました');
            }
        } catch (error) {
            console.error('Semifinal points update failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    const handleFinalizeAdvance = async () => {
        if (!window.confirm('勝ち抜けを確定しますか？')) return;

        setIsBusy(true);
        setErrorMessage("");
        try {
            const res = await fetch('/api/semifinal/updateScore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'finalizeAdvance', set })
            });
            const data = await res.json();

            if (data.success && socket) {
                socket.emit('broadcast_scores', data.allPlayers);
            } else {
                setErrorMessage(data.error || '勝ち抜けの確定に失敗しました');
            }
        } catch (error) {
            console.error('Semifinal finalize advance failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    const handleFinalizeEliminate = async () => {
        if (!window.confirm('失格を確定しますか？')) return;

        setIsBusy(true);
        setErrorMessage("");
        try {
            const res = await fetch('/api/semifinal/updateScore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'finalizeEliminate' })
            });
            const data = await res.json();

            if (data.success && socket) {
                socket.emit('broadcast_scores', data.allPlayers);
            } else {
                setErrorMessage(data.error || '失格の確定に失敗しました');
            }
        } catch (error) {
            console.error('Semifinal finalize elimination failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    const handlePlayoffScore = async (
        playerId: number,
        purpose: 'advance' | 'eliminate',
        action: 'correct' | 'wrong'
    ) => {
        setIsBusy(true);
        setErrorMessage("");
        try {
            const res = await fetch('/api/semifinal/updateScore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'playoff', playerId, set, purpose, playoffAction: action })
            });
            const data = await res.json();

            if (data.success && socket) {
                socket.emit('broadcast_scores', data.allPlayers);
            } else {
                setErrorMessage(data.error || 'プレーオフの記録に失敗しました');
            }
        } catch (error) {
            console.error('Semifinal playoff score failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    const handleUndo = async () => {
        setIsBusy(true);
        setErrorMessage("");
        try {
            const res = await fetch('/api/semifinal/undo', { method: 'POST' });
            const data = await res.json();

            if (data.success && socket) {
                socket.emit('broadcast_scores', data.allPlayers);
            } else {
                setErrorMessage(data.error || 'Undo に失敗しました');
            }
        } catch (error) {
            console.error('Semifinal undo failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    return (
        <div className="flex flex-col gap-6 bg-white dark:bg-zinc-800 p-8 rounded-xl shadow-md w-full max-w-5xl">
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-black text-zinc-900 dark:text-zinc-100">
                    SemiFinal: Nine Hundred
                </h2>
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                    9名 → 3名
                </span>
            </div>

            {/* セット切り替え */}
            <div className="flex gap-2">
                {[1, 2, 3].map(s => (
                    <button
                        key={s}
                        onClick={() => changeState({ set: s })}
                        className={`flex-1 px-4 py-2.5 rounded-lg font-bold transition-all shadow-sm ${set === s
                            ? "bg-indigo-600 text-white ring-2 ring-indigo-500/50"
                            : "bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-800 dark:text-zinc-200"
                            }`}
                    >
                        第{s}セット
                    </button>
                ))}
            </div>

            {/* Main の表示切り替え。Admin 自身はポイントを常に見るので影響を受けない */}
            <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Main表示:</span>
                <div className="flex gap-2">
                    <button
                        onClick={() => changeState({ view: 'quiz' })}
                        className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${semifinalState.view === 'quiz'
                            ? "bg-blue-600 text-white"
                            : "bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
                            }`}
                    >
                        クイズ中
                    </button>
                    <button
                        onClick={() => changeState({ view: 'results' })}
                        className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${semifinalState.view === 'results'
                            ? "bg-blue-600 text-white"
                            : "bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
                            }`}
                    >
                        点数発表
                    </button>
                </div>
            </div>

            {errorMessage && (
                <div className="px-4 py-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300 text-sm font-bold">
                    {errorMessage}
                </div>
            )}

            {/* 5分タイマー */}
            <div className="flex flex-col items-center gap-4 w-full max-w-md mx-auto">
                <div
                    className={`font-mono font-black text-6xl tabular-nums ${remaining === 0
                        ? "text-red-600 dark:text-red-500"
                        : remaining <= 30
                            ? "text-amber-600 dark:text-amber-500"
                            : "text-zinc-900 dark:text-zinc-100"
                        }`}
                >
                    {formatTime(remaining)}
                </div>
                <span className="text-xs font-bold tracking-wider text-zinc-500 dark:text-zinc-400">
                    {remaining === 0 ? "時間切れ" : isTimerRunning ? "計測中" : "停止中"}
                </span>
                <div className="flex gap-3 w-full">
                    <button
                        onClick={() => changeTimer('start')}
                        disabled={isTimerRunning || remaining === 0}
                        className="flex-1 bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg transition-colors"
                    >
                        開始
                    </button>
                    <button
                        onClick={() => changeTimer('stop')}
                        disabled={!isTimerRunning}
                        className="flex-1 bg-amber-500 hover:bg-amber-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg transition-colors"
                    >
                        停止
                    </button>
                    <button
                        onClick={handleTimerReset}
                        className="flex-1 bg-zinc-500 hover:bg-zinc-600 text-white font-bold py-3 rounded-lg transition-colors"
                    >
                        リセット
                    </button>
                </div>

                {isEditingTimer ? (
                    <div className="w-full flex flex-col gap-3 p-3 rounded-lg border border-zinc-300 dark:border-zinc-600">
                        <div className="flex items-center justify-center gap-2 font-mono">
                            <input
                                type="number"
                                min={0}
                                max={5}
                                value={editMinutes}
                                onChange={e => setEditMinutes(Math.max(0, Number(e.target.value) || 0))}
                                className="w-20 px-2 py-2 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-right"
                            />
                            <span className="font-bold">分</span>
                            <input
                                type="number"
                                min={0}
                                max={59}
                                value={editSeconds}
                                onChange={e => setEditSeconds(Math.max(0, Number(e.target.value) || 0))}
                                className="w-20 px-2 py-2 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-right"
                            />
                            <span className="font-bold">秒</span>
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={handleTimerEditSave}
                                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded-lg transition-colors"
                            >
                                この時間にする
                            </button>
                            <button
                                onClick={() => setIsEditingTimer(false)}
                                className="flex-1 bg-zinc-400 hover:bg-zinc-500 text-white font-bold py-2 rounded-lg transition-colors"
                            >
                                キャンセル
                            </button>
                        </div>
                    </div>
                ) : (
                    <button
                        onClick={handleTimerEditStart}
                        className="w-full bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-bold py-2 rounded-lg transition-colors text-sm"
                    >
                        残り時間を手動で変更
                    </button>
                )}
            </div>

            <hr className="border-zinc-200 dark:border-zinc-700" />

            {/* 得点変動の入力。このセットの勝ち抜けがまだ決まっていない間だけ出す
                （勝ち抜けはこの入力結果をもとに確定するため、確定後の入力は意味を持たない） */}
            {!hasAdvanced && (
                <div className="flex flex-col gap-3">
                    <span className="text-sm font-bold text-zinc-700 dark:text-zinc-300">
                        得点変動の入力（第{set}セット、{activeEntrants.length}名）
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {activeEntrants.map(p => (
                            <div key={p.id} className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 flex flex-col gap-1">
                                <div className="text-sm font-bold text-zinc-800 dark:text-zinc-200 truncate">{p.name}</div>
                                <div className="text-[10px] font-mono text-zinc-400">累計 {p.semifinalPoint}pt</div>
                                <input
                                    type="number"
                                    value={pointInputs[p.id] ?? ''}
                                    onChange={e => setPointInputs(prev => ({ ...prev, [p.id]: e.target.value }))}
                                    placeholder="0"
                                    className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-right font-mono"
                                />
                            </div>
                        ))}
                    </div>
                    <button
                        onClick={handleSubmitPoints}
                        disabled={isBusy || activeEntrants.length === 0}
                        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg transition-colors"
                    >
                        得点変動を反映する
                    </button>
                </div>
            )}

            <hr className="border-zinc-200 dark:border-zinc-700" />

            {/* 進行状況に応じて、次に押すべき操作だけを出す */}
            {!hasAdvanced ? (
                advanceTieGroup.length > 0 ? (
                    <div className="p-4 rounded-xl border-2 border-purple-400 dark:border-purple-600 bg-purple-50 dark:bg-purple-950/20 flex flex-col gap-3">
                        <p className="font-black text-purple-700 dark:text-purple-300">
                            勝ち抜け候補が同点です（{advanceTieGroup.length}名）。プレーオフで決めてください。
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {advanceTieGroup.map(p => (
                                <div key={p.id} className="p-3 border border-purple-300 dark:border-purple-700 bg-white dark:bg-zinc-800 rounded-xl flex flex-col gap-2">
                                    <div className="text-center font-black text-sm truncate">{p.name}</div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handlePlayoffScore(p.id, 'advance', 'correct')}
                                            disabled={isBusy}
                                            className="flex-1 bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white font-bold py-2 rounded-lg transition-colors text-sm"
                                        >
                                            正解
                                        </button>
                                        <button
                                            onClick={() => handlePlayoffScore(p.id, 'advance', 'wrong')}
                                            disabled={isBusy}
                                            className="flex-1 bg-red-500 hover:bg-red-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white font-bold py-2 rounded-lg transition-colors text-sm"
                                        >
                                            誤答
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <button
                        onClick={handleFinalizeAdvance}
                        disabled={isBusy || activeEntrants.length === 0}
                        className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-bold py-4 rounded-lg transition-colors"
                    >
                        勝ち抜けを確定する
                    </button>
                )
            ) : !isSetComplete ? (
                activeEntrants.length <= 2 ? (
                    <button
                        onClick={handleFinalizeEliminate}
                        disabled={isBusy}
                        className="w-full bg-zinc-700 hover:bg-zinc-800 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-bold py-4 rounded-lg transition-colors"
                    >
                        残り{activeEntrants.length}名を失格にして確定する
                    </button>
                ) : eliminateTieGroup.length > 0 ? (
                    <div className="p-4 rounded-xl border-2 border-purple-400 dark:border-purple-600 bg-purple-50 dark:bg-purple-950/20 flex flex-col gap-3">
                        <p className="font-black text-purple-700 dark:text-purple-300">
                            失格境界が同点です（{eliminateTieGroup.length}名）。プレーオフで決めてください。
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {eliminateTieGroup.map(p => (
                                <div key={p.id} className="p-3 border border-purple-300 dark:border-purple-700 bg-white dark:bg-zinc-800 rounded-xl flex flex-col gap-2">
                                    <div className="text-center font-black text-sm truncate">{p.name}</div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handlePlayoffScore(p.id, 'eliminate', 'correct')}
                                            disabled={isBusy}
                                            className="flex-1 bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white font-bold py-2 rounded-lg transition-colors text-sm"
                                        >
                                            正解
                                        </button>
                                        <button
                                            onClick={() => handlePlayoffScore(p.id, 'eliminate', 'wrong')}
                                            disabled={isBusy}
                                            className="flex-1 bg-red-500 hover:bg-red-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white font-bold py-2 rounded-lg transition-colors text-sm"
                                        >
                                            誤答
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <button
                        onClick={handleFinalizeEliminate}
                        disabled={isBusy}
                        className="w-full bg-zinc-700 hover:bg-zinc-800 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-bold py-4 rounded-lg transition-colors"
                    >
                        下位2名を失格にして確定する
                    </button>
                )
            ) : set < 3 ? (
                <button
                    onClick={() => changeState({ set: set + 1 })}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-lg transition-colors"
                >
                    第{set}セット終了。次のセットへ
                </button>
            ) : (
                <div className="p-4 rounded-xl border-2 border-amber-400 dark:border-amber-500 bg-amber-50 dark:bg-amber-950/20">
                    <p className="font-black text-amber-700 dark:text-amber-400">準決勝終了。決勝進出3名が確定しました。</p>
                </div>
            )}

            <hr className="border-zinc-200 dark:border-zinc-700" />

            {/* 選手一覧（ポイント降順）。勝ち抜け・失格・対象中を状態から出し分ける */}
            <div className="flex flex-col gap-2">
                <span className="text-sm font-bold text-zinc-700 dark:text-zinc-300">選手一覧</span>
                <div className="grid grid-cols-3 sm:grid-cols-9 gap-2">
                    {[...entrants].sort((a, b) => b.semifinalPoint - a.semifinalPoint).map(p => {
                        const isAdvanced = p.semifinalRank > 0;
                        const isEliminated = p.semifinalRank === -1;
                        return (
                            <div
                                key={p.id}
                                className={`p-2 rounded-lg border flex flex-col items-center gap-1 ${isAdvanced
                                    ? "border-amber-400 dark:border-amber-500 bg-amber-50 dark:bg-amber-950/20"
                                    : isEliminated
                                        ? "border-transparent bg-zinc-200 dark:bg-zinc-900 opacity-60"
                                        : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900/40"
                                    }`}
                            >
                                <span className="text-[10px] font-bold text-center truncate w-full">{p.name}</span>
                                <span className="font-mono font-black text-sm">{p.semifinalPoint}pt</span>
                                {isAdvanced && (
                                    <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400">
                                        👑 {p.semifinalRank}セット
                                    </span>
                                )}
                                {isEliminated && <span className="text-[9px] font-bold text-zinc-500">☠️ 失格</span>}
                            </div>
                        );
                    })}
                </div>
            </div>

            {advancedPlayers.length > 0 && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    決勝進出: {advancedPlayers.map(p => `${p.name}（第${p.semifinalRank}セット）`).join(' / ')}
                </p>
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
