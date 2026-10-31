"use client";
// Admin の左サイドバー（SELECT ROUND）と、進行中のラウンドの案内（2026-10-22。docs/linear-progress-design.md 3章・提案D・E）
//
// - 前のラウンドが完了していないラウンドは押せない（鍵の印と、理由を小さく出す）
// - 各ラウンドに状態の印: 完了 ✓ ／ 進行中 ● ／ 未開始（印なし）
// - 後のラウンドに結果があるときに前のラウンドを押したら確認を出す（提案D-1。Main も切り替わるため）
// - 待機画面のとき、DB の結果から見た「いま進めるべきラウンド」を示し、1クリックで移れるようにする（提案E）
import type { RoundProgress } from './roundProgressContext';
import styles from './console/console.module.css';
import {
    ROUND_LABEL, ROUND_MODE, canEnterRound, currentRoundFromData, laterRoundStarted, previousRound,
    type RoundKey,
} from '@/lib/roundProgress';

/**
 * 進行レールの項目（2026-10-31 改善案 Step 1 で、日本語で読める大きさ・ルール名つきに変更）。
 * rule は状況（進行中の内容など）が無いときに2段目へ出すルール名
 */
const ROUND_NAV: { mode: string; label: string; rule: string; round: RoundKey | null }[] = [
    { mode: 'waiting', label: '待機画面', rule: '案内・準備', round: null },
    { mode: '1stRound', label: '1st Round', rule: '筆記クイズ', round: 'firstRound' },
    { mode: 'secondRound', label: '2nd Round', rule: '連答つき 5○2×', round: 'secondRound' },
    { mode: 'thirdRound', label: '3rd Round', rule: '4コース', round: 'thirdRound' },
    { mode: 'extraRound', label: 'Extra Round', rule: '敗者復活', round: 'extraRound' },
    { mode: 'semifinal', label: 'Semi-Final', rule: 'Nine Hundred', round: 'semifinal' },
    { mode: 'final', label: 'Final', rule: 'Triple Seven', round: 'final' },
];
/** 大会終了後の発表（ラウンドではないので、区切り線の下に置き、いつでも押せる） */
const AFTER_NAV = { mode: 'paperTop100', label: '上位100名発表', rule: '大会終了後' };

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
        <nav className={styles.rail} aria-label="ラウンドの選択">
            <div className={styles.brand}><b>abc the24th</b>運営コンソール</div>
            {ROUND_NAV.map(({ mode, label, rule, round }) => {
                const active = isActive(mode);
                const status = round && progress ? progress.statuses[round] : null;
                const gate = round && progress ? canEnterRound(progress.statuses, round) : { ok: true as const };
                // 表示中のラウンドは、条件を満たさなくなっても（リセット後など）押せないだけで表示は続ける
                const locked = !gate.ok && !active;
                const prev = round ? previousRound(round) : null;
                const complete = !!status && status.complete;
                // 2段目: 押せない理由 ／ 進行中・完了の内容 ／ ルール名
                const note = locked && prev
                    ? `${ROUND_LABEL[prev]} 未完了`
                    : status && status.started && round !== 'firstRound'
                        ? (complete ? `完了 · ${status.detail}` : status.detail)
                        : complete ? '完了' : rule;
                const cls = [styles.step, active ? styles.stepNow : complete ? styles.stepDone : ''].join(' ');
                return (
                    <button key={mode} type="button" className={cls} onClick={() => handleClick(mode, round)} disabled={locked}
                        title={!gate.ok ? gate.reason : undefined} aria-current={active ? 'page' : undefined}>
                        <span className={styles.mark} aria-hidden="true">{!active && complete ? '✓' : ''}</span>
                        <span>
                            <span className={styles.stepName}>{label}</span>
                            <span className={styles.stepNote}>{note}</span>
                        </span>
                    </button>
                );
            })}
            <div className={styles.railSep} />
            <button type="button" className={[styles.step, isActive(AFTER_NAV.mode) ? styles.stepNow : ''].join(' ')}
                onClick={() => handleClick(AFTER_NAV.mode, null)} aria-current={isActive(AFTER_NAV.mode) ? 'page' : undefined}>
                <span className={styles.mark} aria-hidden="true" />
                <span>
                    <span className={styles.stepName}>{AFTER_NAV.label}</span>
                    <span className={styles.stepNote}>{AFTER_NAV.rule}</span>
                </span>
            </button>
        </nav>
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

