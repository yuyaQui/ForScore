import { Socket } from "socket.io-client";
import { useState, useEffect } from "react";
import type { Player, ThirdRoundTimer } from "@/lib/types";
import {
    COURSE_TIME_LIMIT_SECONDS,
    THIRD_ROUND_COURSES,
    type ThirdRoundCourseName
} from "@/lib/thirdRoundCourses";
import { formatTime } from "@/lib/formatTime";
import {
    getCourseFinishState,
    getTenByTenTotal,
    getTenByTenWrongPoint,
    isEliminatedByCourseRule
} from "@/lib/thirdRoundScoring";

type Props = {
    socket: Socket | null;
}

type Course = {
    id: number;
    name: string;
    playOrder: number | null;
}

type ThirdRoundState = {
    // playoff は判定基準で決着しなかった選手の早押しプレーオフ。
    // quizOrder はそのまま使うので、どのコースの分かが分かる。
    phase: "courseSelect" | "quiz" | "playoff";
    step: "entry" | "closed";
    quizOrder: number;
    // コース終了処理を走らせたコースの quizOrder。未実行なら null。
    // 「終了処理を走らせたか」はデータから導出できないため状態として持つ。
    finishedOrder: number | null;
}

// 確定結果の内訳。掲げた／強制出場の区別を表示するためだけに使う。
// DB には保存しないため、リロードすると消える（大会結果には影響しない情報）。
type AssignedPlayer = {
    id: number;
    entryNo: number;
    name: string;
    secondRoundRank: number;
    paperRank: number;
    forced: boolean;
}

export default function AdminThirdRound(props: Props) {
    const { socket } = props;

    const [thirdRoundState, setThirdRoundState] = useState<ThirdRoundState>({
        phase: "courseSelect",
        step: "entry",
        quizOrder: 1,
        finishedOrder: null
    });
    const [courses, setCourses] = useState<Course[]>([]);
    const [winners, setWinners] = useState<Player[]>([]);
    // プレートを掲げていた人。Admin のローカル状態で、確定時にサーバへ送る
    const [raisedIds, setRaisedIds] = useState<number[]>([]);
    // 直前に確定した結果の内訳（掲げた／強制出場）
    const [lastAssigned, setLastAssigned] = useState<AssignedPlayer[]>([]);
    const [isBusy, setIsBusy] = useState(false); // API と通信中かどうか
    const [errorMessage, setErrorMessage] = useState("");
    // 15分タイマー。サーバが唯一の時計で、ここは受け取った値を表示するだけ。
    // 接続直後にサーバから現在値が届くので、初期値は表示が一瞬崩れないための仮置き。
    const [timer, setTimer] = useState<ThirdRoundTimer>({
        remainings: {},
        runningOrder: null
    });
    // タイマーの手動編集。入力中の値は Admin のローカル状態で持つ
    const [isEditingTimer, setIsEditingTimer] = useState(false);
    const [editMinutes, setEditMinutes] = useState(0);
    const [editSeconds, setEditSeconds] = useState(0);

    useEffect(() => {
        // 画面を開いた直後の1回だけ、現在の状態を直接取得する。
        // この時点では他の画面に配信すべき新しい情報がないため setState してよい。
        fetch('/api/thirdRound/courses')
            .then(res => res.json())
            .then(data => { if (data.success) setCourses(data.courses); })
            .catch(err => console.error("Failed to load third round courses", err));

        fetch('/api/thirdRound/courseSelect')
            .then(res => res.json())
            .then(data => { if (data.success) setWinners(data.winners); })
            .catch(err => console.error("Failed to load third round winners", err));

        if (socket) {
            const handleStateUpdate = (state: ThirdRoundState) => setThirdRoundState(state);

            const handlePlayersUpdate = (allPlayers: Player[]) => {
                setWinners(
                    allPlayers
                        .filter(p => p.secondRoundRank >= 1)
                        .sort((a, b) =>
                            a.secondRoundRank !== b.secondRoundRank
                                ? a.secondRoundRank - b.secondRoundRank
                                : a.paperRank - b.paperRank
                        )
                );
            };

            // 抽選結果はここで受け取る。
            // fetch の戻り値を直接 setState しないのは、更新経路を1本に保つため。
            // Socket 経由に統一すると Admin と Main が同じデータを同じタイミングで受け取る。
            //
            // このイベントが運ぶのはコース情報だけ。選手データは update_players で受け取る。
            // 経路を種別ごとに1本に保たないと、片方の画面だけが更新される事故が起きる。
            const handleCoursesUpdate = (nextCourses: Course[]) => {
                setCourses(nextCourses);
                setRaisedIds([]);       // 新しいコースに移るのでチェックを外す
                setLastAssigned([]);    // 前のコースの内訳表示も消す
            };

            const handleTimerUpdate = (next: ThirdRoundTimer) => setTimer(next);

            socket.on("update_third_round_state", handleStateUpdate);
            socket.on("update_third_round_courses", handleCoursesUpdate);
            socket.on("update_players", handlePlayersUpdate);
            socket.on("update_third_round_timer", handleTimerUpdate);

            return () => {
                socket.off("update_third_round_state", handleStateUpdate);
                socket.off("update_third_round_courses", handleCoursesUpdate);
                socket.off("update_players", handlePlayersUpdate);
                socket.off("update_third_round_timer", handleTimerUpdate);
            };
        }
    }, [socket]);

    const changeState = (updates: Partial<ThirdRoundState>) => {
        if (socket) socket.emit('change_3rd_round_state', updates);
    };

    // タイマー操作。サーバが時計を持っているので、ここは要求を送るだけ。
    // 自分の画面も配信（update_third_round_timer）経由で更新される。
    const changeTimer = (action: 'start' | 'stop' | 'reset') => {
        if (socket) socket.emit('change_third_round_timer', { action });
    };

    const handleTimerReset = () => {
        // 進行中に誤って押すと15分が巻き戻るため確認する
        if (window.confirm('タイマーを15分に戻しますか？')) changeTimer('reset');
    };

    // 残り秒数の手動編集。疑義の申し立てで時間を戻す場合や、開始を忘れたまま
    // 進行してしまった場合の復旧手段。サーバ側で編集時に時計は止まる。
    const handleTimerEditStart = () => {
        setEditMinutes(Math.floor(remaining / 60));
        setEditSeconds(remaining % 60);
        setIsEditingTimer(true);
    };

    const handleTimerEditSave = () => {
        if (socket) {
            socket.emit('change_third_round_timer', {
                action: 'edit',
                seconds: editMinutes * 60 + editSeconds
            });
        }
        setIsEditingTimer(false);
    };

    // スコア更新。
    // fetch の結果を直接 setState せず、Socket で配って update_players 経由で
    // 自分の画面も更新する。自分だけ別経路で更新すると Main と表示がずれる。
    // playerId はスルーのとき null。スルーは「問題が1問終わった」というイベントで
    // 選手に紐づかないため、対象コースは常に courseName で伝える。
    const handleScore = async (
        playerId: number | null,
        action: 'correct' | 'wrong' | 'through' | 'finish'
    ) => {
        if (!quizCourse) return;

        setIsBusy(true);
        setErrorMessage("");
        try {
            const res = await fetch('/api/thirdRound/updateScores', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerId, action, courseName: quizCourse.name })
            });
            const data = await res.json();

            if (data.success && socket) {
                // 選手データ専用の経路で配る。コース情報のイベントに同乗させない。
                socket.emit('broadcast_scores', data.allPlayers);

                // 勝ち抜けまたは失格が出たら時計を止める（設計メモ 4.2）。
                // 判定は API 側にある。server/ は DB を見ないので勝ち抜けを知らず、
                // Admin が中継役になる。止まっていても stop は無害。
                if (data.shouldStopTimer) {
                    socket.emit('change_third_round_timer', { action: 'stop' });
                }
            } else {
                setErrorMessage(data.error || 'スコアの更新に失敗しました');
            }
        } catch (error) {
            console.error('Score update failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    // サドンデスの採点部分
    const handlePlayoffScore = async (playerId: number, action: 'correct' | 'wrong') => {
        if (!quizCourse) return;
        setIsBusy(true);
        setErrorMessage("");
        try {
            const res = await fetch('/api/thirdRound/updateScores', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    playerId,
                    action,
                    courseName: quizCourse.name,
                    playoff: true
                })
            });
            const data = await res.json()
            if (data.success && socket) {
                socket.emit('broadcast_scores', data.allPlayers)
            } else {
                setErrorMessage(data.error || 'スコアの更新に失敗しました');
            }
        } catch (error) {
            console.error('Playoff score update failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    // スコア更新を1手戻す。履歴はコース単位なので、いま実施中のコース名を送る。
    // タイマーと出場者の割当は戻らない（別系統）。
    const handleScoreUndo = async () => {
        if (!quizCourse) return;

        setIsBusy(true);
        setErrorMessage("");
        try {
            const res = await fetch('/api/thirdRound/undo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseName: quizCourse.name })
            });
            const data = await res.json();

            if (data.success && socket) {
                socket.emit('broadcast_scores', data.allPlayers);
                // 戻したのがコース終了だった可能性があるので、安全側に倒して解除する。
                // それ以外の操作を戻した場合でも、押し直せば同じ結果になる（終了処理は冪等）。
                changeState({ finishedOrder: null });
            } else {
                setErrorMessage(data.error || 'Undo に失敗しました');
            }
        } catch (error) {
            console.error('Undo failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    // ---- ここから、表示に使う値を状態から導出する ----

    // 抽選済みのコースを実施順に並べる
    const drawnCourses = courses
        .filter(c => c.playOrder !== null)
        .sort((a, b) => (a.playOrder as number) - (b.playOrder as number));
    const remainingCourses = courses.filter(c => c.playOrder === null);
    const isAllDrawn = courses.length > 0 && remainingCourses.length === 0;

    // いま処理中のコース＝最後に抽選されたコース。
    // 順番に処理していくので、playOrder が最大のものが常に現在のコースになる。
    const currentCourse = drawnCourses.length > 0
        ? drawnCourses[drawnCourses.length - 1]
        : null;

    // クイズ実施フェーズで対象になっているコース（Main 側と同じ導出）
    const quizCourse = drawnCourses.find(c => c.playOrder === thirdRoundState.quizOrder);

    // 表示中のコースのタイマー。配信された状態から導出する。
    // キーが無いコースは「まだ一度も動かしていない」＝制限時間のまま。
    const remaining = timer.remainings[thirdRoundState.quizOrder] ?? COURSE_TIME_LIMIT_SECONDS;
    const isTimerRunning = timer.runningOrder === thirdRoundState.quizOrder;

    // そのコースに割り当て済みの選手。
    // 「確定済みかどうか」を状態として持たず、ここから判定する。
    const assignedToCurrent = currentCourse
        ? winners.filter(p => p.thirdRoundCourseName === currentCourse.name)
        : [];
    const isCurrentAssigned = assignedToCurrent.length >= 5;

    // まだどのコースにも割り当てられていない選手（エントリー対象）
    const unassignedWinners = winners.filter(p => !p.thirdRoundCourseName);

    // クイズ実施中のコースの出場者5名。
    // winners は優先順位（2R勝ち抜け順 → 1R順位）で並んでいるので、絞り込んでも順序は保たれる。
    // 「誰が出場するか」は Player.thirdRoundCourseName が持っているため、ここでは導出するだけ。
    const quizPlayers = quizCourse
        ? winners.filter(p => p.thirdRoundCourseName === quizCourse.name)
        : [];

    // 表示する数字はコースによって変わる。
    // 10 up-down はポイント、10 by 10 は「正解pt × 誤答pt = 総合pt」
    const isUpDown = quizCourse?.name === THIRD_ROUND_COURSES.UP_DOWN;
    const isTenByTen = quizCourse?.name === THIRD_ROUND_COURSES.TEN_BY_TEN;
    const isSwedish = quizCourse?.name === THIRD_ROUND_COURSES.SWEDISH;
    // スルーを記録するのは Freeze 10 だけ。他の3コースでは何にも影響しないため
    // ボタン自体を出さない（決定事項2）
    const isFreeze = quizCourse?.name === THIRD_ROUND_COURSES.FREEZE;

    // 終了条件を満たしたか。データは変えず、提示するだけ（決定事項5）
    const finishState = getCourseFinishState(quizPlayers);

    // コース終了の操作。タイマーが0でも自動では発火させない（決定事項5）。
    // 最後に読まれていた問題の判定を入力できなくなるため。
    const handleFinishCourse = async () => {
        if (!window.confirm('このコースを終了し、判定基準で順位を確定しますか？')) return;
        await handleScore(null, 'finish');
        // 「終了処理を走らせた」という事実はデータから復元できないので状態に残す
        changeState({ finishedOrder: thirdRoundState.quizOrder });
    };

    // プレーオフの対象者。コース終了処理で決着した人には順位が入っているので、
    // rank === 0 で残った選手がそのまま対象になる。リストは保存しない。
    const playoffPlayers = quizPlayers.filter(p => p.thirdRoundRank === 0);
    const playoffSeats = 2 - finishState.winnersCount;

    // 終了処理を走らせたうえで、判定基準で決着しなかった選手が残っている状態。
    //
    // 「終了処理を走らせたか」を敗退者の有無で代用してはいけない。コース途中でも
    // 失格者は出るため、たとえば「失格2名・勝ち抜け0名・解答席3名」で成立してしまう。
    const needsPlayoff =
        thirdRoundState.finishedOrder === thirdRoundState.quizOrder
        && playoffPlayers.length > 0;

    const isClosed = thirdRoundState.step === 'closed';

    // ---- 操作 ----

    const handleDraw = async () => {
        setIsBusy(true);
        setErrorMessage("");
        try {
            const res = await fetch('/api/thirdRound/draw', { method: 'POST' });
            const data = await res.json();

            if (data.success && socket) {
                // 必要なデータだけを送る。レスポンス全体を送ると、そのイベントが
                // 何を運ぶのかが曖昧になり、受信側ごとに読む項目がずれる原因になる。
                socket.emit('broadcast_third_round_courses', data.courses);
                // 新しいコースのエントリータイムが始まるので、締切状態を解除する
                changeState({ step: 'entry' });
            } else {
                setErrorMessage(data.error || '抽選に失敗しました');
            }
        } catch (error) {
            console.error('Draw failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    const handleReset = async () => {
        if (!window.confirm('抽選をリセットしますか？決まった実施順はすべて失われます。')) return;

        setIsBusy(true);
        setErrorMessage("");
        try {
            const res = await fetch('/api/thirdRound/draw', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                // 確認ダイアログでOKされたときだけ force を送る
                body: JSON.stringify({ force: true })
            });
            const data = await res.json();

            if (data.success && socket) {
                // データ種別ごとに経路を分ける。
                // リセットは実施順と所属コースの両方を消すので、両方を配信する必要がある。
                socket.emit('broadcast_third_round_courses', data.courses);   // コース情報
                socket.emit('broadcast_scores', data.allPlayers);             // 選手情報
                changeState({ step: 'entry' });
            } else {
                setErrorMessage(data.error || 'リセットに失敗しました');
            }
        } catch (error) {
            console.error('Reset failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    const toggleRaised = (playerId: number) => {
        if (!isClosed) return;   // 締切前は操作させない
        setRaisedIds(prev =>
            prev.includes(playerId)
                ? prev.filter(id => id !== playerId)
                : [...prev, playerId]
        );
    };

    const handleAssign = async () => {
        if (!currentCourse) return;

        setIsBusy(true);
        setErrorMessage("");
        try {
            const res = await fetch('/api/thirdRound/assignCourse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseName: currentCourse.name, raisedIds })
            });
            const data = await res.json();

            if (data.success && socket) {
                // 掲げた／強制出場の内訳は自分の画面でしか使わないので、ここで持つ
                setLastAssigned(data.assigned);
                // 選手データは Socket 経由で全画面に配る（Main の強調表示に必要）
                socket.emit('broadcast_scores', data.allPlayers);
            } else {
                setErrorMessage(data.error || '確定に失敗しました');
            }
        } catch (error) {
            console.error('Assign failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    const handleUnassign = async () => {
        if (!currentCourse) return;
        if (!window.confirm(`「${currentCourse.name}」の出場者確定を取り消しますか？`)) return;

        setIsBusy(true);
        setErrorMessage("");
        try {
            const res = await fetch('/api/thirdRound/assignCourse', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseName: currentCourse.name, force: true })
            });
            const data = await res.json();

            if (data.success && socket) {
                setLastAssigned([]);
                setRaisedIds([]);
                socket.emit('broadcast_scores', data.allPlayers);
                // 締切前に戻して、エントリーからやり直せるようにする
                changeState({ step: 'entry' });
            } else {
                setErrorMessage(data.error || '取り消しに失敗しました');
            }
        } catch (error) {
            console.error('Unassign failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    return (
        <div className="flex flex-col gap-6 bg-white dark:bg-zinc-800 p-8 rounded-xl shadow-md w-full max-w-5xl">
            <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 border-b pb-4 border-zinc-200 dark:border-zinc-700">
                3rd Round 管理画面
            </h2>

            {/* フェーズの切り替え */}
            <div className="flex flex-col gap-2">
                <span className="text-sm font-bold text-zinc-700 dark:text-zinc-300">進行フェーズ</span>
                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={() => changeState({ phase: 'courseSelect' })}
                        className={`px-5 py-2.5 rounded-lg font-bold transition-all shadow-sm ${thirdRoundState.phase === 'courseSelect'
                            ? "bg-purple-600 text-white ring-2 ring-purple-500/50"
                            : "bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-800 dark:text-zinc-200"
                            }`}
                    >
                        コース選択
                    </button>
                    {[1, 2, 3, 4].map((order) => (
                        <button
                            key={order}
                            onClick={() => changeState({ phase: 'quiz', quizOrder: order })}
                            className={`px-5 py-2.5 rounded-lg font-bold transition-all shadow-sm ${thirdRoundState.phase === 'quiz' && thirdRoundState.quizOrder === order
                                ? "bg-blue-600 text-white ring-2 ring-blue-500/50"
                                : "bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-800 dark:text-zinc-200"
                                }`}
                        >
                            {order}コース目
                        </button>
                    ))}
                </div>
            </div>

            <hr className="border-zinc-200 dark:border-zinc-700" />

            {/* ===== コース選択フェーズ（抽選とエントリーを1画面で行う）===== */}
            {thirdRoundState.phase === 'courseSelect' && (
                <div className="flex flex-col gap-6">

                    {errorMessage && (
                        <div className="px-4 py-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300 text-sm font-bold">
                            {errorMessage}
                        </div>
                    )}

                    {/* --- 実施順 --- */}
                    <div className="flex flex-col gap-3">
                        <div className="flex justify-between items-center">
                            <span className="text-sm font-bold text-zinc-700 dark:text-zinc-300">
                                コース実施順（{drawnCourses.length} / 4 確定）
                            </span>
                            <button
                                onClick={handleReset}
                                disabled={isBusy || drawnCourses.length === 0}
                                className="px-4 py-1.5 rounded-lg text-xs font-bold bg-red-100 hover:bg-red-200 dark:bg-red-950/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-400 border border-red-200/50 dark:border-red-900/30 disabled:opacity-40 transition-colors"
                            >
                                リセット
                            </button>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {[1, 2, 3, 4].map((order) => {
                                const course = drawnCourses.find(c => c.playOrder === order);
                                const isCurrent = currentCourse?.playOrder === order;
                                return (
                                    <div
                                        key={order}
                                        className={`rounded-xl p-4 border flex flex-col items-center justify-center min-h-[100px] transition-all ${course
                                            ? isCurrent
                                                ? "bg-purple-50 dark:bg-purple-950/20 border-2 border-purple-400 dark:border-purple-600"
                                                : "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800"
                                            : "bg-zinc-50 dark:bg-zinc-900/40 border-dashed border-zinc-300 dark:border-zinc-700"
                                            }`}
                                    >
                                        <span className="text-[10px] font-mono font-bold text-zinc-400 dark:text-zinc-500 mb-2">
                                            {order} 番目
                                        </span>
                                        <span className={`text-base font-black text-center ${course
                                            ? isCurrent
                                                ? "text-purple-800 dark:text-purple-300"
                                                : "text-emerald-800 dark:text-emerald-300"
                                            : "text-zinc-300 dark:text-zinc-700"
                                            }`}>
                                            {course ? course.name : "？"}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <hr className="border-zinc-200 dark:border-zinc-700" />

                    {/* --- 現在のコースの操作 --- */}
                    {/* 進行状況に応じて、次に押すべき操作だけを表示する */}

                    {/* 状況4: 現在のコースの出場者が確定済み → 結果と取り消し */}
                    {currentCourse && isCurrentAssigned && (
                        <div className="flex flex-col gap-3">
                            <div className="flex justify-between items-center">
                                <span className="text-sm font-bold text-zinc-700 dark:text-zinc-300">
                                    {currentCourse.playOrder} 番目「{currentCourse.name}」の出場者
                                </span>
                                <button
                                    onClick={handleUnassign}
                                    disabled={isBusy}
                                    className="px-4 py-1.5 rounded-lg text-xs font-bold bg-red-100 hover:bg-red-200 dark:bg-red-950/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-400 border border-red-200/50 dark:border-red-900/30 disabled:opacity-40 transition-colors"
                                >
                                    確定を取り消す
                                </button>
                            </div>

                            {/* 掲げた／強制出場を区別して出す。
                                強制出場が優先順位の下位から選ばれているかをその場で検算できる */}
                            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                                {assignedToCurrent.map((p) => {
                                    const detail = lastAssigned.find(a => a.id === p.id);
                                    const forced = detail?.forced;
                                    return (
                                        <div
                                            key={p.id}
                                            className={`p-3 rounded-lg border ${forced
                                                ? "bg-amber-50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800"
                                                : "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800"
                                                }`}
                                        >
                                            <div className="text-sm font-black text-zinc-800 dark:text-zinc-200 truncate">
                                                {p.name}
                                            </div>
                                            <div className="text-[9px] font-mono text-zinc-400 mt-0.5">
                                                2R{p.secondRoundRank}位 / 1R{p.paperRank}位
                                            </div>
                                            {detail && (
                                                <div className={`mt-1.5 text-[10px] font-bold ${forced
                                                    ? "text-amber-700 dark:text-amber-400"
                                                    : "text-emerald-700 dark:text-emerald-400"
                                                    }`}>
                                                    {forced ? "強制出場" : "掲げた"}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {lastAssigned.length === 0 && (
                                <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                                    ※ 掲げた／強制出場の内訳は確定直後のみ表示されます（保存していないため、リロードすると消えます）
                                </p>
                            )}
                        </div>
                    )}

                    {/* 状況1: まだ1つも抽選していない、または前のコースが確定済み */}
                    {(!currentCourse || isCurrentAssigned) && !isAllDrawn && (
                        <div className="flex flex-col gap-3">
                            <span className="text-sm font-bold text-zinc-700 dark:text-zinc-300">
                                次の操作
                            </span>
                            {remainingCourses.length === 1 && (
                                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                    残り1コース（{remainingCourses[0].name}）のため、抽選の余地はありません。
                                </p>
                            )}
                            <button
                                onClick={handleDraw}
                                disabled={isBusy}
                                className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white font-bold py-4 rounded-lg transition-colors"
                            >
                                {drawnCourses.length + 1} 番目のコースを抽選する
                            </button>
                        </div>
                    )}

                    {/* 状況2〜4: 現在のコースがあり、まだ出場者が確定していない */}
                    {currentCourse && !isCurrentAssigned && (
                        <div className="flex flex-col gap-4">
                            <div className="flex justify-between items-center">
                                <span className="text-sm font-bold text-zinc-700 dark:text-zinc-300">
                                    現在: {currentCourse.playOrder} 番目「{currentCourse.name}」
                                </span>
                                <span className={`px-3 py-1 rounded-full text-xs font-bold ${isClosed
                                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                                    : "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                                    }`}>
                                    {isClosed ? "エントリー締切済み" : "エントリータイム中"}
                                </span>
                            </div>

                            {/* 状況2: 締切前 */}
                            {!isClosed && (
                                <>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                        エントリータイムは専用BGMで計測します。BGMが終わったら締切を押してください。
                                    </p>
                                    <button
                                        onClick={() => changeState({ step: 'closed' })}
                                        className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold py-4 rounded-lg transition-colors"
                                    >
                                        エントリー締切
                                    </button>
                                </>
                            )}

                            {/* 掲げた人のチェック欄。締切前はグレーアウトして操作できない */}
                            <div className="flex flex-col gap-2">
                                <div className="flex justify-between items-center">
                                    <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400">
                                        プレートを掲げていた人にチェック
                                    </span>
                                    <span className="text-xs font-mono text-zinc-500">
                                        {raisedIds.length} 名選択中 / 未割当 {unassignedWinners.length} 名
                                    </span>
                                </div>

                                {!isClosed && (
                                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                                        ── 締切後に入力できます ──
                                    </p>
                                )}

                                <div className={`grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2 ${isClosed ? "" : "opacity-40 pointer-events-none"
                                    }`}>
                                    {unassignedWinners.map((p, index) => {
                                        const checked = raisedIds.includes(p.id);
                                        return (
                                            <button
                                                key={p.id}
                                                onClick={() => toggleRaised(p.id)}
                                                className={`text-left p-2 rounded-lg border transition-all ${checked
                                                    ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-400 dark:border-emerald-700"
                                                    : "bg-white dark:bg-zinc-900/40 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300"
                                                    }`}
                                            >
                                                <div className="flex items-center gap-1.5">
                                                    <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px] font-black ${checked
                                                        ? "bg-emerald-500 border-emerald-500 text-white"
                                                        : "border-zinc-300 dark:border-zinc-600"
                                                        }`}>
                                                        {checked ? "✓" : ""}
                                                    </span>
                                                    <span className="text-[9px] font-mono text-zinc-400">
                                                        優先{index + 1}
                                                    </span>
                                                </div>
                                                <div className="text-xs font-bold text-zinc-800 dark:text-zinc-200 mt-1 truncate">
                                                    {p.name}
                                                </div>
                                                <div className="text-[9px] font-mono text-zinc-400">
                                                    2R{p.secondRoundRank}位 / 1R{p.paperRank}位
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* 状況3: 締切済み → 出場者を確定する */}
                            {isClosed && (
                                <button
                                    onClick={handleAssign}
                                    disabled={isBusy}
                                    className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white font-bold py-4 rounded-lg transition-colors"
                                >
                                    出場者を確定する（掲げた {raisedIds.length} 名 + 強制出場 {Math.max(0, 5 - raisedIds.length)} 名）
                                </button>
                            )}
                        </div>
                    )}

                    {/* 状況5: 4コースすべて抽選済みで、現在のコースも確定済み */}
                    {isAllDrawn && isCurrentAssigned && (
                        <button
                            onClick={() => changeState({ phase: 'quiz', quizOrder: 1 })}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-lg transition-colors"
                        >
                            クイズ実施へ進む
                        </button>
                    )}
                </div>
            )}

            {/* ===== クイズ実施フェーズ ===== */}
            {thirdRoundState.phase === 'quiz' && (
                <div className="p-6 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-zinc-800 w-full flex flex-col items-center gap-6">
                    <h3 className="text-xl font-bold text-zinc-800 dark:text-zinc-200">
                        {thirdRoundState.quizOrder} コース目
                        {quizCourse && `: ${quizCourse.name}`}
                    </h3>

                    {/* 15分タイマー */}
                    <div className="flex flex-col items-center gap-4 w-full max-w-md">
                        <div
                            className={`font-mono font-black text-6xl tabular-nums ${remaining === 0
                                ? "text-red-600 dark:text-red-500"
                                : remaining <= 60
                                    ? "text-amber-600 dark:text-amber-500"
                                    : "text-zinc-900 dark:text-zinc-100"
                                }`}
                        >
                            {formatTime(remaining)}
                        </div>

                        <span className="text-xs font-bold tracking-wider text-zinc-500 dark:text-zinc-400">
                            {remaining === 0
                                // 0秒でも操作は受け付け続ける（設計メモ 4.2）。
                                // コースの終了はスタッフの明示操作で行う。
                                ? "時間切れ（最後の問題の判定は入力できます）"
                                : isTimerRunning ? "計測中" : "停止中"}
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

                        {/* 残り時間の手動編集。疑義の申し立てで時間を戻す場合や、
                            開始を忘れたまま進行してしまった場合の復旧手段。
                            編集するとサーバ側で時計が止まる。再開は明示操作。 */}
                        {isEditingTimer ? (
                            <div className="w-full flex flex-col gap-3 p-3 rounded-lg border border-zinc-300 dark:border-zinc-600">
                                <div className="flex items-center justify-center gap-2 font-mono">
                                    <input
                                        type="number"
                                        min={0}
                                        max={15}
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

                    {/* 終了条件の提示。システムはコースを勝手に締めない（決定事項5）。
                        スタッフが上のコース切り替えで次へ進める。 */}
                    {finishState.finished && (
                        <div className="w-full p-4 rounded-xl border-2 border-amber-400 dark:border-amber-500 bg-amber-50 dark:bg-amber-950/20">
                            <p className="font-black text-amber-700 dark:text-amber-400">
                                終了条件を満たしました
                                {finishState.reason === 'allWinnersDecided'
                                    ? `：${finishState.winnersCount}名が勝ち抜け`
                                    : `：${finishState.eliminatedCount}名が失格（残り${finishState.activeCount}名 ＝ 残り枠）`}
                            </p>
                            <p className="text-sm text-amber-700/80 dark:text-amber-400/80 mt-1">
                                {finishState.reason === 'seatsMatchRemaining'
                                    ? '解答席に残っていた全員を勝ち抜けにしました（ポイント多い順、同点は席順）。'
                                    : ''}
                                上の切り替えで次のコースへ進んでください。
                            </p>
                        </div>
                    )}

                    {/* 出場者5名。優先順位順に並ぶ（winners の並びをそのまま引き継ぐ） */}
                    <div className="w-full">
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="font-bold text-zinc-700 dark:text-zinc-300">出場者</h4>
                            <span className="text-sm text-zinc-500 dark:text-zinc-400">
                                勝ち抜け {finishState.winnersCount} / 敗退 {finishState.eliminatedCount} / 解答席 {finishState.activeCount}
                            </span>
                        </div>

                        <div className="grid grid-cols-5 gap-3">
                            {quizPlayers.map(p => {
                                // 勝ち抜け → 正の数、失格 → −1、未決着 → 0
                                const isWinner = p.thirdRoundRank > 0;
                                const isEliminated = p.thirdRoundRank < 0;
                                const isSettled = p.thirdRoundRank !== 0;
                                // Freeze 10 の休み中は解答権が無い（設計メモ 3.3）
                                const isResting = isFreeze && p.thirdRoundFreezeRest > 0;

                                return (
                                    <div
                                        key={p.id}
                                        className={`p-4 border rounded-xl flex flex-col gap-2 transition-all ${isWinner
                                            ? "border-amber-400 dark:border-amber-500 bg-amber-50 dark:bg-amber-950/20"
                                            : isEliminated
                                                ? "border-transparent bg-zinc-200 dark:bg-zinc-900 opacity-60"
                                                : "border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
                                            }`}
                                    >
                                        <div className="flex justify-between text-xs font-mono text-zinc-500">
                                            <span>No.{p.entryNo}</span>
                                            <span>2R{p.secondRoundRank}位</span>
                                        </div>
                                        <div className="text-center font-black text-lg truncate" title={p.name}>
                                            {p.name}
                                        </div>

                                        {/* 表示する数字はコースによって変える。
                                            10 up-down で見るべきなのはポイントで、正解数ではない。
                                            ポイントは誤答で0に戻るため、正解数を出すと
                                            「⭕️7」なのに勝ち抜けまで残り3問ではない、という
                                            進行卓が誤読しやすい表示になる。 */}
                                        {isTenByTen ? (
                                            // ルールの式をそのまま出す。誤答は回数ではなく
                                            // 誤答ポイント（10 から始まり誤答ごとに1減る）。
                                            // スタッフがその場で暗算して検算できる。
                                            <div className="flex justify-center items-baseline gap-1 font-mono font-bold text-sm">
                                                <span className="text-emerald-600 dark:text-emerald-400">
                                                    {p.thirdRoundCorrectCount}
                                                </span>
                                                <span className="text-zinc-400">×</span>
                                                <span className="text-red-600 dark:text-red-400">
                                                    {getTenByTenWrongPoint(p)}
                                                </span>
                                                <span className="text-zinc-400">=</span>
                                                <span className="text-blue-600 dark:text-blue-400 text-base">
                                                    {getTenByTenTotal(p)}
                                                </span>
                                            </div>
                                        ) : (
                                            <div className="flex justify-center gap-4 font-mono font-bold text-sm">
                                                {isUpDown ? (
                                                    <span className="text-blue-600 dark:text-blue-400">
                                                        {p.thirdRoundUpDownPoint} pt
                                                    </span>
                                                ) : (
                                                    <span className="text-emerald-600 dark:text-emerald-400">
                                                        ⭕️ {p.thirdRoundCorrectCount}
                                                    </span>
                                                )}
                                                <span className="text-red-600 dark:text-red-400">
                                                    {/* Swedish 10 で意味を持つのは×の合計。
                                                        誤答回数は失格判定にも判定基準にも使わない。 */}
                                                    {isSwedish
                                                        ? `× ${p.thirdRoundSwedishCross}`
                                                        : `❌ ${p.thirdRoundWrongCount}`}
                                                </span>
                                            </div>
                                        )}

                                        {/* Freeze 10 のみ。残り問数が1以上の選手は解答権を持たない */}
                                        {isFreeze && p.thirdRoundFreezeRest > 0 && (
                                            <div className="text-center font-black text-sky-600 dark:text-sky-400 text-sm">
                                                ❄️ 休み {p.thirdRoundFreezeRest} 問
                                            </div>
                                        )}

                                        {isSettled ? (
                                            <div className={`text-center font-black py-2 text-sm ${isWinner
                                                ? "text-amber-600 dark:text-amber-400"
                                                : "text-zinc-500"
                                                }`}>
                                                {isWinner
                                                    ? `👑 勝ち抜け（${p.thirdRoundRank}位）`
                                                    // 失格と敗退は DB 上どちらも −1。コースの失格条件から導出して出し分ける
                                                    : quizCourse && isEliminatedByCourseRule(
                                                        quizCourse.name as ThirdRoundCourseName, p)
                                                        ? "❌ 失格"
                                                        : "－ 敗退"}
                                            </div>
                                        ) : (
                                            <div className="flex gap-2 w-full">
                                                <button
                                                    onClick={() => handleScore(p.id, 'correct')}
                                                    disabled={isBusy || isResting}
                                                    className="flex-1 bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-bold py-2 rounded-lg transition-colors text-sm"
                                                >
                                                    正解
                                                </button>
                                                <button
                                                    onClick={() => handleScore(p.id, 'wrong')}
                                                    disabled={isBusy || isResting}
                                                    className="flex-1 bg-red-500 hover:bg-red-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-bold py-2 rounded-lg transition-colors text-sm"
                                                >
                                                    誤答
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {quizPlayers.length === 0 && (
                            <div className="py-10 text-center text-zinc-500 dark:text-zinc-400 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl">
                                このコースの出場者がまだ確定していません。
                            </div>
                        )}

                        {/* コース終了は終了条件3（15分経過）専用の操作。
                            条件1（2名勝ち抜け）と条件2（3名失格）は自動で決着済みなので要らない。
                            そのため 0秒に到達したときだけ出す。
                            0秒でも自動では発火させない（決定事項5）。最後に読まれていた
                            問題の判定を入力できなくなるため。 */}
                        {quizPlayers.length > 0 && finishState.activeCount > 0 && remaining === 0 && (
                            <button
                                onClick={handleFinishCourse}
                                disabled={isBusy}
                                className="mt-4 w-full bg-purple-600 hover:bg-purple-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg transition-colors"
                            >
                                コース終了（判定基準で順位を確定する）
                            </button>
                        )}

                        {/* 判定基準で決着しなかった選手が残っている状態。
                            対象者リストは持たず、rank === 0 のまま残った人がそのまま対象になる。
                            移行は明示操作にする。会場では司会の進行が入るため、
                            システムが勝手に画面を切り替えるとタイミングが合わない。 */}
                        {needsPlayoff && (
                            <div className="mt-3 p-4 rounded-xl border-2 border-purple-400 dark:border-purple-600 bg-purple-50 dark:bg-purple-950/20">
                                <p className="font-black text-purple-700 dark:text-purple-300">
                                    判定基準で決着しませんでした（{playoffPlayers.length}名が同値、残り{playoffSeats}枠）
                                </p>
                                <button
                                    onClick={() => changeState({ phase: 'playoff' })}
                                    className="mt-3 w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 rounded-lg transition-colors"
                                >
                                    プレーオフへ
                                </button>
                            </div>
                        )}

                        {quizPlayers.length > 0 && (
                            <div className="mt-4 flex gap-3">
                                {/* スルーを記録するのは Freeze 10 だけ（決定事項2）。
                                    選手に紐づかない「問題が1問終わった」というイベントで、
                                    休み中の選手の残り問数を減らす契機になる。 */}
                                {isFreeze && (
                                    <button
                                        onClick={() => handleScore(null, 'through')}
                                        disabled={isBusy}
                                        className="flex-1 bg-sky-500 hover:bg-sky-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg transition-colors"
                                    >
                                        スルー（1問終了）
                                    </button>
                                )}
                                <button
                                    onClick={handleScoreUndo}
                                    disabled={isBusy}
                                    className="flex-1 bg-yellow-500 hover:bg-yellow-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg transition-colors"
                                >
                                    Undo（このコースのスコアを1手戻す）
                                </button>
                            </div>
                        )}
                    </div>

                </div>
            )}

            {/* ===== プレーオフ ===== */}
            {thirdRoundState.phase === 'playoff' && (
                <div className="p-6 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-zinc-800 w-full flex flex-col items-center gap-6">
                    <div className="text-center">
                        <h3 className="text-xl font-bold text-zinc-800 dark:text-zinc-200">
                            早押しプレーオフ
                            {quizCourse && `：${quizCourse.name}`}
                        </h3>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                            1問正解で勝ち抜け・1問誤答で敗退。残り {playoffSeats} 枠
                        </p>
                    </div>

                    {playoffPlayers.length > 0 ? (
                        <div className="w-full grid grid-cols-5 gap-3">
                            {playoffPlayers.map(p => (
                                <div
                                    key={p.id}
                                    className="p-4 border border-purple-300 dark:border-purple-700 bg-white dark:bg-zinc-800 rounded-xl flex flex-col gap-2"
                                >
                                    <div className="flex justify-between text-xs font-mono text-zinc-500">
                                        <span>No.{p.entryNo}</span>
                                        <span>2R{p.secondRoundRank}位</span>
                                    </div>
                                    <div className="text-center font-black text-lg truncate" title={p.name}>
                                        {p.name}
                                    </div>
                                    <div className="text-center text-xs text-zinc-500 dark:text-zinc-400 truncate">
                                        {p.school || "未登録"}
                                    </div>

                                    {/* プレーオフは1問正解で勝ち抜け・1問誤答で敗退。
                                        スルーはこの場面では使わないのでボタンを出さない。
                                        決着した選手はこの一覧から消えるため、
                                        ボタンを無効化する処理は要らない。 */}
                                    <div className="flex gap-2 w-full mt-1">
                                        <button
                                            onClick={() => handlePlayoffScore(p.id, 'correct')}
                                            disabled={isBusy}
                                            className="flex-1 bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-bold py-2 rounded-lg transition-colors text-sm"
                                        >
                                            正解
                                        </button>
                                        <button
                                            onClick={() => handlePlayoffScore(p.id, 'wrong')}
                                            disabled={isBusy}
                                            className="flex-1 bg-red-500 hover:bg-red-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-bold py-2 rounded-lg transition-colors text-sm"
                                        >
                                            誤答
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="py-10 text-center text-zinc-500 dark:text-zinc-400 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl w-full">
                            プレーオフの対象者がいません。上の切り替えでコースへ戻ってください。
                        </div>
                    )}

                    {/* プレーオフの結果もコース単位の履歴に入るので Undo で戻せる */}
                    {playoffPlayers.length > 0 && (
                        <button
                            onClick={handleScoreUndo}
                            disabled={isBusy}
                            className="w-full bg-yellow-500 hover:bg-yellow-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg transition-colors"
                        >
                            Undo（1手戻す）
                        </button>
                    )}

                    <p className="text-zinc-500 dark:text-zinc-400 text-sm">
                        戻るときは上のコース切り替えを使ってください。
                    </p>
                </div>
            )}
        </div>
    );
}
