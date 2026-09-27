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
            <div className="absolute top-[3vw] left-[3vw] text-[3vw] font-bold text-[#FBFCF6] tracking-wider z-10">
                1st Round
            </div>
            <div className="absolute top-[3vw] right-[3vw] text-[3vw] font-bold text-[#FBFCF6] tracking-wider z-10">
                Paper Quiz
            </div>
            {/* 枠内の塗りは指定色(#A2D7DD)を暗くした#205359。色相・彩度は変えず明度だけ下げて、
                白系の文字(#FBFCF6)とのコントラストを確保している（元の#A2D7DDだと双方が明るく読みにくかった）。
                周囲のネオングローは元の明るい#A2D7DD寄りの色のまま残し、発光感を保つ */}
            <div className="text-[14vw] font-mono font-bold p-[1.5vw] bg-[#205359] rounded-none shadow-[0_0_40px_rgba(162,215,221,0.5)] w-[90%] text-center z-10">
                {/* 背景が#205359（暗め）になったため、赤/黄は明るめの色にしてコントラストを確保する。
                    彩度の高い赤(red-500系)は暗い背景では逆に沈んで見えにくいので、あえて薄めのred-200/yellow-300を使う */}
                <span className={
                    timer <= 60 ? "text-red-200" :
                        timer <= 300 ? "text-yellow-300" :
                            "text-[#FBFCF6]"
                }>
                    {formattedTime}
                </span>
            </div>
        </div>
    )
}