// First Step 通過者（Second Step 出場者、最大12名）を選ぶ作業面（運営コンソール。2026-11-05 に載せ替え）。
// 約200名から探すため、名前・エントリーNo・学校名での絞り込みを用意する。
// 「Second Step へ ▶」は上のバーの進行ボタンに出す。そのため、押したときの処理と名前は onActions で親へ渡す。
import { Socket } from "socket.io-client";
import { useState, useMemo, useEffect, useRef, type ReactNode } from "react";
import type { Player } from "@/lib/types";
import { EXTRA_ROUND_MAX_ENTRANTS } from "@/lib/extraRound";
import { toOrdinal } from "@/lib/ordinal";
import { ACCENT, tierOf } from "@/lib/cyberpunkCard";
import { useRoundProgress, cascadeNotice, broadcastAfterReset } from "./roundProgressContext";
import { WorkHead, MetaItem } from "./console/ConsoleFrame";
import { notify, errorText } from "@/lib/adminNotice";
import styles from "./console/console.module.css";

type Props = {
    socket: Socket | null;
    /** 全選手。親が読み込み済みの状態で渡す（読み込み前は描画しない） */
    players: Player[];
    /** 出場者の確定が済んだ。singleWinner は「1名だけで、早押しを飛ばして敗者復活にした」場合 */
    onConfirmed: (singleWinner: boolean) => void;
    /** 上のバーの進行ボタン（名前と、押したときの処理。押せないときは run が null）。画面を離れるときは null */
    onActions: (action: { label: string; run: (() => void) | null } | null) => void;
    /** 作業面の右上の道具（引き出しを開く） */
    tools: ReactNode;
};

// ペーパー順位の昇順（未設定は末尾、同順位はエントリーナンバー順）。
function compareByPaperRank(a: Player, b: Player): number {
    const ra = a.paperRank > 0 ? a.paperRank : Number.POSITIVE_INFINITY;
    const rb = b.paperRank > 0 ? b.paperRank : Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra < rb ? -1 : 1;
    return a.entryNo - b.entryNo;
}

export default function AdminExtraRoundEntrants({ socket, players, onConfirmed, onActions, tools }: Props) {
    const [searchTerm, setSearchTerm] = useState("");
    // entryNo の集合で選択状態を持つ。開いた時点の DB（extraRoundSecondStep）を初期値にする。
    // 以後の update_players には追従させない。追従させると、確定前のローカルな選択が
    // DB の値で上書きされてしまうため。
    // dbEntryNos: DB に登録されている出場者そのまま（「選び直したか」の比較に使う）
    const [dbEntryNos] = useState<number[]>(() =>
        players.filter(p => p.extraRoundSecondStep).map(p => p.entryNo)
    );
    // 3rd Round 通過者は選べない（下記）ので、過去のデータに紛れていても初期の選択からは除く
    const [selectedEntryNos, setSelectedEntryNos] = useState<Set<number>>(() =>
        new Set(players.filter(p => p.extraRoundSecondStep && p.thirdRoundRank <= 0).map(p => p.entryNo))
    );
    const [saving, setSaving] = useState(false);
    // 各ラウンドの状況（2026-10-22。選び直しの確認文に後のラウンドへの影響を書く）
    const progress = useRoundProgress();

    // 3rd Round 通過者（thirdRoundRank > 0）は候補から外す。すでに準決勝進出が決まっている
    // 選手なので、Second Step（敗者復活）の対象にはなり得ない。ここで弾いておかないと、
    // 誤って選ばれた選手が「3rd Round通過」と「Extra Round敗者復活」を両方持つ矛盾した
    // データになり、準決勝の座席が重複してしまう（API 側でも拒否している）。
    //
    // 並び順はペーパー順位（1st Round 順位 paperRank）の昇順。First Step 通過者は
    // ペーパー上位から探すことが多く、ルール上も「20問後に13名以上残ったら1st Round の
    // 成績で12名を決める」ため、上から順に見ればよい並びにしておく。順位が未設定
    // （0 以下）の選手は末尾、同順位はエントリーナンバー順。
    const candidates = useMemo(
        () => players.filter(p => p.thirdRoundRank <= 0).sort(compareByPaperRank),
        [players]
    );

    const filteredPlayers = useMemo(() => {
        const term = searchTerm.trim();
        if (term === "") return candidates;
        return candidates.filter(p =>
            p.name.includes(term) || p.school.includes(term) || String(p.entryNo).includes(term)
        );
    }, [candidates, searchTerm]);

    const selectedPlayers = useMemo(
        () => candidates.filter(p => selectedEntryNos.has(p.entryNo)),
        [candidates, selectedEntryNos]
    );

    const count = selectedEntryNos.size;
    const isOver = count > EXTRA_ROUND_MAX_ENTRANTS;

    // 12名を超えて選べないようにする（超えた状態でのチェックは受け付けない）
    const toggleEntrant = (entryNo: number) => {
        setSelectedEntryNos(prev => {
            const next = new Set(prev);
            if (next.has(entryNo)) next.delete(entryNo);
            else if (next.size < EXTRA_ROUND_MAX_ENTRANTS) next.add(entryNo);
            return next;
        });
    };

    const post = async (confirmReset: boolean) => {
        const res = await fetch('/api/extraRound/secondStepEntrants', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entryNos: Array.from(selectedEntryNos), confirmReset })
        });
        return { res, data: await res.json() };
    };

    const handleConfirm = async () => {
        if (count === 0 || isOver || saving) return;

        // 選び直していない（開いた時点と同じ）なら、データには触らずそのまま進む
        const unchanged =
            dbEntryNos.length === count && dbEntryNos.every(n => selectedEntryNos.has(n));
        if (unchanged) {
            onConfirmed(count === 1);
            return;
        }

        if (count === 1) {
            const only = selectedPlayers[0];
            const ok = window.confirm(
                `出場者が1名のため、${only ? only.name : 'この選手'} を敗者復活として確定しますか？`
            );
            if (!ok) return;
        }

        setSaving(true);
        try {
            let { res, data } = await post(false);
            let didReset = false;

            // Extra Round の結果（または後のラウンドの結果）が残っている場合は、
            // 初期化してよいかを確認してからもう一度送る（2026-10-22: Semi-Final 以降も初期化される）
            if (res.status === 409 && data.needsConfirmation) {
                const ok = window.confirm(
                    `Extra Round の結果（Second Step・敗者復活者なしの確定）がリセットされます。よろしいですか？${cascadeNotice(progress, 'semifinal', true)}`
                );
                if (!ok) return;
                ({ res, data } = await post(true));
                didReset = true;
            }

            if (res.ok && data.success) {
                if (didReset) {
                    // Semi-Final 以降の進行状態も戻す（Extra Round 自身はこのまま Second Step へ進む）
                    broadcastAfterReset(socket, 'semifinal', data);
                } else if (socket) {
                    socket.emit('broadcast_scores', data.allPlayers);
                }
                onConfirmed(!!data.singleWinner);
            } else {
                notify(data.error || '更新に失敗しました', 'error');
            }
        } catch (error) {
            notify(errorText(error, '通信に失敗しました。進出者の登録は反映されていません。'), 'error');
        } finally {
            setSaving(false);
        }
    };

    // 上のバーの進行ボタン。押したときは最新の handleConfirm を呼ぶ（選択のたびに親へ関数を渡し直さないため ref 経由）
    const confirmRef = useRef(handleConfirm);
    useEffect(() => { confirmRef.current = handleConfirm; });
    const canConfirm = count >= 1 && !isOver && !saving;
    const confirmLabel = saving
        ? '登録中...'
        : count === 0 ? '進出者を選んでください'
        : count === 1
            ? '1名で敗者復活を確定 ▶'
            : `Second Step へ（${count}名） ▶`;
    useEffect(() => {
        onActions({ label: confirmLabel, run: canConfirm ? () => { void confirmRef.current(); } : null });
    }, [confirmLabel, canConfirm, onActions]);
    useEffect(() => () => onActions(null), [onActions]);

    return (
        <>
            <WorkHead
                meta={<MetaItem label="選択数" value={`${count} / ${EXTRA_ROUND_MAX_ENTRANTS}`} />}
                tools={<>
                    <button type="button" className={styles.btn} onClick={() => { setSelectedEntryNos(new Set()); }} disabled={count === 0 || saving}>すべて外す</button>
                    {tools}
                </>} />

            <div className={styles.chipBox}>
                <span className={styles.sectionLabel}>Second Step 進出者</span>
                <div className={styles.chips}>
                    {selectedPlayers.length === 0 && <span className={styles.chipHint}>下の一覧から選んでください</span>}
                    {selectedPlayers.map(p => (
                        <button key={p.id} type="button" className={styles.chip} onClick={() => toggleEntrant(p.entryNo)} title="クリックで選択を外す">
                            {/* エントリーNoではなく 1st Round の順位を出す（2026-10-11 ユーザー指示） */}
                            <b style={{ color: tierOf(p.paperRank, ACCENT).color }}>{toOrdinal(p.paperRank)}</b>
                            {p.name}
                            <span className={styles.chipX}>×</span>
                        </button>
                    ))}
                </div>
            </div>

            <input type="text" className={styles.search} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="名前・学校・エントリーNoで検索" aria-label="検索" />

            <div className={styles.entryList}>
                {filteredPlayers.map(p => {
                    const checked = selectedEntryNos.has(p.entryNo);
                    const blocked = !checked && count >= EXTRA_ROUND_MAX_ENTRANTS;
                    return (
                        <button key={p.id} type="button" className={checked ? styles.entryRowOn : styles.entryRow}
                            onClick={() => toggleEntrant(p.entryNo)} disabled={blocked} aria-pressed={checked}
                            style={blocked ? { opacity: .4 } : undefined}>
                            <span className={styles.check}>{checked ? '✓' : ''}</span>
                            <span className={styles.entryNo}>No.{p.entryNo}</span>
                            <span className={styles.entryRank} style={{ color: tierOf(p.paperRank, ACCENT).color }}>{toOrdinal(p.paperRank)}</span>
                            <span className={styles.entryName}>{p.name}</span>
                            <span className={styles.entrySub}>{p.school}（{p.grade}）</span>
                        </button>
                    );
                })}
                {filteredPlayers.length === 0 && <div className={styles.empty}>該当する選手がいません</div>}
            </div>
            {count >= EXTRA_ROUND_MAX_ENTRANTS && (
                <div className={styles.hint} style={{ color: 'var(--air)' }}>上限{EXTRA_ROUND_MAX_ENTRANTS}名です。選び直すには選択を外してください</div>
            )}
        </>
    );
}
