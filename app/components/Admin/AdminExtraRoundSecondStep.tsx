import type { Player } from "@/lib/types";
import { toOrdinal } from "@/lib/ordinal";
import { ACCENT, tierOf } from "@/lib/cyberpunkCard";
import { STAT_CARD_STYLE, STAT_LABEL_STYLE, opBtnStyle, opBtnTextStyle } from "./adminCyberStyles";

type Props = {
    /** Second Step 出場者（extraRoundSecondStep === true の選手） */
    entrants: Player[];
    onScore: (playerId: number, action: 'correct' | 'wrong') => void;
    busy: boolean;
};

// Second Step で勝ち抜けに必要な正解数（lib/extraRoundScoring.ts と同じ値）
const WIN_CORRECT_COUNT = 5;

// Second Step（早押し）の採点画面。Cowork Design の 3rd Round Admin（AdminQuizCard）と
// 同じカード構成で、ルールの違い（5問正解で勝ち抜け・誤答は即失格）に合わせて内訳を変えている。
export default function AdminExtraRoundSecondStep({ entrants, onScore, busy }: Props) {
    const winner = entrants.find(p => p.extraRoundRank > 0) ?? null;
    const activeCount = entrants.filter(p => p.extraRoundRank === 0).length;

    // 縦書きの選手名の枠は全員同じ高さにそろえる。名前の長さで枠が伸び縮みすると、その下の
    // 正解数・ゲージ・ボタンの位置が選手ごとに上下してしまうため。いちばん長い名前が収まる高さ
    // （1文字あたり約28px: 文字23px＋字間5px）を、全員に使う。
    const longestName = entrants.reduce((max, p) => Math.max(max, Array.from(p.name).length), 0);
    const nameBoxHeight = Math.max(130, longestName * 28 + 4);

    return (
        <div className="flex flex-col gap-5">
            <div className="flex gap-4">
                <div style={STAT_CARD_STYLE}>
                    <div style={STAT_LABEL_STYLE}>出場者</div>
                    <div style={{ marginTop: 6, fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 34, color: '#EAF6FF' }}>{entrants.length}</div>
                </div>
                <div style={STAT_CARD_STYLE}>
                    <div style={STAT_LABEL_STYLE}>残り</div>
                    <div style={{ marginTop: 6, fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 34, color: winner ? '#5C7EA6' : '#EAF6FF' }}>{winner ? 0 : activeCount}</div>
                </div>
                <div style={{ ...STAT_CARD_STYLE, flex: 2 }}>
                    <div style={STAT_LABEL_STYLE}>敗者復活</div>
                    <div style={{ marginTop: 10, fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: 24, color: winner ? '#FFE28A' : '#5C7EA6' }}>
                        {winner ? `${winner.name}（No.${winner.entryNo}）` : '未決定'}
                    </div>
                </div>
            </div>

            <div className="flex flex-wrap gap-3 justify-center">
                {entrants.map(p => {
                    const tier = tierOf(p.paperRank, ACCENT);
                    const isWinner = p.extraRoundRank > 0;
                    const isEliminated = p.extraRoundRank < 0;
                    // 勝ち抜け者が決まったら、残りの選手の操作も止める（API 側でも拒否される）
                    const canOperate = p.extraRoundRank === 0 && !winner;
                    const dotColor = isEliminated ? '#4A5568' : isWinner ? '#FFC93C' : '#35FFA0';
                    const barColor = isEliminated ? '#4A5568' : isWinner ? '#FFC93C' : '#4FD8FF';
                    const pct = Math.min(100, (p.extraRoundCorrectCount / WIN_CORRECT_COUNT) * 100);
                    const statusStr = isEliminated ? 'LOST' : isWinner ? 'WIN' : '';

                    return (
                        <div
                            key={p.id}
                            style={{
                                flex: '1 1 0', minWidth: 120, maxWidth: 220, boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
                                alignItems: 'center', background: 'rgba(12,22,40,.75)', border: '1px solid rgba(79,216,255,.22)',
                                borderTop: `3px solid ${tier.color}`, padding: '14px 8px 16px', gap: 12, overflow: 'hidden',
                            }}
                        >
                            <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 20, letterSpacing: 1, color: tier.color }}>
                                {toOrdinal(p.paperRank)}
                            </div>
                            <span style={{ display: 'block', width: 9, height: 9, borderRadius: '50%', background: dotColor, boxShadow: `0 0 8px ${dotColor}` }} />
                            <div style={{
                                writingMode: 'vertical-rl', textOrientation: 'mixed', fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700,
                                fontSize: 23, letterSpacing: 5, color: isEliminated ? '#6E7685' : '#E9F3FF', height: nameBoxHeight, flexShrink: 0, display: 'flex',
                                alignItems: 'flex-start', justifyContent: 'center', whiteSpace: 'nowrap',
                            }}>
                                {p.name}
                            </div>
                            <div style={{ height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <span style={{
                                    fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 14, letterSpacing: 1,
                                    color: isEliminated ? '#8A93A3' : '#FFC93C',
                                    textShadow: isEliminated ? 'none' : '0 0 6px rgba(255,201,60,.6)', whiteSpace: 'nowrap',
                                }}>
                                    {statusStr}
                                </span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 26, color: '#EAF6FF' }}>
                                    {p.extraRoundCorrectCount}
                                </span>
                                <div style={{ width: 11, height: 64, background: 'rgba(255,255,255,.06)', position: 'relative', overflow: 'hidden' }}>
                                    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${pct}%`, background: barColor, boxShadow: `0 0 8px ${barColor}` }} />
                                </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', marginTop: 'auto' }}>
                                <button onClick={() => onScore(p.id, 'correct')} disabled={busy || !canOperate} style={opBtnStyle('correct', canOperate)}>
                                    <span style={opBtnTextStyle('correct')}>正解</span>
                                </button>
                                <button onClick={() => onScore(p.id, 'wrong')} disabled={busy || !canOperate} style={opBtnStyle('wrong', canOperate)}>
                                    <span style={opBtnTextStyle('wrong')}>誤答</span>
                                </button>
                            </div>
                        </div>
                    );
                })}
                {entrants.length === 0 && (
                    <div className="w-full py-10 text-center" style={{ fontFamily: '"Noto Sans JP",sans-serif', color: '#5C7EA6' }}>
                        出場者が未選択です。手動操作から選び直してください
                    </div>
                )}
            </div>
        </div>
    );
}
