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
    return (
        <div className="flex flex-col gap-4 bg-white dark:bg-zinc-800 p-8 rounded-xl shadow-md w-full max-w-md">
            <label className="text-sm font-bold text-zinc-700 dark:text-zinc-300">
                1st Round 結果アップロード
            </label>

            {/* ファイル選択ボタン */}
            <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="block w-full text-sm text-zinc-500
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-lg file:border-0
                    file:text-sm file:font-bold
                    file:bg-blue-100 file:text-blue-700
                    hover:file:bg-blue-200 dark:file:bg-blue-900/50 dark:file:text-blue-300
                    cursor-pointer"
            />

            {/* ▼ 読み込んだデータのプレビュー表示 ▼ */}
            {csvData.length > 0 && (
                <div className="mt-4">
                    <p className="text-xs text-zinc-500 mb-2">プレビュー ({csvData.length}件)</p>
                    <div className="max-h-40 overflow-y-auto border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 bg-zinc-50 dark:bg-zinc-900/50">
                        <table className="w-full text-sm text-left">
                            <tbody>
                                {csvData.map((row, i) => (
                                    <tr key={i}>
                                        {row.map((cell, j) => (
                                            <td key={j} className="border-b border-zinc-200 dark:border-zinc-800 p-1 truncate max-w-[100px]">
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
                        className="w-full mt-4 bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 rounded-lg transition-colors"
                    >
                        データベースに登録する
                    </button>
                </div>
            )}
        </div>
    )
}