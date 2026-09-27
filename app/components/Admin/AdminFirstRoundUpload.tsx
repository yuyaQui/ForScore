import { useState } from "react";

export default function AdminFirstRoundUpload() {
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
        const res = await fetch('/api/firstRound', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ players: csvData })
        });

        if (res.ok) {
            alert('データベースへの保存が完了しました！');
            setCsvData([]); // 成功したら画面をクリアする
        } else {
            alert('保存に失敗しました...');
        }
    };


    // ↓↓↓ ここからが画面の表示（return）↓↓↓
    // AdminFirstRound.tsx（タイマー画面）と同じデザイン（黒背景・角四角・#A2D7DD枠・#FBFCF6文字）に揃える
    return (
        <div className="flex flex-col gap-[2vh] bg-black border border-[#A2D7DD] rounded-none p-[2vw] shadow-[0_0_30px_rgba(162,215,221,0.25)] w-[90%]">
            <label className="text-[clamp(0.8rem,1vw,1rem)] font-bold text-[#FBFCF6] tracking-widest uppercase">
                1st Round 結果アップロード
            </label>

            {/* ファイル選択ボタン */}
            <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="block w-full text-[clamp(0.75rem,1vw,0.9rem)] text-[#FBFCF6]
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-none file:border file:border-[#A2D7DD]
                    file:text-sm file:font-bold
                    file:bg-[#A2D7DD] file:text-black
                    hover:file:brightness-90
                    cursor-pointer"
            />

            {/* ▼ 読み込んだデータのプレビュー表示 ▼ */}
            {csvData.length > 0 && (
                <div className="mt-[1.5vh]">
                    <p className="text-[clamp(0.65rem,0.9vw,0.75rem)] text-[#A2D7DD] mb-2">プレビュー ({csvData.length}件)</p>
                    <div className="max-h-40 overflow-y-auto border border-[#A2D7DD] rounded-none p-2 bg-black">
                        <table className="w-full text-sm text-left text-[#FBFCF6]">
                            <tbody>
                                {csvData.map((row, i) => (
                                    <tr key={i}>
                                        {row.map((cell, j) => (
                                            <td key={j} className="border-b border-[#A2D7DD]/30 p-1 truncate max-w-[100px]">
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
                        className="w-full mt-4 bg-blue-500 hover:bg-blue-600 hover:shadow-[0_0_20px_rgba(59,130,246,0.7)] text-[#FBFCF6] font-bold py-3 rounded-none transition-shadow"
                    >
                        登録する
                    </button>
                </div>
            )}
        </div>
    )
}