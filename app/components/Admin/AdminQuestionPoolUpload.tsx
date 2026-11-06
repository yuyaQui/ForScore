// 大会共通の問題データ（通し番号つき）の取り込み（2026-10-22 追加。docs/question-display-design.md 4.1 (a)）。
// 大会準備の Admin に置く。大会前に一度だけ使う想定。取り込みは全件入れ替え。
// 2026-11-05: 運営コンソールの面（console/）の見た目に載せ替え。取り込みの処理（API・検証・入れ替えの確認）は同じ。
//   変えたのは次の点: 押すと開くプルダウンはやめて常に開いている／登録は同時に1つだけ（useSingleFlight）／結果は画面の上の通知（notify）／
//   プレビューは作業面の残りいっぱいに出す。
import { useEffect, useRef, useState } from "react";
import { parseQuestionPoolCsv, type PoolQuestion, type QuestionPoolSummary } from "@/lib/questionPool";
import { notify, errorText } from "@/lib/adminNotice";
import { readCsvText } from "./AdminExtraRoundUpload";
import { useSingleFlight } from "../useSingleFlight";
import styles from "./console/console.module.css";

function summaryText(s: QuestionPoolSummary | null): string {
    if (!s) return '確認中...';
    if (s.count === 0) return '未登録';
    return `登録済み ${s.count}問（No.${s.min}〜${s.max}${s.missing.length > 0 ? `・欠番あり: ${s.missing.join(', ')}` : ''}）`;
}

export default function AdminQuestionPoolUpload() {
    const [summary, setSummary] = useState<QuestionPoolSummary | null>(null);
    const [csvText, setCsvText] = useState('');
    const [fileName, setFileName] = useState('');
    const [preview, setPreview] = useState<{ questions: PoolQuestion[]; errors: string[] } | null>(null);
    const flight = useSingleFlight();
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 登録状況を読む
    useEffect(() => {
        fetch('/api/questionPool').then(res => res.json()).then(data => {
            if (data.success) setSummary(data.summary);
            else notify(errorText(data.error, '登録状況を読み込めません'), 'error');   // migrate 前ならやることを表示する
        }).catch(() => notify('登録状況を読み込めません', 'error'));
    }, []);

    // CSV を選んだら画面で先に検証してプレビューを出す（API でも同じ検証をする）
    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const text = await readCsvText(file);
            setCsvText(text);
            setFileName(file.name);
            setPreview(parseQuestionPoolCsv(text));
        } catch {
            setPreview({ questions: [], errors: ['ファイルを読み込めませんでした'] });
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleSave = () => flight.run(async () => {
        if (!preview || preview.errors.length > 0 || preview.questions.length === 0) return;
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
                setFileName('');
                notify('問題データを登録しました');
            } else {
                notify(Array.isArray(data.details) && data.details.length > 0 ? data.details.slice(0, 5).join(' / ') : errorText(data.error, '登録に失敗しました'), 'error');
            }
        } catch (e) {
            notify(errorText(e, '登録に失敗しました。通信を確かめてください'), 'error');
        }
    });

    const hasErrors = !!preview && preview.errors.length > 0;
    const canSave = !!preview && !hasErrors && preview.questions.length > 0 && !flight.pending;

    return (
        <section className={styles.pnlTall} aria-label="問題データ">
            <div className={styles.pnlHead}>
                <span className={styles.pnlTitle}>問題データ</span>
                <span className={summary && summary.count > 0 ? styles.pnlOk : styles.pnlWarn}>{summaryText(summary)}</span>
            </div>
            <div className={styles.pnlRow}>
                <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFile} style={{ display: 'none' }} aria-label="問題データの CSV" />
                <button type="button" className={preview ? styles.btn : styles.btnOn} onClick={() => fileInputRef.current?.click()} disabled={flight.pending}>
                    {preview ? 'CSV を選び直す' : 'CSV を選ぶ'}
                </button>
                <button type="button" className={canSave ? styles.btnOn : styles.btn} onClick={() => { void handleSave(); }} disabled={!canSave}>
                    {flight.pending ? '登録中...' : '登録'}
                </button>
                {fileName && <span className={styles.pnlCount}>{fileName}</span>}
            </div>

            {hasErrors && preview && (
                <div className={styles.bannerError} role="alert">
                    <div>取り込めません。修正して選び直してください</div>
                    {preview.errors.slice(0, 6).map((m, i) => <div key={i} style={{ fontWeight: 500 }}>・{m}</div>)}
                    {preview.errors.length > 6 && <div style={{ fontWeight: 500 }}>ほか {preview.errors.length - 6} 件</div>}
                </div>
            )}

            {preview && !hasErrors && preview.questions.length > 0 ? (
                <>
                    <div className={styles.hint}>プレビュー（{preview.questions.length}問・No.{preview.questions[0].serial}〜{preview.questions[preview.questions.length - 1].serial}）</div>
                    <div className={styles.scrollBox}>
                        <table className={styles.csvTable}>
                            <thead><tr><th style={{ width: 52 }}>No.</th><th>問題文</th><th style={{ width: 140 }}>解答</th><th style={{ width: 160 }}>別解・正誤判定基準</th></tr></thead>
                            <tbody>
                                {preview.questions.map(q => (
                                    <tr key={q.serial}><td>{q.serial}</td><td>{q.text}</td><td>{q.answer}</td><td>{q.altAnswer}</td></tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            ) : !hasErrors && (
                <div className={styles.hint}>大会前に一度だけ取り込みます。登録済みの場合は、登録時に入れ替えの確認が出ます。</div>
            )}
        </section>
    );
}
