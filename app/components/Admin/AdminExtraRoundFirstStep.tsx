import type { ExtraRoundQuestion } from "@/lib/types";
import {
    FIRST_STEP_SEQUENCE,
    EXTRA_ROUND_QUESTION_COUNT,
    getExtraRoundPhaseLabel,
    getExtraRoundPhaseRange,
    getFirstStepItem,
    isPhaseEndAnswer,
} from "@/lib/extraRound";
import { ACCENT } from "@/lib/cyberpunkCard";
import { STAT_CARD_STYLE, STAT_LABEL_STYLE } from "./adminCyberStyles";

type Props = {
    cursor: number;
    /** いまのステップの中身（問題文 / 解答）を Main に出したか */
    revealed: boolean;
    questions: ExtraRoundQuestion[];
};

const GOLD = '#FFC93C';

// First Step（筆記）の進行画面。いま Main に出ているものと、その問題・解答・別解を確認する。
// 別解・正誤判定基準は Admin（採点するスタッフ）だけが見る。Main には出ない。
export default function AdminExtraRoundFirstStep({ cursor, revealed, questions }: Props) {
    const item = getFirstStepItem(cursor);
    const isAnswer = item.view === 'answer';
    const question = questions.find(q => q.number === item.number);
    const [phaseStart, phaseEnd] = getExtraRoundPhaseRange(item.number);
    const atDecision = isPhaseEndAnswer(cursor);
    const missing = questions.length < EXTRA_ROUND_QUESTION_COUNT;

    return (
        <div className="flex flex-col gap-5">
            {/* 「ステップ ○ / 40」は 2026-10-11 のユーザー指示で削除し、フェーズと Main 表示中の2枚を左右に並べる */}
            <div className="flex gap-[18px] flex-wrap">
                <div style={STAT_CARD_STYLE}>
                    <div style={STAT_LABEL_STYLE}>フェーズ</div>
                    <div style={{ marginTop: 6, fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 30, color: '#EAF6FF' }}>
                        {getExtraRoundPhaseLabel(item.number)}
                        <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontSize: 14, marginLeft: 10, color: '#7FA8D9' }}>
                            第{phaseStart}〜{phaseEnd}問
                        </span>
                    </div>
                </div>
                <div style={STAT_CARD_STYLE}>
                    <div style={STAT_LABEL_STYLE}>Main 表示中</div>
                    <div style={{ marginTop: 6, fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: 26, color: isAnswer ? '#FFE28A' : '#4FD8FF' }}>
                        {isAnswer ? `解答 ${item.number}` : `問題 ${item.number}`}
                        {!revealed && (
                            <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, fontSize: 14, marginLeft: 10, color: '#7FA8D9' }}>
                                {isAnswer ? '（解答は未表示）' : '（未表示）'}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* 進行バー: 40ステップを並べ、いまの位置を示す。金色はフェーズ最後の解答（進出者を決める地点） */}
            <div style={{ background: 'rgba(8,15,28,.65)', border: '1px solid rgba(79,216,255,.18)', padding: '14px 16px' }}>
                <div className="flex gap-[3px]">
                    {FIRST_STEP_SEQUENCE.map((s, i) => {
                        const isCurrent = i === cursor;
                        const isPast = i < cursor;
                        const isDecision = isPhaseEndAnswer(i);
                        const base = s.view === 'answer' ? '#8A6A1E' : '#1F4A7A';
                        return (
                            <span
                                key={i}
                                title={`${s.view === 'answer' ? '解答' : '問題'} ${s.number}`}
                                style={{
                                    flex: 1, height: isCurrent ? 18 : 10, alignSelf: 'center',
                                    background: isCurrent ? (s.view === 'answer' ? GOLD : ACCENT) : isPast ? base : 'rgba(255,255,255,.07)',
                                    boxShadow: isCurrent ? `0 0 10px ${s.view === 'answer' ? GOLD : ACCENT}` : 'none',
                                    outline: isDecision ? `1px solid ${GOLD}` : 'none', outlineOffset: 1,
                                    transition: 'height .15s ease',
                                }}
                            />
                        );
                    })}
                </div>
                <div className="flex items-center justify-between" style={{ marginTop: 8, fontFamily: '"Noto Sans JP",sans-serif', fontSize: 12, color: '#5C7EA6' }}>
                    <span>青: 問題 / 金茶: 解答 / 金枠: 進出者決定</span>
                    <span>Phase 1（1〜10）→ Phase 2（11〜15）→ Survival（16〜20）</span>
                </div>
            </div>

            {missing && (
                <div style={{ padding: '14px 18px', border: '1.5px solid #FF3B5C', background: 'rgba(255,59,92,.08)' }}>
                    <p style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 800, color: '#FFB3C0', margin: 0 }}>
                        問題が足りません（{questions.length} / {EXTRA_ROUND_QUESTION_COUNT}問）。手動操作から取り込み直してください
                    </p>
                </div>
            )}

            {!revealed && (
                <div style={{ padding: '14px 18px', border: `1.5px solid ${isAnswer ? GOLD : '#33C6FF'}`, background: isAnswer ? 'rgba(255,201,60,.08)' : 'rgba(51,198,255,.08)' }}>
                    <p style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 800, color: isAnswer ? GOLD : '#BFE3FF', margin: 0 }}>
                        {isAnswer
                            ? 'Main は問題文のみ表示中。「解答を表示」で解答を出します'
                            : 'Main は枠のみ表示中。「問題を表示」で問題文を出します'}
                    </p>
                </div>
            )}

            {atDecision && revealed && (
                <div style={{ padding: '14px 18px', border: `1.5px solid ${GOLD}`, background: 'rgba(255,201,60,.08)' }}>
                    <p style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 800, color: GOLD, margin: 0 }}>
                        {/* 最後（Survival）の解答のあとは First Step 全体の終わりなので「First Step 終了」と出す
                            （2026-10-11 ユーザー指示）。次のフェーズは無いので、進出者を決める案内だけにする */}
                        {cursor === FIRST_STEP_SEQUENCE.length - 1
                            ? 'First Step 終了。進出者を決めます'
                            : `${getExtraRoundPhaseLabel(item.number)} 終了。進出者を決めるか、次のフェーズへ進めます`}
                    </p>
                </div>
            )}

            <div style={{ background: 'rgba(8,15,28,.65)', border: `1px solid ${isAnswer ? 'rgba(255,201,60,.4)' : 'rgba(79,216,255,.22)'}`, padding: '22px 26px' }}>
                {question ? (
                    <div className="flex flex-col gap-5">
                        <div>
                            <div style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 12, letterSpacing: 3, color: '#5C7EA6' }}>問題 {question.number}</div>
                            <p style={{ margin: '8px 0 0', fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, fontSize: 22, lineHeight: 1.7, color: '#F3FAFF', whiteSpace: 'pre-wrap' }}>
                                {question.text}
                            </p>
                        </div>
                        {/* 解答・別解は常にスタッフ向けに見せる。Main には解答発表のステップまで出ない */}
                        <div style={{ borderTop: '1px solid rgba(79,216,255,.18)', paddingTop: 16 }}>
                            <div style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 12, letterSpacing: 3, color: isAnswer ? GOLD : '#5C7EA6' }}>
                                模範解答{isAnswer && revealed ? '（表示中）' : '（未表示）'}
                            </div>
                            <p style={{ margin: '8px 0 0', fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: 26, color: '#FFE28A', whiteSpace: 'pre-wrap' }}>
                                {question.answer}
                            </p>
                            <div style={{ marginTop: 14, fontFamily: 'Orbitron, sans-serif', fontSize: 12, letterSpacing: 3, color: '#5C7EA6' }}>別解・正誤判定基準</div>
                            <p style={{ margin: '6px 0 0', fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 500, fontSize: 16, lineHeight: 1.7, color: question.altAnswer ? '#C9D8EE' : '#3A5170', whiteSpace: 'pre-wrap' }}>
                                {question.altAnswer || '（なし）'}
                            </p>
                        </div>
                    </div>
                ) : (
                    <p style={{ margin: 0, fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, color: '#5C7EA6' }}>
                        問題 {item.number} が登録されていません
                    </p>
                )}
            </div>
        </div>
    );
}
