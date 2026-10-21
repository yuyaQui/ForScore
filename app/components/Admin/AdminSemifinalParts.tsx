import type { CSSProperties } from "react";
import type { Player } from "@/lib/types";
import type { PoolQuestion } from "@/lib/questionPool";
import type { SemifinalPlayoff, PlayoffProgress } from "@/lib/semifinalPlayoff";
import { formatTime } from "@/lib/formatTime";
import { ACCENT, tierOf } from "@/lib/cyberpunkCard";
import { toOrdinal } from "@/lib/ordinal";
import { SET_TIME_LIMIT_SECONDS } from "@/lib/semifinal";
import {
    MANUAL_LABEL_STYLE, STAT_CARD_STYLE, STAT_LABEL_STYLE,
    neutralBtnStyle, NEUTRAL_BTN_TEXT, opBtnStyle, opBtnTextStyle,
} from "./adminCyberStyles";

// 準決勝 Admin の部品。見た目は 3rd Round / Extra Round の Admin と同じ定数・形を使う。

const JP = '"Noto Sans JP",sans-serif';
const ORB = 'Orbitron, sans-serif';
const GOLD = '#FFC93C';
const RED = '#FF3B5C';

// ---------------------------------------------------------------------------
// タイマー（3rd Round Admin の TimerDisplay と同じ形。残り1分で警告色）
// ---------------------------------------------------------------------------

function timerBtnStyle(kind: 'start' | 'stop', enabled: boolean): CSSProperties {
    return {
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '7px 0',
        clipPath: 'polygon(4px 0,100% 0,100% calc(100% - 4px),calc(100% - 4px) 100%,0 100%,0 4px)',
        background: kind === 'start' ? 'rgba(51,198,255,.12)' : 'rgba(255,59,92,.10)',
        border: `1.5px solid ${kind === 'start' ? '#33C6FF' : RED}`,
        opacity: enabled ? 1 : 0.35, cursor: enabled ? 'pointer' : 'default',
    };
}

export function SemifinalTimerCard({ remaining, isRunning, onStart, onStop }: {
    remaining: number; isRunning: boolean; onStart: () => void; onStop: () => void;
}) {
    const R = 19;
    const C = 2 * Math.PI * R;
    const filled = Math.max(0, Math.min(1, remaining / SET_TIME_LIMIT_SECONDS)) * C;
    const urgent = remaining <= 60;
    const ringColor = urgent ? RED : '#4FD8FF';
    const glow = urgent ? 'rgba(255,59,92,.65)' : 'rgba(79,216,255,.55)';
    const canStart = !isRunning && remaining > 0;

    return (
        <div style={STAT_CARD_STYLE}>
            <div style={STAT_LABEL_STYLE}>残り時間</div>
            <div className={urgent ? 'animate-pulse' : ''} style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 14 }}>
                <svg width={46} height={46} viewBox="0 0 46 46" style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
                    <circle cx={23} cy={23} r={R} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth={5} />
                    <circle
                        cx={23} cy={23} r={R} fill="none" stroke={ringColor} strokeWidth={5} strokeLinecap="round"
                        strokeDasharray={`${filled.toFixed(1)} ${(C - filled).toFixed(1)}`}
                        style={{ filter: `drop-shadow(0 0 4px ${glow})` }}
                    />
                </svg>
                <span style={{ fontFamily: ORB, fontWeight: 800, fontSize: 28, letterSpacing: 1, color: '#FFFFFF', fontVariantNumeric: 'tabular-nums', textShadow: `0 0 10px ${glow}` }}>
                    {formatTime(remaining)}
                </span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={onStart} disabled={!canStart} style={timerBtnStyle('start', canStart)}>
                    <span style={{ fontFamily: ORB, fontWeight: 800, fontSize: 12, color: '#DFF7FF' }}>START</span>
                </button>
                <button onClick={onStop} disabled={!isRunning} style={timerBtnStyle('stop', isRunning)}>
                    <span style={{ fontFamily: ORB, fontWeight: 800, fontSize: 12, color: '#FFE3E8' }}>STOP</span>
                </button>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// 選手一覧（席順）。Admin は常にポイントが見える
// ---------------------------------------------------------------------------

export function SemifinalStandings({ entrants }: { entrants: Player[] }) {
    return (
        <div className="grid gap-[8px]" style={{ gridTemplateColumns: `repeat(${Math.max(1, entrants.length)}, minmax(0, 1fr))` }}>
            {entrants.map(p => {
                const won = p.semifinalRank > 0;
                const lost = p.semifinalRank === -1;
                const color = lost ? '#4A5568' : won ? GOLD : '#4FD8FF';
                return (
                    <div key={p.id} style={{
                        boxSizing: 'border-box', padding: '10px 8px', minWidth: 0, textAlign: 'center',
                        background: 'rgba(12,22,40,.75)', borderTop: `3px solid ${color}`, opacity: lost ? 0.55 : 1,
                    }}>
                        <div style={{ fontFamily: ORB, fontWeight: 800, fontSize: 12, color: tierOf(p.paperRank, ACCENT).color }}>{toOrdinal(p.paperRank)}</div>
                        <div style={{ fontFamily: JP, fontWeight: 800, fontSize: 14, color: '#F3FAFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                        <div style={{ fontFamily: ORB, fontWeight: 800, fontSize: 24, color: '#EAF6FF', marginTop: 4 }}>{p.semifinalPoint}</div>
                        <div style={{ fontFamily: ORB, fontWeight: 800, fontSize: 12, letterSpacing: 1, color, minHeight: 16 }}>
                            {won ? 'WIN' : lost ? 'LOST' : ''}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ---------------------------------------------------------------------------
// 振り返り範囲（通し番号）
// ---------------------------------------------------------------------------

const NUM_INPUT_CLASS = "w-24 px-2 py-1.5 bg-zinc-900 border border-zinc-600 text-white text-right font-mono";

/** 振り返る問題の通し番号の入力。タイムアップ後に本文へ大きく出す（2026-10-17 の流れ） */
export function ReviewRangeForm({ from, to, onFrom, onTo }: {
    from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void;
}) {
    return (
        <div style={{ ...STAT_CARD_STYLE, flex: 1.4, border: `1px solid ${GOLD}`, boxShadow: `0 0 14px ${GOLD}33` }}>
            <div style={{ ...STAT_LABEL_STYLE, color: GOLD }}>TIME UP — 振り返る問題の通し番号を入力</div>
            <div className="flex items-center gap-2" style={{ marginTop: 10 }}>
                <input type="text" inputMode="numeric" value={from} onChange={e => onFrom(e.target.value)} className={NUM_INPUT_CLASS} aria-label="開始の通し番号" />
                <span style={{ fontFamily: JP, color: '#9FB4D6' }}>〜</span>
                <input type="text" inputMode="numeric" value={to} onChange={e => onTo(e.target.value)} className={NUM_INPUT_CLASS} aria-label="終了の通し番号" />
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// 振り返り中の問題（Main に出している3問。別解・正誤判定基準は Admin だけ）
// ---------------------------------------------------------------------------

export function ReviewPreview({ questions, page, pageCount }: { questions: PoolQuestion[]; page: number; pageCount: number }) {
    return (
        <div className="flex flex-col gap-[8px]">
            <div style={MANUAL_LABEL_STYLE}>Main 表示中（{page + 1} / {pageCount}）</div>
            {questions.map(q => (
                <div key={q.serial} style={{ padding: '10px 14px', background: 'rgba(12,22,40,.75)', border: '1px solid rgba(79,216,255,.18)' }}>
                    <div className="flex items-baseline gap-3">
                        <span style={{ fontFamily: ORB, fontWeight: 800, fontSize: 13, color: '#5C7EA6', flexShrink: 0 }}>No.{q.serial}</span>
                        <span style={{ fontFamily: JP, fontWeight: 700, fontSize: 15, color: '#F3FAFF' }}>{q.text}</span>
                    </div>
                    <div className="flex items-baseline gap-3" style={{ marginTop: 4 }}>
                        <span style={{ fontFamily: JP, fontWeight: 900, fontSize: 16, color: GOLD }}>{q.answer}</span>
                        {q.altAnswer && <span style={{ fontFamily: JP, fontSize: 13, color: '#9FB4D6' }}>{q.altAnswer}</span>}
                    </div>
                </div>
            ))}
        </div>
    );
}

// ---------------------------------------------------------------------------
// セットの得点入力
// ---------------------------------------------------------------------------

/** 「5」「-3」「＋２」「−1」などを整数にする。整数でなければ null */
export function parsePointInput(raw: string): number | null {
    const half = raw.trim()
        .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
        .replace(/[−－ー]/g, '-')
        .replace(/[＋]/g, '+');
    return /^[+-]?\d{1,3}$/.test(half) ? parseInt(half, 10) : null;
}

/** 全員の入力が整数になっているか（「得点を確定 ▶」を押せるか） */
export function allPointsValid(players: Player[], values: Record<number, string>): boolean {
    return players.length > 0 && players.every(p => parsePointInput(values[p.id] ?? '') !== null);
}

/** 得点集計の入力欄。確定は上の1本道ボタン（「得点を確定 ▶」）で行う（2026-10-17） */
export function PointsForm({ players, values, onChange, entered, busy }: {
    players: Player[]; values: Record<number, string>; onChange: (id: number, v: string) => void;
    entered: boolean; busy: boolean;
}) {
    return (
        <div className="flex flex-col gap-[10px]">
            <div style={MANUAL_LABEL_STYLE}>このセットの得点{entered ? '（確定済み・入れ直すときは手動操作の「得点を入力し直す」）' : '（入力したら上の「得点を確定」）'}</div>
            <div className="grid gap-[8px]" style={{ gridTemplateColumns: `repeat(${Math.max(1, players.length)}, minmax(0, 1fr))` }}>
                {players.map(p => {
                    const raw = values[p.id] ?? '';
                    const invalid = raw.trim() !== '' && parsePointInput(raw) === null;
                    return (
                        <label key={p.id} style={{ boxSizing: 'border-box', padding: '8px', minWidth: 0, background: 'rgba(12,22,40,.75)', border: `1px solid ${invalid ? RED : 'rgba(79,216,255,.18)'}` }}>
                            <div style={{ fontFamily: JP, fontWeight: 800, fontSize: 13, color: '#F3FAFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                            <input
                                type="text" inputMode="numeric" value={raw} disabled={entered || busy}
                                onChange={e => onChange(p.id, e.target.value)}
                                className="w-full mt-1 px-2 py-1.5 bg-zinc-900 border border-zinc-600 text-white text-right font-mono disabled:opacity-50"
                                aria-label={`${p.name} の得点`}
                            />
                        </label>
                    );
                })}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// サドンデス（2026-10-15 に「プレーオフ」から呼び名を変更）
// ---------------------------------------------------------------------------

export function PlayoffPanel({ playoff, progress, players, busy, onMark, onUndo }: {
    playoff: SemifinalPlayoff; progress: PlayoffProgress; players: Player[]; busy: boolean;
    onMark: (playerId: number, action: 'correct' | 'wrong') => void; onUndo: () => void;
}) {
    const isAdvance = playoff.purpose === 'advance';
    const winLabel = isAdvance ? 'WIN' : 'SAFE';
    const loseLabel = isAdvance ? '敗退' : 'LOST';
    return (
        <div className="flex flex-col gap-[10px]">
            <div style={MANUAL_LABEL_STYLE}>
                {isAdvance ? '勝ち抜け' : '失格'}サドンデス（{isAdvance ? '勝ち抜け' : '失格'} {playoff.slots}名）
            </div>
            <div className="flex gap-[10px] flex-wrap">
                {playoff.candidateIds.map(id => {
                    const p = players.find(x => x.id === id);
                    const outcome = progress.outcomes[id];
                    const canOperate = !progress.resolved && outcome === undefined && !busy;
                    const color = outcome === 'win' ? GOLD : outcome === 'lose' ? '#4A5568' : '#4FD8FF';
                    return (
                        <div key={id} style={{ width: 180, boxSizing: 'border-box', padding: 10, background: 'rgba(12,22,40,.75)', borderTop: `3px solid ${color}` }}>
                            <div style={{ fontFamily: JP, fontWeight: 800, fontSize: 15, color: '#F3FAFF', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p?.name ?? `#${id}`}</div>
                            <div style={{ fontFamily: ORB, fontWeight: 800, fontSize: 13, color, textAlign: 'center', minHeight: 18, margin: '4px 0' }}>
                                {outcome === 'win' ? winLabel : outcome === 'lose' ? loseLabel : ''}
                            </div>
                            <div className="grid grid-cols-2 gap-[6px]">
                                <button onClick={() => onMark(id, 'correct')} disabled={!canOperate} style={opBtnStyle('correct', canOperate)}>
                                    <span style={opBtnTextStyle('correct')}>正解</span>
                                </button>
                                <button onClick={() => onMark(id, 'wrong')} disabled={!canOperate} style={opBtnStyle('wrong', canOperate)}>
                                    <span style={opBtnTextStyle('wrong')}>誤答</span>
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
            <div>
                <button onClick={onUndo} disabled={busy || progress.effectiveActions.length === 0} style={{ ...neutralBtnStyle(), opacity: progress.effectiveActions.length === 0 ? 0.35 : 1 }}>
                    <span style={NEUTRAL_BTN_TEXT}>Undo</span>
                </button>
            </div>
        </div>
    );
}
