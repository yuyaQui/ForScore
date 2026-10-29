import { Socket } from "socket.io-client";
import { useState, useMemo } from "react";
import type { Player } from "@/lib/types";
import { EXTRA_ROUND_MAX_ENTRANTS } from "@/lib/extraRound";
import { toOrdinal } from "@/lib/ordinal";
import { ACCENT, tierOf } from "@/lib/cyberpunkCard";
import {
    MANUAL_LABEL_STYLE,
    MANUAL_PANEL_BASE,
    STAT_CARD_STYLE,
    STAT_LABEL_STYLE,
    manualBtnStyle,
    manualBtnTextStyle,
    primaryButtonStyle,
} from "./adminCyberStyles";
import { useRoundProgress, cascadeNotice, broadcastAfterReset } from "./roundProgressContext";

type Props = {
    socket: Socket | null;
    /** 全選手。親が読み込み済みの状態で渡す（読み込み前は描画しない） */
    players: Player[];
    /** 出場者の確定が済んだ。singleWinner は「1名だけで、早押しを飛ばして敗者復活にした」場合 */
    onConfirmed: (singleWinner: boolean) => void;
};

// ペーパー順位の昇順（未設定は末尾、同順位はエントリーナンバー順）。
function compareByPaperRank(a: Player, b: Player): number {
    const ra = a.paperRank > 0 ? a.paperRank : Number.POSITIVE_INFINITY;
    const rb = b.paperRank > 0 ? b.paperRank : Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra < rb ? -1 : 1;
    return a.entryNo - b.entryNo;
}

// First Step 通過者（Second Step 出場者、最大12名）を選ぶ画面。
// 約200名から探すため、名前・エントリーNo・学校名での絞り込みを用意する
export default function AdminExtraRoundEntrants({ socket, players, onConfirmed }: Props) {
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
    const [errorMessage, setErrorMessage] = useState("");

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
        setErrorMessage("");
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
        if (count === 0 || isOver) return;
        setErrorMessage("");

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
                setErrorMessage(data.error || '更新に失敗しました');
            }
        } catch (error) {
            console.error('Extra Round entrants save failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setSaving(false);
        }
    };

    const canConfirm = count >= 1 && !isOver && !saving;
    const confirmLabel = saving
        ? '登録中...'
        : count === 1
            ? '1名で敗者復活を確定 ▶'
            : 'Second Step へ ▶';

    return (
        <div className="flex flex-col gap-5">
            <div className="flex gap-4">
                <div style={STAT_CARD_STYLE}>
                    <div style={STAT_LABEL_STYLE}>選択数</div>
                    <div style={{ marginTop: 6, fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 34, color: isOver ? '#FF4D6D' : '#EAF6FF' }}>
                        {count}<span style={{ fontSize: 18, color: '#5C7EA6' }}> / {EXTRA_ROUND_MAX_ENTRANTS}</span>
                    </div>
                </div>
                <div style={{ ...STAT_CARD_STYLE, flex: 3 }}>
                    <div style={STAT_LABEL_STYLE}>Second Step 進出者</div>
                    <div className="flex flex-wrap gap-2" style={{ marginTop: 10, minHeight: 34 }}>
                        {selectedPlayers.length === 0 && (
                            <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontSize: 14, color: '#5C7EA6' }}>
                                下の一覧から選んでください
                            </span>
                        )}
                        {selectedPlayers.map(p => (
                            <button
                                key={p.id}
                                onClick={() => toggleEntrant(p.entryNo)}
                                title="クリックで選択を外す"
                                style={{
                                    ...manualBtnStyle(true), padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 8,
                                }}
                            >
                                {/* エントリーNoではなく 1st Round の順位を出す（2026-10-11 ユーザー指示） */}
                                <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 12, color: tierOf(p.paperRank, ACCENT).color }}>
                                    {toOrdinal(p.paperRank)}
                                </span>
                                <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, fontSize: 14, color: '#DFF7FF' }}>{p.name}</span>
                                <span style={{ fontSize: 14, color: '#5C7EA6' }}>×</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div style={{ ...MANUAL_PANEL_BASE, gap: 14 }}>
                <div style={MANUAL_LABEL_STYLE}>検索</div>
                <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="名前・学校・エントリーNo"
                    className="px-4 py-2 bg-zinc-900 border border-zinc-600 text-white"
                    style={{ fontFamily: '"Noto Sans JP",sans-serif' }}
                />
                <div className="max-h-96 overflow-y-auto" style={{ border: '1px solid rgba(79,216,255,.22)' }}>
                    {filteredPlayers.map(p => {
                        const checked = selectedEntryNos.has(p.entryNo);
                        const blocked = !checked && count >= EXTRA_ROUND_MAX_ENTRANTS;
                        return (
                            <label
                                key={p.id}
                                className="flex items-center gap-3 px-4 py-2"
                                style={{
                                    cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.4 : 1,
                                    background: checked ? 'rgba(51,198,255,.12)' : 'transparent',
                                    borderBottom: '1px solid rgba(79,216,255,.10)',
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={blocked}
                                    onChange={() => toggleEntrant(p.entryNo)}
                                    className="w-4 h-4"
                                />
                                <span style={{ width: 64, fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 13, color: '#7FA8D9' }}>No.{p.entryNo}</span>
                                <span style={{ width: 56, fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 13, color: tierOf(p.paperRank, ACCENT).color }}>{toOrdinal(p.paperRank)}</span>
                                <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, color: '#F3FAFF' }}>{p.name}</span>
                                <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontSize: 13, color: '#7FA8D9' }}>{p.school}（{p.grade}）</span>
                            </label>
                        );
                    })}
                    {filteredPlayers.length === 0 && (
                        <div className="px-4 py-8 text-center" style={{ fontFamily: '"Noto Sans JP",sans-serif', color: '#5C7EA6' }}>
                            該当する選手がいません
                        </div>
                    )}
                </div>
                {count >= EXTRA_ROUND_MAX_ENTRANTS && (
                    <div style={{ fontFamily: '"Noto Sans JP",sans-serif', fontSize: 13, color: '#FFC93C' }}>
                        上限{EXTRA_ROUND_MAX_ENTRANTS}名です。選び直すには選択を外してください
                    </div>
                )}
            </div>

            {errorMessage && (
                <div className="px-4 py-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300 text-sm font-bold">
                    {errorMessage}
                </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
                <button onClick={handleConfirm} disabled={!canConfirm} style={{ ...primaryButtonStyle(canConfirm), opacity: canConfirm ? 1 : 0.6 }}>
                    {confirmLabel}
                </button>
                <button
                    onClick={() => { setSelectedEntryNos(new Set()); setErrorMessage(""); }}
                    disabled={count === 0 || saving}
                    style={{ ...manualBtnStyle(false), opacity: count === 0 ? 0.4 : 1 }}
                >
                    <span style={manualBtnTextStyle(false)}>すべて外す</span>
                </button>
            </div>
        </div>
    );
}
