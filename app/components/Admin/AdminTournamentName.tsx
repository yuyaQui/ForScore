// 大会準備: 大会名の入力（2026-11-02 追加）。
// 保存すると DB（TournamentState.tournamentName）に入り、Admin 左上に表示される。
// 保存後は tournament_state_changed を送り、開いている他の Admin も読み直す（roundProgressContext）。
import { Socket } from "socket.io-client";
import { useState } from "react";
import { TOURNAMENT_NAME_MAX, countNameChars, validateTournamentName } from "@/lib/tournamentName";
import { useRoundProgress } from "./roundProgressContext";
import { MANUAL_LABEL_STYLE, MANUAL_PANEL_BASE, manualBtnStyle, manualBtnTextStyle } from "./adminCyberStyles";

const JP = '"Noto Sans JP",sans-serif';

export default function AdminTournamentName({ socket }: { socket: Socket | null }) {
    const progress = useRoundProgress();
    const saved = progress?.tournamentName ?? '';
    // 入力中の大会名。保存済みの値が変わったら（他の Admin で保存されたときも）入力欄を合わせる
    const [input, setInput] = useState(saved);
    // プルダウンが開いているか（2026-11-04）
    const [open, setOpen] = useState(false);
    const [savedSeen, setSavedSeen] = useState(saved);
    if (savedSeen !== saved) {
        setSavedSeen(saved);
        setInput(saved);
    }
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

    const check = validateTournamentName(input);
    const dirty = check.ok ? check.value !== saved : true;
    const canSave = check.ok && dirty && !busy;

    const handleSave = async () => {
        if (!check.ok) return;
        setBusy(true);
        setMessage(null);
        try {
            const res = await fetch('/api/tournamentState', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tournamentName: check.value }),
            });
            const data = await res.json();
            if (data.success) {
                // 開いている Admin（自分も含む）に読み直させる
                socket?.emit('tournament_state_changed');
                setMessage({ text: check.value === '' ? '大会名を消しました' : '保存しました', error: false });
            } else {
                setMessage({ text: data.error || '大会名を保存できません', error: true });
            }
        } catch {
            setMessage({ text: '通信に失敗しました', error: true });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex flex-col gap-4 bg-black p-6 w-full max-w-5xl" style={{ border: '1px solid rgba(79,216,255,.22)' }}>
            {/* 押すと開くプルダウン（2026-11-04 ユーザー指示）。説明文は出さない */}
            <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
                className="flex flex-wrap items-center justify-between gap-3 w-full" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }}>
                <div style={MANUAL_LABEL_STYLE}>{open ? '▾' : '▸'} 大会名</div>
                <span style={{ fontFamily: JP, fontWeight: 700, fontSize: 14, color: saved ? '#7FE8FF' : '#FFC93C' }}>{saved ? `✓ ${saved}` : '未設定'}</span>
            </button>
            {open && (<>
            <div style={{ ...MANUAL_PANEL_BASE, gap: 12 }}>
                <div className="flex flex-wrap items-center gap-3">
                    <input id="tournament-name" type="text" value={input} onChange={e => { setInput(e.target.value); setMessage(null); }}
                        onKeyDown={e => { if (e.key === 'Enter' && canSave) void handleSave(); }}
                        placeholder="例: abc Fortior" aria-label="大会名"
                        className="px-3 py-2 bg-zinc-900 border text-white"
                        style={{ flex: '1 1 320px', minWidth: 0, fontFamily: JP, fontSize: 16, borderColor: check.ok ? (dirty ? '#33C6FF' : '#52525b') : '#FF3B5C' }} />
                    <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 12, color: check.ok ? '#5C7EA6' : '#FF3B5C', whiteSpace: 'nowrap' }}>
                        {countNameChars(input.trim())}/{TOURNAMENT_NAME_MAX}
                    </span>
                    <button onClick={() => { void handleSave(); }} disabled={!canSave} style={{ ...manualBtnStyle(canSave), opacity: canSave ? 1 : 0.35 }}>
                        <span style={{ ...manualBtnTextStyle(canSave), fontFamily: JP }}>{busy ? '保存中…' : '保存'}</span>
                    </button>
                </div>
                {!check.ok && <div style={{ fontFamily: JP, fontWeight: 700, fontSize: 13, color: '#FF6B85' }}>{check.error}</div>}
            </div>
            {message && <div style={{ fontFamily: JP, fontWeight: 700, fontSize: 14, color: message.error ? '#FF6B85' : '#7FE8FF' }}>{message.text}</div>}
            </>)}
        </div>
    );
}
