import { useSocketSync } from "../useSocketSync";
import { Socket } from "socket.io-client";
import { useEffect, useState } from "react";
import type { ExtraRoundState, ExtraRoundQuestion, Player } from "@/lib/types";
import { DEFAULT_EXTRA_ROUND_STATE } from "@/lib/types";
import {
    getExtraRoundPhaseRange,
    getFirstStepItem,
    normalizeExtraRoundState,
} from "@/lib/extraRound";
import { ACCENT, TIER_PURPLE } from "@/lib/cyberpunkCard";
import { StandbyStage, BlankScreen } from "./StandbyScreen";
import FixedStage from "@/app/components/FixedStage";
import { useReadyGate } from "../useReadyGate";
import { RoundStage } from "@/app/components/Main/RoundStage";
import { PlayerCardFrame, useCardIntroPhase, WINNER_BAR_COLOR, PLAYER_CARD_CHASSIS_H } from "@/app/components/Main/PlayerCardFrame";
import { RevealWhole } from "@/app/components/Main/RevealText";
import { belowFontSize, BELOW_NUMBER_H } from "@/app/components/Main/belowSizes";

type Props = {
    socket: Socket | null;
}

// Second Step の勝ち抜けに必要な正解数（lib/extraRoundScoring.ts と同じ値）
const SECOND_STEP_WIN_CORRECT_COUNT = 5;

// 色。2nd / 3rd Round の Main と同じ配色を使う（金=勝ち抜け・解答、赤=失格）。
const GOLD = '#FFC93C';
const GOLD_SOFT = '#FFE28A';
const PANEL_CLIP = 'polygon(26px 0,100% 0,100% calc(100% - 26px),calc(100% - 26px) 100%,0 100%,0 26px)';

/**
 * Extra Round（敗者復活）の Main 画面。
 *
 * Main は独自の状態を持たない。サーバから配信される進行状態（stage / cursor / revealed）
 * だけで表示が決まる。stage ごとの表示:
 *   setup / entrantSelect … 「準備中」（スタッフが Admin 側で作業している間の待機画面）
 *   firstStep             … 筆記クイズの問題 → 解答の順に1つずつ表示。問題文・解答は
 *                            Admin が「問題を表示する」「解答を表示」を押す（revealed が
 *                            false → true）まで出ず、押した瞬間に文字が徐々に現れる
 *   secondStep            … 進出者による早押し。2nd / 3rd Round と同じ縦長カード
 */
export default function MainExtraRound(props: Props) {
    const { socket } = props;

    const [state, setState] = useState<ExtraRoundState>(DEFAULT_EXTRA_ROUND_STATE);
    const [questions, setQuestions] = useState<Pick<ExtraRoundQuestion, 'number' | 'text' | 'answer' | 'altAnswer'>[]>([]);
    const [players, setPlayers] = useState<Player[]>([]);
    // 進行状態は、この画面が表示された時点・つなぎ直した時点でサーバから取り直す(覆いが外れて画面が作り直されたとき用。2026-11-04)
    useSocketSync(socket, ['request_extra_round_sync']);

    // 状態・選手（First Step では問題も）がそろうまでは黒い舞台だけを出す（既定の状態の画面が1コマ映るのを防ぐ。2026-11-06）
    const isFirstStep = state.stage === 'firstStep';
    const { ready, mark, load } = useReadyGate(isFirstStep ? ['state', 'players', 'questions'] : ['state', 'players'], ['brand']);

    useEffect(() => {
        const stopPlayers = load('players', '/api/secondRound/loadPlayers', data => setPlayers(data.allPlayers));

        if (socket) {
            const handleStateUpdate = (next: ExtraRoundState) => { setState(normalizeExtraRoundState(next)); mark('state'); };
            const handlePlayersUpdate = (allPlayers: Player[]) => setPlayers(allPlayers);

            socket.on('update_extra_round_state', handleStateUpdate);
            socket.on('update_players', handlePlayersUpdate);

            return () => {
                stopPlayers();
                socket.off('update_extra_round_state', handleStateUpdate);
                socket.off('update_players', handlePlayersUpdate);
            };
        }
        return stopPlayers;
    }, [socket, mark, load]);

    // 問題は First Step に入るたびに取り直す。Main を開いたまま、Admin で問題CSVを
    // 取り込み直すことがあるため（準備中の間に取り込まれた問題を確実に拾う）。
    // public=1 で、Main で使う項目（問題文・解答・別解・正誤判定基準）だけを受け取る。
    useEffect(() => {
        if (!isFirstStep) return;
        return load('questions', '/api/extraRound/questions?public=1', data => setQuestions(data.questions));
    }, [isFirstStep, load]);

    if (!ready) return <BlankScreen />;

    if (state.stage === 'firstStep') {
        const item = getFirstStepItem(state.cursor);
        const question = questions.find(q => q.number === item.number);
        return (
            <FixedStage>
                <FirstStepView
                    key={`${item.view}-${item.number}`}
                    number={item.number}
                    view={item.view}
                    question={question ?? null}
                    revealed={state.revealed}
                />
            </FixedStage>
        );
    }

    if (state.stage === 'secondStep') {
        const entrants = players.filter(p => p.extraRoundSecondStep);
        return (
            <FixedStage>
                <SecondStepView entrants={entrants} socket={socket} />
            </FixedStage>
        );
    }

    // setup / entrantSelect
    return (
        <FixedStage>
            <StandbyView sub={state.stage === 'entrantSelect' ? 'Second Step' : null} />
        </FixedStage>
    );
}

// ============================================================================
// 共通部品
// ============================================================================

const STAGE_STYLE = {
    width: 1920, height: 1080, boxSizing: 'border-box' as const, padding: '56px 72px', backgroundColor: '#000000',
    display: 'flex', flexDirection: 'column' as const, position: 'relative' as const, overflow: 'hidden',
    fontFamily: "'Rajdhani','Noto Sans JP',sans-serif",
};

/**
 * 見出し。1行目は「Extra Round」、step を渡すと「Extra Round - First Step」のように段階名を
 * 右に並べる（2026-10-11 のユーザー指示）。subtitle を渡すと2行目に大きく出す。
 */
function Header({ step, subtitle, right }: { step?: string; subtitle?: string; right?: React.ReactNode }) {
    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 40, letterSpacing: 3, color: '#FFFFFF' }}>{step ? `Extra Round - ${step}` : 'Extra Round'}</div>
                {subtitle && (
                    <div style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: 50, color: '#F3FAFF', letterSpacing: 1 }}>{subtitle}</div>
                )}
            </div>
            {right}
        </div>
    );
}

// ============================================================================
// 準備中（setup / entrantSelect）
// ============================================================================

function StandbyView({ sub }: { sub?: string | null }) {
    // 共有の待機画面（2026-11-04 ユーザー指示。今までの「準備中 / STANDBY」を置き換え）。
    // 問題の取り込み中は NEXT Extra Round、Second Step の進出者を選んでいる間は NEXT Extra Round / Second Step
    return <StandbyStage title="Extra Round" sub={sub} />;
}

// ============================================================================
// First Step（問題 / 解答）
// ============================================================================

/**
 * 問題文の長さに応じた文字サイズ。パネルの横幅（約1700px）と高さに収まるよう、
 * 長い問題ほど小さくする。1行あたりの文字数と行数から逆算した段階値。
 */
function questionFontSize(text: string, hasAnswer: boolean): number {
    const len = text.length;
    // 解答も同じ画面に出す場合、問題文に使える高さが減るので一段小さくする
    const shrink = hasAnswer ? 0.7 : 1;
    let size: number;
    if (len <= 100) size = 64;
    else if (len <= 150) size = 48;
    else if (len <= 220) size = 36;
    else size = 30;
    return Math.floor(size * shrink);
}

function answerFontSize(text: string): number {
    const len = text.length;
    if (len <= 16) return 96;
    if (len <= 24) return 72;
    if (len <= 48) return 54;
    return 42;
}

function FirstStepView({ number, view, question, revealed }: {
    number: number;
    view: 'question' | 'answer';
    question: Pick<ExtraRoundQuestion, 'number' | 'text' | 'answer' | 'altAnswer'> | null;
    /** 問題のステップでは問題文、解答のステップでは解答を出してよいか */
    revealed: boolean;
}) {
    const isAnswer = view === 'answer';
    const lineColor = isAnswer ? GOLD : ACCENT;
    const [phaseStart, phaseEnd] = getExtraRoundPhaseRange(number);
    const inPhase = Array.from({ length: phaseEnd - phaseStart + 1 }, (_, i) => phaseStart + i);

    return (
        <div style={STAGE_STYLE}>
            {/* 見出し「Extra Round - First Step」と下の紫の線は 2026-11-12 のユーザー指示で削除した
                （右上のフェーズ名 Phase 1 / Phase 2 / Survival は 2026-10-11 に削除済み）。問題番号と問題文の枠は舞台の上下中央 */}

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 32, minHeight: 0 }}>
                {/* 問題番号と、フェーズ内の位置 */}
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 22 }}>
                        <span style={{ fontFamily: 'Orbitron, "Noto Sans JP", sans-serif', fontWeight: 900, fontSize: 40, letterSpacing: 4, color: isAnswer ? GOLD_SOFT : '#7FA8D9' }}>
                            {isAnswer ? 'ANSWER' : 'QUESTION'}
                        </span>
                        <span style={{ fontFamily: 'Orbitron, "Noto Sans JP", sans-serif', fontWeight: 900, fontSize: 150, lineHeight: 1, color: '#F3FAFF', textShadow: `0 0 26px ${lineColor}66` }}>
                            {number}
                        </span>
                    </div>
                    <div style={{ display: 'flex', gap: 10, paddingBottom: 18 }}>
                        {inPhase.map(n => (
                            <span
                                key={n}
                                style={{
                                    width: n === number ? 44 : 24, height: 10, transition: 'width .3s ease',
                                    background: n === number ? lineColor : n < number ? '#3A5170' : 'rgba(255,255,255,.08)',
                                    boxShadow: n === number ? `0 0 10px ${lineColor}` : 'none',
                                }}
                            />
                        ))}
                    </div>
                </div>

                {/* 問題文（と解答）。枠は ACCENT（解答のときは金）。clip-path で面取りした外枠＋内側 */}
                <div style={{ clipPath: PANEL_CLIP, background: lineColor, padding: 3, boxShadow: `0 0 30px ${lineColor}55` }}>
                    <div style={{ clipPath: PANEL_CLIP, background: 'rgba(8,14,26,.96)', padding: '46px 64px', minHeight: 420, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 36 }}>
                        {question ? (
                            <>
                                <p style={{ margin: 0, fontFamily: '"Noto Sans JP",sans-serif', fontWeight: isAnswer ? 700 : 900, fontSize: questionFontSize(question.text, isAnswer), lineHeight: 1.5, letterSpacing: 1, color: '#F3FAFF', whiteSpace: 'pre-wrap' }}>
                                    {/* 文字色は問題・解答のステップで同じ（2026-10-11 ユーザー指示）。
                                        問題のステップでは、問題文だけが全体一度に現れる。解答のステップでは問題文は最初から出ている */}
                                    {isAnswer
                                        ? question.text
                                        : <RevealWhole text={question.text} revealed={revealed} />}
                                </p>
                                {isAnswer && (
                                    <div style={{ borderTop: `2px solid ${GOLD}66`, paddingTop: 30, display: 'flex', alignItems: 'baseline', gap: 28 }}>
                                        <span style={{ fontFamily: 'Orbitron, "Noto Sans JP", sans-serif', fontWeight: 800, fontSize: 26, letterSpacing: 4, color: GOLD, flexShrink: 0 }}>A.</span>
                                        <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: answerFontSize(question.answer), lineHeight: 1.3, color: GOLD_SOFT, textShadow: '0 0 22px rgba(255,201,60,.45)', whiteSpace: 'pre-wrap' }}>
                                            {/* 解答は、Admin の「解答を表示」を押すと問題文と同じ動き（全体一度に）で現れる（2026-10-11 ユーザー指示） */}
                                            <RevealWhole text={question.answer} revealed={revealed} />
                                        </span>
                                    </div>
                                )}
                                {/* 別解・正誤判定基準（2026-10-11 のユーザー指示で Main にも出す）。
                                    解答と同時に、同じ動きで現れる。空のときは出さない */}
                                {/* 「別解・正誤判定」という見出しは付けない（2026-10-11 ユーザー指示）。
                                    左端は解答の文字とそろえるため、見えない「A.」を同じ幅で置く */}
                                {isAnswer && question.altAnswer && (
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 28, marginTop: -8 }}>
                                        <span aria-hidden style={{ fontFamily: 'Orbitron, "Noto Sans JP", sans-serif', fontWeight: 800, fontSize: 26, letterSpacing: 4, flexShrink: 0, visibility: 'hidden' }}>A.</span>
                                        <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, fontSize: 64, lineHeight: 1.4, color: '#E9F3FF', whiteSpace: 'pre-wrap' }}>
                                            <RevealWhole text={question.altAnswer} revealed={revealed} />
                                        </span>
                                    </div>
                                )}
                            </>
                        ) : (
                            <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: 52, color: '#5C7EA6', textAlign: 'center' }}>
                                問題 {number} を準備中です
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ============================================================================
// Second Step（早押し）
// ============================================================================

function SecondStepView({ entrants, socket }: { entrants: Player[]; socket: Socket | null }) {
    const phase = useCardIntroPhase();

    // 人数が多いときは列全体を縮小して画面幅に収め、少ないときは間隔を広げて見栄えを保つ。
    // 2026-10-22 から縮小は RoundStage が行う（見出し → 問題欄 → 仕切り線 → カードの位置を全ラウンドでそろえる）
    const CARD_SLOT_W = 172;
    const n = entrants.length;
    const gap = n <= 6 ? 56 : n <= 9 ? 28 : 12;
    const naturalRowW = n > 0 ? n * CARD_SLOT_W + (n - 1) * gap : 1;

    return (
        // 右上の「敗者復活者が決定しました」は 2026-10-11 のユーザー指示で削除した。
        // 2026-10-11 のユーザー指示で、1行目を「Extra Round - Second Step」、2行目をルール（5○1×）にした
        <RoundStage socket={socket} round="extraSecondStep" ruleColor={TIER_PURPLE} contentW={naturalRowW} contentH={EXTRA_SECOND_STEP_CONTENT_H}
            header={<Header step="Second Step" subtitle={`${SECOND_STEP_WIN_CORRECT_COUNT}○1×`} />}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap }}>
                {entrants.map(p => {
                    const isWinner = p.extraRoundRank > 0;
                    const eliminated = p.extraRoundRank < 0;
                    const resultColor = eliminated ? '#8A93A3' : isWinner ? GOLD_SOFT : '#EAF6FF';
                    const filled = Math.min(SECOND_STEP_WIN_CORRECT_COUNT, p.extraRoundCorrectCount);
                    return (
                        <PlayerCardFrame
                            key={p.id}
                            phase={phase}
                            paperRank={p.paperRank}
                            eliminated={eliminated}
                            winner={isWinner}
                            name={p.name}
                            school={p.school}
                            grade={p.grade}
                            pct={Math.min(100, (filled / SECOND_STEP_WIN_CORRECT_COUNT) * 100)}
                            // 勝ち抜けたら 2nd・3rd Round と同じくバーをオレンジにする（2026-10-11、ユーザー指示）
                            barColor={isWinner ? WINNER_BAR_COLOR : undefined}
                            belowContent={
                                <>
                                    <div style={{ marginTop: 16, height: BELOW_NUMBER_H, lineHeight: `${BELOW_NUMBER_H}px`, fontFamily: 'Orbitron, "Noto Sans JP", sans-serif', fontSize: belowFontSize(eliminated ? 'LOST' : isWinner ? 'Revival' : p.extraRoundCorrectCount), fontWeight: 800, letterSpacing: 1, color: resultColor, whiteSpace: 'nowrap' }}>
                                        {/* 敗者復活者（1名まで）は順位でなく「Revival」（2026-11-04 ユーザー指示） */}
                                        {eliminated ? 'LOST' : isWinner ? 'Revival' : p.extraRoundCorrectCount}
                                    </div>
                                </>
                            }
                        />
                    );
                })}
                {n === 0 && (
                    <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, fontSize: 28, color: '#5C7EA6' }}>
                        出場者が選ばれていません。
                    </span>
                )}
            </div>
        </RoundStage>
    );
}

/** 選手カード（600。2026-11-07 に 694 から詰めた）＋ 下の数字（16＋BELOW_NUMBER_H）。RoundStage の縮小の基準（2026-10-22） */
const EXTRA_SECOND_STEP_CONTENT_H = PLAYER_CARD_CHASSIS_H + 16 + BELOW_NUMBER_H;
