// 大会共通の問題データ（通し番号つき）の取り込み（2026-10-22 追加。docs/question-display-design.md 4.1 (a)）。
// 待機画面の Admin に置く。大会前に一度だけ使う想定。取り込みは全件入れ替え。
import { useEffect, useRef, useState } from "react";
import { parseQuestionPoolCsv, type PoolQuestion, type QuestionPoolSummary } from "@/lib/questionPool";
import { ACCENT } from "@/lib/cyberpunkCard";
import { MANUAL_LABEL_STYLE, MANUAL_PANEL_BASE, manualBtnStyle, manualBtnTextStyle } from "./adminCyberStyles";
import { readCsvText } from "./AdminExtraRoundUpload";

const JP = '"Noto Sans JP",sans-serif';

function summaryText(s: QuestionPoolSummary | null): string {
    if (!s) return '確認中...';
    if (s.count === 0) return '未登録';
    return `登録済み ${s.count}問（No.${s.min}〜${s.max}${s.missing.length > 0 ? `・欠番あり: ${s.missing.join(', ')}` : ''}）`;
}

export default function AdminQuestionPoolUpload() {
    const [summary, setSummary] = useState<QuestionPoolSummary | null>(null);
    // プルダウンが開いているか（2026-11-04）
    const [open, setOpen] = useState(false);
    const [csvText, setCsvText] = useState('');
    const [preview, setPreview] = useState<{ questions: PoolQuestion[]; errors: string[] } | null>(null);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 登録状況を読む
    useEffect(() => {
        fetch('/api/questionPool').then(res => res.json()).then(data => {
            if (data.success) setSummary(data.summary);
            else setMessage(data.error || '登録状況を読み込めません');   // migrate 前ならやることを表示する
        }).catch(() => setMessage('登録状況を読み込めません'));
    }, []);

    // CSV を選んだら画面で先に検証してプレビューを出す（API でも同じ検証をする）
    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setMessage('');
        try {
            const text = await readCsvText(file);
            setCsvText(text);
            setPreview(parseQuestionPoolCsv(text));
        } catch {
            setPreview({ questions: [], errors: ['ファイルを読み込めませんでした'] });
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleSave = async () => {
        if (!preview || preview.errors.length > 0 || preview.questions.length === 0) return;
        setSaving(true);
        setMessage('');
        const post = (confirmReplace: boolean) => fetch('/api/questionPool', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ csvText, confirmReplace }),
        });
        try {
            let res = await post(false);
            // 登録済みの問題データがあるときは、入れ替えてよいか確認してから送り直す
            if (res.status === 409) {
                const data = await res.json().catch(() => null);
                if (!data?.needsConfirmation || !window.confirm(`登録済みの問題データ（${data.existing}問）を、この CSV の内容に入れ替えますか？`)) return;
                res = await post(true);
            }
            const data = await res.json();
            if (res.ok && data.success) {
                setSummary(data.summary);
                setPreview(null);
                setMessage('登録しました');
            } else {
                setMessage(Array.isArray(data.details) && data.details.length > 0 ? data.details.slice(0, 5).join(' / ') : (data.error || '登録に失敗しました'));
            }
        } catch {
            setMessage('通信に失敗しました');
        } finally {
            setSaving(false);
        }
    };

    const hasErrors = !!preview && preview.errors.length > 0;
    const canSave = !!preview && !hasErrors && preview.questions.length > 0 && !saving;

    return (
        <div className="flex flex-col gap-4 bg-black p-6 w-full max-w-5xl" style={{ border: '1px solid rgba(79,216,255,.22)' }}>
            {/* 押すと開くプルダウン（2026-11-04 ユーザー指示）。列の説明・ファイル名は出さない */}
            <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
                className="flex flex-wrap items-center justify-between gap-3 w-full" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }}>
                <div style={MANUAL_LABEL_STYLE}>{open ? '▾' : '▸'} 問題データ</div>
                <span style={{ fontFamily: JP, fontWeight: 700, fontSize: 14, color: summary && summary.count > 0 ? '#7FE8FF' : '#FFC93C' }}>{summaryText(summary)}</span>
            </button>
            {open && (<>
            <div style={{ ...MANUAL_PANEL_BASE, gap: 12 }}>
                <div className="flex flex-wrap items-center gap-3">
                    <label style={manualBtnStyle(true)}>
                        <span style={manualBtnTextStyle(true)}>ファイルを選択</span>
                        <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFile} style={{ display: 'none' }} />
                    </label>
                    <button onClick={() => { void handleSave(); }} disabled={!canSave} style={{ ...manualBtnStyle(canSave), opacity: canSave ? 1 : 0.35 }}>
                        <span style={manualBtnTextStyle(canSave)}>{saving ? '登録中...' : '登録'}</span>
                    </button>
                </div>
            </div>

            {message && <div style={{ fontFamily: JP, fontWeight: 700, fontSize: 14, color: message === '登録しました' ? '#7FE8FF' : '#FF6B85' }}>{message}</div>}

            {hasErrors && preview && (
                <div style={{ padding: '12px 16px', border: '1px solid rgba(255,59,92,.5)', background: 'rgba(255,59,92,.08)', fontFamily: JP, fontSize: 13, color: '#FFD0D8' }}>
                    <div style={{ fontWeight: 700 }}>取り込めません。修正して選び直してください</div>
                    <ul className="mt-1 list-disc pl-5">
                        {preview.errors.slice(0, 12).map((m, i) => <li key={i}>{m}</li>)}
                        {preview.errors.length > 12 && <li>ほか {preview.errors.length - 12} 件</li>}
                    </ul>
                </div>
            )}

            {preview && !hasErrors && preview.questions.length > 0 && (
                <div className="flex flex-col gap-2">
                    <div style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 12, letterSpacing: 3, color: '#5C7EA6' }}>
                        プレビュー（{preview.questions.length}問・No.{preview.questions[0].serial}〜{preview.questions[preview.questions.length - 1].serial}）
                    </div>
                    <div className="max-h-80 overflow-y-auto" style={{ border: '1px solid rgba(79,216,255,.22)', background: 'rgba(12,22,40,.75)' }}>
                        <table className="w-full text-left" style={{ fontFamily: JP, fontSize: 13, color: '#DFF7FF' }}>
                            <thead>
                                <tr style={{ color: '#5C7EA6', fontSize: 11, letterSpacing: 2 }}>
                                    <th className="p-2 w-14">No.</th><th className="p-2">問題文</th><th className="p-2 w-48">解答</th><th className="p-2 w-56">別解・正誤判定基準</th>
                                </tr>
                            </thead>
                            <tbody>
                                {preview.questions.map(q => (
                                    <tr key={q.serial} style={{ borderTop: '1px solid rgba(79,216,255,.12)' }}>
                                        <td className="p-2 font-mono" style={{ color: ACCENT }}>{q.serial}</td>
                                        <td className="p-2">{q.text}</td>
                                        <td className="p-2" style={{ color: '#FFE28A' }}>{q.answer}</td>
                                        <td className="p-2" style={{ color: '#9FB4D6' }}>{q.altAnswer}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            </>)}
        </div>
    );
}
