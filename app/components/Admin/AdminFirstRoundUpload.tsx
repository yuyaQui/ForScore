import { useState } from "react";
import { Socket } from "socket.io-client";

type Props = {
    socket: Socket | null;
}

export default function AdminFirstRoundUpload({ socket }: Props) {
    // CSV を行×セルに分解したもの。row.split(',') の結果なのでセルは常に文字列
    const [csvData, setCsvData] = useState<string[][]>([]);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target?.result as string;
            const rows = text.split('\n')
                .map(row => row.trim())
                .filter(row => row !== '')
                .map(row => row.split(','));
            setCsvData(rows);
        };
        reader.readAsText(file);
    };
    const handleSaveToDatabase = async () => {
        if (csvData.length === 0) return;

        // APIにCSVデータを送信
        const post = (confirmClearHistory: boolean) =>
            fetch('/api/firstRound', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ players: csvData, confirmClearHistory })
            });

        let res = await post(false);

        // 各ラウンドの進行履歴、または 3rd Round の抽選結果が残っている場合、サーバは409で確認を求めてくる。
        // 名簿を取り込み直すとどちらも無効になるため、了承を得たうえで一緒に削除する。
        if (res.status === 409) {
            const data = await res.json().catch(() => null);
            if (data?.needsConfirmation) {
                if (!window.confirm('進行履歴（Undo 用）と 3rd Round の抽選結果を削除して登録しますか？')) return;
                res = await post(true);
            }
        }

        if (res.ok) {
            // 取り込み後の状態を各画面に配る（2026-10-20）。
            // 3rd Round の進行状態・タイマーを初期値に戻し、空になった抽選結果と新しい選手データを配信する
            const data = await res.json().catch(() => null);
            if (socket) {
                socket.emit('reset_third_round_progress');
                if (data?.courses) socket.emit('broadcast_third_round_courses', data.courses);
                if (data?.allPlayers) socket.emit('broadcast_scores', data.allPlayers);
            }
            alert('登録しました');
            setCsvData([]); // 成功したら画面をクリアする
        } else {
            alert('登録に失敗しました');
        }
    };


    // ↓↓↓ ここからが画面の表示（return）↓↓↓
    // AdminFirstRound.tsx（タイマー画面）と同じデザイン（黒背景・角四角・#2F7BFF枠・#F3FAFF文字）に揃える
    return (
        <div className="flex flex-col gap-[2vh] bg-black border border-[#2F7BFF] rounded-none p-[2vw] shadow-[0_0_30px_rgba(47,123,255,0.25)] w-[90%]">
            <label className="text-[clamp(0.8rem,1vw,1rem)] font-bold text-[#F3FAFF] tracking-widest uppercase">
                1st Round 結果アップロード
            </label>

            {/* ファイル選択ボタン */}
            <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="block w-full text-[clamp(0.75rem,1vw,0.9rem)] text-[#F3FAFF]
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-none file:border file:border-[#2F7BFF]
                    file:text-sm file:font-bold
                    file:bg-[#2F7BFF] file:text-white
                    hover:file:brightness-90
                    cursor-pointer"
            />

            {/* ▼ 読み込んだデータのプレビュー表示 ▼ */}
            {csvData.length > 0 && (
                <div className="mt-[1.5vh]">
                    <p className="text-[clamp(0.65rem,0.9vw,0.75rem)] text-[#7FA8D9] mb-2">プレビュー（{csvData.length}件）</p>
                    <div className="max-h-40 overflow-y-auto border border-[#2F7BFF] rounded-none p-2 bg-black">
                        <table className="w-full text-sm text-left text-[#F3FAFF]">
                            <tbody>
                                {csvData.map((row, i) => (
                                    <tr key={i}>
                                        {row.map((cell, j) => (
                                            <td key={j} className="border-b border-[#2F7BFF]/30 p-1 truncate max-w-[100px]">
                                                {cell}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <button
                        onClick={handleSaveToDatabase}
                        className="w-full mt-4 bg-[#2F7BFF] hover:bg-[#4A8CFF] hover:shadow-[0_0_20px_rgba(47,123,255,0.7)] text-[#F3FAFF] font-bold py-3 rounded-none transition-shadow"
                    >
                        登録する
                    </button>
                </div>
            )}
        </div>
    )
}