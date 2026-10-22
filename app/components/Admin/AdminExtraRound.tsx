import { Socket } from "socket.io-client";
import { useState, useEffect, useCallback, useRef } from "react";
import type { ExtraRoundState, ExtraRoundQuestion, ExtraRoundStage, Player } from "@/lib/types";
import { DEFAULT_EXTRA_ROUND_STATE } from "@/lib/types";
import {
    FIRST_STEP_SEQUENCE,
    FIRST_STEP_LAST_CURSOR,
    clampCursor,
    getFirstStepItem,
    getFirstStepItemLabel,
    getNextPhaseCursor,
    isPhaseEndAnswer,
    normalizeExtraRoundState,
} from "@/lib/extraRound";
import AdminExtraRoundUpload from "./AdminExtraRoundUpload";
import AdminExtraRoundFirstStep from "./AdminExtraRoundFirstStep";
import AdminExtraRoundEntrants from "./AdminExtraRoundEntrants";
import AdminExtraRoundSecondStep from "./AdminExtraRoundSecondStep";
import { useQuestionDisplay, AdminQuestionPanel } from "./AdminQuestionPanel";
import {
    MANUAL_LABEL_STYLE,
    DANGER_BTN_TEXT,
    NEUTRAL_BTN_TEXT,
    dangerBtnStyle,
    manualBtnStyle,
    manualBtnTextStyle,
    manualPanelStyle,
    neutralBtnStyle,
    primaryButtonStyle,
    secondaryActionStyle,
} from "./adminCyberStyles";

type Props = {
    socket: Socket | null;
}

// 進行ボタンは、状態が変わった直後のこの時間（ms）は押しても無視する。
// 「問題を表示する」を素早く2回押す（ダブルクリック）と、1回目で表示済みになったあと、同じ位置に
// 出てきた「次の問題へ」を2回目が押してしまい、問題を読み上げる前に先へ進む事故になるため。
// 同じ理由で、「次へ」のダブルクリックが次の問題をすぐ表示してしまうのも防ぐ。
// 本番の進行は問題を読み上げる間があるので、この時間で正規の操作を邪魔することはない。
const CLICK_GUARD_MS = 800;

const STAGE_LABELS: Record<ExtraRoundStage, string> = {
    setup: '問題取込',
    firstStep: 'First Step',
    entrantSelect: '進出者選択',
    secondStep: 'Second Step',
};

export default function AdminExtraRound(props: Props) {
    const { socket } = props;

    // 進行状態はサーバが持つ。ここは配信された値を映すだけ。
    // 初期値は配信が届くまでの仮置き（接続直後にサーバから現在値が届く）。
    const [state, setState] = useState<ExtraRoundState>(DEFAULT_EXTRA_ROUND_STATE);

    // 問題文・解答・別解（Admin 用なので別解を含む）
    const [questions, setQuestions] = useState<ExtraRoundQuestion[]>([]);
    const [players, setPlayers] = useState<Player[] | null>(null);
    const [isBusy, setIsBusy] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    // 進行状態（段階・位置・表示済みか）が最後に変わった時刻。進行ボタンの連打よけに使う
    const lastStateChangeAt = useRef(0);
    useEffect(() => {
        lastStateChangeAt.current = Date.now();
    }, [state.stage, state.cursor, state.revealed]);
    // クリック時にだけ呼ぶ（描画中には呼ばない）。直前に状態が変わっていたら何もしない
    const runGuarded = useCallback((action: (() => void) | null) => {
        if (!action) return;
        if (Date.now() - lastStateChangeAt.current < CLICK_GUARD_MS) return;
        action();
    }, []);

    const loadQuestions = useCallback(() => {
        fetch('/api/extraRound/questions').then(res => res.json()).then(data => {
            if (data.success) setQuestions(data.questions);
        }).catch(err => console.error('Failed to load extra round questions', err));
    }, []);

    useEffect(() => {
        fetch('/api/secondRound/loadPlayers').then(res => res.json()).then(data => {
            if (data.success) setPlayers(data.allPlayers);
        }).catch(err => console.error('Failed to load players', err));

        if (socket) {
            const handleStateUpdate = (next: ExtraRoundState) => setState(normalizeExtraRoundState(next));
            const handlePlayersUpdate = (allPlayers: Player[]) => setPlayers(allPlayers);

            socket.on('update_extra_round_state', handleStateUpdate);
            socket.on('update_players', handlePlayersUpdate);

            return () => {
                socket.off('update_extra_round_state', handleStateUpdate);
                socket.off('update_players', handlePlayersUpdate);
            };
        }
    }, [socket]);

    // First Step に入るたびに問題を取り直す（取込直後の最新の内容を確実に映すため）
    const isFirstStep = state.stage === 'firstStep';
    useEffect(() => {
        if (isFirstStep) loadQuestions();
    }, [isFirstStep, loadQuestions]);

    // 進行状態の変更。部分更新できるので、変えたい項目だけを送る。
    // 自分の画面も配信（update_extra_round_state）経由で更新される。
    const changeState = (updates: Partial<ExtraRoundState>) => {
        if (socket) socket.emit('change_extra_round_state', updates);
    };

    // 「問題を表示する」「解答を表示」。いまの位置を添えて送り、サーバ側で位置が一致するときだけ
    // 表示済みにする（別の Admin 画面で先に進んでいたとき、次の問題が出てしまうのを防ぐ）。
    const revealStep = () => {
        if (socket) socket.emit('reveal_extra_round_step', { cursor: state.cursor });
    };

    const entrants = (players ?? []).filter(p => p.extraRoundSecondStep);
    const winner = entrants.find(p => p.extraRoundRank > 0) ?? null;

    // 問題表示（2026-10-22。Second Step のみ）。採点が成功したら、その問題を Main に表示して次の問題に進める
    const { state: questionState, finishQuestion } = useQuestionDisplay(socket, 'extraSecondStep');

    const handleScore = async (playerId: number, action: 'correct' | 'wrong') => {
        setErrorMessage('');
        setIsBusy(true);
        try {
            const res = await fetch('/api/extraRound/secondStep/updateScore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerId, action })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                if (socket) socket.emit('broadcast_scores', data.allPlayers);
                finishQuestion();
            } else {
                setErrorMessage(data.error || '更新に失敗しました');
            }
        } catch (error) {
            console.error('Extra Round Second Step score update failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    const handleUndo = async () => {
        setErrorMessage('');
        setIsBusy(true);
        try {
            const res = await fetch('/api/extraRound/secondStep/undo', { method: 'POST' });
            const data = await res.json();
            if (res.ok && data.success) {
                if (socket) socket.emit('broadcast_scores', data.allPlayers);
            } else {
                setErrorMessage(data.error || 'Undo に失敗しました');
            }
        } catch (error) {
            console.error('Extra Round Second Step undo failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    // Extra Round の結果（extraRoundRank・extraRoundCorrectCount・extraRoundSecondStep）を
    // 全選手ぶんリセットする。テストデータの矛盾を直す、または本番前にやり直すための操作。
    // 進行状態（段階・First Step の位置）は変えない。
    const handleReset = async () => {
        if (!window.confirm('Extra Round の結果をリセットしますか？（元に戻せません）')) return;

        setErrorMessage('');
        setIsBusy(true);
        try {
            const res = await fetch('/api/extraRound/reset', { method: 'POST' });
            const data = await res.json();
            if (res.ok && data.success) {
                if (socket) socket.emit('broadcast_scores', data.allPlayers);
            } else {
                setErrorMessage(data.error || 'リセットに失敗しました');
            }
        } catch (error) {
            console.error('Extra Round reset failed', error);
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    // ---- いま押すべき操作（画面上部の大きなボタン）----
    let statusLabel: string;
    let primaryLabel: string;
    let primaryAction: (() => void) | null = null;
    let secondaryLabel: string | null = null;
    let secondaryAction: (() => void) | null = null;
    // 表示前に出す、押せない「次へ」。押す順番（表示 → 次へ）を見せるためのもの
    let waitingNextLabel: string | null = null;
    let primaryDoneColor: string | undefined;

    if (state.stage === 'setup') {
        statusLabel = 'EXTRA ROUND · 問題取込';
        primaryLabel = '問題CSVを取り込んでください';
    } else if (state.stage === 'firstStep') {
        const atDecision = isPhaseEndAnswer(state.cursor);
        statusLabel = `EXTRA ROUND · FIRST STEP · ${getFirstStepItemLabel(state.cursor)}（${state.cursor + 1} / ${FIRST_STEP_SEQUENCE.length}）`;
        if (!state.revealed) {
            // 中身（問題文 / 解答）をまだ Main に出していない。出すまでは先に進めない
            primaryLabel = getFirstStepItem(state.cursor).view === 'question' ? '問題を表示 ▶' : '解答を表示 ▶';
            primaryAction = revealStep;
            if (!atDecision) waitingNextLabel = `次へ（${getFirstStepItemLabel(state.cursor + 1)}） ▶`;
        } else if (atDecision) {
            // フェーズ最後の解答発表。進出者を決める（途中で1st Stepを終える場合もここ）か、次のフェーズへ
            primaryLabel = 'Second Step 進出者決定 ▶';
            primaryAction = () => changeState({ stage: 'entrantSelect' });
            const nextCursor = getNextPhaseCursor(state.cursor);
            if (nextCursor !== null) {
                secondaryLabel = '次のフェーズへ ▶';
                secondaryAction = () => changeState({ cursor: nextCursor, revealed: false });
            }
        } else {
            primaryLabel = `次へ（${getFirstStepItemLabel(state.cursor + 1)}） ▶`;
            primaryAction = () => changeState({ cursor: clampCursor(state.cursor + 1), revealed: false });
        }
    } else if (state.stage === 'entrantSelect') {
        statusLabel = 'EXTRA ROUND · 進出者選択';
        primaryLabel = '進出者を選んでください';
    } else {
        statusLabel = 'EXTRA ROUND · SECOND STEP';
        if (winner) {
            primaryLabel = 'Extra Round 終了';
            primaryDoneColor = '#FFE28A';
        } else {
            primaryLabel = '進行中...';
        }
    }

    const canGoBack = state.stage === 'firstStep' && state.cursor > 0;

    return (
        <div className="flex flex-col gap-4 bg-white dark:bg-zinc-800 p-6 rounded-xl shadow-md w-full max-w-[1900px]">
            <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 border-b pb-4 border-zinc-200 dark:border-zinc-700">
                Extra Round 管理画面
            </h2>

            {errorMessage && (
                <div className="px-4 py-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300 text-sm font-bold">
                    {errorMessage}
                </div>
            )}

            {/* 進行フロー: 3rd Round の Admin と同じく、いま押すべき操作を大きく出す。
                問題取込 → First Step → 進出者選択 → Second Step の1本道。 */}
            <div className="flex flex-col items-center gap-3 bg-black py-5 rounded-none">
                <div className="text-xs tracking-[0.3em] text-[#5C7EA6] font-mono">
                    {statusLabel}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-4 px-4">
                    {canGoBack && (
                        <button onClick={() => runGuarded(() => changeState({ cursor: clampCursor(state.cursor - 1), revealed: true }))} style={{ ...neutralBtnStyle(), padding: '18px 28px' }}>
                            <span style={{ ...NEUTRAL_BTN_TEXT, fontSize: 16 }}>◀ 戻る</span>
                        </button>
                    )}
                    <button onClick={() => runGuarded(primaryAction)} disabled={!primaryAction || isBusy} style={primaryButtonStyle(!!primaryAction, primaryDoneColor)}>
                        {primaryLabel}
                    </button>
                    {waitingNextLabel && (
                        <button disabled style={{ ...primaryButtonStyle(false), opacity: 0.4, cursor: 'not-allowed' }}>
                            {waitingNextLabel}
                        </button>
                    )}
                    {secondaryLabel && (
                        <button onClick={() => runGuarded(secondaryAction)} disabled={!secondaryAction || isBusy} style={secondaryActionStyle()}>
                            {secondaryLabel}
                        </button>
                    )}
                </div>
            </div>

            {/* 手動操作: 通常運用では触らない退避ハッチ。段階・位置の直接切り替え、
                Undo・結果リセットをここにまとめる。見た目は 2nd / 3rd Round と揃えている。 */}
            <details className="group">
                <summary
                    className="flex cursor-pointer select-none items-center gap-[10px] bg-black px-5 py-4 [&::-webkit-details-marker]:hidden"
                    style={{ listStyle: 'none' }}
                >
                    <span
                        className="inline-block transition-transform duration-150 group-open:rotate-90"
                        style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 15, letterSpacing: 2, color: '#7FA8D9' }}
                    >
                        ▸
                    </span>
                    <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 15, letterSpacing: 3, color: '#7FA8D9' }}>
                        手動操作
                    </span>
                </summary>
                <div className="flex flex-col gap-[22px] bg-black px-5 pb-6 pt-4">
                    <div style={{ height: 1, background: 'rgba(79,216,255,.22)', flexShrink: 0 }} />

                    <div className="flex flex-wrap gap-[18px]">
                        <div style={manualPanelStyle(true, 1.4)}>
                            <div style={MANUAL_LABEL_STYLE}>段階</div>
                            <div className="flex flex-wrap gap-[10px]">
                                {(Object.keys(STAGE_LABELS) as ExtraRoundStage[]).map(stage => (
                                    <button key={stage} onClick={() => changeState({ stage })} style={manualBtnStyle(state.stage === stage)}>
                                        <span style={manualBtnTextStyle(state.stage === stage)}>{STAGE_LABELS[stage]}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div style={manualPanelStyle(state.stage === 'firstStep', 1.4)}>
                            <div style={MANUAL_LABEL_STYLE}>First Step の位置</div>
                            <select
                                value={state.cursor}
                                onChange={e => changeState({ cursor: clampCursor(Number(e.target.value)), revealed: false })}
                                className="px-3 py-2 bg-zinc-900 border border-zinc-600 text-white"
                                style={{ fontFamily: '"Noto Sans JP",sans-serif' }}
                            >
                                {FIRST_STEP_SEQUENCE.map((_, i) => (
                                    <option key={i} value={i}>
                                        {i + 1}. {getFirstStepItemLabel(i)}{isPhaseEndAnswer(i) ? '（進出者決定）' : ''}
                                    </option>
                                ))}
                            </select>
                            <div className="flex flex-wrap gap-[10px]">
                                <button onClick={() => changeState({ cursor: 0, revealed: false })} style={neutralBtnStyle()}>
                                    <span style={NEUTRAL_BTN_TEXT}>最初（問題 1）へ</span>
                                </button>
                                <button onClick={() => changeState({ cursor: FIRST_STEP_LAST_CURSOR, revealed: false })} style={neutralBtnStyle()}>
                                    <span style={NEUTRAL_BTN_TEXT}>最後（解答 20）へ</span>
                                </button>
                            </div>
                        </div>

                        <div style={manualPanelStyle(true, 1.4)}>
                            <div style={MANUAL_LABEL_STYLE}>データ操作</div>
                            <div className="flex flex-wrap items-center gap-[10px]">
                                <button onClick={handleUndo} disabled={isBusy || state.stage !== 'secondStep'} style={{ ...dangerBtnStyle(), opacity: state.stage === 'secondStep' ? 1 : 0.35 }}>
                                    <span style={DANGER_BTN_TEXT}>Undo</span>
                                </button>
                                <button onClick={handleReset} disabled={isBusy} style={dangerBtnStyle()}>
                                    <span style={DANGER_BTN_TEXT}>Extra Round の結果をリセット</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-[10px]">
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FF3B5C', boxShadow: '0 0 8px rgba(255,59,92,.7)' }} />
                        <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, fontSize: 13, letterSpacing: 1, color: '#5C7EA6' }}>
                            通常は閉じたまま。進行は上のボタンで完結します
                        </span>
                    </div>
                </div>
            </details>

            <hr className="border-zinc-200 dark:border-zinc-700" />

            <div className="flex flex-col gap-5 bg-black p-[2vw]" style={{ border: '1px solid rgba(79,216,255,.22)' }}>
                {state.stage === 'setup' && (
                    <AdminExtraRoundUpload
                        onReady={() => {
                            loadQuestions();
                            changeState({ stage: 'firstStep', cursor: 0, revealed: false });
                        }}
                    />
                )}

                {state.stage === 'firstStep' && (
                    <AdminExtraRoundFirstStep cursor={state.cursor} revealed={state.revealed} questions={questions} />
                )}

                {state.stage === 'entrantSelect' && (
                    players === null ? (
                        <div className="py-10 text-center" style={{ color: '#5C7EA6' }}>読み込み中...</div>
                    ) : (
                        <AdminExtraRoundEntrants
                            socket={socket}
                            players={players}
                            onConfirmed={() => changeState({ stage: 'secondStep' })}
                        />
                    )
                )}

                {state.stage === 'secondStep' && (
                    <>
                        <AdminExtraRoundSecondStep entrants={entrants} onScore={handleScore} busy={isBusy} />
                        {/* スルー（誰も解答しなかった）: スコアは変えず、その問題を Main に表示して次の問題へ（2026-10-22） */}
                        <button onClick={finishQuestion} style={{ boxSizing: 'border-box', padding: '12px 0', background: 'rgba(127,216,255,.10)', border: '1.5px solid #7FE8FF', clipPath: 'polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)', cursor: 'pointer' }}>
                            <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 16, letterSpacing: 1, color: '#DFF7FF' }}>スルー</span>
                        </button>
                        <AdminQuestionPanel socket={socket} round="extraSecondStep" state={questionState} />
                    </>
                )}
            </div>
        </div>
    );
}
