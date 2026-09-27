import { Socket } from "socket.io-client";
import { useState, useEffect, useMemo } from "react";
import type { Player } from "@/lib/types";

type Props = {
    socket: Socket | null;
}

// First Step 通過者（Second Step 出場者、最大12名）を選ぶ画面。
// 約200名から探すため、名前・エントリーNoでの絞り込みを用意する
export default function AdminExtraRoundEntrants(props: Props) {
    const { socket } = props;

    const [players, setPlayers] = useState<Player[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    // entryNo の集合で選択状態を持つ。初期値は DB の extraRoundSecondStep を反映する
    const [selectedEntryNos, setSelectedEntryNos] = useState<Set<number>>(new Set());
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetch('/api/secondRound/loadPlayers').then(res => res.json()).then(data => {
            if (data.success) {
                setPlayers(data.allPlayers);
                // 初回読み込み時だけ、DB 上ですでに選ばれている人を選択状態にする。
                // 以後の update_players（他画面の操作によるグローバル更新）には追従させない。
                // 追従させると、保存前のローカルな選択がDBの値で上書きされてしまうため
                // （react-hooks/set-state-in-effect 対応と合わせて修正）。
                setSelectedEntryNos(new Set(
                    (data.allPlayers as Player[]).filter(p => p.extraRoundSecondStep).map(p => p.entryNo)
                ));
            }
        });

        if (socket) {
            const handlePlayersUpdate = (allPlayers: Player[]) => setPlayers(allPlayers);
            socket.on("update_players", handlePlayersUpdate);
            return () => {
                socket.off("update_players", handlePlayersUpdate);
            };
        }
    }, [socket]);

    // 名前 or エントリーNo で絞り込む。
    // 3rd Round 通過者（thirdRoundRank > 0）は候補から外す。すでに準決勝進出が
    // 決まっている選手なので、Second Step（敗者復活）の対象にはなり得ない。
    // ここで弾いておかないと、誤って選ばれた選手が「3rd Round通過」と「Extra Round
    // 敗者復活」を両方持つ矛盾したデータになり、準決勝の座席が重複してしまう。
    const filteredPlayers = useMemo(() => {
        const candidates = players
            .filter(p => p.thirdRoundRank <= 0)
            .sort((a, b) => a.entryNo - b.entryNo);
        const term = searchTerm.trim();
        if (term === "") return candidates;
        return candidates.filter(p =>
            p.name.includes(term) || String(p.entryNo).includes(term)
        );
    }, [players, searchTerm]);

    const toggleEntrant = (entryNo: number) => {
        setSelectedEntryNos(prev => {
            const next = new Set(prev);
            if (next.has(entryNo)) next.delete(entryNo);
            else next.add(entryNo);
            return next;
        });
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await fetch('/api/extraRound/secondStepEntrants', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entryNos: Array.from(selectedEntryNos) })
            });
            const data = await res.json();

            if (data.success) {
                if (socket) socket.emit('broadcast_scores', data.allPlayers);
                alert(`Second Step 出場者を登録しました（${selectedEntryNos.size}名）`);
            } else {
                alert('登録に失敗しました...');
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <label className="text-lg font-bold text-zinc-800 dark:text-zinc-200">
                    Second Step 出場者の選択
                </label>
                <span className={`text-sm font-mono font-bold ${selectedEntryNos.size > 12 ? "text-red-500" : "text-zinc-500 dark:text-zinc-400"}`}>
                    {selectedEntryNos.size} / 12 名
                </span>
            </div>

            {/* 名前・エントリーNoでの絞り込み */}
            <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="名前 or エントリーナンバーで検索"
                className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
            />

            <div className="max-h-96 overflow-y-auto border border-zinc-200 dark:border-zinc-700 rounded-xl divide-y divide-zinc-200 dark:divide-zinc-700">
                {filteredPlayers.map(p => (
                    <label
                        key={p.id}
                        className="flex items-center gap-3 px-4 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-700/30 cursor-pointer"
                    >
                        <input
                            type="checkbox"
                            checked={selectedEntryNos.has(p.entryNo)}
                            onChange={() => toggleEntrant(p.entryNo)}
                            className="w-4 h-4"
                        />
                        <span className="font-mono text-sm text-zinc-500 w-16">No.{p.entryNo}</span>
                        <span className="font-bold text-zinc-900 dark:text-zinc-100">{p.name}</span>
                        <span className="text-sm text-zinc-500 dark:text-zinc-400">{p.school}（{p.grade}）</span>
                    </label>
                ))}
                {filteredPlayers.length === 0 && (
                    <div className="px-4 py-8 text-center text-zinc-500">
                        該当する選手がいません
                    </div>
                )}
            </div>

            <button
                onClick={handleSave}
                disabled={saving || selectedEntryNos.size > 12}
                className="px-5 py-3 rounded-lg font-bold bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
                {saving ? "保存中..." : "参加者を確定する"}
            </button>
        </div>
    );
}
