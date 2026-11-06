// 決勝: トリプルセブン の管理画面。
// 2026-11-05: 運営コンソール（console/）に載せ替え。2nd / 3rd Round・Semi-Final と同じ枠で、1440×900 の1画面に収める。
//   上のバー … Main に出ている画面・戻る・Undo（直前の操作名）・次の操作（1本道）。優勝決定後は最終成績の3つのボタン
//   作業面   … 待機・選手紹介（3名）／クイズ（問題欄・3名を横一列・縦書き・スルー）／最終成績
//   右の列   … 開始番号・操作の記録
//   引き出し … 「表示の切り替え」（Main 表示）と「データ修正」（結果リセット）
// 採点・次のセット・Undo・リセットの処理と呼ぶ API は、載せ替え前と同じ。
// 同時に、2nd / 3rd Round と同じ堅牢化を入れた（2026-11-04 の docs/robust-flow-design.md）:
//   ・採点・次のセット・Undo・リセットは同時に1つだけ（useSingleFlight）。応答待ちの押し直しで二重に効かない
//   ・Main が待機画面・ブランクで覆っている間は採点しない
//   ・画面を開いた時・つなぎ直した時に、進行状態・選手を取り直す
//   ・失敗は画面の上の通知（notify）で知らせる
//
// 準決勝と違いタイマーを一切持たない（設計メモ 決定事項4）。「セットが決着したか」
// も新しい状態を持たず、lib/finalScoring.ts の isSetOver / getSetWinner が
// 選手データ（finalCorrectCount・finalWrongCount）から都度判定する。
//
// 優勝（finalRank === 1）が決まった瞬間に、準優勝・第3位もルールの判定基準で
// 自動確定する（lib/finalScoring.ts compareFinalStanding。設計メモ 6.1）。
//
// 2026-10-17 追加（設計メモ 8章）: 上のバーの1本道ボタンで Main の表示を進める。
//   待機（何も表示しない）→ 選手紹介（1〜3人目。準決勝の勝ち抜け順）→ クイズ（採点）
//   → 優勝決定後に「優勝者を表示」「準優勝者を表示」「3位を表示」で最終成績を出す。
import { Socket } from "socket.io-client";
import { useState, useEffect, type ReactNode } from "react";
import type { Player, FinalState, FinalView } from "@/lib/types";
import { DEFAULT_FINAL_STATE } from "@/lib/types";
import { isSetOver, getSetWinner } from "@/lib/finalScoring";
import { getFinalists, finalPlaceLabel } from "@/lib/finalProfile";
import { photoUrl, displayNickname } from "@/lib/semifinalProfile";
import { NoPhoto } from "@/app/components/Main/SemifinalCard";
import { notify, errorText } from "@/lib/adminNotice";
import { coverBlocksRound, describeCover } from "@/lib/mainCover";
import { useSemifinalProfiles } from "./AdminSemifinalPrep";
import { useQuestionDisplay } from "./AdminQuestionPanel";
import { broadcastAfterReset } from "./roundProgressContext";
import { ConsoleFrame, WorkHead, MetaItem, Drawer, DrawerGroup } from "./console/ConsoleFrame";
import { SeatCard, SeatRow, Pips, WrongMarks, BigNumber, seatNameSize, type SeatStatus } from "./console/SeatCard";
import { QuestionStrip } from "./console/QuestionStrip";
import { ConsoleSide } from "./console/ConsoleSide";
import { useActionLog } from "./console/useActionLog";
import styles from "./console/console.module.css";
import { useMainCover } from "../useMainCover";
import { coverStartPrimary, CoverButtons } from "./MainCoverControls";
import { useSocketSync } from "../useSocketSync";
import { useSingleFlight } from "../useSingleFlight";

type Props = {
    socket: Socket | null;
}

/** 優勝決定後に出す、最終成績の表示ボタン */
const RESULT_BUTTONS = [
    { rank: 1, label: '優勝者を表示' },
    { rank: 2, label: '準優勝者を表示' },
    { rank: 3, label: '3位を表示' },
];

/** 「表示の切り替え」から切り替えられる Main 表示（最終成績は優勝決定後の3つのボタンから出す） */
const MANUAL_VIEWS: { key: string; label: string; update: { view: FinalView; introIndex?: number } }[] = [
    { key: 'standby', label: '待機', update: { view: 'standby' } },
    { key: 'intro0', label: '紹介（1人目）', update: { view: 'intro', introIndex: 0 } },
    { key: 'intro1', label: '紹介（2人目）', update: { view: 'intro', introIndex: 1 } },
    { key: 'intro2', label: '紹介（3人目）', update: { view: 'intro', introIndex: 2 } },
    { key: 'quiz', label: 'クイズ', update: { view: 'quiz' } },
];

/** 戻るボタンの連打防止（押すたびに前の画面へ進むため。1本道ボタンは ConsoleFrame 側で止める） */
const CLICK_GUARD_MS = 800;

/** 問題表示の操作の記録・Undo の単位（Final の Undo 履歴はセットをまたいで1本。2026-10-29） */
const QUESTION_SCOPE = 'final';

export default function AdminFinal(props: Props) {
    const { socket } = props;

    const [players, setPlayers] = useState<Player[]>([]);
    // Main を覆う表示（待機画面・ブランク。2026-11-04）
    const [cover, setCover, coverControls] = useMainCover(socket);
    const [finalState, setFinalState] = useState<FinalState>(DEFAULT_FINAL_STATE);
    // 写真・二つ名（選手紹介の確認用）
    const { profiles } = useSemifinalProfiles(socket);
    // 問題表示（2026-10-22）。採点が成功したら、その問題を Main に表示して次の問題に進める
    const { state: questionState, finishQuestion, recordEvent, undoWithQuestion } = useQuestionDisplay(socket, 'final');
    // 採点・次のセット・Undo・リセットは同時に1つだけ走らせる（応答待ちの押し直しで二重に効かない。2026-11-05）
    const flight = useSingleFlight();
    // 開いている引き出し（表示の切り替え／データ修正）
    const [drawer, setDrawer] = useState<'view' | 'data' | null>(null);
    // 操作の記録（この画面の中だけ。Undo ボタンの説明にも使う）
    const actionLog = useActionLog();
    const [lastBack, setLastBack] = useState(0);

    // 進行状態は、この画面を開いた時・つなぎ直した時に必ず取り直す（server/FinalHandler.js）
    useSocketSync(socket, ['request_final_sync']);

    useEffect(() => {
        // 選手は、開いた時・つなぎ直した時に読み直す（切れている間の更新の配信は受け取れていないため。2026-11-05）
        const loadPlayers = () => {
            fetch('/api/secondRound/loadPlayers').then(res => res.json()).then(data => {
                if (data.success) setPlayers(data.allPlayers);
            }).catch(err => console.error('Failed to load players', err));
        };
        loadPlayers();

        if (socket) {
            const handleStateUpdate = (state: FinalState) => setFinalState(state);
            const handlePlayersUpdate = (allPlayers: Player[]) => setPlayers(allPlayers);

            socket.on("update_final_state", handleStateUpdate);
            socket.on("update_players", handlePlayersUpdate);
            socket.io.on("reconnect", loadPlayers);

            return () => {
                socket.off("update_final_state", handleStateUpdate);
                socket.off("update_players", handlePlayersUpdate);
                socket.io.off("reconnect", loadPlayers);
            };
        }
    }, [socket]);

    const changeState = (updates: Partial<FinalState>) => {
        if (socket) socket.emit('change_final_state', updates);
    };

    // ---- 表示に使う値を選手データから導出する ----

    // 決勝の3名。新しい列は持たないため、準決勝の勝ち抜け（semifinalRank > 0）から
    // 都度導出する。並び順は準決勝の勝ち抜け順（設計メモ 決定事項1）。
    const finalPlayers = getFinalists(players);

    const set = finalState.set;
    const setOver = isSetOver(finalPlayers);
    const setWinner = getSetWinner(finalPlayers);
    const champion = finalPlayers.find(p => p.finalRank === 1);

    const isTournamentFinished = finalPlayers.length > 0 && finalPlayers.every(p => p.finalRank !== 0);

    // ---- 操作 ----

    const handleScore = (playerId: number, action: 'correct' | 'wrong') => flight.run(async () => {
        // Main が待機画面・ブランクで「これから始まる場面」を覆っている間は採点しない（会場に出ていない問題が進むのを防ぐ）
        if (coverBlocksRound(cover)) {
            notify('Main が待機中のため採点できません。上のバーの「○○を始める ▶」で画面を出してから採点してください。', 'error');
            return;
        }
        try {
            const res = await fetch('/api/final/updateScore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, playerId })
            });
            const data = await res.json();

            if (data.success && socket) {
                socket.emit('broadcast_scores', data.allPlayers);
                // 得点の Undo 履歴を積んだか（historyAdded）も問題表示の記録に残す（2026-10-29）
                finishQuestion(QUESTION_SCOPE, data.historyAdded !== false);
                const after = (data.allPlayers as Player[]).find(p => p.id === playerId);
                const out = !!after && action === 'wrong' && after.finalWrongCount >= 3;
                actionLog.add({
                    who: after?.name ?? '',
                    what: action === 'correct' ? '正解' : out ? '誤答（このセットは失格）' : '誤答',
                    tone: action === 'correct' ? 'ok' : 'ng', scope: QUESTION_SCOPE,
                });
            } else {
                notify(data.error || '更新に失敗しました', 'error');
            }
        } catch (error) {
            notify(errorText(error, '通信に失敗しました。採点は反映されていません。画面を確かめてからやり直してください。'), 'error');
        }
    });

    // スルー（誰も解答しなかった。2026-10-22）。スコアを変えず問題だけ進める
    const handleThrough = () => {
        if (coverBlocksRound(cover)) {
            notify('Main が待機中のためスルーできません。上のバーの「○○を始める ▶」で画面を出してからにしてください。', 'error');
            return;
        }
        finishQuestion(QUESTION_SCOPE, false);
        actionLog.add({ who: '', what: 'スルー', tone: 'through', scope: QUESTION_SCOPE });
    };

    // 次のセットへ。得点をリセットしたうえで、進行状態のセット番号も進める。
    const handleNextSet = () => {
        if (!window.confirm(`第${set + 1}セットへ進みますか？`)) return;
        void flight.run(async () => {
            try {
                const res = await fetch('/api/final/updateScore', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'nextSet' })
                });
                const data = await res.json();

                if (data.success && socket) {
                    socket.emit('broadcast_scores', data.allPlayers);
                    // 次のセットへ（得点が変わったとき）も Undo の1手になるので、問題と関係しない操作として記録する（2026-10-29）
                    if (data.historyAdded) recordEvent(QUESTION_SCOPE);
                    changeState({ set: set + 1 });
                    actionLog.add({ who: '', what: `第${set + 1}セットへ`, tone: 'other', scope: QUESTION_SCOPE });
                } else {
                    notify(data.error || '更新に失敗しました', 'error');
                }
            } catch (error) {
                notify(errorText(error, '通信に失敗しました。次のセットへは進んでいません。'), 'error');
            }
        });
    };

    // Undo。2026-10-29 から問題表示も一緒に戻す（直前がスルーなら問題だけ戻す。undoWithQuestion）。
    // 2026-11-05: 「次のセットへ」を取り消したとき（得点は前のセットの決着直後に戻る）は、セット番号も1つ戻す。
    // 以前は得点だけ戻り、セット番号が進んだままになっていた
    const handleUndo = () => flight.run(async () => {
        // いま全員の正解・誤答が 0 で第2セット以降なら、直前の1手は「次のセットへ」
        const justAfterNextSet = set > 1 && finalPlayers.every(p => p.finalCorrectCount === 0 && p.finalWrongCount === 0);
        const undone = await undoWithQuestion(QUESTION_SCOPE, async () => {
            try {
                const res = await fetch('/api/final/undo', { method: 'POST' });
                const data = await res.json();

                if (data.success && socket) {
                    socket.emit('broadcast_scores', data.allPlayers);
                    if (justAfterNextSet && isSetOver(getFinalists(data.allPlayers as Player[]))) changeState({ set: set - 1 });
                    return true;
                }
                notify(data.error || 'Undo に失敗しました', 'error');
                return false;
            } catch (error) {
                notify(errorText(error, '通信に失敗しました。Undo は反映されていません。'), 'error');
                return false;
            }
        });
        if (undone) actionLog.markUndone(QUESTION_SCOPE);
    });

    // 結果リセット（2026-10-22 新設。他のラウンドと同じ位置づけ）。
    // DB（正解数・誤答数・獲得セット数・最終順位・Undo 履歴）を API で戻し、進行（待機・第1セット）をサーバで戻す。
    // 二つ名・写真は消さない
    const handleReset = () => {
        if (!window.confirm('Final の結果（正解数・誤答数・獲得セット数・最終順位）をリセットしますか？\n待機画面・第1セットに戻ります。（元に戻せません）')) return;
        void flight.run(async () => {
            try {
                const res = await fetch('/api/final/reset', { method: 'POST' });
                const data = await res.json();
                if (res.ok && data.success) {
                    broadcastAfterReset(socket, 'final', data);
                    actionLog.add({ who: '', what: 'Final をリセット', tone: 'other', scope: 'reset' });
                    setDrawer(null);
                } else {
                    notify(data.error || 'リセットに失敗しました', 'error');
                }
            } catch (error) {
                notify(errorText(error, '通信に失敗しました。リセットは反映されていません。'), 'error');
            }
        });
    };

    // ---- 1本道ボタン ----
    const view = finalState.view;
    const introIndex = finalState.introIndex;
    let onAirDetail = '';
    let primaryLabel = '';
    let primaryAction: (() => void) | null = null;
    let backLabel = '';
    let backAction: (() => void) | null = null;
    // 優勝が決まったら、クイズ中・最終成績の表示中は「優勝者を表示」などの3つのボタンを出す
    const showResultButtons = isTournamentFinished && (view === 'quiz' || view === 'result');

    if (finalPlayers.length < 3) {
        primaryLabel = '決勝進出者が未確定です';
    } else if (view === 'standby') {
        onAirDetail = '待機（Main は何も表示しない）';
        primaryLabel = '選手紹介（1人目）▶';
        primaryAction = () => changeState({ view: 'intro', introIndex: 0 });
    } else if (view === 'intro') {
        onAirDetail = `選手紹介 ${introIndex + 1} / 3`;
        if (introIndex < 2) {
            primaryLabel = `選手紹介（${introIndex + 2}人目）▶`;
            primaryAction = () => changeState({ introIndex: introIndex + 1 });
        } else {
            primaryLabel = 'クイズ画面へ ▶';
            primaryAction = () => changeState({ view: 'quiz' });
        }
        backLabel = '◀ 戻る';
        backAction = introIndex > 0 ? () => changeState({ introIndex: introIndex - 1 }) : () => changeState({ view: 'standby' });
    } else if (view === 'result') {
        onAirDetail = `最終成績（${finalPlaceLabel(finalState.resultRank)}）`;
        primaryLabel = '最終成績を表示中';
        backLabel = '◀ クイズ画面に戻る';
        backAction = () => changeState({ view: 'quiz' });
    } else if (isTournamentFinished) {
        onAirDetail = '終了';
        primaryLabel = '← 表示する順位を選ぶ';
    } else if (setOver && !champion && setWinner) {
        // セット決着後、優勝がまだ決まっていなければ「次のセットへ」
        onAirDetail = `クイズ（第${set}セット決着: ${setWinner.name} が獲得）`;
        primaryLabel = `第${set + 1}セットへ ▶`;
        primaryAction = handleNextSet;
    } else {
        onAirDetail = 'クイズ';
        primaryLabel = '進行中（採点は下の画面で）';
    }

    // 待機画面・ブランクで「これから始まる場面」を覆っている間は、進行ボタンを覆いの操作にする
    // （待機画面を消す → ○○を始める。裏で画面を進めてしまわないように。2026-11-04）
    const coverStart = coverStartPrimary(cover, setCover);
    if (coverStart) {
        primaryLabel = coverStart.label;
        primaryAction = coverStart.action;
    } else if (coverBlocksRound(cover)) {
        primaryLabel = 'Main は待機中（上の帯から進めてください）';
        primaryAction = null;
    }
    // 処理中は次の操作を受け付けない
    if (flight.pending) primaryAction = null;

    const guardedBack = () => {
        const now = Date.now();
        if (now - lastBack < CLICK_GUARD_MS) return;
        setLastBack(now);
        backAction?.();
    };

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
            <DrawerGroup label="Main 表示">
                {MANUAL_VIEWS.map(({ key, label, update }) => {
                    const selected = view === update.view && (update.view !== 'intro' || finalState.introIndex === update.introIndex);
                    return (
                        <button key={key} type="button" className={selected ? styles.btnOn : styles.btn} onClick={() => changeState(update)}>{label}</button>
                    );
                })}
            </DrawerGroup>
            <div className={styles.note}>通常は使いません。進行は上のバーの右端のボタンで行います。</div>
        </Drawer>
    );
    const drawerData = drawer === 'data' && (
        <Drawer title="データ修正" onClose={() => setDrawer(null)}>
            <DrawerGroup label="Final の結果" note="正解数・誤答数・獲得セット数・最終順位と Undo の履歴を消して、待機画面・第1セットに戻します。写真・二つ名は消しません。元に戻せません。">
                <button type="button" className={styles.btnDanger} onClick={handleReset} disabled={flight.pending}>Final の結果をリセット</button>
            </DrawerGroup>
            <div className={styles.note}>1手だけ戻すときは、上のバーの Undo を使ってください。</div>
        </Drawer>
    );

    // ---- 作業面 ----
    let work: ReactNode;
    if (view === 'standby' || view === 'intro') {
        // 選手紹介の順番（準決勝の勝ち抜け順・Final の席順も同じ）
        work = (
            <>
                <WorkHead meta={<MetaItem label="紹介" value={view === 'intro' ? `${introIndex + 1} / 3` : '待機中'} />} tools={tools} />
                <div className={styles.sectionLabel}>選手紹介の順番（準決勝の勝ち抜け順・Final の席順も同じ）</div>
                <div className={styles.introGrid}>
                    {finalPlayers.map((p, i) => {
                        const now = view === 'intro' && i === introIndex;
                        const done = view === 'intro' && i < introIndex;
                        const pr = profiles.find(x => x.playerId === p.id);
                        const photo = photoUrl(pr);
                        return (
                            <div key={p.id} className={now ? styles.introBoxNow : done ? styles.introBoxDone : styles.introBox}>
                                <div className={styles.introPhoto}>
                                    {photo
                                        // eslint-disable-next-line @next/next/no-img-element
                                        ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                                        : <NoPhoto color="#5C7EA6" />}
                                </div>
                                <div className={styles.introText}>
                                    <span className={styles.sectionLabel}>
                                        {i + 1}人目 · SF {p.semifinalRank}セット目{now ? ' · NOW' : done ? ' · DONE' : ''}
                                    </span>
                                    <span className={styles.introNick}>{p.name}</span>
                                    <span className={styles.introSub}>{displayNickname(p, pr) || '（二つ名なし）'}</span>
                                </div>
                            </div>
                        );
                    })}
                    {finalPlayers.length === 0 && <div className={styles.empty}>決勝進出者が未確定です</div>}
                </div>
            </>
        );
    } else {
        // クイズ・最終成績: 出場者3名。正解数・誤答数・獲得セット数は常時リアルタイムで表示する
        // （決勝には準決勝のような「クイズ中は隠す」区分がない、設計メモ 決定事項5）
        work = (
            <>
                <WorkHead
                    meta={<>
                        <MetaItem label="セット" value={set} />
                        {setOver && !champion && setWinner && <MetaItem label="このセット" value={`${setWinner.name} が獲得`} />}
                        {isTournamentFinished && champion && <MetaItem label="優勝" value={champion.name} />}
                    </>}
                    tools={tools} />
                <QuestionStrip socket={socket} round="final" state={questionState} />
                {finalPlayers.length === 0 ? (
                    <div className={styles.empty}>出場者が未確定です</div>
                ) : (
                    <SeatRow count={finalPlayers.length}>
                        {finalPlayers.map(p => {
                            const isEliminatedThisSet = p.finalWrongCount >= 3;
                            const isSettled = p.finalRank !== 0;
                            const status: SeatStatus | null = p.finalRank === 1 ? { label: '優勝', tone: 'win' }
                                : p.finalRank === 2 ? { label: '準優勝', tone: 'dc' }
                                : p.finalRank === 3 ? { label: '3位', tone: 'info' }
                                : isEliminatedThisSet ? { label: '失格', tone: 'lost' } : null;
                            return (
                                <SeatCard key={p.id} paperRank={p.paperRank} name={p.name} nameSize={seatNameSize(finalPlayers.length, p.name)}
                                    status={status} dimmed={isEliminatedThisSet && !isSettled}
                                    score={<>
                                        <BigNumber value={p.finalCorrectCount} size={34} suffix="/ 7" />
                                        <Pips value={Math.min(7, p.finalCorrectCount)} max={7} />
                                        <WrongMarks count={p.finalWrongCount} max={3} />
                                        <span className={styles.formula}>獲得 {p.finalSetsWon} セット</span>
                                    </>}
                                    onCorrect={isSettled ? undefined : () => handleScore(p.id, 'correct')}
                                    onWrong={isSettled ? undefined : () => handleScore(p.id, 'wrong')}
                                    canOperate={!flight.pending && !setOver && !isEliminatedThisSet} />
                            );
                        })}
                    </SeatRow>
                )}
                {view === 'quiz' && !isTournamentFinished && (
                    <button type="button" className={styles.through} onClick={handleThrough} disabled={flight.pending || finalPlayers.length === 0}>スルー（誰も答えなかった）</button>
                )}
                <div className={styles.hint}>
                    並びは準決勝の勝ち抜け順。正解・誤答・スルーで、その問題を Main に出して次の問題へ進みます。
                    {isTournamentFinished && ' 優勝が決まりました。上のバーから、最終成績を Main に出す順位を選びます。'}
                </div>
            </>
        );
    }

    return (
        <ConsoleFrame
            onAir={`Final　第${set}セット`}
            onAirDetail={cover.kind !== 'none' ? describeCover(cover) : onAirDetail}
            barExtra={<>
                {backLabel && (
                    <button type="button" className={styles.btn} onClick={guardedBack} disabled={flight.pending}>{backLabel}</button>
                )}
                {showResultButtons && RESULT_BUTTONS.map(({ rank, label }) => (
                    <button key={rank} type="button"
                        className={view === 'result' && finalState.resultRank === rank ? styles.resultBtnOn : styles.resultBtn}
                        disabled={coverBlocksRound(cover)}
                        onClick={() => changeState({ view: 'result', resultRank: rank })}>
                        {label}
                    </button>
                ))}
                <CoverButtons cover={cover} setCover={setCover} forceRelease={coverControls.forceRelease} className={styles.btn} />
            </>}
            undo={{
                detail: actionLog.lastLabel(QUESTION_SCOPE),
                onClick: () => { void handleUndo(); },
                disabled: flight.pending || (view !== 'quiz' && view !== 'result'),
            }}
            next={{ label: primaryLabel, onClick: primaryAction }}
            side={<ConsoleSide socket={socket} round="final" state={questionState} log={actionLog.entries} />}
        >
            {work}
            {drawerView}
            {drawerData}
        </ConsoleFrame>
    );
}
