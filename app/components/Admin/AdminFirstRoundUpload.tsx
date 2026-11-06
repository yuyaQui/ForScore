// 1st Round の結果（選手名簿）の取り込み画面。
// 2026-11-05: 運営コンソール（console/）に載せ替え。流れは「CSV を選ぶ → 内容を確かめる → 登録する ▶ → 2nd Round へ ▶」。
// 登録の API（POST /api/firstRound）と、全ラウンドの進行を初期値に戻す配信は載せ替え前と同じ。変えたのは次の点:
//   ・登録前に CSV の中身を確かめる（見出し行の読み飛ばし・列の不足・数字でない順位/番号・順位の重複）。誤りがあれば登録できない
//     （以前は確かめず、数字でない行があるとサーバが 500 を返して「登録に失敗しました」だけが出ていた）
//   ・登録は同時に1つだけ（useSingleFlight）。応答待ちの押し直しで二重に取り込まない
//   ・結果は alert ではなく画面の上の通知（notify）で知らせる。何名取り込んだかも出す
//   ・登録済みなら「2nd Round へ ▶」を出す（進行ボタンは上のバーの1つだけ）
// 全ラウンドの結果を消す取り込みなので、サーバが 409 で確認を求めたときの確認ダイアログは従来どおり出す。
import { useState, useRef } from "react";
import { Socket } from "socket.io-client";
import { broadcastAfterReset, useRoundProgress, nextRoundPrimary } from "./roundProgressContext";
import { ConsoleFrame, WorkHead, MetaItem } from "./console/ConsoleFrame";
import { SideLog } from "./console/SideLog";
import { useActionLog } from "./console/useActionLog";
import styles from "./console/console.module.css";
import { useMainCover } from "../useMainCover";
import { coverStartPrimary, CoverButtons } from "./MainCoverControls";
import { describeCover } from "@/lib/mainCover";
import { useSingleFlight } from "../useSingleFlight";
import { notify, errorText } from "@/lib/adminNotice";

type Props = {
    socket: Socket | null;
}

export type CsvCheck = {
    rows: string[][];
    /** 見出し行として読み飛ばした行があるか */
    skippedHeader: boolean;
    /** 行ごとの誤り（行番号は CSV の行。見出しを含む） */
    problems: { line: number; text: string }[];
};

/** CSV の文字列を、登録できる形（順位, 番号, 学校, 学年, 氏名）の行にして確かめる */
export function parseRosterCsv(raw: string): CsvCheck {
    const text = raw.replace(/^﻿/, '');
    const lines = text.split(/\r?\n/).map((l, i) => ({ line: i + 1, body: l.trim() })).filter(l => l.body !== '');
    const cells = lines.map(l => ({ line: l.line, cells: l.body.split(',').map(c => c.trim().replace(/^"(.*)"$/, '$1')) }));
    // 1行目の順位が数字でなければ見出し行とみなして読み飛ばす
    const skippedHeader = cells.length > 0 && !/^\d+$/.test(cells[0].cells[0] ?? '');
    const body = skippedHeader ? cells.slice(1) : cells;
    const problems: { line: number; text: string }[] = [];
    const seenRank = new Map<string, number>();
    for (const r of body) {
        const [rank, entry, school, grade, name] = r.cells;
        if (r.cells.length < 5) problems.push({ line: r.line, text: `列が足りません（${r.cells.length}列。順位・番号・学校・学年・氏名の5列が必要）` });
        else if (!/^\d+$/.test(rank)) problems.push({ line: r.line, text: `順位が数字ではありません（${rank}）` });
        else if (!/^\d+$/.test(entry)) problems.push({ line: r.line, text: `エントリー番号が数字ではありません（${entry}）` });
        else if (!name) problems.push({ line: r.line, text: '氏名が空です' });
        else if (seenRank.has(rank)) problems.push({ line: r.line, text: `順位 ${rank} が ${seenRank.get(rank)} 行目と重複しています` });
        if (/^\d+$/.test(rank ?? '') && !seenRank.has(rank)) seenRank.set(rank, r.line);
        void school; void grade;
    }
    return { rows: body.map(r => r.cells), skippedHeader, problems };
}

export default function AdminFirstRoundUpload({ socket }: Props) {
    const progress = useRoundProgress();
    const [csv, setCsv] = useState<CsvCheck | null>(null);
    const [fileName, setFileName] = useState('');
    const [cover, setCover, coverControls] = useMainCover(socket);
    const flight = useSingleFlight();
    const actionLog = useActionLog();
    const inputRef = useRef<HTMLInputElement>(null);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            setCsv(parseRosterCsv(String(event.target?.result ?? '')));
            setFileName(file.name);
        };
        reader.onerror = () => notify('ファイルを読み込めませんでした。もう一度選んでください', 'error');
        reader.readAsText(file);
        e.target.value = '';   // 同じファイルを選び直しても読み込めるように
    };

    const valid = csv !== null && csv.rows.length > 0 && csv.problems.length === 0;

    const handleSaveToDatabase = () => flight.run(async () => {
        if (!csv || !valid) return;
        try {
            const post = (confirmClearHistory: boolean) =>
                fetch('/api/firstRound', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ players: csv.rows, confirmClearHistory })
                });

            let res = await post(false);

            // 各ラウンドの進行履歴・結果、または 3rd Round の抽選結果が残っている場合、サーバは409で確認を求めてくる。
            // 名簿を取り込み直すとどれも無効になるため、了承を得たうえで一緒に削除する。
            if (res.status === 409) {
                const data = await res.json().catch(() => null);
                if (data?.needsConfirmation) {
                    if (!window.confirm('全ラウンドの結果・進行履歴（Undo 用）・3rd Round の抽選結果・二つ名と写真を削除して登録しますか？')) return;
                    res = await post(true);
                }
            }

            if (res.ok) {
                // 取り込み後の状態を各画面に配る。新しい選手データと空になった抽選結果を配信し、
                // 全ラウンドの進行状態・タイマーを初期値に戻す（reset_round_progress { from: 'all' }）
                const data = await res.json().catch(() => null);
                broadcastAfterReset(socket, 'all', data ?? {});
                notify(`登録しました（${data?.count ?? csv.rows.length}名）`);
                actionLog.add({ who: '', what: `名簿を登録（${data?.count ?? csv.rows.length}名）`, tone: 'ok', scope: 'upload' });
                setCsv(null);
                setFileName('');
            } else {
                const data = await res.json().catch(() => null);
                notify(errorText(data?.error, '登録に失敗しました'), 'error');
            }
        } catch (e) {
            notify(errorText(e, '登録に失敗しました。通信を確かめてください'), 'error');
        }
    });

    const registered = progress?.statuses.firstRound.complete ? progress.statuses.firstRound.detail : null;

    // 次の操作（1本道）
    let primaryLabel: string;
    let primaryAction: (() => void) | null = null;
    const coverStart = coverStartPrimary(cover, setCover);
    if (coverStart) {
        primaryLabel = coverStart.label;
        primaryAction = coverStart.action;
    } else if (csv !== null) {
        if (valid) { primaryLabel = `${csv.rows.length}名を登録する ▶`; primaryAction = handleSaveToDatabase; }
        else primaryLabel = csv.rows.length === 0 ? 'CSV に選手がいません' : `CSV に誤りがあります（${csv.problems.length}件）`;
    } else {
        ({ label: primaryLabel, action: primaryAction } = nextRoundPrimary(socket, progress, 'firstRound'));
        if (!registered) primaryLabel = 'CSV を選んでください';
    }
    if (flight.pending) primaryAction = null;

    const shown = csv?.rows.slice(0, 200) ?? [];
    const badLines = new Set(csv?.problems.map(p => p.line) ?? []);

    return (
        <ConsoleFrame
            onAir="1st Round　集計結果"
            onAirDetail={cover.kind !== 'none' ? describeCover(cover) : '名簿の取り込み'}
            barExtra={<>
                <button type="button" className={styles.btn} onClick={() => socket?.emit('change_mode', '1stRound')}>← タイマーへ</button>
                <CoverButtons cover={cover} setCover={setCover} forceRelease={coverControls.forceRelease} className={styles.btn} />
            </>}
            undo={null}
            next={{ label: primaryLabel, onClick: primaryAction }}
            side={<SideLog log={actionLog.entries} empty="この画面で行った取り込みがここに並びます" />}
        >
            <WorkHead
                meta={<>
                    <MetaItem label="登録済み " value={registered ?? '未登録'} />
                    {csv && <MetaItem label="読み込み " value={`${csv.rows.length}名`} />}
                </>}
                tools={<>
                    <input ref={inputRef} type="file" accept=".csv" onChange={handleFileUpload} style={{ display: 'none' }} aria-label="CSV ファイル" />
                    <button type="button" className={csv ? styles.btn : styles.btnOn} onClick={() => inputRef.current?.click()} disabled={flight.pending}>
                        {csv ? 'CSV を選び直す' : 'CSV を選ぶ'}
                    </button>
                </>}
            />
            {csv === null ? (
                <div className={styles.empty}>
                    <div style={{ textAlign: 'center', lineHeight: 1.9 }}>
                        1st Round の集計結果（CSV）を選んでください。<br />
                        <span className={styles.hint}>列は 順位, エントリー番号, 学校, 学年, 氏名。1行目が見出しなら読み飛ばします。</span>
                        {registered && <><br /><span className={styles.hint}>すでに {registered} です。選び直して登録すると、全ラウンドの結果が消えて入れ替わります（登録前に確認が出ます）。</span></>}
                    </div>
                </div>
            ) : (
                <>
                    <div className={styles.hint}>
                        {fileName}　{csv.rows.length}名{csv.skippedHeader ? '（1行目は見出しとして読み飛ばしました）' : ''}
                    </div>
                    {csv.problems.length > 0 && (
                        <div className={styles.bannerError} role="alert">
                            {csv.problems.slice(0, 3).map(p => <div key={p.line}>{p.line} 行目: {p.text}</div>)}
                            {csv.problems.length > 3 && <div>ほか {csv.problems.length - 3} 件</div>}
                        </div>
                    )}
                    <div className={styles.scrollBox}>
                        <table className={styles.csvTable}>
                            <thead><tr><th>順位</th><th>番号</th><th>学校</th><th>学年</th><th>氏名</th></tr></thead>
                            <tbody>
                                {shown.map((r, i) => (
                                    <tr key={i} className={badLines.has(i + 1 + (csv.skippedHeader ? 1 : 0)) ? styles.csvBad : undefined}>
                                        {[0, 1, 2, 3, 4].map(j => <td key={j}>{r[j] ?? ''}</td>)}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {csv.rows.length > shown.length && <div className={styles.hint} style={{ padding: 8 }}>先頭 {shown.length} 名を表示しています（登録は全 {csv.rows.length} 名）</div>}
                    </div>
                </>
            )}
        </ConsoleFrame>
    );
}
