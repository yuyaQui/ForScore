// ペーパークイズ上位100名の発表の Admin 画面（2026-10-31 ユーザー承認・項目19）。
// 2026-11-05: 運営コンソール（console/）に載せ替え。2nd Round 以降と同じ枠に揃えた。
//   上のバー … Main に出ている画面・◀ 戻る・Main を覆う操作・次の操作（1本道）
//   作業面   … 「Main に表示中」と「次の画面」の選手の一覧（5〜10位 …）
//   引き出し … 「表示の切り替え」（画面を直接選ぶ。順位だけの状態で表示する）
// DB は読むだけ。進行（何画面目か・名前を出したか）はサーバのメモリ（server/PaperTopHandler.js）。
// 進行ボタンの流れと API・Socket のイベントは載せ替え前と同じ:
//   1本道: 「名前を発表 ▶」→「次の画面（5〜10位）▶」→「名前を発表 ▶」→ … →「発表を終える ▶」→「発表終了」
//   ◀ 戻る: 名前を出す前の状態 → 前の画面の名前を出した状態、の順に1つずつ戻る
// 変えたのは次の点: つなぎ直したときに進行状態と選手を取り直す／選手の読み込みの失敗を画面の上に出す／操作の記録を出す。
import { Socket } from "socket.io-client";
import { useEffect, useState } from "react";
import type { Player, PaperTopState } from "@/lib/types";
import { DEFAULT_PAPER_TOP_STATE } from "@/lib/types";
import { getPaperTopPages, paperTopRangeLabel, PAPER_TOP_COUNT } from "@/lib/paperTop";
import { ACCENT, tierOf } from "@/lib/cyberpunkCard";
import { toOrdinal } from "@/lib/ordinal";
import { describeCover } from "@/lib/mainCover";
import { notify } from "@/lib/adminNotice";
import { ConsoleFrame, WorkHead, MetaItem, Drawer, DrawerGroup } from "./console/ConsoleFrame";
import { SideLog } from "./console/SideLog";
import { useActionLog } from "./console/useActionLog";
import styles from "./console/console.module.css";
import { useMainCover } from "../useMainCover";
import { coverStartPrimary, CoverButtons } from "./MainCoverControls";
import { useSocketSync } from "../useSocketSync";

export default function AdminPaperTop({ socket }: { socket: Socket | null }) {
    const [players, setPlayers] = useState<Player[]>([]);
    const [state, setState] = useState<PaperTopState>(DEFAULT_PAPER_TOP_STATE);
    // 「次の画面」の切り替え中（今の帯を順位だけに戻してから、1.3秒後に次の画面へ進める間）
    const [transitioning, setTransitioning] = useState(false);
    const [drawer, setDrawer] = useState(false);
    const [cover, setCover, coverControls] = useMainCover(socket);
    const actionLog = useActionLog();

    useEffect(() => {
        const load = () => fetch('/api/secondRound/loadPlayers').then(res => res.json()).then(data => {
            if (data.success) setPlayers(data.allPlayers);
            else notify('選手データを読み込めませんでした', 'error');
        }).catch(() => notify('選手データを読み込めませんでした。通信を確かめてください', 'error'));
        void load();
        if (!socket) return;
        const onState = (next: PaperTopState) => setState(next);
        const onPlayers = (all: Player[]) => setPlayers(all);
        socket.on('update_paper_top_state', onState);
        socket.on('update_players', onPlayers);
        // つなぎ直したときは、切れていた間に変わった選手も取り直す
        socket.on('connect', load);
        return () => {
            socket.off('update_paper_top_state', onState);
            socket.off('update_players', onPlayers);
            socket.off('connect', load);
        };
    }, [socket]);
    // 画面を開いた時・つなぎ直した時に進行状態を取り直す
    useSocketSync(socket, ['request_paper_top_sync']);

    const changeState = (updates: Partial<PaperTopState>) => {
        if (socket) socket.emit('change_paper_top_state', updates);
    };
    const log = (what: string) => actionLog.add({ who: '', what, tone: 'other', scope: 'paperTop' });

    // 画面ごとの選手（ペーパー順位から都度計算）
    const pages = getPaperTopPages(players);
    const pageIndex = Math.min(state.page, Math.max(0, pages.length - 1));
    // 最後の画面の1つ先 = 発表を終えた状態（Main は帯を出さず、選手がフェードで消える）
    const done = pages.length > 0 && state.page >= pages.length;
    const current = done ? [] : (pages[pageIndex] ?? []);
    const next = done ? null : (pages[pageIndex + 1] ?? null);
    const expanded = state.phase === 'expanded';

    // 今の帯を順位だけに戻してから、1300ms 後に指定の画面へ進める（2nd Round のターンオーバーの「次へ」と同じ2段階。2026-11-04 ユーザー指示）
    const collapseThenGo = (page: number) => {
        setTransitioning(true);
        changeState({ phase: 'collapsed' });
        setTimeout(() => {
            changeState({ page, phase: 'collapsed' });
            setTransitioning(false);
        }, 1300);
    };

    // ---- 1本道ボタン ----
    let primaryLabel: string;
    let primaryAction: (() => void) | null = null;
    const coverStart = coverStartPrimary(cover, setCover);
    if (coverStart) {
        primaryLabel = coverStart.label;
        primaryAction = coverStart.action;
    } else if (pages.length === 0) {
        primaryLabel = '選手データがありません';
    } else if (transitioning) {
        // 帯を順位だけに戻す演出の最中は、進行ボタンを一時的に押せなくする
        primaryLabel = '切り替え中…';
    } else if (done) {
        primaryLabel = '発表終了';
    } else if (!expanded) {
        primaryLabel = '名前を発表 ▶';
        primaryAction = () => { changeState({ phase: 'expanded' }); log(`${paperTopRangeLabel(current)} の名前を発表`); };
    } else if (next) {
        primaryLabel = `次の画面（${paperTopRangeLabel(next)}）▶`;
        primaryAction = () => { collapseThenGo(pageIndex + 1); log(`次の画面（${paperTopRangeLabel(next)}）へ`); };
    } else {
        // 最後の画面: 順位だけに戻してから 1300ms 後に帯を消す
        primaryLabel = '発表を終える ▶';
        primaryAction = () => { collapseThenGo(pages.length); log('発表を終える'); };
    }

    // ◀ 戻る: 名前を出していれば順位だけに、順位だけなら前の画面の名前を出した状態に
    let backAction: (() => void) | null = null;
    if (transitioning) backAction = null;
    else if (done) backAction = () => changeState({ page: pages.length - 1, phase: 'expanded' });
    else if (expanded) backAction = () => changeState({ phase: 'collapsed' });
    else if (pageIndex > 0) backAction = () => changeState({ page: pageIndex - 1, phase: 'expanded' });
    const back = backAction ? () => { backAction?.(); log('戻る'); } : null;

    const detail = pages.length === 0 ? '' : done ? `全${pages.length}画面 · 発表終了`
        : `${pageIndex + 1} / ${pages.length}画面 · ${paperTopRangeLabel(current)} · ${expanded ? '名前を公開中' : '順位だけ表示中'}`;

    return (
        <ConsoleFrame
            onAir={`ペーパー上位${PAPER_TOP_COUNT}名の発表`}
            onAirDetail={cover.kind !== 'none' ? describeCover(cover) : detail}
            barExtra={<>
                <button type="button" className={styles.btn} onClick={back ?? undefined} disabled={!back}>◀ 戻る</button>
                <CoverButtons cover={cover} setCover={setCover} forceRelease={coverControls.forceRelease} className={styles.btn} />
            </>}
            undo={null}
            next={{ label: primaryLabel, onClick: primaryAction }}
            side={<SideLog log={actionLog.entries} empty="この画面で行った発表の操作がここに並びます" />}
        >
            <WorkHead
                meta={<>
                    <MetaItem label="画面 " value={pages.length === 0 ? '—' : done ? `${pages.length} / ${pages.length}（終了）` : `${pageIndex + 1} / ${pages.length}`} />
                    <MetaItem label="状態 " value={pages.length === 0 ? '—' : done ? '発表終了' : expanded ? '名前を公開中' : '順位だけ表示中'} />
                </>}
                tools={
                    <button type="button" className={drawer ? styles.btnOn : styles.btn} onClick={() => setDrawer(!drawer)} disabled={pages.length === 0}>表示の切り替え</button>
                }
            />
            {pages.length === 0 ? (
                <div className={styles.empty}>選手データがありません（1st Round の集計結果を取り込んでください）</div>
            ) : (
                <div className={styles.ptGrid}>
                    <PageList title={done ? 'Main に表示中（なし）' : `Main に表示中（${paperTopRangeLabel(current)}）`} players={current} on />
                    <PageList title={next ? `次の画面（${paperTopRangeLabel(next)}）` : '次の画面（なし）'} players={next ?? []} />
                </div>
            )}
            <div className={styles.hint}>「名前を発表」で順位だけの帯に名前が出ます。次の画面へ進むときは、帯が順位だけに戻ってから切り替わります。</div>

            {drawer && (
                <Drawer title="表示の切り替え" onClose={() => setDrawer(false)}>
                    <DrawerGroup label="画面を選ぶ" note="選んだ画面を、順位だけの状態で Main に出します">
                        {pages.map((pg, i) => (
                            <button key={i} type="button" className={!done && i === pageIndex ? styles.btnOn : styles.btn}
                                disabled={transitioning}
                                onClick={() => { changeState({ page: i, phase: 'collapsed' }); log(`${paperTopRangeLabel(pg)} を表示（手動）`); setDrawer(false); }}>
                                {paperTopRangeLabel(pg)}
                            </button>
                        ))}
                    </DrawerGroup>
                </Drawer>
            )}
        </ConsoleFrame>
    );
}

/** 1画面ぶんの選手の一覧 */
function PageList({ title, players, on }: { title: string; players: Player[]; on?: boolean }) {
    return (
        <div className={on ? styles.ptColOn : styles.ptCol}>
            <div className={styles.sectionLabel}>{title}</div>
            <div className={styles.ptList}>
                {players.length === 0 && <div className={styles.ptNone}>—</div>}
                {players.map(p => (
                    <div key={p.id} className={styles.ptRow}>
                        <span className={styles.ptRank} style={{ color: tierOf(p.paperRank, ACCENT).color }}>{toOrdinal(p.paperRank)}</span>
                        <span className={styles.ptName}>{p.name}</span>
                        <span className={styles.ptSchool}>{p.school} {p.grade}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
