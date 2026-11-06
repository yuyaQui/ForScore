// Extra Round（敗者復活）の Admin。
// 2026-11-05: 運営コンソール（console/）に載せ替え。2nd・3rd Round と同じ枠で、1440×900 の1画面に収める。
//   上のバー … Main に出ている画面・（First Step の）戻る／次のフェーズへ・Undo（Second Step）・次の操作（1本道）
//   作業面   … 問題取込／First Step（問題・解答の確認）／進出者選択／Second Step（早押しの採点）
//   右の列   … Second Step は開始番号・操作の記録。それ以外は進行の段階
//   引き出し … 「表示の切り替え」（段階・First Step の位置）と「データ修正」（結果のリセット・敗者復活者なしの取り消し）
// 採点・Undo・リセット・進出者の確定の処理と呼ぶ API は、載せ替え前と同じ。
// 同時に、2nd・3rd Round と同じ堅牢化を入れた（docs/robust-flow-design.md）:
//   ・採点・Undo・リセットは同時に1つだけ（useSingleFlight）
//   ・Main が待機画面・ブランクで覆っている間は採点しない
//   ・画面を開いた時・つなぎ直した時に、進行状態と選手を取り直す
//   ・失敗は画面の上の通知（notify）で知らせる
import { useSocketSync } from "../useSocketSync";
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
import { useQuestionDisplay } from "./AdminQuestionPanel";
import { useRoundProgress, nextRoundPrimary, blockUndoIfLaterStarted, cascadeNotice, broadcastAfterReset } from "./roundProgressContext";
import { ConsoleFrame, Drawer, DrawerGroup } from "./console/ConsoleFrame";
import { QuestionStrip } from "./console/QuestionStrip";
import { ConsoleSide } from "./console/ConsoleSide";
import { useActionLog } from "./console/useActionLog";
import styles from "./console/console.module.css";
import { useMainCover } from "../useMainCover";
import { coverStartPrimary, CoverButtons } from "./MainCoverControls";
import { useSingleFlight } from "../useSingleFlight";
import { notify, errorText } from "@/lib/adminNotice";
import { BLANK_END_COVER, blankStartCover, standbyAfterCover, coverBlocksRound, describeCover, rewindCover } from "@/lib/mainCover";

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
const STAGES = Object.keys(STAGE_LABELS) as ExtraRoundStage[];

export default function AdminExtraRound(props: Props) {
    const { socket } = props;

    // 進行状態はサーバが持つ。ここは配信された値を映すだけ。
    // 初期値は配信が届くまでの仮置き（接続直後にサーバから現在値が届く）。
    const [state, setState] = useState<ExtraRoundState>(DEFAULT_EXTRA_ROUND_STATE);
    // 進行状態は、この画面を開いた時・つなぎ直した時に必ずサーバから取り直す(別のラウンドから戻ったとき・再読み込みの後に、仮の初期値のまま操作しない。2026-11-04)
    useSocketSync(socket, ['request_extra_round_sync']);

    // 問題文・解答・別解（Admin 用なので別解を含む）
    const [questions, setQuestions] = useState<ExtraRoundQuestion[]>([]);
    const [players, setPlayers] = useState<Player[] | null>(null);
    // 採点・Undo・リセットは同時に1つだけ走らせる（応答待ちの押し直しで二重に効かない）
    const flight = useSingleFlight();
    // 開いている引き出し（表示の切り替え／データ修正）
    const [drawer, setDrawer] = useState<'view' | 'data' | null>(null);
    // 操作の記録（この画面の中だけ。Undo ボタンの説明にも使う）
    const actionLog = useActionLog();
    // 進出者選択の画面が渡す、上のバーの進行ボタン（名前と処理）
    const [entrantAction, setEntrantAction] = useState<{ label: string; run: (() => void) | null } | null>(null);

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
        const loadPlayers = () => {
            fetch('/api/secondRound/loadPlayers').then(res => res.json()).then(data => {
                if (data.success) setPlayers(data.allPlayers);
            }).catch(err => console.error('Failed to load players', err));
        };
        loadPlayers();

        if (socket) {
            const handleStateUpdate = (next: ExtraRoundState) => setState(normalizeExtraRoundState(next));
            const handlePlayersUpdate = (allPlayers: Player[]) => setPlayers(allPlayers);

            socket.on('update_extra_round_state', handleStateUpdate);
            socket.on('update_players', handlePlayersUpdate);
            // つなぎ直したときは選手を読み直す（切れている間の更新の配信は受け取れていないため。2026-11-05）
            socket.io.on('reconnect', loadPlayers);

            return () => {
                socket.off('update_extra_round_state', handleStateUpdate);
                socket.off('update_players', handlePlayersUpdate);
                socket.io.off('reconnect', loadPlayers);
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

    // 各ラウンドの状況（2026-10-22。「Semi-Final へ ▶」・Undo の制限・リセットの確認文・敗者復活者なしに使う）
    const progress = useRoundProgress();
    // Main を覆う表示（待機画面・ブランク。2026-11-04）
    const [cover, setCover, coverControls] = useMainCover(socket);
    const noRevival = progress?.extraRoundNoRevival ?? false;

    // 問題表示（2026-10-22。Second Step のみ）。採点が成功したら、その問題を Main に表示して次の問題に進める
    const { state: questionState, finishQuestion, undoWithQuestion } = useQuestionDisplay(socket, 'extraSecondStep');
    // 問題表示の操作の記録で「どの操作か」を表す（Second Step は1つだけ。2026-10-29）
    const QUESTION_SCOPE = 'secondStep';
    const hasCursor = questionState.cursors.extraSecondStep !== undefined;

    const handleScore = (playerId: number, action: 'correct' | 'wrong') => flight.run(async () => {
        // Main が待機画面・ブランクで「これから始まる場面」を覆っている間は採点しない（会場に出ていない問題が進むのを防ぐ）
        if (coverBlocksRound(cover)) {
            notify('Main が待機中のため採点できません。上のバーの「○○を始める ▶」で画面を出してから採点してください。', 'error');
            return;
        }
        try {
            const res = await fetch('/api/extraRound/secondStep/updateScore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerId, action })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                if (socket) socket.emit('broadcast_scores', data.allPlayers);
                finishQuestion(QUESTION_SCOPE, true);
                const after: Player | undefined = (data.allPlayers as Player[]).find(p => p.id === playerId);
                const note = action === 'correct'
                    ? (after && after.extraRoundRank > 0 ? '正解（敗者復活）' : '正解')
                    : '誤答（失格）';
                actionLog.add({ who: after?.name ?? '', what: note, tone: action === 'correct' ? 'ok' : 'ng', scope: QUESTION_SCOPE });
            } else {
                notify(data.error || '更新に失敗しました', 'error');
            }
        } catch (error) {
            notify(errorText(error, '通信に失敗しました。採点は反映されていません。画面を確かめてからやり直してください。'), 'error');
        }
    });

    // スルー（誰も解答しなかった）: スコアは変えず、その問題を Main に表示して次の問題へ（2026-10-22）
    const handleThrough = () => {
        if (coverBlocksRound(cover)) {
            notify('Main が待機中のためスルーできません。上のバーの「○○を始める ▶」で画面を出してからにしてください。', 'error');
            return;
        }
        finishQuestion(QUESTION_SCOPE, false);
        actionLog.add({ who: '', what: 'スルー', tone: 'through', scope: QUESTION_SCOPE });
    };

    const handleUndo = () => flight.run(async () => {
        // Semi-Final が始まっていたら Undo しない（提案B）
        if (blockUndoIfLaterStarted(progress, 'extraRound')) return;
        if (cover.at === 'manual') {
            notify('手動の待機画面が出ています。「待機画面を消す ▶」を押してから Undo してください。', 'error');
            return;
        }
        // 2026-10-29: 問題表示も一緒に戻す（直前がスルーなら問題だけ戻す。undoWithQuestion）
        const undone = await undoWithQuestion(QUESTION_SCOPE, async () => {
            try {
                const res = await fetch('/api/extraRound/secondStep/undo', { method: 'POST' });
                const data = await res.json();
                if (res.ok && data.success) {
                    if (socket) socket.emit('broadcast_scores', data.allPlayers);
                    return true;
                }
                notify(data.error || 'Undo に失敗しました', 'error');
                return false;
            } catch (error) {
                notify(errorText(error, '通信に失敗しました。Undo は反映されていません。'), 'error');
                return false;
            }
        });
        if (!undone) return;
        actionLog.markUndone(QUESTION_SCOPE);
        // クイズの終了後（ブランク・待機画面 NEXT Semi-Final）に戻したときは、取り消した先の画面を会場に出さず、
        // ブランクにして「クイズを再開する ▶」で出す(2026-11-04)
        if (cover.at === 'end') setCover(rewindCover());
    });

    // Extra Round の結果（extraRoundRank・extraRoundCorrectCount・extraRoundSecondStep・敗者復活者なし）を
    // 全選手ぶんリセットする。2026-10-22: Semi-Final 以降も初期化し、進行は問題取込（setup）に戻す
    // （登録済みの問題は DB に残るので「登録済みの問題を使う」で再開できる）。
    const handleReset = () => {
        if (!window.confirm(`Extra Round の結果をリセットしますか？（元に戻せません）\n問題取込の画面に戻ります（登録済みの問題はそのまま使えます）。${cascadeNotice(progress, 'semifinal', true)}`)) return;
        void flight.run(async () => {
            try {
                const res = await fetch('/api/extraRound/reset', { method: 'POST' });
                const data = await res.json();
                if (res.ok && data.success) {
                    // Extra Round 以降の進行状態も戻す（Extra Round は問題取込へ）
                    broadcastAfterReset(socket, 'extraRound', data);
                    setDrawer(null);
                } else {
                    notify(data.error || 'リセットに失敗しました', 'error');
                }
            } catch (error) {
                notify(errorText(error, '通信に失敗しました。リセットは反映されていません。'), 'error');
            }
        });
    };

    // 「敗者復活者なし」の確定／取り消し（2026-10-22。First Step で全員が脱落した場合）。
    // 確定すると Semi-Final に 3rd Round 通過の8名で進める
    const handleNoRevival = (value: boolean) => {
        const message = value
            ? '敗者復活者なしで確定しますか？\nSemi-Final は 3rd Round 通過の8名で行います。'
            : '「敗者復活者なし」の確定を取り消しますか？';
        if (!window.confirm(message)) return;
        void flight.run(async () => {
            try {
                const res = await fetch('/api/extraRound/noRevival', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ value })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    if (socket) socket.emit('tournament_state_changed');
                    if (!value) setDrawer(null);
                } else {
                    notify(data.error || '更新に失敗しました', 'error');
                }
            } catch (error) {
                notify(errorText(error, '通信に失敗しました。確定は反映されていません。'), 'error');
            }
        });
    };

    // ---- いま押すべき操作（上のバーの右端のボタン）----
    let primaryLabel: string;
    let primaryAction: (() => void) | null = null;
    let secondaryLabel: string | null = null;
    let secondaryAction: (() => void) | null = null;
    // 表示前に出す、押せない「次へ」。押す順番（表示 → 次へ）を見せるためのもの
    let waitingNextLabel: string | null = null;

    if (state.stage === 'setup') {
        primaryLabel = '問題CSVを取り込んでください';
    } else if (state.stage === 'firstStep') {
        const atDecision = isPhaseEndAnswer(state.cursor);
        if (!state.revealed) {
            // 中身（問題文 / 解答）をまだ Main に出していない。出すまでは先に進めない
            primaryLabel = getFirstStepItem(state.cursor).view === 'question' ? '問題を表示 ▶' : '解答を表示 ▶';
            primaryAction = revealStep;
            if (!atDecision) waitingNextLabel = `次へ（${getFirstStepItemLabel(state.cursor + 1)}）`;
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
        if (noRevival) {
            // 敗者復活者なしで確定済み。Semi-Final へ（提案A）
            ({ label: primaryLabel, action: primaryAction } = nextRoundPrimary(socket, progress, 'extraRound'));
        } else {
            primaryLabel = entrantAction?.label ?? '進出者を選んでください';
            primaryAction = entrantAction?.run ?? null;
            // First Step で全員が脱落したとき用
            if (!winner) {
                secondaryLabel = '敗者復活者なしで確定';
                secondaryAction = () => handleNoRevival(true);
            }
        }
    } else {
        if (winner && cover.kind === 'none') {
            // 敗者復活者が決まった。まず Main をブランクにする（早押しの場面の終わりは何も表示しない。2026-11-04 ユーザー指示）
            primaryLabel = 'クイズを終了する ▶';
            primaryAction = () => setCover(BLANK_END_COVER);
        } else if (winner && cover.kind === 'blank') {
            primaryLabel = '待機画面を表示する ▶';
            primaryAction = () => setCover(standbyAfterCover('Semi-Final'));
        } else if (winner) {
            // 待機画面 NEXT Semi-Final。Semi-Final へ（提案A）
            ({ label: primaryLabel, action: primaryAction } = nextRoundPrimary(socket, progress, 'extraRound'));
        } else {
            primaryLabel = `進行中（残り ${entrants.filter(p => p.extraRoundRank === 0).length}名）`;
        }
    }

    // 待機画面・ブランクで「これから始まる場面」を覆っている間は、進行ボタンを覆いの操作にする
    // （待機画面を消す → ○○を始める。裏で画面を進めてしまわないように。2026-11-04）
    const coverStart = coverStartPrimary(cover, setCover);
    if (coverStart) {
        primaryLabel = coverStart.label;
        primaryAction = coverStart.action;
        secondaryLabel = null;
        secondaryAction = null;
        waitingNextLabel = null;
    } else if (coverBlocksRound(cover)) {
        primaryAction = null;
        secondaryLabel = null;
        secondaryAction = null;
        waitingNextLabel = null;
    }
    const guardedPrimary = primaryAction && !coverStart ? () => runGuarded(primaryAction) : primaryAction;
    const canGoBack = state.stage === 'firstStep' && state.cursor > 0 && !coverBlocksRound(cover);

    // ---- 上のバー（Main に出ている画面） ----
    const onAirDetail = state.stage === 'firstStep'
        ? `First Step・${getFirstStepItemLabel(state.cursor)}（${state.cursor + 1}/${FIRST_STEP_SEQUENCE.length}）${state.revealed ? '' : '・未表示'}`
        : state.stage === 'entrantSelect' ? (noRevival ? '敗者復活者なし' : '進出者選択')
        : state.stage === 'secondStep' ? 'Second Step'
        : '問題取込';

    // ---- 作業面の右上の道具（引き出しを開く） ----
    const tools = (
        <>
            <button type="button" className={drawer === 'view' ? styles.btnOn : styles.btn} onClick={() => setDrawer(drawer === 'view' ? null : 'view')}>表示の切り替え</button>
            <button type="button" className={drawer === 'data' ? styles.btnOn : styles.btn} onClick={() => setDrawer(drawer === 'data' ? null : 'data')}>データ修正</button>
        </>
    );

    // ---- 引き出し ----
    const drawerView = drawer === 'view' && (
        <Drawer title="表示の切り替え" onClose={() => setDrawer(null)}>
            <DrawerGroup label="段階">
                {STAGES.map(stage => (
                    <button key={stage} type="button" className={state.stage === stage ? styles.btnOn : styles.btn} onClick={() => changeState({ stage })}>{STAGE_LABELS[stage]}</button>
                ))}
            </DrawerGroup>
            <DrawerGroup label="First Step の位置" disabled={state.stage !== 'firstStep'}>
                <select className={styles.input} style={{ width: 260, textAlign: 'left' }} aria-label="First Step の位置" value={state.cursor}
                    onChange={e => changeState({ cursor: clampCursor(Number(e.target.value)), revealed: false })}>
                    {FIRST_STEP_SEQUENCE.map((_, i) => (
                        <option key={i} value={i}>{i + 1}. {getFirstStepItemLabel(i)}{isPhaseEndAnswer(i) ? '（進出者決定）' : ''}</option>
                    ))}
                </select>
                <button type="button" className={styles.btn} onClick={() => changeState({ cursor: 0, revealed: false })}>最初（問題 1）へ</button>
                <button type="button" className={styles.btn} onClick={() => changeState({ cursor: FIRST_STEP_LAST_CURSOR, revealed: false })}>最後（解答 20）へ</button>
            </DrawerGroup>
            <div className={styles.note}>通常は使いません。進行は上のバーの右端のボタンで行います。</div>
        </Drawer>
    );
    const drawerData = drawer === 'data' && (
        <Drawer title="データ修正" onClose={() => setDrawer(null)}>
            <DrawerGroup label="Extra Round の結果" note="全選手の Extra Round の結果（Second Step・敗者復活者なし）を消し、問題取込に戻します。登録済みの問題はそのまま使えます。元に戻せません。">
                <button type="button" className={styles.btnDanger} onClick={handleReset} disabled={flight.pending}>Extra Round の結果をリセット</button>
            </DrawerGroup>
            {noRevival && (
                <DrawerGroup label="敗者復活者なし">
                    <button type="button" className={styles.btn} onClick={() => handleNoRevival(false)} disabled={flight.pending}>「敗者復活者なし」を取り消す</button>
                </DrawerGroup>
            )}
            <div className={styles.note}>1手だけ戻すときは、上のバーの Undo を使ってください（Second Step のとき）。</div>
        </Drawer>
    );

    // ---- 採点面 ----
    let work: React.ReactNode;
    if (state.stage === 'setup') {
        work = (
            <div className={styles.scrollBox}>
                <AdminExtraRoundUpload
                    onReady={() => {
                        loadQuestions();
                        changeState({ stage: 'firstStep', cursor: 0, revealed: false });
                    }}
                />
            </div>
        );
    } else if (state.stage === 'firstStep') {
        work = <AdminExtraRoundFirstStep cursor={state.cursor} revealed={state.revealed} questions={questions} tools={tools} />;
    } else if (state.stage === 'entrantSelect') {
        work = players === null ? (
            <div className={styles.empty}>読み込み中...</div>
        ) : (
            <AdminExtraRoundEntrants
                socket={socket}
                players={players}
                tools={tools}
                onActions={setEntrantAction}
                onConfirmed={(single: boolean) => {
                    changeState({ stage: 'secondStep' });
                    // Second Step（早押し）の始まりは Main をブランクにし、上のバーの「クイズを始める」で出す（2026-11-04）。
                    // 1名で敗者復活が決まったとき（早押しをしない）はブランクにしない
                    if (!single) setCover(blankStartCover('クイズを始める'));
                }}
            />
        );
    } else {
        work = (
            <AdminExtraRoundSecondStep
                entrants={entrants}
                onScore={handleScore}
                onThrough={handleThrough}
                busy={flight.pending}
                canThrough={hasCursor}
                tools={tools}
                strip={<QuestionStrip socket={socket} round="extraSecondStep" state={questionState} />}
            />
        );
    }

    // ---- 右の列 ----
    const side = state.stage === 'secondStep'
        ? <ConsoleSide socket={socket} round="extraSecondStep" state={questionState} log={actionLog.entries} />
        : (
            <div className={styles.log}>
                <h3 className={styles.sideTitle} style={{ marginBottom: 6 }}>進行（Extra Round）</h3>
                {STAGES.map(stage => (
                    <div key={stage} className={styles.logRow} style={state.stage === stage ? { color: 'var(--text)' } : undefined}>
                        <em>{state.stage === stage ? '▶' : ''}</em>
                        <span>{STAGE_LABELS[stage]}</span>
                        <span />
                    </div>
                ))}
            </div>
        );

    const isSecondStep = state.stage === 'secondStep';
    return (
        <ConsoleFrame
            onAir="Extra Round"
            onAirDetail={cover.kind !== 'none' ? describeCover(cover) : onAirDetail}
            barExtra={<>
                {canGoBack && (
                    <button type="button" className={styles.btn} onClick={() => runGuarded(() => changeState({ cursor: clampCursor(state.cursor - 1), revealed: true }))}>◀ 戻る</button>
                )}
                {secondaryLabel && (
                    <button type="button" className={styles.btn} onClick={() => runGuarded(secondaryAction)} disabled={!secondaryAction || flight.pending}>{secondaryLabel}</button>
                )}
                {waitingNextLabel && <span className={styles.waitNote}>→ {waitingNextLabel}</span>}
                <CoverButtons cover={cover} setCover={setCover} forceRelease={coverControls.forceRelease} className={styles.btn} />
            </>}
            undo={{
                detail: isSecondStep ? actionLog.lastLabel(QUESTION_SCOPE) : null,
                onClick: () => { void handleUndo(); },
                disabled: !isSecondStep || flight.pending,
            }}
            next={{ label: primaryLabel, onClick: flight.pending ? null : guardedPrimary }}
            side={side}
        >
            {work}
            {drawerView}
            {drawerData}
        </ConsoleFrame>
    );
}
