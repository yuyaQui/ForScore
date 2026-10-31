// ペーパークイズ上位100名の発表の Main 画面（2026-10-31 ユーザー承認・項目19・見出しなし）。
// 2nd Round のターンオーバーと同じ帯（TurnOverView）を使い、1画面ぶんの選手を1本の帯に並べる。
// 「順位だけ」→「学校名・学年・名前」の2段階（PaperTopState.phase）。
import { Socket } from "socket.io-client";
import { useEffect, useState } from "react";
import type { Player, PaperTopState } from "@/lib/types";
import { DEFAULT_PAPER_TOP_STATE } from "@/lib/types";
import { getPaperTopPages } from "@/lib/paperTop";
import FixedStage from "@/app/components/FixedStage";
import { TurnOverView } from "./MainSecondRound";

export default function MainPaperTop({ socket }: { socket: Socket | null }) {
    const [players, setPlayers] = useState<Player[]>([]);
    const [state, setState] = useState<PaperTopState>(DEFAULT_PAPER_TOP_STATE);

    useEffect(() => {
        // 選手（DB は読むだけ）
        fetch('/api/secondRound/loadPlayers').then(res => res.json()).then(data => {
            if (data.success) setPlayers(data.allPlayers);
        }).catch(err => console.error('Failed to load players', err));
        if (!socket) return;
        const onState = (next: PaperTopState) => setState(next);
        const onPlayers = (all: Player[]) => setPlayers(all);
        socket.on('update_paper_top_state', onState);
        socket.on('update_players', onPlayers);
        // 接続直後の配信はこの画面が無いうちに届いて失われるので、表示した時点で取り直す
        socket.emit('request_paper_top_sync');
        return () => {
            socket.off('update_paper_top_state', onState);
            socket.off('update_players', onPlayers);
        };
    }, [socket]);

    const pages = getPaperTopPages(players);
    const page = pages[state.page] ?? [];

    // key に画面の番号を入れ、画面が変わるたびに帯の登場の演出をはじめから再生する
    return (
        <FixedStage>
            <TurnOverView
                key={`paperTop-${state.page}`}
                groupPlayers={page}
                groupNumber={0}
                turnOverStep={0}
                turnOverPhase={state.phase}
                turnOverFinalRevealed={false}
                singleBand
            />
        </FixedStage>
    );
}
