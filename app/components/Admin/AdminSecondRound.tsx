import { Socket } from "socket.io-client";
import { useState, useEffect } from "react";
import type { CSSProperties } from "react";
import type { Player, SecondRoundState } from "@/lib/types";
import { DEFAULT_SECOND_ROUND_STATE } from "@/lib/types";
import { toOrdinal } from "@/lib/ordinal";
import { TURN_OVER_STEP_LABELS, getTurnOverStepSlice, getRunnerUps, RUNNER_UP_RANK } from "@/lib/secondRound";
import { ACCENT, tierOf, fitFontSizeToWidth } from "@/lib/cyberpunkCard";
import { useQuestionDisplay, AdminQuestionPanel } from "./AdminQuestionPanel";
import { useRoundProgress, nextRoundPrimary, blockUndoIfLaterStarted, cascadeNotice, broadcastAfterReset } from "./roundProgressContext";

type Props = {
    socket: Socket | null;
}

// 「5○2×」ルール: 5ポイントで勝ち抜け（ポイントバーの満タン基準にも使う）
const CLEAR_POINT = 5;

// 手動操作パネル: Cowork Design アーティファクト(AdminManual.dc.html、
// ユーザーとのコメントレビューで確定した版)の見た目をそのまま移植したスタイル。
const MANUAL_PANEL_BASE: CSSProperties = {
    boxSizing: 'border-box', padding: '16px 20px 20px', background: 'rgba(12,22,40,.75)',
    border: '1px solid rgba(79,216,255,.22)',
    clipPath: 'polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px)',
    display: 'flex', flexDirection: 'column', gap: 12,
};
const MANUAL_LABEL_STYLE: CSSProperties = {
    fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 12, letterSpacing: 3, color: '#5C7EA6',
};
// active=false のときはパネル全体を薄く・操作不可にする（個々のボタンの色は変えない）。
// 発表ステップの選択はTurn Over専用、データ操作はQuiz View専用の操作なので、
// 表示中の画面と逆側のパネルをこれで不活性化する(2026-09-25、ユーザー指示)。
function manualPanelStyle(active: boolean, flex: number): CSSProperties {
    return { ...MANUAL_PANEL_BASE, flex, ...(active ? {} : { opacity: 0.35, pointerEvents: 'none' as const }) };
}
function manualBtnStyle(selected: boolean): CSSProperties {
    return {
        padding: '9px 16px',
        background: selected ? 'rgba(51,198,255,.14)' : 'rgba(255,255,255,.03)',
        border: `1.5px solid ${selected ? ACCENT : 'rgba(79,216,255,.18)'}`,
        clipPath: 'polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px)',
        cursor: 'pointer',
        boxShadow: selected ? '0 0 14px rgba(51,198,255,.14)' : undefined,
    };
}
function manualBtnTextStyle(selected: boolean): CSSProperties {
    return {
        fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 14, letterSpacing: 1,
        color: selected ? '#DFF7FF' : '#5C7EA6', whiteSpace: 'nowrap',
    };
}

export default function AdminSecondRound(props: Props) {
    const { socket } = props;
    const [players, setPlayers] = useState<Player[]>([]);
    const [secondRoundState, setSecondRoundState] = useState<SecondRoundState>(DEFAULT_SECOND_ROUND_STATE);
    // Turn Over の「次へ」を押した直後、Design アーティファクト通りの収縮+ペーパー順位
    // 再表示アニメーション(1300ms)が終わるまで、ボタンの二重押しを防ぐためのフラグ。
    const [turnOverTransitioning, setTurnOverTransitioning] = useState(false);

    useEffect(() => {
        // プレイヤーデータを持ってくる
        fetch('/api/secondRound/loadPlayers').then(res => res.json()).then(data => {
            if (data.success) setPlayers(data.allPlayers);
        })

        if (socket) {
            // プレイヤーデータ更新命令が来た時の処理
            const onPlayers = (allPlayers: Player[]) => setPlayers(allPlayers);
            // ラウンド状態更新命令が来た時の処理
            const onState = (state: SecondRoundState) => setSecondRoundState(state);
            socket.on("update_players", onPlayers);
            socket.on("update_second_round_state", onState);
            // 外すのは自分の受け取り口だけ（2026-10-22。イベント名だけで off すると、
            // admin/page.tsx など同じイベントを受けている他の受け取り口まで外れてしまう）
            return () => {
                socket.off("update_players", onPlayers);
                socket.off("update_second_round_state", onState);
            }
        }
    }, [socket])

    // 各ラウンドの状況（2026-10-22。「3rd Round へ ▶」・Undo の制限・リセットの確認文に使う）
    const progress = useRoundProgress();

    // 問題表示（2026-10-22）。採点が成功したら、その問題を Main に表示して次の問題に進める
    const { state: questionState, finishQuestion, undoWithQuestion } = useQuestionDisplay(socket, 'secondRound');
    // 問題表示の操作の記録で「どの組の操作か」を表す（2026-10-29。Undo は組ごとなので、違う組の記録では問題を戻さない）
    const questionScope = `g${secondRoundState.group}`;

    const handleScoreAction = async (playerId: number, action: 'correct' | 'wrong') => {
        try {
            const res = await fetch('/api/secondRound/updateScores', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerId, action })
            });
            const data = await res.json();

            if (data.success && socket) {
                socket.emit('broadcast_scores', data.allPlayers);
                // 正解・誤答でその問題は終わる（ルール）。Main に表示して次の問題へ（得点の Undo 履歴あり）
                finishQuestion(questionScope, true);
            }
        } catch (error) {
            console.error('Score update failed', error);
        }
    };

    const handleGroupReset = async (secondRoundState: { group: number, view: string }) => {
        try {
            const res = await fetch('/api/secondRound/resetScores', {
                method: 'POST', // DB を書き換えるため POST
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ secondRoundState })
            });
            const data = await res.json();

            if (data.success) {
                // 3rd Round 以降も DB で初期化済み。選手・コースを配り、3rd Round 以降の進行状態も戻す
                broadcastAfterReset(socket, 'thirdRound', data);
            } else if (data.error) {
                alert(data.error);
            }
        } catch (error) {
            console.error('Reset scores failed', error);
        }
    };

    // Undo。2026-10-29 から問題表示も一緒に戻す（直前がスルーなら問題だけ戻す。undoWithQuestion）
    const handleGroupUndo = async (secondRoundState: { group: number, view: string }) => {
        // 3rd Round が始まっていたら Undo しない（提案B）
        if (blockUndoIfLaterStarted(progress, 'secondRound')) return;
        await undoWithQuestion(`g${secondRoundState.group}`, async () => {
            try {
                const res = await fetch('/api/secondRound/undo', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ secondRoundState })
                });
                const data = await res.json();

                if (data.success && socket) {
                    socket.emit('broadcast_scores', data.allPlayers);
                    return true;
                }
                if (data.error) alert(data.error || 'Undo に失敗しました');
                return false;
            } catch (error) {
                console.error('Undo scores failed', error);
                return false;
            }
        });
    };

    const handleStateChange = (updates: Partial<typeof secondRoundState>) => {
        if (socket) {
            socket.emit('change_2nd_round_state', { ...secondRoundState, ...updates });
        }
    };

    // 組参加選手を取り出す。
    //
    // 組番号は取込のときに DB へ保存されている（lib/secondRound.ts の規則）。
    // 列を見れば、2nd Round に出ない選手は組番号が null なので自然に外れる。
    const filteredPlayers = players
        .filter(p => p.secondRoundGroupNumber === secondRoundState.group)
        .sort((a, b) => a.paperRank - b.paperRank);

    // ============================================================
    // 進行フロー（「1組目発表→1組目クイズ→2組目発表→…」という実際の大会進行は
    // 基本的に後戻りしない一本道であるという事実に合わせて、状態から次に押すべき
    // ボタン1つだけを機械的に決める。個別の組・画面切り替えボタンは手動操作
    // （トラブル時のみ）の中に退避してある。
    // ============================================================
    const allResolved = filteredPlayers.length > 0 && filteredPlayers.every(p => p.secondRoundRank !== 0);
    // 次点（ペーパー49位）。同順位なら全員、いなければ空（2026-10-30 項目6。DB は変えない）
    const runnerUps = getRunnerUps(players);
    // 次点の発表へ進む（順位だけの状態から始める）
    const startRunnerUp = () => handleStateChange({ view: 'runnerUp', turnOverPhase: 'collapsed', turnOverFinalRevealed: false });

    // 手動操作パネル: 発表ステップの選択はTurn Over画面、データ操作はQuiz View画面の
    // ときだけ意味を持つ操作なので、表示中の画面に応じて片方を不活性化する。
    const turnOverStepsActive = secondRoundState.view === 'turnOver';
    const dataOpsActive = secondRoundState.view === 'quiz';

    let primaryLabel: string;
    let primaryAction: (() => void) | null = null;

    // Turn Over の発表ステップは0〜3の4段階で全組共通(TURN_OVER_STEP_LABELS)。
    // 4組目の最終ステップ(3)だけ、48位を他の5人より後に単独発表する追加の1手が
    // 挟まる(turnOverFinalRevealed)。最終ステップの収縮アニメーションが終わったら
    // turnOverStep を配列の範囲外(4)まで進め、Main側の全ての帯を非表示にした状態
    // (「消滅」)にしてから「クイズ開始」を出す(2026-09-27、ユーザー指示：組の発表が
    // 終わったらすぐ早押しへ進むのではなく、6位発表時などと同じ収縮アニメーションを
    // 挟んでから早押しへのボタンを出す)。
    const isLastTurnOverStep = secondRoundState.turnOverStep === TURN_OVER_STEP_LABELS.length - 1;
    const isGroup4FinalStep = secondRoundState.group === 4 && isLastTurnOverStep;
    const awaitingFinalReveal = isGroup4FinalStep
        && secondRoundState.turnOverPhase === 'expanded'
        && !secondRoundState.turnOverFinalRevealed;

    if (secondRoundState.view === 'runnerUp') {
        // 次点の発表: 順位だけ → 展開 → 3rd Round へ（2026-10-30 ユーザー承認・項目6）
        if (secondRoundState.turnOverPhase === 'collapsed') {
            primaryLabel = '展開 ▶';
            primaryAction = () => handleStateChange({ turnOverPhase: 'expanded' });
        } else {
            ({ label: primaryLabel, action: primaryAction } = nextRoundPrimary(socket, progress, 'secondRound'));
        }
    } else if (secondRoundState.view === 'turnOver') {
        if (turnOverTransitioning) {
            // 収縮+ペーパー順位再表示アニメーションの最中は、進行ボタンを一時的に無効化する。
            primaryLabel = '切替中...';
            primaryAction = null;
        } else if (secondRoundState.turnOverStep > TURN_OVER_STEP_LABELS.length - 1) {
            // 最終ステップの収縮アニメーションが完了し、Main側の帯が全て消えた状態
            primaryLabel = 'クイズへ ▶';
            primaryAction = () => handleStateChange({ view: 'quiz' });
        } else if (secondRoundState.turnOverPhase === 'collapsed') {
            // 4組目の最終ステップだけ、実際に発表されるのは48位を除いた7〜11位の5人
            // なので、ボタンの表示もそれに合わせる(内部のステップ区切り自体は
            // 他の組と同じ7〜12位のまま。48位は次の awaitingFinalReveal 操作で
            // 別枠として発表するため、ここでは「7〜11位」とだけ表示する)。
            const stepLabel = isGroup4FinalStep ? '7〜11位' : TURN_OVER_STEP_LABELS[secondRoundState.turnOverStep];
            primaryLabel = `${stepLabel}を発表 ▶`;
            primaryAction = () => handleStateChange({ turnOverPhase: 'expanded', turnOverFinalRevealed: false });
        } else if (awaitingFinalReveal) {
            // 4組目の最終ステップだけ、28〜44位の5人はすでに展開済みで、48位だけが
            // まだ順位のみのまま。ここで48位単独の発表操作を挟む。
            primaryLabel = '48位を発表 ▶';
            primaryAction = () => handleStateChange({ turnOverFinalRevealed: true });
        } else {
            primaryLabel = '次へ ▶';
            primaryAction = () => {
                const step = secondRoundState.turnOverStep;
                // Design アーティファクト(TurnOver.dc.html)の advance() と同じ2段階の演出。
                // (1) まず今の帯を collapsed に戻す(turnOverStep はそのまま)。Main側はこれで、
                //     その帯自身の中で「学校名・学年・名前が消える→枠が収縮→ペーパー順位が
                //     再度フェードイン」という収縮アニメーションだけを再生する(帯はまだ
                //     アクティブなので opacity は 1 のまま)。
                // (2) その収縮+順位再表示(.5s収縮 + .4s順位フェードイン(一部重複) + 少しの間 =
                //     合計1300ms。アーティファクト側の advance() のコメントと同じ内訳)が終わって
                //     から、次の turnOverStep へ進める。ここで初めて古い帯がフェードアウトし、
                //     新しい帯が(収縮状態のまま)フェードインする。
                //     最終ステップの場合はここで turnOverStep が配列の範囲外まで進み、
                //     Main側の全ての帯が非表示のままになる(「消滅」)。
                setTurnOverTransitioning(true);
                handleStateChange({ turnOverPhase: 'collapsed' });
                setTimeout(() => {
                    handleStateChange({ turnOverStep: step + 1, turnOverPhase: 'collapsed', turnOverFinalRevealed: false });
                    setTurnOverTransitioning(false);
                }, 1300);
            };
        }
    } else {
        if (!allResolved) {
            primaryLabel = '進行中...';
        } else if (secondRoundState.group < 4) {
            const nextGroup = secondRoundState.group + 1;
            primaryLabel = `${nextGroup}組目へ ▶`;
            // 次の組の発表(turnOver)は必ず1位からやり直すので、ここで turnOverStep/turnOverPhase をリセットする
            primaryAction = () => handleStateChange({ group: nextGroup, view: 'turnOver', turnOverStep: 0, turnOverPhase: 'collapsed', turnOverFinalRevealed: false });
        } else if (runnerUps.length > 0) {
            // 4組目まで終わった。次点（49位）がいれば先に発表する（2026-10-30 項目6）
            primaryLabel = `次点（${RUNNER_UP_RANK}位）を発表 ▶`;
            primaryAction = startRunnerUp;
        } else {
            // 4組目まで終わった。全20名の勝ち抜けが決まっていれば「3rd Round へ ▶」（提案A）
            ({ label: primaryLabel, action: primaryAction } = nextRoundPrimary(socket, progress, 'secondRound'));
        }
    }

    const primaryButtonStyle: CSSProperties = primaryAction
        ? {
            padding: '18px 40px', background: 'rgba(51,198,255,.14)', border: '2px solid #33C6FF',
            clipPath: 'polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px)',
            boxShadow: '0 0 22px rgba(51,198,255,.35)', cursor: 'pointer',
            fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 20, letterSpacing: 2, color: '#DFF7FF',
        }
        : {
            padding: '18px 40px', background: 'rgba(255,255,255,.04)', border: '2px solid #3A4B63',
            clipPath: 'polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px)',
            fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 18, letterSpacing: 1, color: secondRoundState.group === 4 && secondRoundState.view === 'quiz' ? '#FFE28A' : '#5C7EA6',
            cursor: 'default',
        };

    return (
        <div className="flex flex-col gap-4 bg-white dark:bg-zinc-800 p-6 rounded-xl shadow-md w-full max-w-[1900px]">
            {/* 進行フロー: 実際の大会進行(1組目発表→1組目クイズ→2組目発表→…)に沿って、
                いま押すべきボタンを1つだけ大きく出す。バックエンドの状態を直接いじる
                操作ではなく、既存の change_2nd_round_state をそのまま呼ぶだけなので
                データ操作としての承認は不要（AGENTS.md の UI 変更の範囲内）。 */}
            <div className="flex flex-col items-center gap-3 bg-black py-5 rounded-none">
                <div className="text-xs tracking-[0.3em] text-[#5C7EA6] font-mono">
                    {secondRoundState.view === 'runnerUp'
                        ? '2ND ROUND · 次点発表'
                        : `2ND ROUND · ${secondRoundState.group}組目 · ${secondRoundState.view === 'turnOver' ? 'ターンオーバー' : 'クイズ画面'}`}
                </div>
                <button onClick={() => primaryAction?.()} disabled={!primaryAction} style={primaryButtonStyle}>
                    {primaryLabel}
                </button>
            </div>

            {/* 手動操作: 通常運用では触らない。巻き戻り・スキップなど想定外の対応が
                必要になったときのための退避ハッチ。見た目は Cowork Design アーティファクト
                (AdminManual.dc.html)をそのまま移植し、ユーザーとのコメントレビューで
                「データ操作を発表ステップの選択の右隣に配置し、表示中の画面と逆側を
                不活性化する」という構成に確定した(2026-09-25)。 */}
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

                    {/* 組の選択・表示画面の選択 */}
                    <div className="flex gap-[18px]">
                        <div style={manualPanelStyle(true, 1.4)}>
                            <div style={MANUAL_LABEL_STYLE}>組</div>
                            <div className="flex flex-wrap gap-[10px]">
                                {[1, 2, 3, 4].map((g) => (
                                    <button key={g} onClick={() => handleStateChange({ group: g })} style={manualBtnStyle(secondRoundState.group === g)}>
                                        <span style={manualBtnTextStyle(secondRoundState.group === g)}>{g}組目</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div style={manualPanelStyle(true, 1)}>
                            <div style={MANUAL_LABEL_STYLE}>Main 表示</div>
                            <div className="flex gap-[10px]">
                                <button onClick={() => handleStateChange({ view: 'turnOver' })} style={manualBtnStyle(secondRoundState.view === 'turnOver')}>
                                    <span style={manualBtnTextStyle(secondRoundState.view === 'turnOver')}>ターンオーバー</span>
                                </button>
                                <button onClick={() => handleStateChange({ view: 'quiz' })} style={manualBtnStyle(secondRoundState.view === 'quiz')}>
                                    <span style={manualBtnTextStyle(secondRoundState.view === 'quiz')}>クイズ画面</span>
                                </button>
                                {/* 次点の発表（2026-10-30）。次点がいないときは押せない */}
                                <button onClick={startRunnerUp} disabled={runnerUps.length === 0} style={{ ...manualBtnStyle(secondRoundState.view === 'runnerUp'), opacity: runnerUps.length === 0 ? 0.35 : 1 }}>
                                    <span style={manualBtnTextStyle(secondRoundState.view === 'runnerUp')}>次点</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* 発表ステップの選択・データ操作: 表示中の画面に応じて片方を不活性化する */}
                    <div className="flex gap-[18px]">
                        <div style={manualPanelStyle(turnOverStepsActive, 2)}>
                            <div style={MANUAL_LABEL_STYLE}>発表ステップ（組内順位）</div>
                            <div className="flex flex-wrap items-center gap-[10px]">
                                {TURN_OVER_STEP_LABELS.map((label, step) => (
                                    <button
                                        key={step}
                                        onClick={() => handleStateChange({ turnOverStep: step, turnOverFinalRevealed: false })}
                                        disabled={!turnOverStepsActive}
                                        style={manualBtnStyle(secondRoundState.turnOverStep === step)}
                                    >
                                        <span style={manualBtnTextStyle(secondRoundState.turnOverStep === step)}>{label}</span>
                                    </button>
                                ))}
                                <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(79,216,255,.18)', margin: '0 4px' }} />
                                <button
                                    onClick={() => handleStateChange({ turnOverPhase: secondRoundState.turnOverPhase === 'collapsed' ? 'expanded' : 'collapsed', turnOverFinalRevealed: false })}
                                    disabled={!turnOverStepsActive}
                                    style={manualBtnStyle(false)}
                                >
                                    <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, fontSize: 14, letterSpacing: 0.5, color: '#9FB4D6', whiteSpace: 'nowrap' }}>
                                        {secondRoundState.turnOverPhase === 'collapsed' ? '発表' : '隠す'}
                                    </span>
                                </button>
                            </div>
                        </div>

                        <div style={manualPanelStyle(dataOpsActive, 1)}>
                            <div style={MANUAL_LABEL_STYLE}>データ操作</div>
                            <div className="flex gap-[10px]">
                                <button
                                    onClick={() => {
                                        if (window.confirm(`${secondRoundState.group}組目の結果をリセットしますか？（元に戻せません）${cascadeNotice(progress, 'thirdRound', true)}`)) {
                                            handleGroupReset(secondRoundState);
                                        }
                                    }}
                                    disabled={!dataOpsActive}
                                    style={{ padding: '9px 18px', background: 'rgba(255,59,92,.10)', border: '1.5px solid #FF3B5C', clipPath: 'polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px)', cursor: 'pointer' }}
                                >
                                    <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 14, letterSpacing: 1, color: '#FFE3E8' }}>リセット（{secondRoundState.group}組目）</span>
                                </button>
                                <button
                                    onClick={() => handleGroupUndo(secondRoundState)}
                                    disabled={!dataOpsActive}
                                    style={{ padding: '9px 18px', background: 'rgba(255,255,255,.04)', border: '1.5px solid #3A4B63', clipPath: 'polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px)', cursor: 'pointer' }}
                                >
                                    <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 14, letterSpacing: 1, color: '#9FB4D6' }}>Undo</span>
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

            {/* 次点の発表中の管理者ビュー（2026-10-30 項目6）。Main に出している選手と公開の状態 */}
            {secondRoundState.view === 'runnerUp' && (
                <div className="flex flex-col gap-4 bg-black p-[2vw]" style={{ border: '1px solid rgba(79,216,255,.22)' }}>
                    <div className="flex items-center justify-between">
                        <label className="text-lg font-bold" style={{ color: '#F3FAFF', fontFamily: '"Noto Sans JP",sans-serif' }}>
                            次点（{RUNNER_UP_RANK}位）の発表
                        </label>
                        <span className="text-sm font-mono" style={{ color: '#5C7EA6' }}>
                            {secondRoundState.turnOverPhase === 'expanded' ? '名前まで公開中' : '順位だけ表示中'}
                        </span>
                    </div>
                    <div style={{ border: '1px solid rgba(79,216,255,.22)', background: 'rgba(12,22,40,.75)' }}>
                        <table className="w-full text-left" style={{ fontFamily: '"Noto Sans JP",sans-serif', fontSize: 15, color: '#DFF7FF' }}>
                            <thead>
                                <tr style={{ color: '#5C7EA6', fontSize: 12, letterSpacing: 2 }}>
                                    <th className="px-4 py-3 w-40">1st Round順位</th>
                                    <th className="px-4 py-3">選手名</th>
                                    <th className="px-4 py-3">学校名</th>
                                    <th className="px-4 py-3 w-32">学年</th>
                                </tr>
                            </thead>
                            <tbody>
                                {runnerUps.map(p => (
                                    <tr key={p.id} style={{ borderTop: '1px solid rgba(79,216,255,.12)' }}>
                                        <td className="px-4 py-3" style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, color: tierOf(p.paperRank, ACCENT).color }}>
                                            {toOrdinal(p.paperRank)}
                                        </td>
                                        <td className="px-4 py-3 font-bold" style={{ color: '#F3FAFF' }}>{p.name}</td>
                                        <td className="px-4 py-3" style={{ color: '#9FB4D6' }}>{p.school || '-'}</td>
                                        <td className="px-4 py-3" style={{ color: '#9FB4D6' }}>{p.grade || '-'}</td>
                                    </tr>
                                ))}
                                {runnerUps.length === 0 && (
                                    <tr style={{ borderTop: '1px solid rgba(79,216,255,.12)' }}>
                                        <td colSpan={4} className="px-4 py-8 text-center" style={{ color: '#5C7EA6' }}>
                                            {RUNNER_UP_RANK}位の選手がいません
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ターンオーバー画面用の管理者ビュー。2026-10-11 のユーザー指示で、列を
                「1st Round順位・選手名・学校名・学年」の4つにし、クイズ画面の操作パネルと
                同じサイバーパンク調（黒背景＋シアン枠）にそろえた。 */}
            {secondRoundState.view === 'turnOver' && (
                <div className="flex flex-col gap-4 bg-black p-[2vw]" style={{ border: '1px solid rgba(79,216,255,.22)' }}>
                    <div className="flex items-center justify-between">
                        <label className="text-lg font-bold" style={{ color: '#F3FAFF', fontFamily: '"Noto Sans JP",sans-serif' }}>
                            {secondRoundState.group}組目 ターンオーバー
                        </label>
                        <span className="text-sm font-mono" style={{ color: '#5C7EA6' }}>{filteredPlayers.length}名</span>
                    </div>
                    <div style={{ border: '1px solid rgba(79,216,255,.22)', background: 'rgba(12,22,40,.75)' }}>
                        <table className="w-full text-left" style={{ fontFamily: '"Noto Sans JP",sans-serif', fontSize: 15, color: '#DFF7FF' }}>
                            <thead>
                                <tr style={{ color: '#5C7EA6', fontSize: 12, letterSpacing: 2 }}>
                                    <th className="px-4 py-3 w-40">1st Round順位</th>
                                    <th className="px-4 py-3">選手名</th>
                                    <th className="px-4 py-3">学校名</th>
                                    <th className="px-4 py-3 w-32">学年</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(() => {
                                    // いま画面(Main)で公開中の帯にいる選手だけ、行を強調する
                                    const currentStepIds = new Set(
                                        getTurnOverStepSlice(filteredPlayers, secondRoundState.turnOverStep).map(p => p.id)
                                    );
                                    return filteredPlayers.map(p => {
                                        const isCurrent = currentStepIds.has(p.id);
                                        return (
                                            <tr
                                                key={p.id}
                                                style={{
                                                    borderTop: '1px solid rgba(79,216,255,.12)',
                                                    background: isCurrent ? 'rgba(79,216,255,.10)' : undefined,
                                                    boxShadow: isCurrent ? 'inset 3px 0 0 #4FD8FF' : undefined,
                                                }}
                                            >
                                                <td className="px-4 py-3" style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, color: tierOf(p.paperRank, ACCENT).color }}>
                                                    {toOrdinal(p.paperRank)}
                                                </td>
                                                <td className="px-4 py-3 font-bold" style={{ color: '#F3FAFF' }}>{p.name}</td>
                                                <td className="px-4 py-3" style={{ color: '#9FB4D6' }}>{p.school || '-'}</td>
                                                <td className="px-4 py-3" style={{ color: '#9FB4D6' }}>{p.grade || '-'}</td>
                                            </tr>
                                        );
                                    });
                                })()}
                                {filteredPlayers.length === 0 && (
                                    <tr style={{ borderTop: '1px solid rgba(79,216,255,.12)' }}>
                                        <td colSpan={4} className="px-4 py-8 text-center" style={{ color: '#5C7EA6' }}>
                                            出場者が未確定です
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* クイズ画面用の管理者ビュー (正誤判定ボタン)。
                Design アーティファクト(Cowork Design: 2nd Round / Admin.dc.html)の
                操作パネルの見た目をそのまま移植し、正誤判定ロジック自体は変更しない */}
            {secondRoundState.view === 'quiz' && (
                <div className="flex flex-col gap-4 bg-black p-[2vw]" style={{ border: '1px solid rgba(79,216,255,.22)' }}>
                    <div className="flex items-center justify-between">
                        <label className="text-lg font-bold" style={{ color: '#F3FAFF', fontFamily: '"Noto Sans JP",sans-serif' }}>
                            {secondRoundState.group}組目 正誤判定
                        </label>
                        <span className="text-sm font-mono" style={{ color: '#5C7EA6' }}>
                            残り {filteredPlayers.filter(p => p.secondRoundRank === 0).length} / {filteredPlayers.length}
                        </span>
                    </div>
                    {/* 2026-09-26 ユーザー指示(3回目、UI/UX再設計): 「2列×6行の横長カード」より
                        「1行12列」の方が操作しやすいとのことなので、縦書きカードの構成に戻しつつ、
                        今度は1行だけにする。2行だったときは「画面に収める」ために全体を
                        transform:scaleで縮小してボタンが押せないほど小さくなってしまったが、
                        1行にすればカードの縦方向はほぼ丸々1画面ぶん使えるため、名前を縦書きの
                        まま・ボタンも十分な大きさのまま収められる(名前ゾーンだけで300px確保)。
                        横方向は grid-cols-12 で12等分の可変幅にし、ウィンドウ幅に応じて
                        1列あたりの幅が自動で変わる(ルート要素の幅上限も広げてある。上記参照)。 */}
                    <div className="grid grid-cols-12 gap-2">
                        {filteredPlayers.map(p => {
                            const tier = tierOf(p.paperRank, ACCENT);
                            const isActive = p.secondRoundRank === 0;
                            const isWinner = p.secondRoundRank >= 1;
                            const wrongCount = p.secondRoundWrongCount || 0;
                            // secondRoundRank < 0 は「2誤答で失格」と「組内で5人の勝ち抜けが決まり
                            // ラウンドが終了した時点で、まだ0/1誤答だった選手が一括で -1 にされた
                            // もの」の2通りを両方含む(app/api/secondRound/updateScores/route.ts参照)。
                            // 後者はLOST表示にしないでほしいというユーザー指示(2026-09-25)のため、
                            // 実際に2回誤答した選手だけをLOSTとして扱う。
                            const isEliminated = p.secondRoundRank < 0 && wrongCount >= 2;
                            // 2nd Roundのポイント上限は5。想定外の経路で5を超える値が入っていても
                            // 表示上は5で頭打ちにする(2026-09-25、ユーザー指示)。
                            const point = Math.min(CLEAR_POINT, p.secondRoundPoint || 0);
                            const pct = Math.min(100, (point / CLEAR_POINT) * 100);

                            const dotColor = isEliminated ? '#4A5568' : isWinner ? '#FFC93C' : '#35FFA0';
                            const barColor = isEliminated ? '#4A5568' : isWinner ? '#FFC93C' : '#4FD8FF';
                            const opButtonOpacity = isActive ? 1 : 0.35;

                            // 名前ゾーンの高さは固定(300px)。1行だけなので縦方向にかなり
                            // 余裕があり、MainSecondRoundの縦書きカードと同じ考え方で、
                            // 文字数が少ない名前ほど大きく・6文字級でもはみ出さないサイズを
                            // 逆算する(lineHeight:1 を明示しないと、Tailwindのpreflightの
                            // line-height:1.5 の影響で縦書き文字の実測サイズが1.5倍膨らむ
                            // 不具合が過去にあったため、ここでも明示しておく)。
                            const NAME_ZONE_H = 300;
                            // 実測したところ、計算どおりの文字サイズでも縦書きの実際の描画が
                            // わずかに規定の高さを超え、勝手に2列へ折り返されて表示が崩れる
                            // ケースがあった(7文字ぴったりの計算値だと余白が2pxしかなかった
                            // ため)。逆算に使う高さに安全マージンを持たせ、折り返しが起きない
                            // ようにする。念のため下のstyleにも whiteSpace:'nowrap' を明示する。
                            const nameFontSize = fitFontSizeToWidth(p.name, NAME_ZONE_H - 14, 3, 20, 44);

                            const cardStyle: CSSProperties = {
                                boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                                background: 'rgba(12,22,40,.75)', border: '1px solid rgba(79,216,255,.22)', borderTop: `3px solid ${tier.color}`,
                                padding: '8px 4px', overflow: 'hidden',
                            };

                            return (
                                <div key={p.id} style={cardStyle}>
                                    <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 13, letterSpacing: 0.5, color: tier.color }}>
                                        {toOrdinal(p.paperRank)}
                                    </div>
                                    <span style={{ display: 'block', width: 7, height: 7, borderRadius: '50%', background: dotColor, boxShadow: `0 0 6px ${dotColor}` }} />
                                    <div style={{ height: NAME_ZONE_H, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                                        <span style={{ writingMode: 'vertical-rl', textOrientation: 'upright', fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, fontSize: nameFontSize, lineHeight: 1, letterSpacing: 3, color: '#E9F3FF', whiteSpace: 'nowrap' }}>
                                            {p.name}
                                        </span>
                                    </div>
                                    <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 12, letterSpacing: 0.5, color: '#FFC93C', textShadow: '0 0 6px rgba(255,201,60,.6)', whiteSpace: 'nowrap', minHeight: 14 }}>
                                        {isWinner ? toOrdinal(p.secondRoundRank) : ''}
                                    </span>
                                    <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 20, color: '#EAF6FF' }}>{point}</span>
                                    <div style={{ width: '80%', height: 7, background: 'rgba(255,255,255,.06)', position: 'relative', overflow: 'hidden' }}>
                                        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${pct}%`, background: barColor, boxShadow: `0 0 6px ${barColor}` }} />
                                    </div>
                                    <div style={{ display: 'flex', gap: 3 }}>
                                        {Array.from({ length: 2 }).map((_, i) => {
                                            const isX = i < wrongCount;
                                            return (
                                                <span key={i} style={{ display: 'inline-block', width: 13, textAlign: 'center', fontSize: 14, lineHeight: 1, color: isX ? '#FF4D6D' : '#3A4B63' }}>
                                                    {isX ? '×' : '・'}
                                                </span>
                                            );
                                        })}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%', marginTop: 2 }}>
                                        <button
                                            onClick={() => handleScoreAction(p.id, 'correct')}
                                            disabled={!isActive}
                                            style={{
                                                display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: 36,
                                                background: 'rgba(51,198,255,.12)', border: '1.5px solid #33C6FF',
                                                clipPath: 'polygon(5px 0,100% 0,100% calc(100% - 5px),calc(100% - 5px) 100%,0 100%,0 5px)',
                                                cursor: isActive ? 'pointer' : 'default', opacity: opButtonOpacity,
                                            }}
                                        >
                                            <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 13, letterSpacing: 0.5, color: '#DFF7FF' }}>正解</span>
                                        </button>
                                        <button
                                            onClick={() => handleScoreAction(p.id, 'wrong')}
                                            disabled={!isActive}
                                            style={{
                                                display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: 36,
                                                background: 'rgba(255,59,92,.10)', border: '1.5px solid #FF3B5C',
                                                clipPath: 'polygon(5px 0,100% 0,100% calc(100% - 5px),calc(100% - 5px) 100%,0 100%,0 5px)',
                                                cursor: isActive ? 'pointer' : 'default', opacity: opButtonOpacity,
                                            }}
                                        >
                                            <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 13, letterSpacing: 0.5, color: '#FFE3E8' }}>誤答</span>
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                        {filteredPlayers.length === 0 && (
                            <div className="col-span-12 py-8 text-center" style={{ color: '#5C7EA6' }}>
                                選手データがありません
                            </div>
                        )}
                    </div>
                    {/* スルー（誰も解答しなかった）: スコアは変えず、その問題を Main に表示して次の問題へ（2026-10-22） */}
                    <button onClick={() => finishQuestion(questionScope, false)} style={{ boxSizing: 'border-box', padding: '12px 0', background: 'rgba(127,216,255,.10)', border: '1.5px solid #7FE8FF', clipPath: 'polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)', cursor: 'pointer' }}>
                        <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 16, letterSpacing: 1, color: '#DFF7FF' }}>スルー</span>
                    </button>
                    <AdminQuestionPanel socket={socket} round="secondRound" state={questionState} />
                </div>
            )}
        </div>
    );
}
