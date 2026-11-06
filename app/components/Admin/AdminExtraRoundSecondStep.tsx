// Extra Round Second Step（早押し）の作業面（運営コンソール。2026-11-05 に載せ替え）。
// 5問正解で敗者復活、誤答は即失格。出場者（最大12名）を横一列・縦書きで並べ、正解・誤答を押す。
// 問題欄（strip）とスルーは親（AdminExtraRound）が渡す。
import type { ReactNode } from "react";
import type { Player } from "@/lib/types";
import { WorkHead, MetaItem } from "./console/ConsoleFrame";
import { SeatCard, SeatRow, Pips, BigNumber, seatNameSize, type SeatStatus } from "./console/SeatCard";
import styles from "./console/console.module.css";

type Props = {
    /** Second Step 出場者（extraRoundSecondStep === true の選手） */
    entrants: Player[];
    onScore: (playerId: number, action: 'correct' | 'wrong') => void;
    onThrough: () => void;
    /** 処理中（採点・Undo の応答待ち）。押せなくする */
    busy: boolean;
    /** スルーできるか（開始番号が入っているか） */
    canThrough: boolean;
    /** 作業面の右上の道具（引き出しを開く） */
    tools: ReactNode;
    /** 問題欄（表示中の問題・次に読む問題） */
    strip: ReactNode;
};

// Second Step で勝ち抜けに必要な正解数（lib/extraRoundScoring.ts と同じ値）
const WIN_CORRECT_COUNT = 5;

export default function AdminExtraRoundSecondStep({ entrants, onScore, onThrough, busy, canThrough, tools, strip }: Props) {
    const winner = entrants.find(p => p.extraRoundRank > 0) ?? null;
    const activeCount = entrants.filter(p => p.extraRoundRank === 0).length;
    const count = entrants.length;

    return (
        <>
            <WorkHead
                meta={<>
                    <MetaItem label="出場者" value={count} />
                    <MetaItem label="残り" value={winner ? 0 : activeCount} />
                    <MetaItem label="敗者復活" value={winner ? `${winner.name}（No.${winner.entryNo}）` : '未決定'} />
                </>}
                tools={tools} />
            {strip}
            {count === 0 ? (
                <div className={styles.empty}>出場者が未選択です。右上「表示の切り替え」から進出者選択に戻って選び直してください</div>
            ) : (
                <SeatRow count={count}>
                    {entrants.map((p, i) => {
                        const isWinner = p.extraRoundRank > 0;
                        const isEliminated = p.extraRoundRank < 0;
                        // 勝ち抜け者が決まったら、残りの選手の操作も止める（API 側でも拒否される）
                        const canOperate = p.extraRoundRank === 0 && !winner && !busy;
                        const status: SeatStatus | null = isEliminated ? { label: 'LOST', tone: 'lost' } : isWinner ? { label: 'WIN', tone: 'win' } : null;
                        return (
                            <SeatCard key={p.id} seatNo={i + 1} paperRank={p.paperRank} name={p.name} nameSize={seatNameSize(count, p.name)}
                                status={status} dimmed={isEliminated}
                                score={<><BigNumber value={p.extraRoundCorrectCount} size={32} suffix={`/ ${WIN_CORRECT_COUNT}`} /><Pips value={Math.min(WIN_CORRECT_COUNT, p.extraRoundCorrectCount)} max={WIN_CORRECT_COUNT} /></>}
                                onCorrect={() => onScore(p.id, 'correct')} onWrong={() => onScore(p.id, 'wrong')} canOperate={canOperate} />
                        );
                    })}
                </SeatRow>
            )}
            <button type="button" className={styles.through} onClick={onThrough} disabled={busy || !canThrough || count === 0 || !!winner}>スルー（誰も答えなかった）</button>
            <div className={styles.hint}>並びはペーパー順位順。5問正解で敗者復活、誤答は即失格です。正解・誤答・スルーで、その問題を Main に出して次の問題へ進みます。</div>
        </>
    );
}
