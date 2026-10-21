import { useState, useEffect } from "react";
import { Socket } from "socket.io-client";
// CommonJS の constants.js を名前付き import で読む（AdminFirstRound.tsx と同じ）
import { DEFAULT_COUNTDOWN } from "../../../constants.js";

type Props = {
    socket: Socket | null;
}

export default function MainFirstRound({ socket }: Props) {
    const [timer, setTimer] = useState(DEFAULT_COUNTDOWN);

    useEffect(() => {
        if (socket) {
            socket.on("1R_update_timer", (time: number) => {
                setTimer(time);
            });

            return () => {
                socket.off("1R_update_timer");
            };
        }
    }, [socket]);

    // 秒数を「分：秒」の形式に変換
    const minutes = Math.floor(timer / 60);
    const seconds = timer % 60;
    const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    return (
        <div className="flex flex-col items-center justify-center w-full">
            {/* 「1st Round」は画面左上、「Paper Quiz」は画面右上に固定配置。
                フォントは画面幅(vw)基準で、解像度が変わっても同じ比率の大きさ・位置になる */}
            <div className="absolute top-[3vw] left-[3vw] text-[3vw] font-bold text-[#F3FAFF] tracking-wider z-10">
                1st Round
            </div>
            <div className="absolute top-[3vw] right-[3vw] text-[3vw] font-bold text-[#F3FAFF] tracking-wider z-10">
                Paper Quiz
            </div>
            {/* 色は 2nd Round 以降と同じ配色（地: #0C1628、枠・グロー: ACCENT #2F7BFF、文字: #F3FAFF）。
                残り5分以下は金(#FFC93C)、1分以下は赤(#FF4D6D)。2026-10-06 に1st Roundの色を2nd Round以降に揃えた */}
            <div className="text-[14vw] font-mono font-bold p-[1.5vw] bg-[#0C1628] border-2 border-[#2F7BFF] rounded-none shadow-[0_0_40px_rgba(47,123,255,0.45)] w-[90%] text-center z-10">
                
                <span className={
                    timer <= 60 ? "text-[#FF4D6D]" :
                        timer <= 300 ? "text-[#FFC93C]" :
                            "text-[#F3FAFF]"
                }>
                    {formattedTime}
                </span>
            </div>
        </div>
    )
}