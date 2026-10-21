import { useEffect, useRef, useState } from "react";
import { EXTRA_ROUND_QUESTION_COUNT } from "@/lib/extraRound";
import { parseExtraRoundCsv, type ExtraRoundCsvResult } from "@/lib/extraRoundCsv";
import { ACCENT } from "@/lib/cyberpunkCard";
import { MANUAL_LABEL_STYLE, manualBtnStyle, manualBtnTextStyle, MANUAL_PANEL_BASE } from "./adminCyberStyles";

type Props = {
    /** 問題の登録が終わった（新規取込 or 登録済みの利用）。First Step への移行は呼び出し側で行う */
    onReady: () => void;
};

/**
 * ファイルを文字列にする。Excel が出す CSV は Shift_JIS のことが多いので、
 * UTF-8 として読んで文字化け（置換文字 U+FFFD）が出たら Shift_JIS で読み直す。
 */
async function readCsvText(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const utf8 = new TextDecoder('utf-8').decode(buffer);
    if (!utf8.includes('�')) return utf8;
    try {
        return new TextDecoder('shift_jis').decode(buffer);
    } catch {
        return utf8;
    }
}

// Extra Round の最初の段階（setup）。First Step で使う20問のCSVを取り込む。
// 取り込めたら First Step に進む。登録済みの問題があれば、取り込み直さずに使うこともできる。
export default function AdminExtraRoundUpload({ onReady }: Props) {
    const [result, setResult] = useState<ExtraRoundCsvResult | null>(null);
    const [fileName, setFileName] = useState('');
    const [registeredCount, setRegisteredCount] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        fetch('/api/extraRound/questions').then(res => res.json()).then(data => {
            if (data.success) setRegisteredCount(data.questions.length);
        }).catch(() => setRegisteredCount(null));
    }, []);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setSaveError('');
        setFileName(file.name);
        try {
            setResult(parseExtraRoundCsv(await readCsvText(file)));
        } catch {
            setResult({ questions: [], errors: ['ファイルを読み込めませんでした'] });
        }
        // 同じファイルを選び直しても onChange が走るように、選択をリセットする
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleSave = async () => {
        if (!result || result.errors.length > 0 || result.questions.length === 0) return;
        setSaving(true);
        setSaveError('');
        try {
            const res = await fetch('/api/extraRound/questions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    // API 側で同じ検証をするため、CSV の行と同じ形（番号,問題,解答,別解）で送る
                    questions: result.questions.map(q => [String(q.number), q.text, q.answer, q.altAnswer]),
                }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setRegisteredCount(data.count);
                setResult(null);
                onReady();
            } else {
                setSaveError(
                    Array.isArray(data.details) && data.details.length > 0
                        ? data.details.join(' / ')
                        : (data.error || '保存に失敗しました')
                );
            }
        } catch {
            setSaveError('通信に失敗しました');
        } finally {
            setSaving(false);
        }
    };

    const canUseRegistered = registeredCount === EXTRA_ROUND_QUESTION_COUNT;
    const hasErrors = !!result && result.errors.length > 0;

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div style={MANUAL_LABEL_STYLE}>First Step の問題</div>
                <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, fontSize: 14, color: canUseRegistered ? '#7FE8FF' : '#9FB4D6' }}>
                    {registeredCount === null ? '確認中...' : `登録済み ${registeredCount}問`}
                </span>
            </div>

            <div style={{ ...MANUAL_PANEL_BASE, gap: 14 }}>
                <p style={{ margin: 0, fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, fontSize: 14, color: '#9FB4D6', lineHeight: 1.7 }}>
                    {EXTRA_ROUND_QUESTION_COUNT}問のCSV。列:
                    <b style={{ color: '#DFF7FF' }}> 問題番号 / 問題文 / 模範解答 / 別解・正誤判定基準</b>
                    （4列目は空可）
                </p>
                <div className="flex flex-wrap items-center gap-3">
                    <label style={manualBtnStyle(true)}>
                        <span style={manualBtnTextStyle(true)}>CSVを選択</span>
                        <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFileUpload} style={{ display: 'none' }} />
                    </label>
                    {fileName && (
                        <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontSize: 13, color: '#7FA8D9' }}>{fileName}</span>
                    )}
                </div>
            </div>

            {hasErrors && result && (
                <div className="px-4 py-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300 text-sm font-bold">
                    <div>取り込めません。修正して選び直してください</div>
                    <ul className="mt-1 list-disc pl-5 font-normal">
                        {result.errors.slice(0, 12).map((message, i) => <li key={i}>{message}</li>)}
                        {result.errors.length > 12 && <li>ほか {result.errors.length - 12} 件</li>}
                    </ul>
                </div>
            )}

            {result && !hasErrors && result.questions.length > 0 && (
                <div className="flex flex-col gap-3">
                    <div style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 12, letterSpacing: 3, color: '#5C7EA6' }}>
                        プレビュー（{result.questions.length}問）
                    </div>
                    <div className="max-h-80 overflow-y-auto" style={{ border: '1px solid rgba(79,216,255,.22)', background: 'rgba(12,22,40,.75)' }}>
                        <table className="w-full text-left" style={{ fontFamily: '"Noto Sans JP",sans-serif', fontSize: 13, color: '#DFF7FF' }}>
                            <thead>
                                <tr style={{ color: '#5C7EA6', fontSize: 11, letterSpacing: 2 }}>
                                    <th className="p-2 w-12">No.</th>
                                    <th className="p-2">問題文</th>
                                    <th className="p-2 w-48">模範解答</th>
                                    <th className="p-2 w-56">別解・正誤判定基準</th>
                                </tr>
                            </thead>
                            <tbody>
                                {result.questions.map(q => (
                                    <tr key={q.number} style={{ borderTop: '1px solid rgba(79,216,255,.12)' }}>
                                        <td className="p-2 font-mono" style={{ color: ACCENT }}>{q.number}</td>
                                        <td className="p-2">{q.text}</td>
                                        <td className="p-2" style={{ color: '#FFE28A' }}>{q.answer}</td>
                                        <td className="p-2" style={{ color: '#9FB4D6' }}>{q.altAnswer}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            style={{
                                padding: '14px 32px', background: 'rgba(51,198,255,.14)', border: '2px solid #33C6FF',
                                clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)',
                                boxShadow: '0 0 18px rgba(51,198,255,.3)', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.5 : 1,
                                fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 16, letterSpacing: 2, color: '#DFF7FF',
                            }}
                        >
                            {saving ? '保存中...' : '保存して First Step へ ▶'}
                        </button>
                        <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontSize: 12, color: '#7FA8D9' }}>
                            登録済みの問題を置き換えます
                        </span>
                    </div>
                </div>
            )}

            {saveError && (
                <div className="px-4 py-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300 text-sm font-bold">
                    {saveError}
                </div>
            )}

            {/* 登録済みの問題をそのまま使う。サーバ再起動後など、取り込み直さずに First Step へ戻るため */}
            {canUseRegistered && (
                <div style={{ ...MANUAL_PANEL_BASE, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, fontSize: 14, color: '#9FB4D6' }}>
                        登録済みの{EXTRA_ROUND_QUESTION_COUNT}問で進められます
                    </span>
                    <button onClick={onReady} style={manualBtnStyle(false)}>
                        <span style={manualBtnTextStyle(true)}>登録済みの問題を使う ▶</span>
                    </button>
                </div>
            )}
        </div>
    );
}
