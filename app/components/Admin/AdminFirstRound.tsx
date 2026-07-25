import { useState, useEffect } from "react";
import { Socket } from "socket.io-client";
const { DEFAULT_COUNTDOWN } = require("../../../constants.js");

interface Props {
    socket: Socket | null,
    onGoToResult: () => void
}

export default function AdminFirstRound(props: Props) {
    const { socket, onGoToResult } = props;

    const [timer, setTimer] = useState(DEFAULT_COUNTDOWN);
    const [isFinished, setIsFinished] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editMinutes, setEditMinutes] = useState(0);
    const [editSeconds, setEditSeconds] = useState(0);

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
    const remainTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    const handleStartTimer = () => {
        if (socket) socket.emit("1R_start_timer");
    };
    const handleStopTimer = () => {
        if (socket) socket.emit("1R_stop_timer");
    };
    const handleResetTimer = () => {
        if (socket) socket.emit("1R_reset_timer");
    };
    const handleEditClick = () => {
        setIsEditing(true);
        setEditMinutes(Math.floor(timer / 60)); // 今の「分」を入力欄の初期値にする
        setEditSeconds(timer % 60);             // 今の「秒」を入力欄の初期値にする
    };
    const handleSaveEdit = () => {
        const newTime = editMinutes * 60 + editSeconds; // 分と秒を「合計の秒数」に戻す
        if (socket) socket.emit("1R_edit_timer", newTime);
        setIsEditing(false);
    };
    const handleCancelEdit = () => {
        setIsEditing(false);
    };

    return (
        < div className="flex flex-col gap-4 bg-white dark:bg-zinc-800 p-8 rounded-xl shadow-md w-full max-w-md" >
            <label className="text-sm font-bold text-zinc-700 dark:text-zinc-300">
                1st Round
            </label>
            {/* タイマー表示 */}
            {isEditing ? (
                <div className="flex items-center justify-center gap-2 py-4 rounded-lg bg-zinc-100 dark:bg-zinc-900">
                    <input
                        type="number"
                        value={editMinutes}
                        onChange={(e) => setEditMinutes(Number(e.target.value))}
                        className="w-20 text-center text-2xl font-mono p-2 border rounded dark:bg-zinc-800 dark:text-white"
                        min="0"
                    />
                    <span className="text-2xl font-bold dark:text-white">:</span>
                    <input
                        type="number"
                        value={editSeconds}
                        onChange={(e) => setEditSeconds(Number(e.target.value))}
                        className="w-20 text-center text-2xl font-mono p-2 border rounded dark:bg-zinc-800 dark:text-white"
                        min="0" max="59"
                    />
                </div>
            ) : (
                <div className={`text-4xl font-mono font-bold text-center py-4 rounded-lg bg-zinc-100 dark:bg-zinc-900 ${isFinished ? 'text-red-500' : 'text-zinc-800 dark:text-zinc-200'}`}>
                    {isFinished ? "Time up !" : remainTime}
                </div>
            )}
            {/* 操作ボタン表示 */}
            <div className="flex gap-4">
                {isEditing ? (
                    <>
                        <button
                            onClick={handleSaveEdit}
                            className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-4 rounded-lg transition-colors"
                        >
                            SAVE
                        </button>
                        <button
                            onClick={handleCancelEdit}
                            className="flex-1 bg-zinc-500 hover:bg-zinc-600 text-white font-bold py-3 px-4 rounded-lg transition-colors"
                        >
                            CANCEL
                        </button>
                    </>
                ) : (
                    <>
                        <button
                            onClick={handleStartTimer}
                            className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 px-4 rounded-lg transition-colors text-sm"
                        >
                            START
                        </button>
                        <button
                            onClick={handleStopTimer}
                            className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-3 px-4 rounded-lg transition-colors text-sm"
                        >
                            STOP
                        </button>
                        <button
                            onClick={handleEditClick}
                            className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-4 rounded-lg transition-colors text-sm"
                        >
                            EDIT
                        </button>
                        <button
                            onClick={handleResetTimer}
                            className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-4 rounded-lg transition-colors text-sm"
                        >
                            RESET
                        </button>
                    </>
                )}
            </div>
            {isFinished && (
                <button
                    onClick={onGoToResult} // mode を 1stRoundResult に変更する
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-lg transition-colors mt-2"
                >
                    1st Round 結果入力画面へ
                </button>
            )}
        </div >
    )
}