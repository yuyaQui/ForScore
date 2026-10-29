"use client";
// Admin の左サイドバー（SELECT ROUND）と、進行中のラウンドの案内（2026-10-22。docs/linear-progress-design.md 3章・提案D・E）
//
// - 前のラウンドが完了していないラウンドは押せない（鍵の印と、理由を小さく出す）
// - 各ラウンドに状態の印: 完了 ✓ ／ 進行中 ● ／ 未開始（印なし）
// - 後のラウンドに結果があるときに前のラウンドを押したら確認を出す（提案D-1。Main も切り替わるため）
// - 待機画面のとき、DB の結果から見た「いま進めるべきラウンド」を示し、1クリックで移れるようにする（提案E）
import type { RoundProgress } from './roundProgressContext';
import {
    ROUND_LABEL, ROUND_MODE, canEnterRound, currentRoundFromData, laterRoundStarted, previousRound,
    type RoundKey,
} from '@/lib/roundProgress';

/** サイドバーの項目。ラベルは 2026-10-11 のユーザー指示どおり */
const ROUND_NAV: { mode: string; label: string; round: RoundKey | null }[] = [
    { mode: 'waiting', label: '待機画面', round: null },
    { mode: '1stRound', label: '1ST ROUND', round: 'firstRound' },
    { mode: 'secondRound', label: '2ND ROUND', round: 'secondRound' },
    { mode: 'thirdRound', label: '3RD ROUND', round: 'thirdRound' },
    { mode: 'extraRound', label: 'EXTRA ROUND', round: 'extraRound' },
    { mode: 'semifinal', label: 'SEMI-FINAL', round: 'semifinal' },
    { mode: 'final', label: 'FINAL', round: 'final' },
];

/** 鍵の印（押せないラウンド） */
function LockIcon() {
    return (
        <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true" style={{ flexShrink: 0 }}>
            <rect x="1" y="6" width="10" height="7.5" fill="none" stroke="#5C7EA6" strokeWidth="1.5" />
            <path d="M3.2 6V4.2a2.8 2.8 0 0 1 5.6 0V6" fill="none" stroke="#5C7EA6" strokeWidth="1.5" />
        </svg>
    );
}

export function AdminRoundSidebar({ currentMode, progress, onChangeMode }: {
    currentMode: string;
    progress: RoundProgress | null;
    onChangeMode: (mode: string) => void;
}) {
    // 「1stRoundResult」は 1R のサブ画面なので、サイドバー上は親ラウンドをアクティブ表示にする
    const isActive = (mode: string) =>
        mode === '1stRound' ? currentMode === '1stRound' || currentMode === '1stRoundResult' : currentMode === mode;

    const handleClick = (mode: string, round: RoundKey | null) => {
        if (isActive(mode)) return;
        if (round && progress) {
            // 前のラウンドが完了していなければ移れない（ボタンも押せないが念のため）
            if (!canEnterRound(progress.statuses, round).ok) return;
            // 提案D-1: 後のラウンドに結果があるのに、前のラウンドへ戻ろうとしたら確認する
            const later = laterRoundStarted(progress.statuses, round);
            if (later && !window.confirm(
                `${ROUND_LABEL[round]} の画面に戻りますか？\nMain も ${ROUND_LABEL[round]} の画面に戻ります（${ROUND_LABEL[later]} 以降の結果はそのまま残ります）。`
            )) return;
        }
        onChangeMode(mode);
    };

    return (
        <div
            className="shrink-0 flex flex-col gap-[10px]"
            style={{
                width: 220, minHeight: '100vh', boxSizing: 'border-box', padding: '30px 18px',
                background: 'rgba(8,15,28,.7)', borderRight: '1px solid rgba(79,216,255,.18)',
            }}
        >
            <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 13, letterSpacing: 5, color: '#5C7EA6', marginBottom: 10 }}>
                SELECT ROUND
            </div>
            {ROUND_NAV.map(({ mode, label, round }) => {
                const active = isActive(mode);
                const status = round && progress ? progress.statuses[round] : null;
                const gate = round && progress ? canEnterRound(progress.statuses, round) : { ok: true as const };
                // 表示中のラウンドは、条件を満たさなくなっても（リセット後など）押せないだけで表示は続ける
                const locked = !gate.ok && !active;
                const prev = round ? previousRound(round) : null;
                // 2段目の小さい説明: 押せない理由／進行中・完了の内容
                const note = locked && prev
                    ? `${ROUND_LABEL[prev]} 未完了`
                    : status && status.started && round !== 'firstRound' ? status.detail : null;
                const mark = !status || locked ? null : status.complete ? '✓' : status.started ? '●' : null;

                return (
                    <button
                        key={mode}
                        onClick={() => handleClick(mode, round)}
                        disabled={locked}
                        title={!gate.ok ? gate.reason : undefined}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                            cursor: locked ? 'not-allowed' : 'pointer',
                            background: active ? 'rgba(79,216,255,.10)' : 'transparent',
                            border: 'none', textAlign: 'left', opacity: locked ? 0.55 : 1,
                        }}
                    >
                        <span style={{
                            display: 'block', width: 3, height: 20, flexShrink: 0,
                            background: active ? '#4FD8FF' : 'transparent', boxShadow: active ? '0 0 8px #4FD8FF' : 'none',
                        }} />
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 14, letterSpacing: 2, color: active ? '#F3FAFF' : '#5C7EA6' }}>
                                    {label}
                                </span>
                                {locked && <LockIcon />}
                                {mark && (
                                    <span style={{ fontSize: 12, fontWeight: 800, color: mark === '✓' ? '#4FD8FF' : '#FFC93C' }}>{mark}</span>
                                )}
                            </span>
                            {note && (
                                <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontSize: 11, color: '#5C7EA6', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {note}
                                </span>
                            )}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

/**
 * 提案E: 待機画面のとき、DB の結果から見た「いま進めるべきラウンド」を示す。
 * サーバを再起動すると表示モードが待機画面に戻るため、どこから再開するかを1クリックで選べるようにする。
 */
export function AdminResumeBanner({ progress, onChangeMode }: {
    progress: RoundProgress | null;
    onChangeMode: (mode: string) => void;
}) {
    if (!progress) return null;
    const round = currentRoundFromData(progress.statuses);
    // 何も始まっていない、または 1st Round だけ（選手登録のみ）のときは出さない
    if (!round || round === 'firstRound') return null;
    const status = progress.statuses[round];
    const state = status.complete ? '終了' : status.started ? '進行中' : '開始前';

    return (
        <div className="flex flex-wrap items-center justify-between gap-4 bg-black px-6 py-4 w-[90%]"
            style={{ border: '1px solid rgba(255,201,60,.45)' }}>
            <div className="flex flex-col gap-1">
                <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 12, letterSpacing: 3, color: '#FFC93C' }}>
                    RESUME
                </span>
                <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, fontSize: 15, color: '#DFF7FF' }}>
                    DB の結果では {ROUND_LABEL[round]} が{state}です（{status.detail}）
                </span>
            </div>
            <button
                onClick={() => onChangeMode(ROUND_MODE[round])}
                style={{
                    padding: '12px 28px', background: 'rgba(255,201,60,.10)', border: '2px solid #FFC93C', cursor: 'pointer',
                    clipPath: 'polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)',
                    fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 16, letterSpacing: 2, color: '#FFE9A8',
                }}
            >
                {ROUND_LABEL[round]} へ ▶
            </button>
        </div>
    );
}

