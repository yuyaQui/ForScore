import { Socket } from "socket.io-client";
import { useEffect, useState } from "react";
import type { Player, ThirdRoundTimer } from "@/lib/types";
import { COURSE_TIME_LIMIT_SECONDS, THIRD_ROUND_COURSES } from "@/lib/thirdRoundCourses";
import { formatTime } from "@/lib/formatTime";
import {
    getCourseFinishState,
    getTenByTenTotal,
    getTenByTenWrongPoint
} from "@/lib/thirdRoundScoring";

type Props = {
    players: Player[],
    socket: Socket | null,
    setPlayers: (players: Player[]) => void
}

type Course = {
    id: number;
    name: string;
    playOrder: number | null;
}

type ThirdRoundState = {
    phase: "courseSelect" | "quiz";
    step: "entry" | "closed";
    quizOrder: number;
}

export default function MainThirdRound(props: Props) {
    const { players, socket, setPlayers } = props;

    const [thirdRoundState, setThirdRoundState] = useState<ThirdRoundState>({
        phase: "courseSelect",
        step: "entry",
        quizOrder: 1
    });
    const [courses, setCourses] = useState<Course[]>([]);
    // 15分タイマー。時計はサーバが持っており、Main は受け取った値を映すだけ。
    // 接続直後にサーバから現在値が届くので、初期値は表示が一瞬崩れないための仮置き。
    const [timer, setTimer] = useState<ThirdRoundTimer>({
        remainings: {},
        runningOrder: null
    });

    useEffect(() => {
        // 画面を開いた直後の1回だけ、現在の状態を直接取得する。
        //
        // 選手データも自分で取りに行く。親（app/main/page.tsx）は Socket の
        // update_players しか見ていないため、これがないと投影画面を開いた直後は
        // 誰かが操作するまで選手が表示されない。
        fetch('/api/secondRound/loadPlayers')
            .then(res => res.json())
            .then(data => { if (data.success) setPlayers(data.allPlayers); })
            .catch(err => console.error("Failed to load players", err));

        fetch('/api/thirdRound/courses')
            .then(res => res.json())
            .then(data => { if (data.success) setCourses(data.courses); })
            .catch(err => console.error("Failed to load third round courses", err));

        if (socket) {
            const handleStateUpdate = (state: ThirdRoundState) => setThirdRoundState(state);
            const handleCoursesUpdate = (courses: Course[]) => setCourses(courses);
            const handleTimerUpdate = (next: ThirdRoundTimer) => setTimer(next);

            socket.on("update_third_round_state", handleStateUpdate);
            socket.on("update_third_round_courses", handleCoursesUpdate);
            socket.on("update_third_round_timer", handleTimerUpdate);

            return () => {
                socket.off("update_third_round_state", handleStateUpdate);
                socket.off("update_third_round_courses", handleCoursesUpdate);
                socket.off("update_third_round_timer", handleTimerUpdate);
            };
        }
        // setPlayers は親（app/main/page.tsx）の useState の setter で、React が
        // 参照の同一性を保証している。依存配列に加えても実行回数は変わらない。
    }, [socket, setPlayers]);

    // ---- 表示に使う値を導出する（Admin と同じ規則）----

    const drawnCourses = courses
        .filter(c => c.playOrder !== null)
        .sort((a, b) => (a.playOrder as number) - (b.playOrder as number));

    // 順番に処理していくので、playOrder が最大のものが現在のコースになる
    const currentCourse = drawnCourses.length > 0
        ? drawnCourses[drawnCourses.length - 1]
        : null;

    // コース選択の優先順位: 2nd Round 勝ち抜け順 → 1st Round 順位
    const winners = players
        .filter(p => p.secondRoundRank >= 1)
        .sort((a, b) =>
            a.secondRoundRank !== b.secondRoundRank
                ? a.secondRoundRank - b.secondRoundRank
                : a.paperRank - b.paperRank
        );

    // 「確定済みかどうか」は状態として持たず、割当済みの人数から判定する
    const assignedToCurrent = currentCourse
        ? winners.filter(p => p.thirdRoundCourseName === currentCourse.name)
        : [];
    const isCurrentAssigned = assignedToCurrent.length >= 5;

    const isClosed = thirdRoundState.step === 'closed';

    // 常に20枠（2行×10列）を維持する
    const gridItems = Array.from({ length: 20 }, (_, index) => winners[index] || null);

    // クイズ実施フェーズで対象になっているコース
    const quizCourse = drawnCourses.find(c => c.playOrder === thirdRoundState.quizOrder);

    // 表示中のコースの残り秒数。キーが無ければ「まだ動かしていない」＝制限時間のまま。
    // Main は稼働中かどうかを表示しないので runningOrder は使わない。
    const remaining = timer.remainings[thirdRoundState.quizOrder] ?? COURSE_TIME_LIMIT_SECONDS;

    // クイズ実施中のコースの出場者5名（Admin と同じ導出）。
    // winners が優先順位順に並んでいるので、絞り込んでも順序は保たれる。
    const quizPlayers = quizCourse
        ? winners.filter(p => p.thirdRoundCourseName === quizCourse.name)
        : [];

    // 表示する数字はコースによって変わる（Admin と同じ規則）。
    // 10 up-down はポイント、10 by 10 は「正解pt × 誤答pt = 総合pt」
    const isUpDown = quizCourse?.name === THIRD_ROUND_COURSES.UP_DOWN;
    const isTenByTen = quizCourse?.name === THIRD_ROUND_COURSES.TEN_BY_TEN;
    const isSwedish = quizCourse?.name === THIRD_ROUND_COURSES.SWEDISH;
    const isFreeze = quizCourse?.name === THIRD_ROUND_COURSES.FREEZE;

    // 終了条件（Admin と同じ関数で判定する）
    const finishState = getCourseFinishState(quizPlayers);

    // ---- 現在の状況を表す見出し ----
    let statusLabel: string;
    if (!currentCourse) {
        statusLabel = "抽選をお待ちください";
    } else if (isCurrentAssigned) {
        statusLabel = "出場者決定";
    } else if (isClosed) {
        statusLabel = "エントリー締切";
    } else {
        statusLabel = "エントリータイム中";
    }

    // ===== クイズ実施フェーズ（中身は後のステップで実装）=====
    if (thirdRoundState.phase === 'quiz') {
        return (
            <div className="w-full max-w-7xl flex flex-col items-center justify-center min-h-[80vh] px-4 py-8 z-10">
                <div className="text-center animate-fade-in w-full">
                    <span className="px-4 py-1.5 rounded-full text-xs font-bold tracking-widest uppercase bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/30">
                        3rd Round 第 {thirdRoundState.quizOrder} コース
                    </span>
                    <h1 className="mt-4 text-5xl font-black tracking-tight text-zinc-950 dark:text-white">
                        {quizCourse ? quizCourse.name : "コース未確定"}
                    </h1>

                    {/* 15分タイマー。
                        0秒到達はコースの終了ではないので、表示を消したり止めたりしない。
                        色だけ変えて「時間切れ」を伝える（設計メモ 4.2）。 */}
                    <div className="mt-12 p-12 bg-white/80 dark:bg-zinc-800/80 backdrop-blur-md border border-zinc-200/50 dark:border-zinc-700/50 rounded-3xl shadow-2xl max-w-2xl mx-auto flex flex-col items-center justify-center min-h-[250px]">
                        <div
                            className={`font-mono font-black text-8xl tabular-nums leading-none ${remaining === 0
                                ? "text-red-600 dark:text-red-500"
                                : remaining <= 60
                                    ? "text-amber-600 dark:text-amber-500 animate-pulse"
                                    : "text-zinc-900 dark:text-white"
                                }`}
                        >
                            {formatTime(remaining)}
                        </div>
                        {remaining === 0 && (
                            <p className="mt-6 text-2xl font-black tracking-widest text-red-600 dark:text-red-500">
                                TIME UP
                            </p>
                        )}
                    </div>

                    {/* 出場者5名のスコアボード。並びは優先順位順（winners の並びを引き継ぐ） */}
                    <div className="mt-10 w-full grid grid-cols-5 gap-4">
                        {quizPlayers.map(p => {
                            // 勝ち抜け → 正の数、失格 → −1、未決着 → 0
                            const isWinner = p.thirdRoundRank > 0;
                            const isEliminated = p.thirdRoundRank < 0;

                            return (
                                <div
                                    key={p.id}
                                    className={`backdrop-blur-md border rounded-2xl p-5 shadow-lg flex flex-col items-center gap-3 min-h-[260px] justify-between transition-all duration-500 ${isWinner
                                        ? "bg-amber-50 dark:bg-amber-950/20 border-2 border-amber-400 dark:border-amber-500 scale-105 ring-4 ring-amber-500/20"
                                        : isEliminated
                                            ? "bg-zinc-100/70 dark:bg-zinc-900/40 border-zinc-300 dark:border-zinc-800 opacity-40 grayscale"
                                            : "bg-white/80 dark:bg-zinc-800/80 border-zinc-200/50 dark:border-zinc-700/50"
                                        }`}
                                >
                                    <span className="text-xs font-mono font-bold text-zinc-400 dark:text-zinc-500">
                                        No.{p.entryNo}
                                    </span>
                                    <h3 className="text-2xl font-black text-zinc-900 dark:text-white text-center leading-tight">
                                        {p.name}
                                    </h3>
                                    <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate max-w-full">
                                        {p.school || "未登録"}
                                    </span>

                                    {/* コースによって意味のある数字が違う。
                                        10 up-down はポイント（誤答で0に戻るため正解数は誤読を招く）。
                                        10 by 10 は式そのもの（誤答は回数ではなく誤答ポイント）。 */}
                                    {isTenByTen ? (
                                        <div className="flex flex-col items-center font-mono font-black">
                                            <div className="flex items-baseline gap-1 text-xl">
                                                <span className="text-emerald-600 dark:text-emerald-400">
                                                    {p.thirdRoundCorrectCount}
                                                </span>
                                                <span className="text-zinc-400">×</span>
                                                <span className="text-red-600 dark:text-red-400">
                                                    {getTenByTenWrongPoint(p)}
                                                </span>
                                            </div>
                                            <span className="text-blue-600 dark:text-blue-400 text-4xl leading-tight">
                                                {getTenByTenTotal(p)}
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="flex items-end gap-4 font-mono font-black">
                                            {isUpDown ? (
                                                <span className="text-blue-600 dark:text-blue-400 text-4xl">
                                                    {p.thirdRoundUpDownPoint}
                                                    <span className="text-base ml-1">pt</span>
                                                </span>
                                            ) : (
                                                <span className="text-emerald-600 dark:text-emerald-400 text-4xl">
                                                    {p.thirdRoundCorrectCount}
                                                </span>
                                            )}
                                            <span className="text-red-600 dark:text-red-400 text-2xl">
                                                {/* Swedish 10 で意味を持つのは×の合計。
                                                    誤答回数は失格判定にも判定基準にも使わない。 */}
                                                ×{isSwedish ? p.thirdRoundSwedishCross : p.thirdRoundWrongCount}
                                            </span>
                                        </div>
                                    )}

                                    {/* Freeze 10 の休み中。解答権が無いことが会場から見て分かるようにする */}
                                    {isFreeze && p.thirdRoundFreezeRest > 0 && !isWinner && (
                                        <div className="text-base font-black text-sky-600 dark:text-sky-400 tracking-wider">
                                            ❄️ 休み {p.thirdRoundFreezeRest} 問
                                        </div>
                                    )}

                                    {isWinner && (
                                        <div className="text-sm font-black text-amber-600 dark:text-amber-400 tracking-wider animate-pulse">
                                            👑 WIN（{p.thirdRoundRank}位）
                                        </div>
                                    )}
                                    {isEliminated && (
                                        <div className="text-sm font-black text-zinc-400 tracking-widest">
                                            ❌ OUT
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {finishState.finished && (
                        <p className="mt-8 text-3xl font-black tracking-widest text-amber-600 dark:text-amber-400">
                            COURSE FINISHED
                        </p>
                    )}

                    {quizPlayers.length === 0 && (
                        <p className="mt-10 text-zinc-500 dark:text-zinc-400">
                            このコースの出場者がまだ確定していません。
                        </p>
                    )}
                </div>
            </div>
        );
    }

    // ===== コース選択フェーズ =====
    return (
        <div className="w-full max-w-7xl flex flex-col items-center min-h-[80vh] px-4 py-8 z-10">

            {/* --- 見出し --- */}
            <div className="text-center animate-fade-in">
                <span className="px-4 py-1.5 rounded-full text-xs font-bold tracking-widest uppercase bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-500/30">
                    3rd Round
                </span>
                <h1 className="mt-4 text-5xl font-black tracking-tight text-zinc-950 dark:text-white">
                    コース選択
                </h1>
            </div>

            {/* --- 実施順（抽選が進むと「？」が埋まっていく）--- */}
            <div className="mt-8 w-full max-w-5xl">
                <div className="grid grid-cols-4 gap-3">
                    {[1, 2, 3, 4].map((order) => {
                        const course = drawnCourses.find(c => c.playOrder === order);
                        const isCurrent = currentCourse?.playOrder === order;
                        return (
                            <div
                                key={order}
                                className={`rounded-2xl p-4 border flex flex-col items-center justify-center min-h-[90px] transition-all duration-500 ${course
                                    ? isCurrent
                                        ? "bg-purple-100 dark:bg-purple-950/40 border-2 border-purple-500 dark:border-purple-500 scale-105 shadow-xl shadow-purple-500/20"
                                        : "bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 shadow-md"
                                    : "bg-zinc-50/50 dark:bg-zinc-900/30 border-dashed border-zinc-300 dark:border-zinc-700"
                                    }`}
                            >
                                <span className="text-[10px] font-mono font-bold text-zinc-400 dark:text-zinc-500 mb-1.5">
                                    {order} 番目
                                </span>
                                <span className={`text-xl font-black text-center ${course
                                    ? isCurrent
                                        ? "text-purple-800 dark:text-purple-200"
                                        : "text-zinc-800 dark:text-zinc-200"
                                    : "text-zinc-300 dark:text-zinc-700"
                                    }`}>
                                    {course ? course.name : "？"}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* --- 現在のコースと状況 --- */}
            <div className="mt-8 flex flex-col items-center gap-2">
                {currentCourse ? (
                    <>
                        <span className="text-sm font-bold tracking-widest text-zinc-400 dark:text-zinc-500">
                            {currentCourse.playOrder} 番目のコース
                        </span>
                        <h2 className="text-4xl font-black text-purple-700 dark:text-purple-300">
                            {currentCourse.name}
                        </h2>
                    </>
                ) : (
                    <h2 className="text-3xl font-black text-zinc-400 dark:text-zinc-600">
                        コース抽選
                    </h2>
                )}
                <span className={`mt-1 px-5 py-2 rounded-full text-base font-black tracking-wider ${isCurrentAssigned
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : isClosed
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                        : currentCourse
                            ? "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 animate-pulse"
                            : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}>
                    {statusLabel}
                </span>
            </div>

            {/* --- 参加者20名 --- */}
            <div className="mt-10 w-full">
                <div className="grid grid-cols-10 grid-rows-2 gap-3 w-full">
                    {gridItems.map((p, index) => {
                        if (!p) {
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

                        // 今のコースに決まった選手を強調する。
                        // 5名だけを抜き出さないのは、誰が残っているかも見せたいため。
                        const isJustAssigned =
                            !!currentCourse && p.thirdRoundCourseName === currentCourse.name;
                        const isAssignedElsewhere =
                            !!p.thirdRoundCourseName && !isJustAssigned;

                        return (
                            <div
                                key={p.id}
                                className={`relative backdrop-blur-md rounded-2xl p-3 shadow-lg transition-all duration-500 flex flex-col items-center justify-between min-h-[300px] ${isJustAssigned
                                    ? "bg-purple-50 dark:bg-purple-950/30 border-2 border-purple-500 dark:border-purple-500 scale-105 shadow-2xl shadow-purple-500/20 z-20"
                                    : isAssignedElsewhere
                                        ? "bg-zinc-100/70 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 opacity-50"
                                        : "bg-white/80 dark:bg-zinc-800/80 border border-zinc-200/50 dark:border-zinc-700/50"
                                    }`}
                            >
                                {/* 左上のエントリーNo、右上の2R順位 */}
                                <div className="w-full flex justify-between items-center text-[9px] font-mono font-bold opacity-60 mb-2">
                                    <span>No.{p.entryNo}</span>
                                    <span className="text-amber-600 dark:text-amber-400">👑 {p.secondRoundRank}位</span>
                                </div>

                                {/* 選手名（縦書き）と学校名・学年（縦書き） */}
                                <div className="flex justify-center items-stretch flex-grow my-3 gap-2">
                                    <div
                                        className="text-lg font-black tracking-widest leading-none text-zinc-900 dark:text-white select-none"
                                        style={{ writingMode: 'vertical-rl' }}
                                    >
                                        {p.name}
                                    </div>
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
                                    <span className={`px-2 py-0.5 rounded text-[9px] font-black truncate w-full text-center ${isJustAssigned
                                        ? "bg-purple-500 text-white"
                                        : p.thirdRoundCourseName
                                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                            : "bg-zinc-100 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400"
                                        }`}>
                                        {p.thirdRoundCourseName || "未選択"}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
