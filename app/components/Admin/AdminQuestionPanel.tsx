// 問題パネル（2026-10-22 追加。docs/question-display-design.md 4.1 (b)）。
// 2nd Round・3rd Round・Extra Round Second Step・Semi-Final（サドンデス。2026-10-30）・Final の Admin に置く共通部品。
//   - 次に読む問題（通し番号・問題文・解答・別解）を司会・スタッフが確認する
//   - Main に表示中の問題と、表示する／隠す
//   - 開始番号の入力と、◀ 前の問題 / 次の問題 ▶（番号の手動修正。2026-10-29 から Undo で問題も戻るので、通常は使わない。
//     手で動かすとそのラウンドの操作の記録は消え、それ以前の Undo では問題が戻らなくなる）
// 採点（正解・誤答・スルー）が成功したら、各ラウンドの Admin が finishQuestion() を呼ぶ。
import { Socket } from "socket.io-client";
import { useCallback, useEffect, useState } from "react";
import type { QuestionDisplayState, QuestionRound } from "@/lib/types";
import { DEFAULT_QUESTION_DISPLAY } from "@/lib/types";
import type { PoolQuestion } from "@/lib/questionPool";
import { nextSerial, prevSerial } from "@/lib/questionWrap.js";
import { MANUAL_LABEL_STYLE, STAT_LABEL_STYLE, manualBtnStyle, manualBtnTextStyle, neutralBtnStyle, NEUTRAL_BTN_TEXT } from "./adminCyberStyles";

const JP = '"Noto Sans JP",sans-serif';
const ORB = 'Orbitron, sans-serif';

/** 取り込んだ問題の最初と上限の通し番号（2026-11-11）。読めない・未登録なら null */
export type PoolBounds = { min: number; max: number };

/**
 * 取り込んだ問題の最初と上限の通し番号を読む（GET /api/questionPool の登録状況）。
 * 上限の問題の次は最初に戻す（lib/questionWrap.js）ために使う。画面を開くたびに読み直す
 */
export function usePoolBounds(): PoolBounds | null {
    const [bounds, setBounds] = useState<PoolBounds | null>(null);
    useEffect(() => {
        let cancelled = false;
        fetch('/api/questionPool').then(res => res.json()).then(data => {
            const s = data?.summary;
            if (!cancelled && data?.success && s && Number.isInteger(s.min) && Number.isInteger(s.max)) setBounds({ min: s.min, max: s.max });
        }).catch(() => { /* 読めないときは折り返さない（従来どおり） */ });
        return () => { cancelled = true; };
    }, []);
    return bounds;
}

/** ◀前・次▶ の行き先（上限の次は最初、最初の前は上限。2026-11-11） */
export function cursorMoves(cursor: number | null, bounds: PoolBounds | null): { prev: number | null; next: number | null; wrapsNext: boolean } {
    if (cursor === null) return { prev: null, next: null, wrapsNext: false };
    return { prev: prevSerial(cursor, bounds), next: nextSerial(cursor, bounds), wrapsNext: bounds !== null && cursor >= bounds.max };
}

/** 問題表示の状態を受け取り、1問が終わったことをサーバに伝える関数を返す */
export function useQuestionDisplay(socket: Socket | null, round: QuestionRound) {
    const [state, setState] = useState<QuestionDisplayState>(DEFAULT_QUESTION_DISPLAY);
    useEffect(() => {
        if (!socket) return;
        const handle = (next: QuestionDisplayState) => setState(next);
        socket.on('update_question_display', handle);
        // 接続直後の配信は、この画面が無いうちに届いて失われるので、表示した時点で取り直す
        socket.emit('request_question_sync');
        return () => { socket.off('update_question_display', handle); };
    }, [socket]);

    // 採点（正解・誤答・スルー）が成功した後に呼ぶ。サーバは「次に読む問題」と一致するときだけ受け付け、
    // その問題を Main に表示して番号を1つ進める（開始番号が未設定なら何もしない）。
    // 2026-10-29: scope（どの組・コースの操作か）と scored（得点の Undo 履歴を積んだか）も送り、
    // サーバが操作の記録に積む（Undo で問題も戻すため）
    // 2026-11-11: 取り込んだ問題の最初と上限も送り、上限の問題が終わったら最初に戻す（サーバが判断する）
    const cursor = state.cursors[round];
    const bounds = usePoolBounds();
    const finishQuestion = useCallback((scope: string, scored: boolean) => {
        if (socket) socket.emit('finish_question', { round, serial: cursor, scope, scored, bounds });
    }, [socket, round, cursor, bounds]);

    // 問題と関係しない得点の操作（3rd Round のコース終了、Final の次のセットへ）を記録する（2026-10-29）
    const recordEvent = useCallback((scope: string) => {
        if (socket) socket.emit('record_question_event', { round, scope });
    }, [socket, round]);

    // Undo（2026-10-29）。操作の記録の最後を見て、
    //   スルー → 確認のうえ問題だけ戻す（得点の Undo は呼ばない）
    //   採点 → 得点の Undo（dbUndo）が成功したら問題も戻す
    //   問題と関係しない操作 → 得点の Undo が成功したら記録を1つ消す
    //   記録が無い・組やコースが違う → 得点の Undo だけ（従来どおり）
    // dbUndo は得点の Undo を行い、成功したら true を返す
    // 2026-10-31: 何かを取り消したら true を返す（運営コンソールの操作の記録を1つ戻すため）
    const lastEvent = state.lastEvents?.[round];
    const undoWithQuestion = useCallback(async (scope: string, dbUndo: () => Promise<boolean>): Promise<boolean> => {
        const last = lastEvent && lastEvent.scope === scope ? lastEvent : null;
        if (last?.kind === 'through') {
            if (!window.confirm('直前のスルーを取り消して、問題を1つ戻しますか？（得点は変わりません）')) return false;
            socket?.emit('undo_question_event', { round, scope, kind: 'through' });
            return true;
        }
        const ok = await dbUndo();
        if (ok && last) socket?.emit('undo_question_event', { round, scope, kind: last.kind });
        return ok;
    }, [socket, round, lastEvent]);

    return { state, finishQuestion, recordEvent, undoWithQuestion };
}

/** 通し番号1問ぶんを取得する（Admin 用。別解を含む）。無ければ error。運営コンソール（console/）からも使う */
export function useQuestion(serial: number | null) {
    const [loaded, setLoaded] = useState<{ serial: number; question: PoolQuestion | null; error: string } | null>(null);
    useEffect(() => {
        if (serial === null) return;
        let cancelled = false;
        fetch(`/api/questions?from=${serial}&to=${serial}`).then(res => res.json()).then(data => {
            if (cancelled) return;
            setLoaded(data.success ? { serial, question: data.questions[0], error: '' } : { serial, question: null, error: data.error || '問題を読み込めません' });
        }).catch(() => { if (!cancelled) setLoaded({ serial, question: null, error: '通信に失敗しました' }); });
        return () => { cancelled = true; };
    }, [serial]);
    return serial !== null && loaded && loaded.serial === serial ? loaded : null;
}

function QuestionBox({ label, serial, accent, children }: { label: string; serial: number | null; accent: string; children?: React.ReactNode }) {
    const q = useQuestion(serial);
    return (
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px', background: 'rgba(12,22,40,.75)', borderTop: `3px solid ${accent}` }}>
            <div className="flex items-center justify-between gap-2">
                <span style={STAT_LABEL_STYLE}>{label}</span>
                <span style={{ fontFamily: ORB, fontWeight: 800, fontSize: 14, color: accent }}>{serial === null ? '—' : `No.${serial}`}</span>
            </div>
            {serial === null ? (
                <span style={{ fontFamily: JP, fontSize: 13, color: '#5C7EA6' }}>—</span>
            ) : !q ? (
                <span style={{ fontFamily: JP, fontSize: 13, color: '#5C7EA6' }}>読み込み中...</span>
            ) : q.error ? (
                <span style={{ fontFamily: JP, fontWeight: 700, fontSize: 13, color: '#FFC93C' }}>{q.error}</span>
            ) : q.question && (
                <>
                    <span style={{ fontFamily: JP, fontWeight: 700, fontSize: 14, lineHeight: 1.5, color: '#F3FAFF' }}>{q.question.text}</span>
                    <span style={{ fontFamily: JP, fontWeight: 900, fontSize: 15, color: '#FFE28A' }}>A. {q.question.answer}</span>
                    {q.question.altAnswer && <span style={{ fontFamily: JP, fontSize: 12, color: '#9FB4D6' }}>{q.question.altAnswer}</span>}
                </>
            )}
            {children}
        </div>
    );
}

export function AdminQuestionPanel({ socket, round, state }: { socket: Socket | null; round: QuestionRound; state: QuestionDisplayState }) {
    const cursor = state.cursors[round] ?? null;
    const [startInput, setStartInput] = useState('');
    const setCursor = (serial: number) => { if (socket && serial >= 1) socket.emit('set_question_cursor', { round, serial }); };
    const startValue = Number(startInput.trim().replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
    const startValid = /^\d+$/.test(String(startValue)) && startValue >= 1;

    // Main に出しているのがこのラウンドの問題のときだけ「表示中」として扱う
    const shownHere = state.round === round ? state.serial : null;

    return (
        <div className="flex flex-col gap-[10px] bg-black p-4" style={{ border: '1px solid rgba(79,216,255,.22)' }}>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div style={MANUAL_LABEL_STYLE}>問題（採点すると、その問題を Main に表示して次の問題に進みます）</div>
                <div className="flex items-center gap-2">
                    <input value={startInput} onChange={e => setStartInput(e.target.value)} placeholder="開始番号" inputMode="numeric" aria-label="開始の通し番号"
                        className="w-24 px-2 py-1.5 bg-zinc-900 border border-zinc-600 text-white text-right font-mono" />
                    <button onClick={() => { if (startValid) { setCursor(startValue); setStartInput(''); } }} disabled={!startValid} style={{ ...manualBtnStyle(startValid), padding: '7px 12px', opacity: startValid ? 1 : 0.35 }}>
                        <span style={{ ...manualBtnTextStyle(startValid), fontFamily: JP, fontSize: 12 }}>開始番号にする</span>
                    </button>
                </div>
            </div>
            {cursor === null && (
                <div style={{ fontFamily: JP, fontWeight: 700, fontSize: 13, color: '#FFC93C' }}>
                    次に読む問題の通し番号がまだ決まっていません。開始番号を入力してください（番号は大会全体で共有し、以後はどのラウンドでも続きから進みます）。未設定のままだと Main に問題は出ません。
                </div>
            )}
            <div className="flex flex-wrap gap-[10px]">
                <QuestionBox label="次に読む問題" serial={cursor} accent="#33C6FF">
                    <div className="flex gap-2" style={{ marginTop: 4 }}>
                        <button onClick={() => cursor !== null && setCursor(cursor - 1)} disabled={cursor === null || cursor <= 1} style={{ ...neutralBtnStyle(), padding: '6px 12px', opacity: cursor !== null && cursor > 1 ? 1 : 0.35 }}>
                            <span style={{ ...NEUTRAL_BTN_TEXT, fontSize: 12 }}>◀ 前の問題</span>
                        </button>
                        <button onClick={() => cursor !== null && setCursor(cursor + 1)} disabled={cursor === null} style={{ ...neutralBtnStyle(), padding: '6px 12px', opacity: cursor !== null ? 1 : 0.35 }}>
                            <span style={{ ...NEUTRAL_BTN_TEXT, fontSize: 12 }}>次の問題 ▶</span>
                        </button>
                    </div>
                </QuestionBox>
                <QuestionBox label={state.shown && shownHere !== null ? 'Main に表示中' : 'Main に表示していません'} serial={shownHere} accent={state.shown && shownHere !== null ? '#FFC93C' : '#3A4B63'}>
                    {shownHere !== null && (
                        <div className="flex gap-2" style={{ marginTop: 4 }}>
                            <button onClick={() => socket?.emit('change_question_display', { shown: !state.shown })} style={{ ...manualBtnStyle(!state.shown), padding: '6px 12px' }}>
                                <span style={{ ...manualBtnTextStyle(!state.shown), fontFamily: JP, fontSize: 12 }}>{state.shown ? '隠す' : '表示する'}</span>
                            </button>
                        </div>
                    )}
                </QuestionBox>
            </div>
        </div>
    );
}
