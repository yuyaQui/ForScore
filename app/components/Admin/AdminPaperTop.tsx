// ペーパークイズ上位100名の発表の Admin 画面（2026-10-31 ユーザー承認・項目19）。
// DB は読むだけ。進行（何画面目か・名前を出したか）はサーバのメモリ（server/PaperTopHandler.js）。
//
//   1本道: 「名前を発表 ▶」→「次の画面（5〜10位）▶」→「名前を発表 ▶」→ … →「発表を終える ▶」→「発表終了」
//   ◀ 戻る: 名前を出す前の状態 → 前の画面の名前を出した状態、の順に1つずつ戻る
//   手動操作: 画面を直接選ぶ（順位だけの状態で表示する）
import { Socket } from "socket.io-client";
import { useEffect, useState } from "react";
import type { Player, PaperTopState } from "@/lib/types";
import { DEFAULT_PAPER_TOP_STATE } from "@/lib/types";
import { getPaperTopPages, paperTopRangeLabel, PAPER_TOP_COUNT } from "@/lib/paperTop";
import { ACCENT, tierOf } from "@/lib/cyberpunkCard";
import { toOrdinal } from "@/lib/ordinal";
import { MANUAL_LABEL_STYLE, manualBtnStyle, manualBtnTextStyle, neutralBtnStyle, NEUTRAL_BTN_TEXT, primaryButtonStyle } from "./adminCyberStyles";

const JP = '"Noto Sans JP",sans-serif';
const ORB = 'Orbitron, sans-serif';

export default function AdminPaperTop({ socket }: { socket: Socket | null }) {
    const [players, setPlayers] = useState<Player[]>([]);
    const [state, setState] = useState<PaperTopState>(DEFAULT_PAPER_TOP_STATE);
    // 「次の画面」の切り替え中（今の帯を順位だけに戻してから、1.3秒後に次の画面へ進める間）
    const [transitioning, setTransitioning] = useState(false);

    useEffect(() => {
        fetch('/api/secondRound/loadPlayers').then(res => res.json()).then(data => {
            if (data.success) setPlayers(data.allPlayers);
        }).catch(err => console.error('Failed to load players', err));
        if (!socket) return;
        const onState = (next: PaperTopState) => setState(next);
        const onPlayers = (all: Player[]) => setPlayers(all);
        socket.on('update_paper_top_state', onState);
        socket.on('update_players', onPlayers);
        socket.emit('request_paper_top_sync');
        return () => {
            socket.off('update_paper_top_state', onState);
            socket.off('update_players', onPlayers);
        };
    }, [socket]);

    const changeState = (updates: Partial<PaperTopState>) => {
        if (socket) socket.emit('change_paper_top_state', updates);
    };

    // 画面ごとの選手（ペーパー順位から都度計算）
    const pages = getPaperTopPages(players);
    const pageIndex = Math.min(state.page, Math.max(0, pages.length - 1));
    // 最後の画面の1つ先 = 発表を終えた状態（Main は帯を出さず、選手がフェードで消える）
    const done = pages.length > 0 && state.page >= pages.length;
    const current = done ? [] : (pages[pageIndex] ?? []);
    const next = done ? null : (pages[pageIndex + 1] ?? null);
    const expanded = state.phase === 'expanded';

    // ---- 1本道ボタン ----
    let primaryLabel: string;
    let primaryAction: (() => void) | null = null;
    if (pages.length === 0) {
        primaryLabel = '選手データがありません';
    } else if (transitioning) {
        // 帯を順位だけに戻す演出の最中は、進行ボタンを一時的に押せなくする（2nd Round の「次へ」と同じ）
        primaryLabel = '切り替え中…';
    } else if (done) {
        primaryLabel = '発表終了';
    } else if (!expanded) {
        primaryLabel = '名前を発表 ▶';
        primaryAction = () => changeState({ phase: 'expanded' });
    } else if (next) {
        primaryLabel = `次の画面（${paperTopRangeLabel(next)}）▶`;
        // 2nd Round のターンオーバーの「次へ」と同じ2段階（2026-11-04 ユーザー指示）:
        // (1) まず今の画面を順位だけに戻す（Main はその帯の中で収縮アニメーションを再生）
        // (2) 1300ms 後に次の画面へ進める（古い帯がフェードで消え、約1秒後に新しい帯が出る）
        primaryAction = () => {
            const page = pageIndex;
            setTransitioning(true);
            changeState({ phase: 'collapsed' });
            setTimeout(() => {
                changeState({ page: page + 1, phase: 'collapsed' });
                setTransitioning(false);
            }, 1300);
        };
    } else {
        // 最後の画面: 2nd Round の最後の帯と同じく、順位だけに戻してから 1300ms 後に帯を消す（2026-11-04 ユーザー指示）
        primaryLabel = '発表を終える ▶';
        primaryAction = () => {
            const end = pages.length;
            setTransitioning(true);
            changeState({ phase: 'collapsed' });
            setTimeout(() => {
                changeState({ page: end, phase: 'collapsed' });
                setTransitioning(false);
            }, 1300);
        };
    }
    // ◀ 戻る: 名前を出していれば順位だけに、順位だけなら前の画面の名前を出した状態に
    let backAction: (() => void) | null = null;
    if (transitioning) backAction = null;
    else if (done) backAction = () => changeState({ page: pages.length - 1, phase: 'expanded' });
    else if (expanded) backAction = () => changeState({ phase: 'collapsed' });
    else if (pageIndex > 0) backAction = () => changeState({ page: pageIndex - 1, phase: 'expanded' });

    const statusLabel = pages.length === 0
        ? 'PAPER TOP 100'
        : done ? `PAPER TOP 100 · 全${pages.length}画面 · 発表終了`
        : `PAPER TOP 100 · ${pageIndex + 1} / ${pages.length}画面 · ${paperTopRangeLabel(current)} · ${expanded ? '名前を公開中' : '順位だけ表示中'}`;

    return (
        <div className="flex flex-col gap-6 bg-white dark:bg-zinc-800 p-8 rounded-xl shadow-md w-full max-w-5xl">
            <h2 className="text-2xl font-black text-zinc-900 dark:text-zinc-100">ペーパー上位{PAPER_TOP_COUNT}名の発表</h2>

            {/* 1本道ボタン（Main の表示を進める） */}
            <div className="flex flex-col items-center gap-3 bg-black py-5 rounded-none">
                <div className="text-xs tracking-[0.3em] text-[#5C7EA6] font-mono">{statusLabel}</div>
                <div className="flex flex-wrap items-center justify-center gap-4 px-4">
                    {backAction && (
                        <button onClick={backAction} style={{ ...neutralBtnStyle(), padding: '18px 28px' }}>
                            <span style={{ ...NEUTRAL_BTN_TEXT, fontSize: 16 }}>◀ 戻る</span>
                        </button>
                    )}
                    <button onClick={primaryAction ?? undefined} disabled={!primaryAction} style={primaryButtonStyle(!!primaryAction)}>
                        {primaryLabel}
                    </button>
                </div>
            </div>

            {/* 今の画面と次の画面の選手 */}
            {pages.length > 0 && (
                <div className="grid gap-4 bg-black p-5" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                    <PageList title={done ? 'Main に表示中（なし）' : `Main に表示中（${paperTopRangeLabel(current)}）`} players={current} accent={ACCENT} />
                    <PageList title={next ? `次の画面（${paperTopRangeLabel(next)}）` : '次の画面（なし）'} players={next ?? []} accent="#3A4B63" />
                </div>
            )}

            {/* 手動操作: 画面を直接選ぶ（順位だけの状態で表示する） */}
            {pages.length > 0 && (
                <details className="bg-black px-5 py-4">
                    <summary className="cursor-pointer select-none" style={{ fontFamily: ORB, fontWeight: 800, fontSize: 14, letterSpacing: 2, color: '#7FA8D9' }}>
                        手動操作（画面を選ぶ）
                    </summary>
                    <div className="flex flex-wrap gap-[8px] pt-4">
                        {pages.map((pg, i) => (
                            <button key={i} onClick={() => changeState({ page: i, phase: 'collapsed' })} style={manualBtnStyle(!done && i === pageIndex)}>
                                <span style={manualBtnTextStyle(!done && i === pageIndex)}>{paperTopRangeLabel(pg)}</span>
                            </button>
                        ))}
                    </div>
                </details>
            )}
        </div>
    );
}

/** 1画面ぶんの選手の一覧 */
function PageList({ title, players, accent }: { title: string; players: Player[]; accent: string }) {
    return (
        <div className="flex flex-col gap-[8px]">
            <div style={MANUAL_LABEL_STYLE}>{title}</div>
            <div style={{ borderTop: `3px solid ${accent}`, background: 'rgba(12,22,40,.75)' }}>
                {players.length === 0 && (
                    <div style={{ padding: '12px 14px', fontFamily: JP, fontSize: 13, color: '#5C7EA6' }}>—</div>
                )}
                {players.map(p => (
                    <div key={p.id} className="flex items-baseline gap-3" style={{ padding: '8px 14px', borderTop: '1px solid rgba(79,216,255,.10)' }}>
                        <span style={{ width: 56, fontFamily: ORB, fontWeight: 800, fontSize: 14, color: tierOf(p.paperRank, ACCENT).color }}>{toOrdinal(p.paperRank)}</span>
                        <span style={{ fontFamily: JP, fontWeight: 900, fontSize: 15, color: '#F3FAFF' }}>{p.name}</span>
                        <span style={{ fontFamily: JP, fontWeight: 700, fontSize: 12, color: '#9FB4D6', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.school} {p.grade}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
