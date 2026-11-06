import { useState, useEffect } from "react";
import { Socket } from "socket.io-client";
// CommonJS の constants.js を名前付き import で読む（AdminFirstRound.tsx と同じ）
import { DEFAULT_COUNTDOWN } from "../../../constants.js";
import { useSocketSync } from "../useSocketSync";
import FixedStage from "@/app/components/FixedStage";
import { SemifinalTimerGauge } from "./SemifinalCard";
import { BlankScreen } from "./StandbyScreen";
import { useReadyGate } from "../useReadyGate";

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
    // 残り時間が届くまでは黒い舞台だけを出す（20:00 が1コマ映ってから本当の残り時間に変わるのを防ぐ。2026-11-06）
    const { ready, mark } = useReadyGate(['timer']);

    useEffect(() => {
        if (socket) {
            const onUpdate = (time: number) => { setTimer(time); mark('timer'); };
            socket.on("1R_update_timer", onUpdate);
            return () => {
                socket.off("1R_update_timer", onUpdate);
            };
        }
    }, [socket, mark]);
    // 表示された時・つなぎ直した時に残り時間を取り直す（待機画面で覆われている間に進んだ分を取りこぼさない）
    useSocketSync(socket, ['request_first_round_sync']);

    if (!ready) return <BlankScreen />;
    return (
        <FixedStage>
            <div style={{ width: 1920, height: 1080, background: '#000000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <SemifinalTimerGauge remaining={timer} total={DEFAULT_COUNTDOWN} width={1600} height={420} fontSize={240} />
            </div>
        </FixedStage>
    );
}
