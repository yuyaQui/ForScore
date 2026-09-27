import { useState, useEffect } from "react";
import { Socket } from "socket.io-client";
// constants.js は CommonJS（module.exports）だが、名前付き import で読める。
// バンドラが module.exports のオブジェクトを静的に解析し、tsconfig の allowJs によって
// tsc も型（number）を推論できる。server/ 側は CommonJS のまま require し続ける。
import { DEFAULT_COUNTDOWN } from "../../../constants.js";

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

    // ボタンは機能別の色（緑=開始/黄=停止/青=編集/赤=リセット）は維持しつつ、
    // 角を完全な四角にしてホバー時にネオングロー(box-shadow)を出すサイバーパンク調の共通クラス
    const neonButtonBase = "flex-1 rounded-none text-[#FBFCF6] font-bold transition-shadow";

    return (
        < div className="flex flex-col gap-[2vh] bg-black border border-[#A2D7DD] rounded-none p-[2vw] shadow-[0_0_30px_rgba(162,215,221,0.25)] w-[90%]" >
            <label className="text-[clamp(0.8rem,1vw,1rem)] font-bold text-[#FBFCF6] tracking-widest uppercase">
                1st Round
            </label>
            {/* タイマー表示 */}
            {isEditing ? (
                <div className="flex items-center justify-center gap-[1vw] py-[1.5vh] rounded-none bg-black border border-[#A2D7DD]">
                    <input
                        type="number"
                        value={editMinutes}
                        onChange={(e) => setEditMinutes(Number(e.target.value))}
                        className="w-[16vw] text-center text-[clamp(1.6rem,3.5vw,3rem)] font-mono p-[1vw] rounded-none bg-black text-[#FBFCF6] border border-[#A2D7DD] focus:outline-none focus:shadow-[0_0_10px_#A2D7DD]"
                        min="0"
                    />
                    <span className="text-[clamp(1.6rem,3.5vw,3rem)] font-bold text-[#FBFCF6]">:</span>
                    <input
                        type="number"
                        value={editSeconds}
                        onChange={(e) => setEditSeconds(Number(e.target.value))}
                        className="w-[16vw] text-center text-[clamp(1.6rem,3.5vw,3rem)] font-mono p-[1vw] rounded-none bg-black text-[#FBFCF6] border border-[#A2D7DD] focus:outline-none focus:shadow-[0_0_10px_#A2D7DD]"
                        min="0" max="59"
                    />
                </div>
            ) : (
                // 塗りは指定色(#A2D7DD)を暗くした#205359。色相・彩度は変えず明度だけ下げて、
                // #FBFCF6の文字が読みやすいようにしている（Main側のタイマー枠と同じ考え方）
                // Time up時の赤文字も、暗い背景で沈まないようMain側と同じ薄めのred-200にする
                <div className={`text-[clamp(2.4rem,6vw,4.5rem)] font-mono font-bold text-center py-[2vh] rounded-none bg-[#205359] ${isFinished ? 'text-red-200' : 'text-[#FBFCF6]'}`}>
                    {isFinished ? "Time up !" : remainTime}
                </div>
            )}
            {/* 操作ボタン表示 */}
            <div className="flex gap-[1.5vw]">
                {isEditing ? (
                    <>
                        <button
                            onClick={handleSaveEdit}
                            className={`${neonButtonBase} bg-blue-500 hover:bg-blue-600 hover:shadow-[0_0_20px_rgba(59,130,246,0.7)] py-[1.2vh] px-[1.5vw]`}
                        >
                            SAVE
                        </button>
                        <button
                            onClick={handleCancelEdit}
                            className={`${neonButtonBase} bg-zinc-500 hover:bg-zinc-600 hover:shadow-[0_0_20px_rgba(113,113,122,0.6)] py-[1.2vh] px-[1.5vw]`}
                        >
                            CANCEL
                        </button>
                    </>
                ) : (
                    <>
                        <button
                            onClick={handleStartTimer}
                            className={`${neonButtonBase} bg-emerald-500 hover:bg-emerald-600 hover:shadow-[0_0_20px_rgba(16,185,129,0.7)] py-[1.2vh] px-[1.5vw] text-[clamp(0.7rem,1vw,0.9rem)]`}
                        >
                            START
                        </button>
                        <button
                            onClick={handleStopTimer}
                            className={`${neonButtonBase} bg-yellow-500 hover:bg-yellow-600 hover:shadow-[0_0_20px_rgba(234,179,8,0.7)] py-[1.2vh] px-[1.5vw] text-[clamp(0.7rem,1vw,0.9rem)]`}
                        >
                            STOP
                        </button>
                        <button
                            onClick={handleEditClick}
                            className={`${neonButtonBase} bg-blue-500 hover:bg-blue-600 hover:shadow-[0_0_20px_rgba(59,130,246,0.7)] py-[1.2vh] px-[1.5vw] text-[clamp(0.7rem,1vw,0.9rem)]`}
                        >
                            EDIT
                        </button>
                        <button
                            onClick={handleResetTimer}
                            className={`${neonButtonBase} bg-red-500 hover:bg-red-600 hover:shadow-[0_0_20px_rgba(239,68,68,0.7)] py-[1.2vh] px-[1.5vw] text-[clamp(0.7rem,1vw,0.9rem)]`}
                        >
                            RESET
                        </button>
                    </>
                )}
            </div>
            {isFinished && (
                <button
                    onClick={onGoToResult} // mode を 1stRoundResult に変更する
                    className="w-full bg-blue-600 hover:bg-blue-700 hover:shadow-[0_0_20px_rgba(37,99,235,0.7)] text-[#FBFCF6] font-bold py-[1.2vh] rounded-none transition-shadow mt-[1vh]"
                >
                    1st Round 結果入力画面へ
                </button>
            )}
        </div >
    )
}