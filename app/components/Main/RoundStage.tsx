// 早押しラウンドの Main 画面の共通の枠（2026-10-22 追加。docs/question-display-design.md 5.1）。
//
// 2nd Round・3rd Round（クイズ・サドンデス）・Extra Round Second Step・Semi-Final（サドンデス。2026-10-30）・Final のクイズ画面で、
// 見出し → 問題欄 → 仕切り線 → 本体（選手カードなど）の位置を全ラウンドでそろえる。
//   - 問題欄は仕切り線の上。問題文 100文字（1行50文字 × 2行）と解答 1行の高さを常に確保する
//     （問題が無いときも空けておき、表示の有無でカードが動かないようにする）
//   - 本体は仕切り線の下の決まった箱（幅 1776 × 高さ BODY_H）に、上端・中央そろえで置く。
//     はみ出すときはラウンド共通の考え方で縮小する（中身の大きさを測って、収まる倍率にする）
import { Socket } from "socket.io-client";
import { useEffect, useState } from "react";
import type { QuestionDisplayState, QuestionRound } from "@/lib/types";
import { DEFAULT_QUESTION_DISPLAY } from "@/lib/types";
import type { PublicPoolQuestion } from "@/lib/questionPool";

const PAD_TOP = 40, PAD_BOTTOM = 32, PAD_X = 72;
/** 見出し（ラウンド名 40px ＋ 副題 50px）の段の高さ */
export const HEADER_H = 108;
const QUESTION_GAP = 14;
/** 問題欄の高さ（問題文 2行 ＋ 解答 1行） */
export const QUESTION_H = 140;
const RULE_GAP = 12, BODY_GAP = 22;
/** 本体の箱の大きさ */
export const BODY_W = 1920 - PAD_X * 2;                                                         // 1776
export const BODY_H = 1080 - PAD_TOP - PAD_BOTTOM - HEADER_H - QUESTION_GAP - QUESTION_H - RULE_GAP - 2 - BODY_GAP;   // 710

const QUESTION_FONT = 34;      // 1行50文字で 1700px（BODY_W に収まる）
const ANSWER_FONT = 38;

const STRIP_CSS = `
@keyframes qsIn { 0% { opacity:0; filter:blur(10px); transform:translateY(14px); } 100% { opacity:1; filter:blur(0); transform:translateY(0); } }
`;

/** 問題表示の状態（update_question_display）を受け取る */
function useQuestionDisplayState(socket: Socket | null): QuestionDisplayState | null {
    const [state, setState] = useState<QuestionDisplayState | null>(null);
    useEffect(() => {
        if (!socket) return;
        const handle = (next: QuestionDisplayState) => setState(next);
        socket.on('update_question_display', handle);
        // 接続直後の配信はこの画面が無いうちに届いて失われるので、表示した時点で取り直す
        socket.emit('request_question_sync');
        return () => { socket.off('update_question_display', handle); };
    }, [socket]);
    return state;
}

/** 仕切り線の上の問題欄。このラウンドの問題を表示中のときだけ中身を出す */
function QuestionStrip({ socket, round }: { socket: Socket | null; round: QuestionRound }) {
    const received = useQuestionDisplayState(socket);
    const state = received ?? DEFAULT_QUESTION_DISPLAY;
    const serial = state.round === round ? state.serial : null;

    // 問題文・解答を通し番号で取得する（Main 用: 別解なし）
    const [loaded, setLoaded] = useState<{ serial: number; question: PublicPoolQuestion } | null>(null);
    useEffect(() => {
        if (serial === null) return;
        let cancelled = false;
        fetch(`/api/questions?from=${serial}&to=${serial}&public=1`).then(res => res.json()).then(data => {
            if (!cancelled && data.success && data.questions[0]) setLoaded({ serial, question: data.questions[0] });
        }).catch(err => console.error('Failed to load question', err));
        return () => { cancelled = true; };
    }, [serial]);

    // 表示する問題が変わった（seq が増えた）のを、この画面を開いている間に見たときだけ現れる演出をする。
    // 開いた時点で表示済みなら、演出せずにそのまま出す
    const [firstSeq, setFirstSeq] = useState<number | null>(null);
    if (firstSeq === null && received) setFirstSeq(received.seq);
    const animate = firstSeq !== null && state.seq > firstSeq;

    const question = loaded && loaded.serial === serial ? loaded.question : null;
    const visible = state.shown && question !== null;
    // 100文字を超える問題文は、2行に収まるよう文字を小さくする
    const textLen = question ? Array.from(question.text).length : 0;
    const qFont = Math.min(QUESTION_FONT, Math.floor((BODY_W * 2) / Math.max(1, textLen)) - 1);

    return (
        <div style={{ marginTop: QUESTION_GAP, height: QUESTION_H, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 4, overflow: 'hidden' }}>
            <style>{STRIP_CSS}</style>
            {visible && question && (
                <div key={`${state.seq}-${question.serial}`} style={{ display: 'flex', flexDirection: 'column', gap: 4, animation: animate ? 'qsIn .6s ease-out both' : undefined }}>
                    <div style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, fontSize: qFont, lineHeight: 1.36, color: '#F3FAFF', maxHeight: qFont * 1.36 * 2, overflow: 'hidden', wordBreak: 'break-all', lineBreak: 'strict' }}>
                        {question.text}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                        <span style={{ fontFamily: 'Orbitron, "Noto Sans JP", sans-serif', fontWeight: 800, fontSize: 26, color: '#FFC93C' }}>A.</span>
                        <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: ANSWER_FONT, lineHeight: 1.2, color: '#FFE28A', textShadow: '0 0 16px rgba(255,201,60,.4)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {question.answer}
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * 本体を、決まった箱（BODY_W × BODY_H）に収まる倍率で縮める（拡大はしない）。上端・中央そろえ。
 * 中身の大きさは各ラウンドが「設計上の大きさ」で渡す（測ると、カードの開扉演出の途中で高さが
 * 変わるたびに倍率が揺れるため）。
 */
function FitBody({ contentW, contentH, children }: { contentW: number; contentH: number; children: React.ReactNode }) {
    const scale = Math.min(1, BODY_W / Math.max(1, contentW), BODY_H / Math.max(1, contentH));
    return (
        <div style={{ marginTop: BODY_GAP, width: BODY_W, height: BODY_H, flexShrink: 0, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
            <div style={{ width: contentW, height: contentH, flexShrink: 0, transform: `scale(${scale})`, transformOrigin: 'top center' }}>
                {children}
            </div>
        </div>
    );
}

/**
 * 早押しラウンドのクイズ画面の枠。
 * header: 見出しの段（高さ HEADER_H に収める）／ ruleColor: 仕切り線の色 ／ children: 本体
 * contentW / contentH: 本体の設計上の大きさ（箱に収まらなければこの比で縮める）
 */
export function RoundStage({ header, ruleColor, socket, round, contentW, contentH, children }: {
    header: React.ReactNode; ruleColor: string; socket: Socket | null; round: QuestionRound;
    contentW: number; contentH: number; children: React.ReactNode;
}) {
    return (
        <div style={{ width: 1920, height: 1080, boxSizing: 'border-box', padding: `${PAD_TOP}px ${PAD_X}px ${PAD_BOTTOM}px`, backgroundColor: '#000000', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', fontFamily: "'Rajdhani','Noto Sans JP',sans-serif" }}>
            <div style={{ height: HEADER_H, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>{header}</div>
            <QuestionStrip socket={socket} round={round} />
            <div style={{ height: 2, marginTop: RULE_GAP, background: ruleColor, boxShadow: `0 0 12px ${ruleColor}73`, flexShrink: 0 }} />
            <FitBody contentW={contentW} contentH={contentH}>{children}</FitBody>
        </div>
    );
}

/**
 * 見出しの2行目右の「残り参加者数 → 残り勝ち抜け枠数」（2nd Round は 2026-10-11、3rd Round は 2026-10-29 のユーザー指示）。
 * 数え方は各ラウンドが決めて渡す
 */
export function RemainingSlots({ active, slots }: { active: number; slots: number }) {
    return (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, fontFamily: 'Orbitron, "Noto Sans JP", sans-serif', fontWeight: 800, fontSize: 44 }}>
            <span style={{ color: '#4FD8FF' }}>{active}</span>
            {/* 矢印は太く・大きく（2026-11-04 ユーザー指示。キャンバスの値） */}
            <span style={{ fontSize: 40, fontWeight: 900, color: '#9FB4D6', WebkitTextStroke: '1.5px #9FB4D6' }}>→</span>
            <span style={{ color: '#FFC93C' }}>{slots}</span>
        </div>
    );
}
