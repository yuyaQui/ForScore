import { useState, useEffect } from "react";
import { Socket } from "socket.io-client";
const { DEFAULT_COUNTDOWN } = require("../../../constants.js");

type Props = {
    socket: Socket | null;
}

export default function MainFirstRound({ socket }: Props) {
    const [timer, setTimer] = useState(DEFAULT_COUNTDOWN);
    const [isFinished, setIsFinished] = useState(false);

    useEffect(() => {
        if (socket) {
            socket.on("1R_update_timer", (time: number) => {
                setTimer(time);
                if (time > 0) setIsFinished(false);
            });
            socket.on("1R_finish_timer", () => {
                setIsFinished(true);
            });
            socket.on("1R_reset_timer", () => {
                setIsFinished(false);
            });

            return () => {
                socket.off("1R_update_timer");
                socket.off("1R_finish_timer");
                socket.off("1R_reset_timer");
            };
        }
    }, [socket]);

    // 秒数を「分：秒」の形式に変換
    const minutes = Math.floor(timer / 60);
    const seconds = timer % 60;
    const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    return (
        <div className="flex flex-col items-center justify-center w-full">
            {/* 終了時のオーバーレイ表示 */}
            {isFinished && (
                <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-zinc-800 p-16 rounded-3xl shadow-2xl text-center">
                        <h2 className="text-6xl font-black text-red-600 dark:text-red-500 mb-4">Time up !</h2>
                    </div>
                </div>
            )}

            {/* リアルタイムに同期するタイマー */}
            <h1 className="font-bold text-zinc-800 dark:text-white mb-6 tracking-wider text-center flex items-baseline justify-center gap-3">
                <span className="text-2xl text-zinc-500 dark:text-zinc-400">1st Round</span>
                <span className="text-4xl">Paper Quiz</span>
            </h1>
            <div className="text-6xl font-mono font-bold p-6 bg-zinc-800 text-white dark:bg-black rounded-2xl shadow-2xl border-4 border-zinc-700 w-full max-w-md text-center z-10">
                <span className={
                    timer <= 60 ? "text-red-500" :
                        timer <= 300 ? "text-yellow-400" :
                            "text-white"
                }>
                    {formattedTime}
                </span>
            </div>
        </div>
    )
}