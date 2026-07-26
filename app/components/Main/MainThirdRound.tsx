import { Socket } from "socket.io-client";
import { useEffect, useState } from "react";

type Props = {
    players: any[],
    socket: Socket | null,
    setPlayers: (players: any[]) => void
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
            const handleCoursesUpdate = (payload: { courses: Course[] }) => setCourses(payload.courses);

            socket.on("update_third_round_state", handleStateUpdate);
            socket.on("update_third_round_courses", handleCoursesUpdate);

            return () => {
                socket.off("update_third_round_state", handleStateUpdate);
                socket.off("update_third_round_courses", handleCoursesUpdate);
            };
        }
    }, [socket]);

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

                    <div className="mt-12 p-12 bg-white/80 dark:bg-zinc-800/80 backdrop-blur-md border border-zinc-200/50 dark:border-zinc-700/50 rounded-3xl shadow-2xl max-w-2xl mx-auto flex flex-col items-center justify-center min-h-[250px]">
                        <span className="text-4xl mb-4">⚡</span>
                        <p className="text-lg font-bold text-zinc-700 dark:text-zinc-300">
                            {quizCourse ? quizCourse.name : "コース"} のスコアボードを表示しています。
                        </p>
                        <p className="text-sm text-zinc-400 dark:text-zinc-500 mt-2 text-center max-w-md">
                            出場者のスコア・勝ち抜け・失格の進行状況をここに表示する予定です。
                        </p>
                    </div>
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
