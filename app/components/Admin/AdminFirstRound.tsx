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
    const neonButtonBase = "flex-1 rounded-none text-[#F3FAFF] font-bold transition-shadow";

    return (
        < div className="flex flex-col gap-[2vh] bg-black border border-[#2F7BFF] rounded-none p-[2vw] shadow-[0_0_30px_rgba(47,123,255,0.25)] w-[90%]" >
            <label className="text-[clamp(0.8rem,1vw,1rem)] font-bold text-[#F3FAFF] tracking-widest uppercase">
                1st Round
            </label>
            {/* タイマー表示 */}
            {isEditing ? (
                <div className="flex items-center justify-center gap-[1vw] py-[1.5vh]">
                    <input
                        type="number"
                        value={editMinutes}
                        onChange={(e) => setEditMinutes(Number(e.target.value))}
                        className="w-[16vw] text-center text-[clamp(1.6rem,3.5vw,3rem)] font-mono p-[1vw] rounded-none bg-black text-[#F3FAFF] border border-[#2F7BFF] focus:outline-none focus:shadow-[0_0_10px_#2F7BFF]"
                        min="0"
                    />
                    <span className="text-[clamp(1.6rem,3.5vw,3rem)] font-bold text-[#F3FAFF]">:</span>
                    <input
                        type="number"
                        value={editSeconds}
                        onChange={(e) => setEditSeconds(Number(e.target.value))}
                        className="w-[16vw] text-center text-[clamp(1.6rem,3.5vw,3rem)] font-mono p-[1vw] rounded-none bg-black text-[#F3FAFF] border border-[#2F7BFF] focus:outline-none focus:shadow-[0_0_10px_#2F7BFF]"
                        min="0" max="59"
                    />
                </div>
            ) : (
                // 色は 2nd Round 以降と同じ配色（地: #0C1628、枠: ACCENT #2F7BFF、文字: #F3FAFF、Time up は赤 #FF4D6D）。Main 側のタイマー枠と同じ
                <div className={`text-[clamp(2.4rem,6vw,4.5rem)] font-mono font-bold text-center py-[2vh] rounded-none bg-[#0C1628] ${isFinished ? 'text-[#FF4D6D]' : 'text-[#F3FAFF]'}`}>
                    {isFinished ? "Time up !" : remainTime}
                </div>
            )}
            {/* 操作ボタン表示 */}
            <div className="flex gap-[1.5vw]">
                {isEditing ? (
                    <>
                        <button
                            onClick={handleSaveEdit}
                            className={`${neonButtonBase} bg-[#2F7BFF] hover:bg-[#4A8CFF] hover:shadow-[0_0_20px_rgba(47,123,255,0.7)] py-[1.2vh] px-[1.5vw]`}
                        >
                            SAVE
                        </button>
                        <button
                            onClick={handleCancelEdit}
                            className={`${neonButtonBase} bg-[#3A4B63] hover:bg-[#4A5F7F] hover:shadow-[0_0_20px_rgba(58,75,99,0.7)] py-[1.2vh] px-[1.5vw]`}
                        >
                            CANCEL
                        </button>
                    </>
                ) : (
                    <>
                        <button
                            onClick={handleStartTimer}
                            className={`${neonButtonBase} bg-[#33C6FF] hover:bg-[#5AD3FF] hover:shadow-[0_0_20px_rgba(51,198,255,0.7)] !text-black py-[1.2vh] px-[1.5vw] text-[clamp(0.7rem,1vw,0.9rem)]`}
                        >
                            START
                        </button>
                        <button
                            onClick={handleStopTimer}
                            className={`${neonButtonBase} bg-[#FFC93C] hover:bg-[#FFD866] hover:shadow-[0_0_20px_rgba(255,201,60,0.7)] !text-black py-[1.2vh] px-[1.5vw] text-[clamp(0.7rem,1vw,0.9rem)]`}
                        >
                            STOP
                        </button>
                        <button
                            onClick={handleEditClick}
                            className={`${neonButtonBase} bg-[#2F7BFF] hover:bg-[#4A8CFF] hover:shadow-[0_0_20px_rgba(47,123,255,0.7)] py-[1.2vh] px-[1.5vw] text-[clamp(0.7rem,1vw,0.9rem)]`}
                        >
                            EDIT
                        </button>
                        <button
                            onClick={handleResetTimer}
                            className={`${neonButtonBase} bg-[#FF3B5C] hover:bg-[#FF5C78] hover:shadow-[0_0_20px_rgba(255,59,92,0.7)] py-[1.2vh] px-[1.5vw] text-[clamp(0.7rem,1vw,0.9rem)]`}
                        >
                            RESET
                        </button>
                    </>
                )}
            </div>
            {isFinished && (
                <button
                    onClick={onGoToResult} // mode を 1stRoundResult に変更する
                    className="w-full bg-[#2F7BFF] hover:bg-[#4A8CFF] hover:shadow-[0_0_20px_rgba(47,123,255,0.7)] text-[#F3FAFF] font-bold py-[1.2vh] rounded-none transition-shadow mt-[1vh]"
                >
                    集計結果を入力する
                </button>
            )}
        </div >
    )
}