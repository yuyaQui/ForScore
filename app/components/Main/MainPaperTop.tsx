// ペーパークイズ上位100名の発表の Main 画面（2026-10-31 ユーザー承認・項目19・見出しなし）。
// 2nd Round のターンオーバーと同じ帯（TurnOverView）を使い、1画面ぶんの選手を1本の帯に並べる。
// 全画面を帯（段階）として渡し、画面の切り替えも 2nd Round の段階の切り替えと同じにする（2026-11-04）。
// 「順位だけ」→「学校名・学年・名前」の2段階（PaperTopState.phase）。
import { Socket } from "socket.io-client";
import { useEffect, useState } from "react";
import type { Player, PaperTopState } from "@/lib/types";
import { DEFAULT_PAPER_TOP_STATE } from "@/lib/types";
import { getPaperTopPages, paperTopRangeLabel } from "@/lib/paperTop";
import FixedStage from "@/app/components/FixedStage";
import { TurnOverView } from "./MainSecondRound";
import { BlankScreen } from "./StandbyScreen";
import { useReadyGate } from "../useReadyGate";

export default function MainPaperTop({ socket }: { socket: Socket | null }) {
    const [players, setPlayers] = useState<Player[]>([]);
    const [state, setState] = useState<PaperTopState>(DEFAULT_PAPER_TOP_STATE);

    // 状態と選手がそろうまでは黒い舞台だけを出す（帯のない画面や既定の状態が1コマ映るのを防ぐ。2026-11-06）
    const { ready, mark, load } = useReadyGate(['state', 'players']);

    useEffect(() => {
        // 選手（DB は読むだけ）
        const stopPlayers = load('players', '/api/secondRound/loadPlayers', data => setPlayers(data.allPlayers));
        if (!socket) return stopPlayers;
        const onState = (next: PaperTopState) => { setState(next); mark('state'); };
        const onPlayers = (all: Player[]) => setPlayers(all);
        socket.on('update_paper_top_state', onState);
        socket.on('update_players', onPlayers);
        // 接続直後の配信はこの画面が無いうちに届いて失われるので、表示した時点で取り直す
        socket.emit('request_paper_top_sync');
        return () => {
            stopPlayers();
            socket.off('update_paper_top_state', onState);
            socket.off('update_players', onPlayers);
        };
    }, [socket, mark, load]);

    const pages = getPaperTopPages(players);
    const bands = pages.map((pg) => ({ label: paperTopRangeLabel(pg), slice: pg }));

    // 全画面を1つの TurnOverView の段階（帯）として渡す。画面の切り替えは 2nd Round の
    // 段階の切り替えと同じ（今の帯がフェードで消え、約1秒後に次の帯がフェードで出る）。
    // 帯の登場（ポップイン）は最初に表示したときだけ（2026-11-04 ユーザー指示）
    if (!ready) return <BlankScreen />;
    return (
        <FixedStage>
            <TurnOverView
                groupPlayers={[]}
                groupNumber={0}
                bands={bands}
                turnOverStep={state.page}
                turnOverPhase={state.phase}
                turnOverFinalRevealed={false}
            />
        </FixedStage>
    );
}
