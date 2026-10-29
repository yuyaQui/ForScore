import { Socket } from "socket.io-client";
import { useState, useEffect } from "react";
import type { CSSProperties } from "react";
import type { Player, ThirdRoundTimer } from "@/lib/types";
import {
    COURSE_TIME_LIMIT_SECONDS,
    THIRD_ROUND_COURSES,
    WINNERS_PER_COURSE,
    type ThirdRoundCourseName
} from "@/lib/thirdRoundCourses";
import { formatTime } from "@/lib/formatTime";
import {
    getCourseFinishState,
    getTenByTenTotal,
    getTenByTenWrongPoint,
    getSwedishCrossToAdd
} from "@/lib/thirdRoundScoring";
import { toOrdinal } from "@/lib/ordinal";
import { ACCENT, tierOf, fitFontSizeToWidth } from "@/lib/cyberpunkCard";
import { useQuestionDisplay, AdminQuestionPanel } from "./AdminQuestionPanel";
import { useRoundProgress, nextRoundPrimary, blockUndoIfLaterStarted, cascadeNotice, broadcastAfterReset } from "./roundProgressContext";

type Props = {
    socket: Socket | null;
}

type Course = {
    id: number;
    name: string;
    playOrder: number | null;
}

type ThirdRoundState = {
    // playoff は判定基準で決着しなかった選手の早押しプレーオフ。
    // quizOrder はそのまま使うので、どのコースの分かが分かる。
    phase: "courseSelect" | "quiz" | "playoff";
    step: "entry" | "closed";
    quizOrder: number;
    // コース終了処理を走らせたコースの quizOrder。未実行なら null。
    // 「終了処理を走らせたか」はデータから導出できないため状態として持つ。
    finishedOrder: number | null;
    // サドンデスの参加者（始めた時点の未決着者。2026-10-29 追加）。無ければコースの5名全員を出す
    playoffIds?: number[] | null;
}

// 確定結果の内訳。掲げた／強制出場の区別を表示するためだけに使う。
// DB には保存しないため、リロードすると消える（大会結果には影響しない情報）。
type AssignedPlayer = {
    id: number;
    entryNo: number;
    name: string;
    secondRoundRank: number;
    paperRank: number;
    forced: boolean;
}

// ==================== デザイン実装: 共通スタイル ====================
// 手動操作パネルは AdminSecondRound.tsx と同じ見た目(Cowork Design の
// AdminManual.dc.html をレビューで確定した版)を複製している。lib/ 配下は
// Main/Admin共通コードのみを置く方針のため、同じ定数をここでも用意する。
const MANUAL_PANEL_BASE: CSSProperties = {
    boxSizing: 'border-box', padding: '16px 20px 20px', background: 'rgba(12,22,40,.75)',
    border: '1px solid rgba(79,216,255,.22)',
    clipPath: 'polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px)',
    display: 'flex', flexDirection: 'column', gap: 12,
};
const MANUAL_LABEL_STYLE: CSSProperties = {
    fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 12, letterSpacing: 3, color: '#5C7EA6',
};
function manualPanelStyle(active: boolean, flex: number): CSSProperties {
    return { ...MANUAL_PANEL_BASE, flex, ...(active ? {} : { opacity: 0.35, pointerEvents: 'none' as const }) };
}
function manualBtnStyle(selected: boolean): CSSProperties {
    return {
        padding: '9px 16px',
        background: selected ? 'rgba(51,198,255,.14)' : 'rgba(255,255,255,.03)',
        border: `1.5px solid ${selected ? ACCENT : 'rgba(79,216,255,.18)'}`,
        clipPath: 'polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px)',
        cursor: 'pointer',
        boxShadow: selected ? '0 0 14px rgba(51,198,255,.14)' : undefined,
    };
}
function manualBtnTextStyle(selected: boolean): CSSProperties {
    return {
        fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 14, letterSpacing: 1,
        color: selected ? '#DFF7FF' : '#5C7EA6', whiteSpace: 'nowrap',
    };
}
function dangerBtnStyle(): CSSProperties {
    return {
        padding: '9px 18px', background: 'rgba(255,59,92,.10)', border: '1.5px solid #FF3B5C',
        clipPath: 'polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px)', cursor: 'pointer',
    };
}
function neutralBtnStyle(): CSSProperties {
    return {
        padding: '9px 18px', background: 'rgba(255,255,255,.04)', border: '1.5px solid #3A4B63',
        clipPath: 'polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px)', cursor: 'pointer',
    };
}

// コース選択画面の統計カード(DRAWN / CURRENT COURSE / 選択中)。
// Cowork Design の AdminThirdRoundCourseSelect.dc.html と同じ面取り(12px)。
const STAT_CARD_STYLE: CSSProperties = {
    flex: 1, boxSizing: 'border-box', padding: '14px 18px', background: 'rgba(12,22,40,.75)',
    border: '1px solid rgba(79,216,255,.22)',
    clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)',
};
const STAT_LABEL_STYLE: CSSProperties = { fontFamily: 'Orbitron, sans-serif', fontSize: 11, letterSpacing: 3, color: '#5C7EA6' };

// クイズ画面の統計カード(残り勝抜枠 / 残り時間)。Cowork Design の
// AdminThirdRound10UpDown.dc.html 等と同じ面取り(14px)。
const QUIZ_STAT_CARD_STYLE: CSSProperties = {
    flex: 1, boxSizing: 'border-box', padding: '18px 22px', background: 'rgba(12,22,40,.75)',
    border: '1px solid rgba(79,216,255,.22)',
    clipPath: 'polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px)',
};
const QUIZ_STAT_LABEL_STYLE: CSSProperties = { fontFamily: 'Orbitron, sans-serif', fontSize: 12, letterSpacing: 3, color: '#5C7EA6' };

function timerBtnStyle(kind: 'start' | 'stop'): CSSProperties {
    const base: CSSProperties = {
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '7px 0',
        clipPath: 'polygon(4px 0,100% 0,100% calc(100% - 4px),calc(100% - 4px) 100%,0 100%,0 4px)', cursor: 'pointer',
    };
    return kind === 'start'
        ? { ...base, background: 'rgba(51,198,255,.12)', border: '1.5px solid #33C6FF' }
        : { ...base, background: 'rgba(255,59,92,.10)', border: '1.5px solid #FF3B5C' };
}
function timerBtnTextStyle(kind: 'start' | 'stop'): CSSProperties {
    return {
        fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 12, letterSpacing: 0.5,
        color: kind === 'start' ? '#DFF7FF' : '#FFE3E8',
    };
}

// 正誤判定ボタン。4コース共通(Cowork Design の AdminThirdRound*.dc.html と同じ面取り)。
function opBtnStyle(kind: 'correct' | 'wrong', enabled: boolean): CSSProperties {
    return {
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '9px 0',
        background: kind === 'correct' ? 'rgba(51,198,255,.12)' : 'rgba(255,59,92,.10)',
        border: `1.5px solid ${kind === 'correct' ? '#33C6FF' : '#FF3B5C'}`,
        clipPath: 'polygon(5px 0,100% 0,100% calc(100% - 5px),calc(100% - 5px) 100%,0 100%,0 5px)',
        cursor: enabled ? 'pointer' : 'default', opacity: enabled ? 1 : 0.35,
    };
}
function opBtnTextStyle(kind: 'correct' | 'wrong'): CSSProperties {
    return {
        fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 16, letterSpacing: 1,
        color: kind === 'correct' ? '#DFF7FF' : '#FFE3E8',
    };
}

// 残り時間のリング表示。Cowork Design の AdminThirdRound*.dc.html と同じ計算式
// (半径19pxの円周を残り時間の割合で塗り分ける)。
// EDIT(手動編集)はこのカードには置かず、下の「手動操作」パネルにまとめている
// (フォーム入力はこの小さいカードに収まらないため。モックアップはSTART/STOP/EDITの
// 3ボタンだが、ここではSTART/STOPの2つだけを常設し、EDITは手動操作パネル側に
// 移した。見た目の配置のみの変更で、データ操作(タイマーの編集ロジック自体)は変えていない)。
function TimerDisplay({ remaining, isRunning, onStart, onStop }: {
    remaining: number; isRunning: boolean; onStart: () => void; onStop: () => void;
}) {
    const TOTAL = COURSE_TIME_LIMIT_SECONDS;
    const R = 19;
    const C = 2 * Math.PI * R;
    const frac = Math.max(0, Math.min(1, remaining / TOTAL));
    const filled = frac * C;
    const urgent = remaining > 0 && remaining <= 120;
    const ringColor = remaining === 0 || urgent ? '#FF3B5C' : '#4FD8FF';
    const glow = remaining === 0 || urgent ? 'rgba(255,59,92,.65)' : 'rgba(79,216,255,.55)';

    return (
        <>
            <div className={remaining === 0 || urgent ? 'animate-pulse' : ''} style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ position: 'relative', width: 46, height: 46, flexShrink: 0 }}>
                    <svg width={46} height={46} viewBox="0 0 46 46" style={{ transform: 'rotate(-90deg)' }}>
                        <circle cx={23} cy={23} r={R} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth={5} />
                        <circle
                            cx={23} cy={23} r={R} fill="none" stroke={ringColor} strokeWidth={5} strokeLinecap="round"
                            strokeDasharray={`${filled.toFixed(1)} ${(C - filled).toFixed(1)}`}
                            style={{ filter: `drop-shadow(0 0 4px ${glow})` }}
                        />
                    </svg>
                </div>
                <span style={{
                    fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 28, letterSpacing: 1, color: '#FFFFFF',
                    fontVariantNumeric: 'tabular-nums', textShadow: `0 0 10px ${glow}`,
                }}>
                    {formatTime(remaining)}
                </span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={onStart} disabled={isRunning || remaining === 0} style={{ ...timerBtnStyle('start'), opacity: isRunning || remaining === 0 ? 0.35 : 1, cursor: isRunning || remaining === 0 ? 'default' : 'pointer' }}>
                    <span style={timerBtnTextStyle('start')}>START</span>
                </button>
                <button onClick={onStop} disabled={!isRunning} style={{ ...timerBtnStyle('stop'), opacity: !isRunning ? 0.35 : 1, cursor: !isRunning ? 'default' : 'pointer' }}>
                    <span style={timerBtnTextStyle('stop')}>STOP</span>
                </button>
            </div>
        </>
    );
}

// クイズ実施中の選手カード。Cowork Design の AdminThirdRound10UpDown.dc.html /
// AdminThirdRoundFreeze10.dc.html / AdminThirdRoundSwedish10.dc.html /
// AdminThirdRound10by10.dc.html の見た目をそのまま移植し、下段の内訳表示だけを
// コース名で出し分ける(Main側のQuizPlayerCardと同じ考え方)。
// 失格と敗退の区別はMain画面のリデザイン時の決定(一律LOST表示)に合わせている。
/** 選手枠1枚の幅の上限。スルーボタンの幅もこれから求める */
const ADMIN_QUIZ_CARD_MAX_WIDTH = 220;
/**
 * 選手名の欄（縦書き1列）の高さ。名前の長さに関係なくこの高さで固定し、下の表示がずれないようにする。
 * 2026-10-11 のユーザー指示で、ポイントバーを 2nd Round と同じ横向きにした分だけ欄を高くし、
 * 名前は折り返さずに、この高さに収まる最大の文字サイズで1列に表示する（2nd Round と同じ考え方）。
 */
const NAME_ZONE_H = 210;

/** 名前を1列に収める文字サイズと字間。長い名前は字間も詰める */
function getNameFont(name: string): { fontSize: number; letterSpacing: number } {
    const n = Array.from(name).length;
    const letterSpacing = n > 8 ? 1 : 3;
    // 実際の縦書きの描画はわずかに計算より長くなることがあるので、安全マージン(14px)を引いて計算する
    return { fontSize: fitFontSizeToWidth(name, NAME_ZONE_H - 14, letterSpacing, 8, 46), letterSpacing };
}

function AdminQuizCard({ player: p, courseName, onScore, busy }: {
    player: Player; courseName: ThirdRoundCourseName;
    onScore: (playerId: number, action: 'correct' | 'wrong') => void; busy: boolean;
}) {
    const tier = tierOf(p.paperRank, ACCENT);
    const isWinner = p.thirdRoundRank > 0;
    const isEliminated = p.thirdRoundRank < 0;
    const isSettled = p.thirdRoundRank !== 0;
    const isUpDown = courseName === THIRD_ROUND_COURSES.UP_DOWN;
    const isTenByTen = courseName === THIRD_ROUND_COURSES.TEN_BY_TEN;
    const isSwedish = courseName === THIRD_ROUND_COURSES.SWEDISH;
    const isFreeze = courseName === THIRD_ROUND_COURSES.FREEZE;
    const isResting = isFreeze && p.thirdRoundFreezeRest > 0;
    const canOperate = !isSettled && !isResting;

    const dotColor = isEliminated ? '#4A5568' : isWinner ? '#FFC93C' : isResting ? '#7FE8FF' : '#35FFA0';
    const barColor = isEliminated ? '#4A5568' : isWinner ? '#FFC93C' : '#4FD8FF';

    // メインの数字とバーの分母はコースで変わる(Main画面と同じ考え方)。
    // 10 up-down: ポイント/10、Freeze・Swedish: 正解数/10、10 by 10: 総合pt/100。
    let mainValue: number;
    let quota: number;
    if (isTenByTen) {
        mainValue = getTenByTenTotal(p);
        quota = 100;
    } else if (isUpDown) {
        mainValue = p.thirdRoundUpDownPoint;
        quota = 10;
    } else {
        mainValue = p.thirdRoundCorrectCount;
        quota = 10;
    }
    const pct = Math.min(100, (mainValue / quota) * 100);
    const statusStr = isEliminated ? 'LOST' : isWinner ? toOrdinal(p.thirdRoundRank) : '';
    const nameFont = getNameFont(p.name);

    return (
        <div style={{
            flex: '1 1 0', minWidth: 0, maxWidth: ADMIN_QUIZ_CARD_MAX_WIDTH, boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
            alignItems: 'center', background: 'rgba(12,22,40,.75)', border: '1px solid rgba(79,216,255,.22)',
            borderTop: `3px solid ${tier.color}`, padding: '14px 8px 16px', gap: 12, overflow: 'hidden',
        }}>
            <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 20, letterSpacing: 1, color: tier.color }}>
                {toOrdinal(p.paperRank)}
            </div>
            <span style={{ display: 'block', width: 9, height: 9, borderRadius: '50%', background: dotColor, boxShadow: `0 0 8px ${dotColor}` }} />
            {/* 名前の欄は高さを固定し、名前は折り返さず1列に収める（getNameFont。2026-10-11 ユーザー指示） */}
            <div style={{ height: NAME_ZONE_H, width: '100%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                <span style={{
                    writingMode: 'vertical-rl', textOrientation: 'upright', fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700,
                    fontSize: nameFont.fontSize, letterSpacing: nameFont.letterSpacing, lineHeight: 1, color: '#E9F3FF', whiteSpace: 'nowrap',
                }}>
                    {p.name}
                </span>
            </div>
            {/* 勝ち抜け順位/LOST・ポイント数・ポイントバー・誤答数は、2nd Round の Admin と同じく
                上下の間隔を詰めて1かたまりにする（2026-10-11 ユーザー指示。詰めすぎとのことで、変更前(間隔12px)と
                最初に詰めた版(4px)の中間の8pxにしている） */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: '100%' }}>
                <div style={{ height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {statusStr ? (
                        <span style={{
                            fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 14, letterSpacing: 1,
                            color: isEliminated ? '#8A93A3' : '#FFC93C',
                            textShadow: isEliminated ? 'none' : '0 0 6px rgba(255,201,60,.6)', whiteSpace: 'nowrap',
                        }}>
                            {statusStr}
                        </span>
                    ) : isResting ? (
                        // Freeze 10 の休み中の残り問数。休み中の選手は勝ち抜け/LOST が無いので同じ行に出す
                        <span style={{
                            whiteSpace: 'nowrap', fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 15, lineHeight: 1, color: '#7FE8FF',
                            textShadow: '0 0 6px rgba(127,216,255,.5)', padding: '2px 10px', boxSizing: 'border-box',
                            border: '1.5px solid #7FE8FF', background: 'rgba(12,22,40,.85)',
                            clipPath: 'polygon(3px 0,100% 0,100% calc(100% - 3px),calc(100% - 3px) 100%,0 100%,0 3px)',
                        }}>
                            {p.thirdRoundFreezeRest}
                        </span>
                    ) : null}
                </div>
                <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 24, lineHeight: 1, color: '#EAF6FF' }}>{mainValue}</span>
                {/* ポイントバーは 2nd Round と同じ横向き */}
                <div style={{ width: '80%', height: 7, background: 'rgba(255,255,255,.06)', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${pct}%`, background: barColor, boxShadow: `0 0 6px ${barColor}` }} />
                </div>

                {/* コースごとの追加表示（誤答数など） */}
                {isUpDown && (
                    <div style={{ display: 'flex', gap: 3 }}>
                        {Array.from({ length: 2 }).map((_, i) => {
                            const isX = i < p.thirdRoundWrongCount;
                            return (
                                <span key={i} style={{ display: 'inline-block', width: 16, textAlign: 'center', fontSize: 16, lineHeight: 1, color: isX ? '#FF4D6D' : '#3A4B63' }}>
                                    {isX ? '×' : '・'}
                                </span>
                            );
                        })}
                    </div>
                )}
                {/* Freeze 10 の誤答数。「誤答」のラベルは 2026-10-11 のユーザー指示で外した */}
                {isFreeze && (
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 18, lineHeight: 1, color: p.thirdRoundWrongCount > 0 ? '#FF4D6D' : '#3A5170' }}>
                            {p.thirdRoundWrongCount}
                        </span>
                    </div>
                )}
                {/* Swedish 10 の×の数。「×」のラベルは 2026-10-11 のユーザー指示で外した */}
                {isSwedish && (
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 18, lineHeight: 1, color: p.thirdRoundSwedishCross > 0 ? '#FF4D6D' : '#3A5170' }}>
                            {p.thirdRoundSwedishCross}
                        </span>
                        {/* 次に誤答したら加算される×の数（2026-10-11 ユーザー指示）。決着した選手には出さない */}
                        {!isSettled && (
                            <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 13, lineHeight: 1, color: '#FF9E9E' }}>
                                (+{getSwedishCrossToAdd(p.thirdRoundCorrectCount)})
                            </span>
                        )}
                    </div>
                )}
                {isTenByTen && (
                    <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 16, lineHeight: 1, letterSpacing: 0.5 }}>
                        <span style={{ color: '#FF9E9E' }}>{p.thirdRoundCorrectCount}</span>
                        <span style={{ color: '#7FA8D9' }}> × </span>
                        <span style={{ color: '#8FD4FF' }}>{getTenByTenWrongPoint(p)}</span>
                    </div>
                )}
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
}

export default function AdminThirdRound(props: Props) {
    const { socket } = props;

    // 問題表示（2026-10-22）。採点（正解・誤答・スルー）が成功したら、その問題を Main に表示して次の問題に進める。
    // コースが変わっても通し番号は続きから（ラウンドで1本の番号）
    const { state: questionState, finishQuestion } = useQuestionDisplay(socket, 'thirdRound');
    // 各ラウンドの状況（2026-10-22。「Extra Round へ ▶」・Undo の制限・リセットの確認文に使う）
    const progress = useRoundProgress();

    const [thirdRoundState, setThirdRoundState] = useState<ThirdRoundState>({
        phase: "courseSelect",
        step: "entry",
        quizOrder: 1,
        finishedOrder: null
    });
    const [courses, setCourses] = useState<Course[]>([]);
    const [winners, setWinners] = useState<Player[]>([]);
    // プレートを掲げていた人。Admin のローカル状態で、確定時にサーバへ送る
    const [raisedIds, setRaisedIds] = useState<number[]>([]);
    // 直前に確定した結果の内訳（掲げた／強制出場）
    const [lastAssigned, setLastAssigned] = useState<AssignedPlayer[]>([]);
    const [isBusy, setIsBusy] = useState(false); // API と通信中かどうか
    const [errorMessage, setErrorMessage] = useState("");
    // 15分タイマー。サーバが唯一の時計で、ここは受け取った値を表示するだけ。
    // 接続直後にサーバから現在値が届くので、初期値は表示が一瞬崩れないための仮置き。
    const [timer, setTimer] = useState<ThirdRoundTimer>({
        remainings: {},
        runningOrder: null
    });
    // タイマーの手動編集。入力中の値は Admin のローカル状態で持つ
    const [isEditingTimer, setIsEditingTimer] = useState(false);
    const [editMinutes, setEditMinutes] = useState(0);
    const [editSeconds, setEditSeconds] = useState(0);

    useEffect(() => {
        // 画面を開いた直後の1回だけ、現在の状態を直接取得する。
        // この時点では他の画面に配信すべき新しい情報がないため setState してよい。
        fetch('/api/thirdRound/courses')
            .then(res => res.json())
            .then(data => { if (data.success) setCourses(data.courses); })
            .catch(err => console.error("Failed to load third round courses", err));

        fetch('/api/thirdRound/courseSelect')
            .then(res => res.json())
            .then(data => { if (data.success) setWinners(data.winners); })
            .catch(err => console.error("Failed to load third round winners", err));

        if (socket) {
            const handleStateUpdate = (state: ThirdRoundState) => setThirdRoundState(state);

            const handlePlayersUpdate = (allPlayers: Player[]) => {
                setWinners(
                    allPlayers
                        .filter(p => p.secondRoundRank >= 1)
                        .sort((a, b) =>
                            a.secondRoundRank !== b.secondRoundRank
                                ? a.secondRoundRank - b.secondRoundRank
                                : a.paperRank - b.paperRank
                        )
                );
            };

            // 抽選結果はここで受け取る。
            // fetch の戻り値を直接 setState しないのは、更新経路を1本に保つため。
            // Socket 経由に統一すると Admin と Main が同じデータを同じタイミングで受け取る。
            //
            // このイベントが運ぶのはコース情報だけ。選手データは update_players で受け取る。
            // 経路を種別ごとに1本に保たないと、片方の画面だけが更新される事故が起きる。
            const handleCoursesUpdate = (nextCourses: Course[]) => {
                setCourses(nextCourses);
                setRaisedIds([]);       // 新しいコースに移るのでチェックを外す
                setLastAssigned([]);    // 前のコースの内訳表示も消す
            };

            const handleTimerUpdate = (next: ThirdRoundTimer) => setTimer(next);

            socket.on("update_third_round_state", handleStateUpdate);
            socket.on("update_third_round_courses", handleCoursesUpdate);
            socket.on("update_players", handlePlayersUpdate);
            socket.on("update_third_round_timer", handleTimerUpdate);

            // 接続直後の配信はこの画面が無いうちに届いて失われるので、表示した時点で
            // 現在の進行状態とタイマーを取り直す（server/ThirdRoundHandler.js）
            socket.emit("request_third_round_sync");

            return () => {
                socket.off("update_third_round_state", handleStateUpdate);
                socket.off("update_third_round_courses", handleCoursesUpdate);
                socket.off("update_players", handlePlayersUpdate);
                socket.off("update_third_round_timer", handleTimerUpdate);
            };
        }
    }, [socket]);

    const changeState = (updates: Partial<ThirdRoundState>) => {
        if (socket) socket.emit('change_3rd_round_state', updates);
    };

    // タイマー操作。サーバが時計を持っているので、ここは要求を送るだけ。
    // 自分の画面も配信（update_third_round_timer）経由で更新される。
    const changeTimer = (action: 'start' | 'stop' | 'reset') => {
        if (socket) socket.emit('change_third_round_timer', { action });
    };

    const handleTimerReset = () => {
        // 進行中に誤って押すと15分が巻き戻るため確認する
        if (window.confirm('タイマーを15分に戻しますか？')) changeTimer('reset');
    };

    // 残り秒数の手動編集。疑義の申し立てで時間を戻す場合や、開始を忘れたまま
    // 進行してしまった場合の復旧手段。サーバ側で編集時に時計は止まる。
    const handleTimerEditStart = () => {
        setEditMinutes(Math.floor(remaining / 60));
        setEditSeconds(remaining % 60);
        setIsEditingTimer(true);
    };

    const handleTimerEditSave = () => {
        if (socket) {
            socket.emit('change_third_round_timer', {
                action: 'edit',
                seconds: editMinutes * 60 + editSeconds
            });
        }
        setIsEditingTimer(false);
    };

    // スコア更新。
    // fetch の結果を直接 setState せず、Socket で配って update_players 経由で
    // 自分の画面も更新する。自分だけ別経路で更新すると Main と表示がずれる。
    // playerId はスルーのとき null。スルーは「問題が1問終わった」というイベントで
    // 選手に紐づかないため、対象コースは常に courseName で伝える。
    const handleScore = async (
        playerId: number | null,
        action: 'correct' | 'wrong' | 'through' | 'finish'
    ) => {
        if (!quizCourse) return;

        setIsBusy(true);
        setErrorMessage("");
        try {
            const res = await fetch('/api/thirdRound/updateScores', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerId, action, courseName: quizCourse.name })
            });
            const data = await res.json();

            if (data.success && socket) {
                // 選手データ専用の経路で配る。コース情報のイベントに同乗させない。
                socket.emit('broadcast_scores', data.allPlayers);

                // 勝ち抜けまたは失格が出たら時計を止める（設計メモ 4.2）。
                // 判定は API 側にある。server/ は DB を見ないので勝ち抜けを知らず、
                // Admin が中継役になる。止まっていても stop は無害。
                if (data.shouldStopTimer) {
                    socket.emit('change_third_round_timer', { action: 'stop' });
                }
                // 正解・誤答・スルーでその問題は終わる。コース終了処理（finish）は問題と関係しない
                if (action !== 'finish') finishQuestion();
            } else {
                setErrorMessage(data.error || '更新に失敗しました');
            }
        } catch (error) {
            console.error('Score update failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    // サドンデスの採点部分
    const handlePlayoffScore = async (playerId: number, action: 'correct' | 'wrong') => {
        if (!quizCourse) return;
        setIsBusy(true);
        setErrorMessage("");
        try {
            const res = await fetch('/api/thirdRound/updateScores', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    playerId,
                    action,
                    courseName: quizCourse.name,
                    playoff: true
                })
            });
            const data = await res.json()
            if (data.success && socket) {
                socket.emit('broadcast_scores', data.allPlayers)
                // サドンデスも早押しの1問。Main に表示して次の問題へ
                finishQuestion();
            } else {
                setErrorMessage(data.error || '更新に失敗しました');
            }
        } catch (error) {
            console.error('Playoff score update failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    // スコア更新を1手戻す。履歴はコース単位なので、いま実施中のコース名を送る。
    // タイマーと出場者の割当は戻らない（別系統）。
    const handleScoreUndo = async () => {
        if (!quizCourse) return;
        // Extra Round が始まっていたら Undo しない（提案B）
        if (blockUndoIfLaterStarted(progress, 'thirdRound')) return;

        setIsBusy(true);
        setErrorMessage("");
        try {
            const res = await fetch('/api/thirdRound/undo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseName: quizCourse.name })
            });
            const data = await res.json();

            if (data.success && socket) {
                socket.emit('broadcast_scores', data.allPlayers);
                // 戻したのがコース終了だった可能性があるので、安全側に倒して解除する。
                // それ以外の操作を戻した場合でも、押し直せば同じ結果になる（終了処理は冪等）。
                changeState({ finishedOrder: null });
            } else {
                setErrorMessage(data.error || 'Undo に失敗しました');
            }
        } catch (error) {
            console.error('Undo failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    // 表示中のコースのスコアを初期状態に戻す（2026-10-11 ユーザー承認済み）。
    // 所属コース・抽選結果・タイマーはそのまま。そのコースの Undo 履歴は消える。
    const handleScoreReset = async () => {
        if (!quizCourse) return;
        if (!window.confirm(`${quizCourse.name} の結果をリセットしますか？（元に戻せません）${cascadeNotice(progress, 'extraRound', true)}`)) return;

        setIsBusy(true);
        setErrorMessage("");
        try {
            const res = await fetch('/api/thirdRound/resetScores', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseName: quizCourse.name })
            });
            const data = await res.json();

            if (data.success && socket) {
                // Extra Round 以降も DB で初期化済み。選手を配り、Extra Round 以降の進行状態も戻す
                broadcastAfterReset(socket, 'extraRound', data);
                // コース終了の確定も無効になるので解除する（Undo と同じ扱い）
                changeState({ finishedOrder: null });
            } else {
                setErrorMessage(data.error || '更新に失敗しました');
            }
        } catch (error) {
            console.error('Reset failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    // ---- ここから、表示に使う値を状態から導出する ----

    // 抽選済みのコースを実施順に並べる
    const drawnCourses = courses
        .filter(c => c.playOrder !== null)
        .sort((a, b) => (a.playOrder as number) - (b.playOrder as number));
    const remainingCourses = courses.filter(c => c.playOrder === null);
    const isAllDrawn = courses.length > 0 && remainingCourses.length === 0;

    // いま処理中のコース＝最後に抽選されたコース。
    // 順番に処理していくので、playOrder が最大のものが常に現在のコースになる。
    const currentCourse = drawnCourses.length > 0
        ? drawnCourses[drawnCourses.length - 1]
        : null;

    // クイズ実施フェーズで対象になっているコース（Main 側と同じ導出）
    const quizCourse = drawnCourses.find(c => c.playOrder === thirdRoundState.quizOrder);
    // 「次のコースへ」ボタンの表記。2026-10-11 のユーザー指示で「○コース目（コース名）」にした
    const nextOrder = thirdRoundState.quizOrder + 1;
    const nextCourseName = drawnCourses.find(c => c.playOrder === nextOrder)?.name;
    const nextCourseLabel = `${nextOrder}コース目${nextCourseName ? `（${nextCourseName}）` : ''}`;

    // 表示中のコースのタイマー。配信された状態から導出する。
    // キーが無いコースは「まだ一度も動かしていない」＝制限時間のまま。
    const remaining = timer.remainings[thirdRoundState.quizOrder] ?? COURSE_TIME_LIMIT_SECONDS;
    const isTimerRunning = timer.runningOrder === thirdRoundState.quizOrder;

    // そのコースに割り当て済みの選手。
    // 「確定済みかどうか」を状態として持たず、ここから判定する。
    const assignedToCurrent = currentCourse
        ? winners.filter(p => p.thirdRoundCourseName === currentCourse.name)
        : [];
    const isCurrentAssigned = assignedToCurrent.length >= 5;

    // 3rd Round の進行は「4コースすべての参加者を先に決めてから、各コースを実施する」
    // 流れ(ユーザー指示)。下の primaryLabel/primaryAction の導出で、全コース確定前は
    // クイズ実施フェーズへの1本道ボタンを出さないことでこれを強制する。
    // (手動操作パネルの直接切り替えはトラブル対応用の退避ハッチなので、あえて
    // ここでは縛らない。2nd Round の手動操作パネルと同じ考え方。)

    // まだどのコースにも割り当てられていない選手（エントリー対象）
    const unassignedWinners = winners.filter(p => !p.thirdRoundCourseName);

    // クイズ実施中のコースの出場者5名。
    // winners は優先順位（2R勝ち抜け順 → 1R順位）で並んでいるので、絞り込んでも順序は保たれる。
    // 「誰が出場するか」は Player.thirdRoundCourseName が持っているため、ここでは導出するだけ。
    const quizPlayers = quizCourse
        ? winners.filter(p => p.thirdRoundCourseName === quizCourse.name)
        : [];

    // コースごとの表示の出し分けは AdminQuizCard に移した(courseName を渡して
    // そちら側で判定する)ので、ここでは isUpDown 等の個別フラグは持たない。

    // 終了条件を満たしたか。データは変えず、提示するだけ（決定事項5）
    const finishState = getCourseFinishState(quizPlayers);

    // コース終了の操作。タイマーが0でも自動では発火させない（決定事項5）。
    // 最後に読まれていた問題の判定を入力できなくなるため。
    const handleFinishCourse = async () => {
        if (!window.confirm('コースを終了して順位を確定しますか？')) return;
        await handleScore(null, 'finish');
        // 「終了処理を走らせた」という事実はデータから復元できないので状態に残す
        changeState({ finishedOrder: thirdRoundState.quizOrder });
    };

    // プレーオフの対象者。コース終了処理で決着した人には順位が入っているので、
    // rank === 0 で残った選手がそのまま対象になる。リストは保存しない。
    const playoffPlayers = quizPlayers.filter(p => p.thirdRoundRank === 0);

    // サドンデスを始める。その時点の未決着者を参加者として記録し、Main・Admin はその選手だけ並べる（2026-10-29）
    const startPlayoff = () => changeState({ phase: 'playoff', playoffIds: playoffPlayers.map(p => p.id) });
    // サドンデスの画面に並べる選手（記録が無いとき＝サーバ再起動などは、従来どおりコースの5名全員）
    const playoffShownIds = thirdRoundState.playoffIds;
    const playoffShown = playoffShownIds && playoffShownIds.length > 0
        ? quizPlayers.filter(p => playoffShownIds.includes(p.id))
        : quizPlayers;
    const playoffSeats = 2 - finishState.winnersCount;

    // 終了処理を走らせたうえで、判定基準で決着しなかった選手が残っている状態。
    //
    // 「終了処理を走らせたか」を敗退者の有無で代用してはいけない。コース途中でも
    // 失格者は出るため、たとえば「失格2名・勝ち抜け0名・解答席3名」で成立してしまう。
    const needsPlayoff =
        thirdRoundState.finishedOrder === thirdRoundState.quizOrder
        && playoffPlayers.length > 0;

    const isClosed = thirdRoundState.step === 'closed';

    // ---- 操作 ----

    const handleDraw = async () => {
        setIsBusy(true);
        setErrorMessage("");
        try {
            const res = await fetch('/api/thirdRound/draw', { method: 'POST' });
            const data = await res.json();

            if (data.success && socket) {
                // 必要なデータだけを送る。レスポンス全体を送ると、そのイベントが
                // 何を運ぶのかが曖昧になり、受信側ごとに読む項目がずれる原因になる。
                socket.emit('broadcast_third_round_courses', data.courses);
                // 新しいコースのエントリータイムが始まるので、締切状態を解除する
                changeState({ step: 'entry' });
            } else {
                setErrorMessage(data.error || '更新に失敗しました');
            }
        } catch (error) {
            console.error('Draw failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    const handleReset = async () => {
        if (!window.confirm(`抽選をリセットしますか？（元に戻せません）\n全コースの出場者と 3rd Round の結果もリセットされ、コース選択から始め直します。${cascadeNotice(progress, 'extraRound', true)}`)) return;

        setIsBusy(true);
        setErrorMessage("");
        try {
            const res = await fetch('/api/thirdRound/draw', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                // 確認ダイアログでOKされたときだけ force を送る
                body: JSON.stringify({ force: true })
            });
            const data = await res.json();

            if (data.success && socket) {
                // 3rd Round 全体と Extra Round 以降を DB で初期化済み。
                // コース情報・選手情報を配り、3rd Round 以降の進行状態（コース選択・エントリー中・タイマー）も戻す
                broadcastAfterReset(socket, 'thirdRound', data);
            } else {
                setErrorMessage(data.error || 'リセットに失敗しました');
            }
        } catch (error) {
            console.error('Reset failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    const toggleRaised = (playerId: number) => {
        if (!isClosed) return;   // 締切前は操作させない
        setRaisedIds(prev =>
            prev.includes(playerId)
                ? prev.filter(id => id !== playerId)
                : [...prev, playerId]
        );
    };

    const handleAssign = async () => {
        if (!currentCourse) return;

        setIsBusy(true);
        setErrorMessage("");
        try {
            const res = await fetch('/api/thirdRound/assignCourse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseName: currentCourse.name, raisedIds })
            });
            const data = await res.json();

            if (data.success && socket) {
                // 掲げた／強制出場の内訳は自分の画面でしか使わないので、ここで持つ
                setLastAssigned(data.assigned);
                // 選手データは Socket 経由で全画面に配る（Main の強調表示に必要）
                socket.emit('broadcast_scores', data.allPlayers);
            } else {
                setErrorMessage(data.error || '更新に失敗しました');
            }
        } catch (error) {
            console.error('Assign failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    const handleUnassign = async () => {
        if (!currentCourse) return;
        if (!window.confirm(`${currentCourse.name} の出場者確定を取り消しますか？\nこのコースの結果もリセットされます。${cascadeNotice(progress, 'extraRound', true)}`)) return;

        setIsBusy(true);
        setErrorMessage("");
        try {
            const res = await fetch('/api/thirdRound/assignCourse', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseName: currentCourse.name, force: true })
            });
            const data = await res.json();

            if (data.success && socket) {
                setLastAssigned([]);
                setRaisedIds([]);
                // そのコースの結果と Extra Round 以降も DB で初期化済み
                broadcastAfterReset(socket, 'extraRound', data);
                // 締切前に戻して、エントリーからやり直せるようにする
                changeState({ step: 'entry' });
            } else {
                setErrorMessage(data.error || '更新に失敗しました');
            }
        } catch (error) {
            console.error('Unassign failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    // ==================== 進行の「次の一手」を導出する ====================
    // ユーザー指示:「4コースすべての参加者を決定してから、各コースを実施する」という
    // 1本道で進める(2nd Round の Admin と同じ導線パターン)。ここではあくまで表示用の
    // ラベルとボタンの出し分けを決めているだけで、呼び出す先はすべて既存のハンドラの
    // ままであり、新しいデータ操作は増やしていない。
    let statusLabel: string;
    let primaryLabel: string;
    let primaryAction: (() => void) | null = null;

    if (thirdRoundState.phase === 'courseSelect') {
        statusLabel = `3RD ROUND · コース選択 · ${drawnCourses.length} / 4`;
        if (!currentCourse) {
            primaryLabel = `${drawnCourses.length + 1}番目のコースを抽選 ▶`;
            primaryAction = handleDraw;
        } else if (!isCurrentAssigned) {
            if (!isClosed) {
                primaryLabel = 'エントリー締切 ▶';
                primaryAction = () => changeState({ step: 'closed' });
            } else {
                primaryLabel = `出場者を確定（挙手 ${raisedIds.length}名＋強制 ${Math.max(0, 5 - raisedIds.length)}名） ▶`;
                primaryAction = handleAssign;
            }
        } else if (!isAllDrawn) {
            primaryLabel = `${drawnCourses.length + 1}番目のコースを抽選 ▶`;
            primaryAction = handleDraw;
        } else {
            // 2026-10-11 のユーザー指示で、2コース目以降と同じ「○コース目（コース名）へ ▶」にした
            const firstCourseName = drawnCourses.find(c => c.playOrder === 1)?.name;
            primaryLabel = `1コース目${firstCourseName ? `（${firstCourseName}）` : ''}へ ▶`;
            primaryAction = () => changeState({ phase: 'quiz', quizOrder: 1 });
        }
    } else if (thirdRoundState.phase === 'quiz') {
        statusLabel = `3RD ROUND · ${thirdRoundState.quizOrder}コース目${quizCourse ? ` · ${quizCourse.name}` : ''}`;
        if (needsPlayoff) {
            primaryLabel = `サドンデスへ（${playoffPlayers.length}名同点） ▶`;
            primaryAction = startPlayoff;
        } else if (finishState.finished) {
            if (thirdRoundState.quizOrder < 4) {
                primaryLabel = `${nextCourseLabel}へ ▶`;
                primaryAction = () => changeState({ phase: 'quiz', quizOrder: thirdRoundState.quizOrder + 1 });
            } else {
                // 4コース目まで終わった。8名の勝ち抜けが決まっていれば「Extra Round へ ▶」（提案A）
                ({ label: primaryLabel, action: primaryAction } = nextRoundPrimary(socket, progress, 'thirdRound'));
            }
        } else if (quizPlayers.length > 0 && finishState.activeCount > 0 && remaining === 0) {
            primaryLabel = 'コース終了 ▶';
            primaryAction = handleFinishCourse;
        } else {
            primaryLabel = '進行中...';
        }
    } else {
        statusLabel = `3RD ROUND · サドンデス${quizCourse ? `（${quizCourse.name}）` : ''}`;
        if (playoffPlayers.length === 0) {
            if (thirdRoundState.quizOrder < 4) {
                primaryLabel = `${nextCourseLabel}へ ▶`;
                primaryAction = () => changeState({ phase: 'quiz', quizOrder: thirdRoundState.quizOrder + 1 });
            } else {
                ({ label: primaryLabel, action: primaryAction } = nextRoundPrimary(socket, progress, 'thirdRound'));
            }
        } else {
            primaryLabel = 'サドンデス中...';
        }
    }

    const primaryButtonStyle: CSSProperties = primaryAction
        ? {
            padding: '18px 40px', background: 'rgba(51,198,255,.14)', border: '2px solid #33C6FF',
            clipPath: 'polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px)',
            boxShadow: '0 0 22px rgba(51,198,255,.35)', cursor: 'pointer',
            fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 20, letterSpacing: 2, color: '#DFF7FF',
        }
        : {
            padding: '18px 40px', background: 'rgba(255,255,255,.04)', border: '2px solid #3A4B63',
            clipPath: 'polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px)',
            fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 18, letterSpacing: 1,
            color: primaryLabel === '3rd Round 終了' ? '#FFE28A' : '#5C7EA6',
            cursor: 'default',
        };

    return (
        <div className="flex flex-col gap-4 bg-white dark:bg-zinc-800 p-6 rounded-xl shadow-md w-full max-w-[1900px]">
            <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 border-b pb-4 border-zinc-200 dark:border-zinc-700">
                3rd Round 管理画面
            </h2>

            {errorMessage && (
                <div className="px-4 py-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300 text-sm font-bold">
                    {errorMessage}
                </div>
            )}

            {/* 進行フロー: ユーザー指示により「4コースすべての参加者を決めてから、各コースを
                実施する」という1本道で進む。2nd Round の Admin と同じく、いま押すべき操作を
                1つだけ大きく出す。裏側で呼ぶのは既存のハンドラ(handleDraw/handleAssign/...)
                そのままなので、データ操作としての承認は不要(UI配線の変更のみ)。 */}
            <div className="flex flex-col items-center gap-3 bg-black py-5 rounded-none">
                <div className="text-xs tracking-[0.3em] text-[#5C7EA6] font-mono">
                    {statusLabel}
                </div>
                <button onClick={() => primaryAction?.()} disabled={!primaryAction || isBusy} style={primaryButtonStyle}>
                    {primaryLabel}
                </button>
            </div>

            {/* 手動操作: 通常運用では触らない退避ハッチ。フェーズ/コースの直接切り替え、
                抽選リセット・確定取り消し、タイマー操作・Undoをここにまとめる。
                見た目は AdminSecondRound.tsx / Cowork Design(AdminManual.dc.html)と揃えている。 */}
            <details className="group">
                <summary
                    className="flex cursor-pointer select-none items-center gap-[10px] bg-black px-5 py-4 [&::-webkit-details-marker]:hidden"
                    style={{ listStyle: 'none' }}
                >
                    <span
                        className="inline-block transition-transform duration-150 group-open:rotate-90"
                        style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 15, letterSpacing: 2, color: '#7FA8D9' }}
                    >
                        ▸
                    </span>
                    <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 15, letterSpacing: 3, color: '#7FA8D9' }}>
                        手動操作
                    </span>
                </summary>
                <div className="flex flex-col gap-[22px] bg-black px-5 pb-6 pt-4">
                    <div style={{ height: 1, background: 'rgba(79,216,255,.22)', flexShrink: 0 }} />

                    <div className="flex flex-wrap gap-[18px]">
                        <div style={manualPanelStyle(true, 1.6)}>
                            <div style={MANUAL_LABEL_STYLE}>フェーズ・コース</div>
                            <div className="flex flex-wrap gap-[10px]">
                                <button onClick={() => changeState({ phase: 'courseSelect' })} style={manualBtnStyle(thirdRoundState.phase === 'courseSelect')}>
                                    <span style={manualBtnTextStyle(thirdRoundState.phase === 'courseSelect')}>コース選択</span>
                                </button>
                                {[1, 2, 3, 4].map((order) => (
                                    <button key={order} onClick={() => changeState({ phase: 'quiz', quizOrder: order })} style={manualBtnStyle(thirdRoundState.phase === 'quiz' && thirdRoundState.quizOrder === order)}>
                                        <span style={manualBtnTextStyle(thirdRoundState.phase === 'quiz' && thirdRoundState.quizOrder === order)}>{drawnCourses.find(c => c.playOrder === order)?.name ?? `${order}コース目`}</span>
                                    </button>
                                ))}
                                <button onClick={startPlayoff} style={manualBtnStyle(thirdRoundState.phase === 'playoff')}>
                                    <span style={manualBtnTextStyle(thirdRoundState.phase === 'playoff')}>サドンデス</span>
                                </button>
                            </div>
                        </div>

                        <div style={manualPanelStyle(thirdRoundState.phase === 'courseSelect', 1)}>
                            <div style={MANUAL_LABEL_STYLE}>抽選・出場者</div>
                            <div className="flex flex-wrap gap-[10px]">
                                <button onClick={handleReset} disabled={isBusy || drawnCourses.length === 0} style={dangerBtnStyle()}>
                                    <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 14, letterSpacing: 1, color: '#FFE3E8' }}>抽選をリセット</span>
                                </button>
                                <button onClick={handleUnassign} disabled={isBusy || !currentCourse || !isCurrentAssigned} style={neutralBtnStyle()}>
                                    <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 14, letterSpacing: 1, color: '#9FB4D6' }}>確定を取り消す</span>
                                </button>
                            </div>
                        </div>

                        <div style={manualPanelStyle(thirdRoundState.phase === 'quiz' || thirdRoundState.phase === 'playoff', 1.4)}>
                            <div style={MANUAL_LABEL_STYLE}>タイマー・データ操作</div>
                            <div className="flex flex-wrap items-center gap-[10px]">
                                <button onClick={handleTimerReset} style={neutralBtnStyle()}>
                                    <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 14, letterSpacing: 1, color: '#9FB4D6' }}>RESET（15:00）</span>
                                </button>
                                {!isEditingTimer ? (
                                    <button onClick={handleTimerEditStart} style={neutralBtnStyle()}>
                                        <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 14, letterSpacing: 1, color: '#9FB4D6' }}>EDIT</span>
                                    </button>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number" min={0} max={15} value={editMinutes}
                                            onChange={e => setEditMinutes(Math.max(0, Number(e.target.value) || 0))}
                                            className="w-16 px-2 py-1.5 bg-zinc-900 border border-zinc-600 text-white text-right font-mono"
                                        />
                                        <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 12, color: '#9FB4D6' }}>分</span>
                                        <input
                                            type="number" min={0} max={59} value={editSeconds}
                                            onChange={e => setEditSeconds(Math.max(0, Number(e.target.value) || 0))}
                                            className="w-16 px-2 py-1.5 bg-zinc-900 border border-zinc-600 text-white text-right font-mono"
                                        />
                                        <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 12, color: '#9FB4D6' }}>秒</span>
                                        <button onClick={handleTimerEditSave} style={manualBtnStyle(true)}>
                                            <span style={manualBtnTextStyle(true)}>SAVE</span>
                                        </button>
                                        <button onClick={() => setIsEditingTimer(false)} style={manualBtnStyle(false)}>
                                            <span style={manualBtnTextStyle(false)}>CANCEL</span>
                                        </button>
                                    </div>
                                )}
                                <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(79,216,255,.18)', margin: '0 4px' }} />
                                <button onClick={handleScoreReset} disabled={isBusy || !quizCourse} style={dangerBtnStyle()}>
                                    <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 14, letterSpacing: 1, color: '#FFE3E8' }}>リセット（{quizCourse ? quizCourse.name : 'コース未選択'}）</span>
                                </button>
                                <button onClick={handleScoreUndo} disabled={isBusy || !quizCourse} style={dangerBtnStyle()}>
                                    <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 14, letterSpacing: 1, color: '#FFE3E8' }}>Undo</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-[10px]">
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FF3B5C', boxShadow: '0 0 8px rgba(255,59,92,.7)' }} />
                        <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, fontSize: 13, letterSpacing: 1, color: '#5C7EA6' }}>
                            通常は閉じたまま。進行は上のボタンで完結します
                        </span>
                    </div>
                </div>
            </details>

            <hr className="border-zinc-200 dark:border-zinc-700" />

            {/* ===== コース選択フェーズ ===== */}
            {thirdRoundState.phase === 'courseSelect' && (
                <div className="flex flex-col gap-5 bg-black p-[2vw]" style={{ border: '1px solid rgba(79,216,255,.22)' }}>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                        <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: 20, color: '#F3FAFF' }}>
                            コース抽選・エントリー
                        </span>
                        <span className="font-mono text-xs" style={{ color: '#5C7EA6' }}>
                            実施順: {[1, 2, 3, 4].map(o => drawnCourses.find(c => c.playOrder === o)?.name ?? '？').join(' → ')}
                        </span>
                    </div>

                    <div className="flex gap-[14px] flex-wrap">
                        <div style={STAT_CARD_STYLE}>
                            <div style={STAT_LABEL_STYLE}>抽選済み</div>
                            <div style={{ marginTop: 4, fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 24, color: '#F3FAFF' }}>
                                {drawnCourses.length} <span style={{ fontSize: 14, color: '#5C7EA6' }}>/ 4</span>
                            </div>
                        </div>
                        <div style={STAT_CARD_STYLE}>
                            <div style={STAT_LABEL_STYLE}>抽選したコース</div>
                            <div style={{ marginTop: 4, fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: 20, color: '#4FD8FF' }}>
                                {currentCourse ? currentCourse.name : '-'}
                            </div>
                        </div>
                        <div style={STAT_CARD_STYLE}>
                            <div style={STAT_LABEL_STYLE}>挙手</div>
                            <div style={{ marginTop: 4, fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 24, color: '#EAF6FF' }}>
                                {isClosed ? raisedIds.length : '-'} <span style={{ fontSize: 13, color: '#5C7EA6' }}>名 / 未割当 {unassignedWinners.length}名</span>
                            </div>
                        </div>
                    </div>

                    {errorMessage === '' ? null : null /* エラーは上部の共通バナーで表示済み */}

                    {/* 確定済みの出場者(掲げた／強制出場の内訳) */}
                    {currentCourse && isCurrentAssigned && (
                        <div className="flex flex-col gap-[8px]">
                            <div style={MANUAL_LABEL_STYLE}>{currentCourse.playOrder}番目 {currentCourse.name} の出場者</div>
                            <div className="grid grid-cols-5 gap-[8px]">
                                {assignedToCurrent.map((p) => {
                                    const detail = lastAssigned.find(a => a.id === p.id);
                                    const forced = detail?.forced;
                                    return (
                                        <div key={p.id} style={{
                                            boxSizing: 'border-box', padding: '10px 12px',
                                            background: forced ? 'rgba(255,201,60,.08)' : 'rgba(53,255,160,.08)',
                                            border: `1px solid ${forced ? 'rgba(255,201,60,.35)' : 'rgba(53,255,160,.3)'}`,
                                        }}>
                                            <div style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 800, fontSize: 14, color: '#F3FAFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {p.name}
                                            </div>
                                            <div style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 10, color: '#5C7EA6', marginTop: 2 }}>
                                                2R{p.secondRoundRank}位 / 1R{p.paperRank}位
                                            </div>
                                            {detail && (
                                                <div style={{ marginTop: 4, fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 10, color: forced ? '#FFC93C' : '#35FFA0' }}>
                                                    {forced ? '強制' : '挙手'}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            {lastAssigned.length === 0 && (
                                <p style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: 11, color: '#5C7EA6' }}>
                                    ※ 挙手／強制の内訳は確定直後のみ表示（リロードで消えます）
                                </p>
                            )}
                        </div>
                    )}

                    {/* 実施順(4枠)の一覧 */}
                    <div className="grid grid-cols-4 gap-[10px]">
                        {[1, 2, 3, 4].map((order) => {
                            const course = drawnCourses.find(c => c.playOrder === order);
                            const isCurrent = currentCourse?.playOrder === order;
                            return (
                                <div key={order} style={{
                                    boxSizing: 'border-box', padding: '10px 12px',
                                    background: isCurrent ? 'rgba(51,198,255,.10)' : 'rgba(255,255,255,.02)',
                                    border: `1px solid ${isCurrent ? '#33C6FF' : 'rgba(79,216,255,.14)'}`,
                                    display: 'flex', flexDirection: 'column', gap: 4,
                                }}>
                                    <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 10, letterSpacing: 2, color: '#5C7EA6' }}>{order}番目</span>
                                    <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 800, fontSize: 15, color: course ? (isCurrent ? '#DFF7FF' : '#E9F3FF') : '#3A4B63' }}>
                                        {course ? course.name : '？'}
                                    </span>
                                </div>
                            );
                        })}
                    </div>

                    {/* エントリー確認リスト(締切後に操作可) */}
                    {currentCourse && !isCurrentAssigned && (
                        <div className="flex flex-col gap-2" style={{ background: 'rgba(8,15,28,.65)', border: '1px solid rgba(79,216,255,.18)', boxSizing: 'border-box', padding: '14px 16px' }}>
                            <div className="flex items-center justify-between">
                                <span style={MANUAL_LABEL_STYLE}>エントリー（優先順位順・締切後に操作可）</span>
                                <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 11, color: isClosed ? '#4FD8FF' : '#FFC93C' }}>
                                    {isClosed ? 'エントリー締切済み' : 'エントリータイム中'}
                                </span>
                            </div>
                            <div className="flex flex-col gap-1" style={{ maxHeight: 420, overflowY: 'auto', opacity: isClosed ? 1 : 0.4, pointerEvents: isClosed ? 'auto' : 'none' }}>
                                {unassignedWinners.map((p, index) => {
                                    const checked = raisedIds.includes(p.id);
                                    return (
                                        <div
                                            key={p.id}
                                            onClick={() => toggleRaised(p.id)}
                                            className="flex items-center gap-3 cursor-pointer"
                                            style={{ padding: '8px 10px', background: checked ? 'rgba(51,198,255,.07)' : 'transparent', border: `1px solid ${checked ? 'rgba(51,198,255,.2)' : 'rgba(255,255,255,.06)'}` }}
                                        >
                                            <span style={{ width: 16, height: 16, flexShrink: 0, border: `1.5px solid ${checked ? '#33C6FF' : '#3A4B63'}`, background: checked ? '#33C6FF' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#04121F' }}>
                                                {checked ? '✓' : ''}
                                            </span>
                                            <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 12, color: '#5C7EA6', width: 30, flexShrink: 0 }}>
                                                #{index + 1}
                                            </span>
                                            {/* 1st Round の順位（Extra Round の進出者選択と同じ形式。2026-10-11 ユーザー指示） */}
                                            <span style={{ width: 56, flexShrink: 0, fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 13, color: tierOf(p.paperRank, ACCENT).color }}>
                                                {toOrdinal(p.paperRank)}
                                            </span>
                                            <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 800, fontSize: 15, color: '#F3FAFF', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {p.name}
                                            </span>
                                            <span style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: 12, color: '#7FA8D9', flexShrink: 0 }}>
                                                2R {p.secondRoundRank}位 / 1R {p.paperRank}位
                                            </span>
                                            <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 11, padding: '3px 10px', flexShrink: 0, background: checked ? 'rgba(51,198,255,.18)' : 'rgba(255,255,255,.05)', color: checked ? '#DFF7FF' : '#5C7EA6' }}>
                                                {checked ? '挙手' : '未挙手'}
                                            </span>
                                        </div>
                                    );
                                })}
                                {unassignedWinners.length === 0 && (
                                    <div className="py-6 text-center" style={{ color: '#5C7EA6', fontFamily: 'Rajdhani, sans-serif' }}>
                                        未割当の選手がいません
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {!currentCourse && (
                        <div className="py-10 text-center" style={{ color: '#5C7EA6', fontFamily: 'Rajdhani, sans-serif', border: '1px dashed rgba(79,216,255,.18)' }}>
                            上のボタンで抽選してください
                        </div>
                    )}
                </div>
            )}

            {/* ===== クイズ実施フェーズ ===== */}
            {thirdRoundState.phase === 'quiz' && (
                <div className="flex flex-col gap-5 bg-black p-[2vw]" style={{ border: '1px solid rgba(79,216,255,.22)' }}>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                        <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: 20, color: '#F3FAFF' }}>
                            {thirdRoundState.quizOrder}コース目{quizCourse && ` · ${quizCourse.name}`}
                        </span>
                        <span className="font-mono text-xs" style={{ color: '#5C7EA6' }}>
                            勝ち抜け {finishState.winnersCount} / 敗退 {finishState.eliminatedCount} / 解答席 {finishState.activeCount}
                        </span>
                    </div>

                    <div className="flex gap-[18px] flex-wrap">
                        <div style={QUIZ_STAT_CARD_STYLE}>
                            <div style={QUIZ_STAT_LABEL_STYLE}>残り勝抜枠</div>
                            <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 30, color: '#FFC93C', marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 10 }}>
                                <span style={{ color: '#4FD8FF' }}>{finishState.activeCount}</span>
                                <span style={{ fontSize: 18, color: '#5C7EA6' }}>→</span>
                                <span>{Math.max(0, WINNERS_PER_COURSE - finishState.winnersCount)}</span>
                            </div>
                        </div>
                        <div style={QUIZ_STAT_CARD_STYLE}>
                            <div style={QUIZ_STAT_LABEL_STYLE}>残り時間</div>
                            <TimerDisplay
                                remaining={remaining}
                                isRunning={isTimerRunning}
                                onStart={() => changeTimer('start')}
                                onStop={() => changeTimer('stop')}
                            />
                        </div>
                    </div>

                    {finishState.finished && (
                        <div style={{ padding: '14px 18px', border: '1.5px solid #FFC93C', background: 'rgba(255,201,60,.08)' }}>
                            <p style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 800, color: '#FFC93C', margin: 0 }}>
                                終了条件成立
                                {finishState.reason === 'allWinnersDecided'
                                    ? `：${finishState.winnersCount}名が勝ち抜け`
                                    : `：${finishState.eliminatedCount}名が失格（残り${finishState.activeCount}名＝残り枠）`}
                            </p>
                        </div>
                    )}

                    {needsPlayoff && (
                        <div style={{ padding: '14px 18px', border: '1.5px solid #B98BFF', background: 'rgba(185,139,255,.08)' }}>
                            <p style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 800, color: '#D9BBFF', margin: 0 }}>
                                同点のためサドンデス（{playoffPlayers.length}名・残り{playoffSeats}枠）
                            </p>
                        </div>
                    )}

                    <div className="flex flex-col gap-[10px]" style={{ background: 'rgba(8,15,28,.65)', border: '1px solid rgba(79,216,255,.18)', boxSizing: 'border-box', padding: 16 }}>
                        <div className="flex gap-[10px]">
                            {quizCourse && quizPlayers.map((p) => (
                                <AdminQuizCard
                                    key={p.id}
                                    player={p}
                                    courseName={quizCourse.name as ThirdRoundCourseName}
                                    onScore={(id, action) => handleScore(id, action)}
                                    busy={isBusy}
                                />
                            ))}
                            {quizPlayers.length === 0 && (
                                <div className="w-full py-10 text-center" style={{ color: '#5C7EA6' }}>
                                    出場者が未確定です
                                </div>
                            )}
                        </div>

                        {/* スルーを API に記録するのは Freeze 10 だけ（決定事項2。休み中の選手の残り問数を減らす契機）。
                            2026-10-11 のユーザー指示で、左右の端を選手枠の列（カード幅の上限
                            ADMIN_QUIZ_CARD_MAX_WIDTH × 人数＋間隔）とそろえている。 */}
                        {/* 2026-10-22: 問題表示のため、スルーは全コースで出す。Freeze 10 では従来どおり API に記録し
                            （休み中の選手の残り問数を減らす）、他の3コースはスコアを変えずに問題だけ進める */}
                        {quizPlayers.length > 0 && (
                            <button
                                onClick={() => { if (quizCourse?.name === THIRD_ROUND_COURSES.FREEZE) void handleScore(null, 'through'); else finishQuestion(); }}
                                disabled={isBusy}
                                style={{
                                    width: `min(100%, ${quizPlayers.length * ADMIN_QUIZ_CARD_MAX_WIDTH + (quizPlayers.length - 1) * 10}px)`,
                                    boxSizing: 'border-box', padding: '12px 0', background: 'rgba(127,216,255,.10)', border: '1.5px solid #7FE8FF',
                                    clipPath: 'polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)', cursor: 'pointer',
                                }}
                            >
                                <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 16, letterSpacing: 1, color: '#DFF7FF' }}>スルー</span>
                            </button>
                        )}
                        <AdminQuestionPanel socket={socket} round="thirdRound" state={questionState} />
                    </div>
                </div>
            )}

            {/* ===== プレーオフ ===== */}
            {thirdRoundState.phase === 'playoff' && (
                <div className="flex flex-col gap-5 bg-black p-[2vw]" style={{ border: '1px solid rgba(79,216,255,.22)' }}>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                        <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: 20, color: '#F3FAFF' }}>
                            サドンデス{quizCourse && `（${quizCourse.name}）`}
                        </span>
                        <span className="font-mono text-xs" style={{ color: '#B98BFF' }}>
                            残り {playoffSeats} 枠
                        </span>
                    </div>

                    <div className="flex gap-[10px]" style={{ background: 'rgba(8,15,28,.65)', border: '1px solid rgba(79,216,255,.18)', boxSizing: 'border-box', padding: 16 }}>
                        {playoffShown.map((p) => {
                            const isWinner = p.thirdRoundRank > 0;
                            const isUndecided = p.thirdRoundRank === 0;
                            return (
                                <div key={p.id} style={{
                                    flex: '1 1 0', minWidth: 0, maxWidth: 220, boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
                                    alignItems: 'center', background: 'rgba(12,22,40,.75)', border: '1px solid rgba(185,139,255,.3)',
                                    padding: '14px 8px 16px', gap: 12,
                                }}>
                                    <div style={{
                                        writingMode: 'vertical-rl', textOrientation: 'mixed', fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700,
                                        fontSize: 20, letterSpacing: 4, color: '#E9F3FF', minHeight: 110, display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
                                    }}>
                                        {p.name}
                                    </div>
                                    {isUndecided ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', marginTop: 'auto' }}>
                                            <button onClick={() => handlePlayoffScore(p.id, 'correct')} disabled={isBusy} style={opBtnStyle('correct', true)}>
                                                <span style={opBtnTextStyle('correct')}>正解</span>
                                            </button>
                                            <button onClick={() => handlePlayoffScore(p.id, 'wrong')} disabled={isBusy} style={opBtnStyle('wrong', true)}>
                                                <span style={opBtnTextStyle('wrong')}>誤答</span>
                                            </button>
                                        </div>
                                    ) : (
                                        <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 16, color: isWinner ? '#FFC93C' : '#8A93A3', marginTop: 'auto' }}>
                                            {isWinner ? toOrdinal(p.thirdRoundRank) : 'LOST'}
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                        {playoffShown.length === 0 && (
                            <div className="w-full py-10 text-center" style={{ color: '#5C7EA6' }}>
                                サドンデスの対象者がいません
                            </div>
                        )}
                    </div>
                    <AdminQuestionPanel socket={socket} round="thirdRound" state={questionState} />
                </div>
            )}
        </div>
    );
}
