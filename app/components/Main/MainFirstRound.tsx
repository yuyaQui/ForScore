import { useState, useEffect } from "react";
import { Socket } from "socket.io-client";
// CommonJS の constants.js を名前付き import で読む（AdminFirstRound.tsx と同じ）
import { DEFAULT_COUNTDOWN } from "../../../constants.js";
import FixedStage from "@/app/components/FixedStage";
import { SemifinalTimerGauge } from "./SemifinalCard";

type Props = {
    socket: Socket | null;
}

/**
 * 1st Round（ペーパークイズ）の Main。タイマーだけを画面の中央に大きく出す（2026-11-04 ユーザー指示）。
 *   ・「1st Round」「Paper Quiz」の見出しは出さない
 *   ・タイマーは Semi-Final と同じ八角形の枠（残り時間の割合だけ水色の縁が残る。残り1分で赤）
 */
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

    return (
        <FixedStage>
            <div style={{ width: 1920, height: 1080, background: '#000000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <SemifinalTimerGauge remaining={timer} total={DEFAULT_COUNTDOWN} width={1600} height={420} fontSize={240} />
            </div>
        </FixedStage>
    );
}
