// 2nd Round（連答つき 5○2×）の Admin。
// 2026-10-31 改善案 Step 1: 運営コンソール（console/）に載せ替え。1440×900 で1画面に収める。
//   上のバー … Main に出ている画面・Undo（直前の操作名）・次の操作（1本道）
//   採点面   … Main と同じ並び。上に次に読む問題、その下に組の12名を横一列・縦書き、下にスルー
//   右の列   … Main に表示中の問題・問題番号の操作・操作の記録・ルール
//   引き出し … 「表示の切り替え」（組・画面・発表ステップ）と「データ修正」（組のリセット）
// 正解・誤答・Undo・リセットの処理と呼ぶ API は、載せ替え前と同じ。
import { Socket } from "socket.io-client";
import { useState, useEffect } from "react";
import type { Player, SecondRoundState } from "@/lib/types";
import { DEFAULT_SECOND_ROUND_STATE } from "@/lib/types";
import { TURN_OVER_STEP_LABELS, getTurnOverStepSlice, getRunnerUps, RUNNER_UP_RANK } from "@/lib/secondRound";
import { useQuestionDisplay } from "./AdminQuestionPanel";
import { useRoundProgress, nextRoundPrimary, blockUndoIfLaterStarted, cascadeNotice, broadcastAfterReset } from "./roundProgressContext";
import { ConsoleFrame, WorkHead, MetaItem, Drawer, DrawerGroup } from "./console/ConsoleFrame";
import { SeatCard, SeatRow, Pips, WrongMarks, BigNumber, seatNameSize, type SeatStatus } from "./console/SeatCard";
import { QuestionStrip } from "./console/QuestionStrip";
import { ConsoleSide } from "./console/ConsoleSide";
import { useActionLog } from "./console/useActionLog";
import styles from "./console/console.module.css";

type Props = {
    socket: Socket | null;
}

// 「5○2×」ルール: 5ポイントで勝ち抜け、2回誤答で失格
const CLEAR_POINT = 5;
const LOSE_WRONG = 2;
/** 1組の勝ち抜け人数 */
const GROUP_WINNERS = 5;

export default function AdminSecondRound(props: Props) {
    const { socket } = props;
    const [players, setPlayers] = useState<Player[]>([]);
    const [secondRoundState, setSecondRoundState] = useState<SecondRoundState>(DEFAULT_SECOND_ROUND_STATE);
    // Turn Over の「次へ」を押した直後、収縮+ペーパー順位再表示アニメーション(1300ms)が
    // 終わるまで、ボタンの二重押しを防ぐためのフラグ。
    const [turnOverTransitioning, setTurnOverTransitioning] = useState(false);
    // 開いている引き出し（表示の切り替え／データ修正）
    const [drawer, setDrawer] = useState<'view' | 'data' | null>(null);
    // 操作の記録（この画面の中だけ。Undo ボタンの説明にも使う）
    const actionLog = useActionLog();

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
    const hasCursor = questionState.cursors.secondRound !== undefined;

    const handleScoreAction = async (player: Player, action: 'correct' | 'wrong') => {
        try {
            const res = await fetch('/api/secondRound/updateScores', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerId: player.id, action })
            });
            const data = await res.json();

            if (data.success && socket) {
                socket.emit('broadcast_scores', data.allPlayers);
                // 正解・誤答でその問題は終わる（ルール）。Main に表示して次の問題へ（得点の Undo 履歴あり）
                finishQuestion(questionScope, true);
                // 操作の記録（勝ち抜け・失格が決まったら添える）
                const after: Player | undefined = (data.allPlayers as Player[]).find(p => p.id === player.id);
                const note = action === 'correct'
                    ? (after && after.secondRoundRank >= 1 ? '正解（勝ち抜け）' : '正解')
                    : (after && after.secondRoundRank < 0 && after.secondRoundWrongCount >= LOSE_WRONG ? '誤答（失格）' : '誤答');
                actionLog.add({ who: player.name, what: note, tone: action === 'correct' ? 'ok' : 'ng', scope: questionScope });
            } else if (data.error) {
                alert(data.error);
            }
        } catch (error) {
            console.error('Score update failed', error);
        }
    };

    // スルー（誰も解答しなかった）: スコアは変えず、その問題を Main に表示して次の問題へ（2026-10-22）
    const handleThrough = () => {
        finishQuestion(questionScope, false);
        actionLog.add({ who: '', what: 'スルー', tone: 'through', scope: questionScope });
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
                actionLog.add({ who: '', what: `${secondRoundState.group}組目をリセット`, tone: 'other', scope: `reset-g${secondRoundState.group}` });
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
        const scope = `g${secondRoundState.group}`;
        const undone = await undoWithQuestion(scope, async () => {
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
        if (undone) actionLog.markUndone(scope);
    };

    const handleStateChange = (updates: Partial<typeof secondRoundState>) => {
        if (socket) {
            socket.emit('change_2nd_round_state', { ...secondRoundState, ...updates });
        }
    };

    // 組参加選手（席順＝ペーパー順位順。Main と同じ並び）。
    // 組番号は取込のときに DB へ保存されている（lib/secondRound.ts の規則）。
    const filteredPlayers = players
        .filter(p => p.secondRoundGroupNumber === secondRoundState.group)
        .sort((a, b) => a.paperRank - b.paperRank);

    // ============================================================
    // 進行フロー（「1組目発表→1組目クイズ→2組目発表→…」の一本道）。
    // 状態から次に押すべきボタン1つだけを決め、上のバーの右端に出す。
    // ============================================================
    const allResolved = filteredPlayers.length > 0 && filteredPlayers.every(p => p.secondRoundRank !== 0);
    const activeCount = filteredPlayers.filter(p => p.secondRoundRank === 0).length;
    const winnerCount = filteredPlayers.filter(p => p.secondRoundRank >= 1).length;
    // 次点（ペーパー49位）。同順位なら全員、いなければ空（2026-10-30 項目6。DB は変えない）
    const runnerUps = getRunnerUps(players);
    // 次点の発表へ進む（順位だけの状態から始める）
    const startRunnerUp = () => handleStateChange({ view: 'runnerUp', turnOverPhase: 'collapsed', turnOverFinalRevealed: false });

    // Turn Over の発表ステップは0〜3の4段階で全組共通(TURN_OVER_STEP_LABELS)。
    // 4組目の最終ステップ(3)だけ、48位を他の5人より後に単独発表する追加の1手が挟まる(turnOverFinalRevealed)。
    // 最終ステップの収縮アニメーションが終わったら turnOverStep を配列の範囲外(4)まで進め、
    // Main側の全ての帯を非表示にしてから「クイズへ」を出す(2026-09-27、ユーザー指示)。
    const turnOverDone = secondRoundState.turnOverStep > TURN_OVER_STEP_LABELS.length - 1;
    const isLastTurnOverStep = secondRoundState.turnOverStep === TURN_OVER_STEP_LABELS.length - 1;
    const isGroup4FinalStep = secondRoundState.group === 4 && isLastTurnOverStep;
    const awaitingFinalReveal = isGroup4FinalStep
        && secondRoundState.turnOverPhase === 'expanded'
        && !secondRoundState.turnOverFinalRevealed;
    // いまの発表ステップの名前（4組目の最終ステップは 48位を別に発表するので「7〜11位」）
    const stepLabel = isGroup4FinalStep ? '7〜11位' : TURN_OVER_STEP_LABELS[secondRoundState.turnOverStep];

    let primaryLabel: string;
    let primaryAction: (() => void) | null = null;

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
            primaryLabel = '切り替え中…';
        } else if (turnOverDone) {
            // 最終ステップの収縮アニメーションが完了し、Main側の帯が全て消えた状態
            primaryLabel = 'クイズへ ▶';
            primaryAction = () => handleStateChange({ view: 'quiz' });
        } else if (secondRoundState.turnOverPhase === 'collapsed') {
            primaryLabel = `${stepLabel}を発表 ▶`;
            primaryAction = () => handleStateChange({ turnOverPhase: 'expanded', turnOverFinalRevealed: false });
        } else if (awaitingFinalReveal) {
            // 4組目の最終ステップだけ、48位を単独で発表する操作を挟む
            primaryLabel = '48位を発表 ▶';
            primaryAction = () => handleStateChange({ turnOverFinalRevealed: true });
        } else {
            primaryLabel = '次へ ▶';
            primaryAction = () => {
                const step = secondRoundState.turnOverStep;
                // (1) まず今の帯を collapsed に戻す（Main はその帯の中で収縮アニメーションを再生）
                // (2) 1300ms 後に次の turnOverStep へ進める（古い帯が消え、新しい帯が現れる）
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
            primaryLabel = `進行中（残り ${activeCount}名）`;
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

    // ---- 上のバー（Main に出ている画面） ----
    const onAirDetail = secondRoundState.view === 'quiz'
        ? 'クイズ画面'
        : secondRoundState.view === 'runnerUp'
            ? `次点の発表（${secondRoundState.turnOverPhase === 'expanded' ? '名前を公開中' : '順位だけ'}）`
            : turnOverDone
                ? 'ターンオーバー（発表終了）'
                : `ターンオーバー（${stepLabel}・${secondRoundState.turnOverPhase === 'expanded' ? '名前を公開中' : '順位だけ'}）`;
    const onAir = secondRoundState.view === 'runnerUp' ? '2nd Round' : `2nd Round　${secondRoundState.group}組目`;
    const isQuiz = secondRoundState.view === 'quiz';

    // ---- 採点面の右上の道具（引き出しを開く） ----
    const tools = (
        <>
            <button type="button" className={drawer === 'view' ? styles.btnOn : styles.btn} onClick={() => setDrawer(drawer === 'view' ? null : 'view')}>表示の切り替え</button>
            <button type="button" className={drawer === 'data' ? styles.btnOn : styles.btn} onClick={() => setDrawer(drawer === 'data' ? null : 'data')}>データ修正</button>
        </>
    );

    // ---- 引き出し ----
    const drawerView = drawer === 'view' && (
        <Drawer title="表示の切り替え" onClose={() => setDrawer(null)}>
            <DrawerGroup label="組">
                {[1, 2, 3, 4].map(g => (
                    <button key={g} type="button" className={secondRoundState.group === g ? styles.btnOn : styles.btn} onClick={() => handleStateChange({ group: g })}>{g}組目</button>
                ))}
            </DrawerGroup>
            <DrawerGroup label="Main の画面">
                <button type="button" className={secondRoundState.view === 'turnOver' ? styles.btnOn : styles.btn} onClick={() => handleStateChange({ view: 'turnOver' })}>ターンオーバー</button>
                <button type="button" className={isQuiz ? styles.btnOn : styles.btn} onClick={() => handleStateChange({ view: 'quiz' })}>クイズ画面</button>
                {/* 次点の発表（2026-10-30）。次点がいないときは押せない */}
                <button type="button" className={secondRoundState.view === 'runnerUp' ? styles.btnOn : styles.btn} onClick={startRunnerUp} disabled={runnerUps.length === 0}>次点（{RUNNER_UP_RANK}位）</button>
            </DrawerGroup>
            <DrawerGroup label="ターンオーバーの発表ステップ" disabled={secondRoundState.view !== 'turnOver'}>
                {TURN_OVER_STEP_LABELS.map((label, step) => (
                    <button key={step} type="button" className={secondRoundState.turnOverStep === step ? styles.btnOn : styles.btn}
                        onClick={() => handleStateChange({ turnOverStep: step, turnOverFinalRevealed: false })}>{label}</button>
                ))}
                <button type="button" className={styles.btn}
                    onClick={() => handleStateChange({ turnOverPhase: secondRoundState.turnOverPhase === 'collapsed' ? 'expanded' : 'collapsed', turnOverFinalRevealed: false })}>
                    {secondRoundState.turnOverPhase === 'collapsed' ? '名前を公開' : '順位だけに戻す'}
                </button>
            </DrawerGroup>
            <div className={styles.note}>通常は使いません。進行は上のバーの右端のボタンで行います。</div>
        </Drawer>
    );
    const drawerData = drawer === 'data' && (
        <Drawer title="データ修正" onClose={() => setDrawer(null)}>
            <DrawerGroup label={`${secondRoundState.group}組目の結果`} disabled={!isQuiz}
                note={isQuiz ? 'この組の得点・判定と Undo の履歴を消して、組の最初に戻します。元に戻せません。' : 'クイズ画面のときに使えます。'}>
                <button type="button" className={styles.btnDanger}
                    onClick={() => {
                        if (window.confirm(`${secondRoundState.group}組目の結果をリセットしますか？（元に戻せません）${cascadeNotice(progress, 'thirdRound', true)}`)) {
                            handleGroupReset(secondRoundState);
                            setDrawer(null);
                        }
                    }}>{secondRoundState.group}組目をリセット</button>
            </DrawerGroup>
            <div className={styles.note}>1手だけ戻すときは、上のバーの Undo を使ってください。</div>
        </Drawer>
    );

    // ---- 選手の列 ----
    const count = filteredPlayers.length;
    let work: React.ReactNode;
    if (secondRoundState.view === 'runnerUp') {
        // 次点の発表中: Main に出している選手（49位）
        work = (
            <>
                <WorkHead title={`次点（${RUNNER_UP_RANK}位）の発表`} meta={<MetaItem label="Main" value={secondRoundState.turnOverPhase === 'expanded' ? '名前を公開中' : '順位だけ'} />} tools={tools} />
                {runnerUps.length === 0
                    ? <div className={styles.empty}>{RUNNER_UP_RANK}位の選手がいません</div>
                    : (
                        <SeatRow count={runnerUps.length}>
                            {runnerUps.map((p, i) => (
                                <SeatCard key={p.id} seatNo={i + 1} paperRank={p.paperRank} name={p.name} school={`${p.school} ${p.grade}`}
                                    nameSize={seatNameSize(runnerUps.length, p.name, 420)}
                                    status={secondRoundState.turnOverPhase === 'expanded' ? { label: '公開中', tone: 'now' } : { label: '順位だけ', tone: 'info' }}
                                    highlighted />
                            ))}
                        </SeatRow>
                    )}
            </>
        );
    } else if (secondRoundState.view === 'turnOver') {
        // ターンオーバー: 組の12名を Main と同じ席順で並べ、いま発表している帯の選手を目立たせる
        const currentIds = new Set(turnOverDone ? [] : getTurnOverStepSlice(filteredPlayers, secondRoundState.turnOverStep).map(p => p.id));
        const doneIds = new Set(TURN_OVER_STEP_LABELS.flatMap((_, step) =>
            step < secondRoundState.turnOverStep ? getTurnOverStepSlice(filteredPlayers, step).map(p => p.id) : []));
        work = (
            <>
                <WorkHead title={`${secondRoundState.group}組目　ターンオーバー`}
                    meta={<MetaItem label="発表ステップ" value={turnOverDone ? '発表終了' : stepLabel} />} tools={tools} />
                {count === 0 ? <div className={styles.empty}>出場者が未確定です</div> : (
                    <SeatRow count={count}>
                        {filteredPlayers.map((p, i) => {
                            const now = currentIds.has(p.id);
                            const status: SeatStatus | null = now
                                ? (secondRoundState.turnOverPhase === 'expanded' ? { label: '発表中', tone: 'now' } : { label: '次に発表', tone: 'info' })
                                : doneIds.has(p.id) ? { label: '発表済み', tone: 'info' } : null;
                            return (
                                <SeatCard key={p.id} seatNo={i + 1} paperRank={p.paperRank} name={p.name} nameSize={seatNameSize(count, p.name, 420)}
                                    status={status} highlighted={now} dimmed={!now && !turnOverDone && !doneIds.has(p.id)}
                                    score={<><span className={styles.seatNo}>持ち点</span><BigNumber value={p.secondRoundPoint} size={26} /></>} />
                            );
                        })}
                    </SeatRow>
                )}
                <div className={styles.hint}>ターンオーバーは上のバーの右端のボタンで1段ずつ進めます。持ち点は組の中の順位によるアドバンテージです。</div>
            </>
        );
    } else {
        // クイズ: 正誤判定
        work = (
            <>
                <WorkHead title={`${secondRoundState.group}組目　正誤判定`}
                    meta={<><MetaItem label="残り" value={`${activeCount}/${count}`} /><MetaItem label="勝ち抜け" value={`${winnerCount}/${GROUP_WINNERS}`} /></>}
                    tools={tools} />
                <QuestionStrip round="secondRound" state={questionState} />
                {count === 0 ? <div className={styles.empty}>選手データがありません</div> : (
                    <SeatRow count={count}>
                        {filteredPlayers.map((p, i) => {
                            const isActive = p.secondRoundRank === 0;
                            const wrong = p.secondRoundWrongCount || 0;
                            // secondRoundRank < 0 は「2誤答で失格」と「組が終わった時点で未決着だった選手（一括で -1）」の2通り。
                            // 後者は失格と表示しない(2026-09-25、ユーザー指示)
                            const isEliminated = p.secondRoundRank < 0 && wrong >= LOSE_WRONG;
                            // 2nd Roundのポイント上限は5。表示上は5で頭打ちにする(2026-09-25、ユーザー指示)
                            const point = Math.min(CLEAR_POINT, p.secondRoundPoint || 0);
                            const status: SeatStatus | null = p.secondRoundRank >= 1 ? { label: `勝抜${p.secondRoundRank}位`, tone: 'win' }
                                : isEliminated ? { label: '失格', tone: 'lost' }
                                : p.secondRoundRank < 0 ? { label: '終了', tone: 'info' }
                                : p.secondRoundDoubleChance ? { label: '連答権', tone: 'dc' } : null;
                            return (
                                <SeatCard key={p.id} seatNo={i + 1} paperRank={p.paperRank} name={p.name} nameSize={seatNameSize(count, p.name)}
                                    status={status} dimmed={!isActive}
                                    score={<><BigNumber value={point} size={32} /><Pips value={point} max={CLEAR_POINT} /><WrongMarks count={wrong} max={LOSE_WRONG} /></>}
                                    onCorrect={() => handleScoreAction(p, 'correct')} onWrong={() => handleScoreAction(p, 'wrong')} canOperate={isActive} />
                            );
                        })}
                    </SeatRow>
                )}
                <button type="button" className={styles.through} onClick={handleThrough} disabled={!hasCursor}>スルー（誰も答えなかった）</button>
                <div className={styles.hint}>並びは Main と同じ（左から席順）。正解・誤答・スルーで、その問題を Main に出して次の問題へ進みます。</div>
            </>
        );
    }

    return (
        <ConsoleFrame
            onAir={onAir}
            onAirDetail={onAirDetail}
            undo={{ detail: isQuiz ? actionLog.lastLabel(questionScope) : null, onClick: () => handleGroupUndo(secondRoundState), disabled: !isQuiz }}
            next={{ label: primaryLabel, onClick: primaryAction }}
            side={
                <ConsoleSide socket={socket} round="secondRound" state={questionState} log={actionLog.entries}
                    rules={<><b>5○2×</b>　5ポイントで勝ち抜け、2回誤答で失格。正解すると連答権が付き、連答権を持って正解すると2ポイント（誤答・他の人の正解で消える）。1組5名が勝ち抜け。</>} />
            }
        >
            {work}
            {drawerView}
            {drawerData}
        </ConsoleFrame>
    );
}
