// 準決勝: 3セット制タイムレース Nine Hundred の管理画面（設計メモ 6章）。
// 2026-11-05: 運営コンソール（console/）に載せ替え。2nd / 3rd Round と同じ枠で、1440×900 の1画面に収める。
//   上のバー … Main に出ている画面・タイマー・戻る・Undo（直前の操作名）・次の操作（1本道）
//   作業面   … 準備（写真・二つ名）／進出者紹介／選手カード表示／クイズ／振り返り／得点集計／点数発表／サドンデス
//   右の列   … 開始番号・操作の記録
//   引き出し … 「表示の切り替え」（セット・Main 表示）と「データ修正」（タイマー・結果リセット）
// 進行・判定・Undo・リセットの処理と呼ぶ API は、載せ替え前と同じ。
// 同時に、2nd / 3rd Round と同じ堅牢化を入れた（2026-11-04 の docs/robust-flow-design.md）:
//   ・得点確定・判定・Undo・リセットは同時に1つだけ（useSingleFlight）。応答待ちの押し直しで二重に効かない
//   ・Main が待機画面・ブランクで覆っている間は採点しない
//   ・画面を開いた時・つなぎ直した時に、進行状態・選手・コースを取り直す
//   ・失敗は画面の上の通知（notify）で知らせる
//
// 始まりの流れ（2026-10-15 追加）: 準備（写真・二つ名の登録）→ 進出者紹介（1人ずつ 二つ名 → プロフィール）
// → 選手カード表示（Main の演出が終わるまで待つ）→ 第1セットのクイズ画面。
// 第3セットの判定が終わったら「Final へ」でモードを決勝に切り替える。
//
// 1セットの流れ（2026-10-17 ユーザー指示。設計メモ 8章）:
//   タイマー START → タイムアップ → 振り返る問題の番号を入力 → 振り返り（Main に3問ずつ）
//   → 得点集計（各選手の得点を入力して確定）→ 点数発表（Main のポイントバー演出）
//   → 勝ち抜け判定 → 敗退判定（それぞれ同点ならサドンデス）→ 次のセットのクイズ画面。
// 「サドンデス」は 2026-10-15 に「プレーオフ」から呼び名を変えた（コード上の名前は playoff のまま）。
//
// 勝ち抜け・失格・ポイントは DB、表示の段階・振り返り範囲・サドンデスの進行はサーバのメモリ
// （server/SemifinalHandler.js）が持つ。「判定がどこまで進んだか」は DB から導く（getSemifinalSetStage）。
import { Socket } from "socket.io-client";
import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import type { Player, ThirdRoundCourse, SemifinalState, SemifinalTimer, SemifinalView } from "@/lib/types";
import { DEFAULT_SEMIFINAL_STATE } from "@/lib/types";
import { getSemifinalSeats, SET_TIME_LIMIT_SECONDS } from "@/lib/semifinal";
import {
    getActiveSortedByPoint, getSemifinalSetStage, planSemifinalJudgement, findSemifinalCurrentSet, type SemifinalJudgeStep,
} from "@/lib/semifinalScoring";
import { getPlayoffProgress, addPlayoffAction, undoPlayoffAction } from "@/lib/semifinalPlayoff";
import { buildAnnouncePlan, ANNOUNCE_START_DELAY_MS } from "@/lib/semifinalAnnounce";
import type { PoolQuestion } from "@/lib/questionPool";
import { getIntroOrder, getLineupOrder, lineupTotalMs, displayNickname } from "@/lib/semifinalProfile";
import { notify, errorText } from "@/lib/adminNotice";
import { coverBlocksRound, describeCover } from "@/lib/mainCover";
import { StandingsRow, RangeForm, ReviewList, PlayoffRow, IntroView, LineupView, parsePointInput, allPointsValid } from "./AdminSemifinalParts";
import { useSemifinalProfiles, PrepPanel } from "./AdminSemifinalPrep";
import { useRoundProgress, nextRoundPrimary, blockUndoIfLaterStarted, cascadeNotice, broadcastAfterReset } from "./roundProgressContext";
import { useQuestionDisplay } from "./AdminQuestionPanel";
import { ConsoleFrame, WorkHead, MetaItem, Drawer, DrawerGroup } from "./console/ConsoleFrame";
import { QuestionStrip } from "./console/QuestionStrip";
import { ConsoleSide } from "./console/ConsoleSide";
import { TimerChip } from "./console/TimerChip";
import { useActionLog } from "./console/useActionLog";
import styles from "./console/console.module.css";
import { useMainCover } from "../useMainCover";
import { coverStartPrimary, CoverButtons } from "./MainCoverControls";
import { useSocketSync } from "../useSocketSync";
import { useSingleFlight } from "../useSingleFlight";

type Props = {
    socket: Socket | null;
}

/** 振り返り1ページの問題数（2026-10-10 ユーザー決定） */
const REVIEW_PAGE_SIZE = 3;
/** 戻るボタンの連打防止（押すたびに前の画面へ進むため。1本道ボタンは ConsoleFrame 側で止める） */
const CLICK_GUARD_MS = 800;

const VIEW_LABELS: Record<SemifinalView, string> = {
    standby: '準備', intro: '進出者紹介', lineup: '選手カード表示', quiz: 'クイズ', review: '振り返り', tally: '得点集計', results: '点数発表', playoff: 'サドンデス',
};
/** 手動操作で切り替えられる Main 表示（サドンデスは判定からだけ始める） */
const MANUAL_VIEWS: SemifinalView[] = ['standby', 'intro', 'lineup', 'quiz', 'review', 'tally', 'results'];
/** タイマーを出さない（セットの進行が始まる前の）表示 */
const OPENING_VIEWS: SemifinalView[] = ['standby', 'intro', 'lineup'];

/** 写真の切り抜きなど、部品から通知を出すとき用。毎回同じ関数にしておく（部品の effect が再実行されないように） */
const notifyError = (message: string) => notify(message, 'error');

function nameList(players: Player[], ids: number[]): string {
    return ids.map(id => players.find(p => p.id === id)?.name ?? `#${id}`).join('、');
}

export default function AdminSemifinal(props: Props) {
    const { socket } = props;

    const [players, setPlayers] = useState<Player[]>([]);
    const [courses, setCourses] = useState<ThirdRoundCourse[]>([]);
    // サーバから届くまでは null（初期値で入力欄を作ってしまわないように）
    const [receivedState, setState] = useState<SemifinalState | null>(null);
    const state = receivedState ?? DEFAULT_SEMIFINAL_STATE;
    const [timer, setTimer] = useState<SemifinalTimer>({ remainings: {}, runningSet: null });
    // 得点確定・判定・Undo・リセットは同時に1つだけ走らせる（応答待ちの押し直しで二重に効かない。2026-11-05）
    const flight = useSingleFlight();
    // 開いている引き出し（表示の切り替え／データ修正）
    const [drawer, setDrawer] = useState<'view' | 'data' | null>(null);
    // 操作の記録（この画面の中だけ。Undo ボタンの説明にも使う）
    const actionLog = useActionLog();

    // 振り返り範囲の入力（文字列のまま持ち、押した時点で検証する）
    const [rangeFrom, setRangeFrom] = useState("");
    const [rangeTo, setRangeTo] = useState("");
    // セットの得点入力
    const [pointInputs, setPointInputs] = useState<Record<number, string>>({});
    // 振り返りで Main に出している問題（Admin 用。別解つき）
    const [reviewQuestions, setReviewQuestions] = useState<PoolQuestion[]>([]);

    // タイマーの手動編集
    const [isEditingTimer, setIsEditingTimer] = useState(false);
    const [editMinutes, setEditMinutes] = useState(0);
    const [editSeconds, setEditSeconds] = useState(0);

    // 点数発表の演出が終わるまで「判定」を押せないようにする。
    // 発表の回数（announceSeq）が増えたのを受信した時刻から、Main と同じ計算で終了時刻を出す。
    // 開いた時点ですでに発表済みなら、演出は終わっているものとして扱う。
    const lastSeqRef = useRef<number | null>(null);
    const entrantsRef = useRef<Player[]>([]);
    const [announceEndsAt, setAnnounceEndsAt] = useState(0);
    const [announceDone, setAnnounceDone] = useState(true);

    // 選手カード表示の演出が終わるまで「クイズ画面へ」を押せないようにする（点数発表と同じ考え方）
    const lastLineupSeqRef = useRef<number | null>(null);
    const [lineupEndsAt, setLineupEndsAt] = useState(0);
    const [lineupDone, setLineupDone] = useState(true);

    const lastActionAt = useRef(0);

    // 写真・二つ名（準備・進出者紹介で使う）
    const { profiles } = useSemifinalProfiles(socket);
    // 各ラウンドの状況（2026-10-22。「Final へ ▶」・Undo の制限・リセットの確認文に使う）
    const progress = useRoundProgress();
    // Main を覆う表示（待機画面・ブランク。2026-11-04）
    const [cover, setCover, coverControls] = useMainCover(socket);

    const seats = getSemifinalSeats(players, courses);
    const entrants = seats.map(s => s.player);
    const introOrder = getIntroOrder(players, courses);
    const lineupOrder = getLineupOrder(players, courses);
    const revived = players.find(p => p.extraRoundRank === 1) ?? null;
    const lineupCountRef = useRef(0);
    useEffect(() => {
        entrantsRef.current = entrants;
        lineupCountRef.current = lineupOrder.length;
    });

    // 進行状態・タイマーは、この画面を開いた時・つなぎ直した時に必ず取り直す（server/SemifinalHandler.js）。
    // 接続直後の配信はこの画面が無いうちに届いて失われるため
    useSocketSync(socket, ['request_semifinal_sync']);

    useEffect(() => {
        // 選手・コースは、開いた時・つなぎ直した時に読み直す（切れている間の更新の配信は受け取れていないため）
        const loadAll = () => {
            fetch('/api/secondRound/loadPlayers').then(res => res.json()).then(data => {
                if (data.success) setPlayers(data.allPlayers);
            }).catch(err => console.error('Failed to load players', err));
            fetch('/api/thirdRound/courses').then(res => res.json()).then(data => {
                if (data.success) setCourses(data.courses);
            }).catch(err => console.error('Failed to load third round courses', err));
        };
        loadAll();

        if (socket) {
            const handleStateUpdate = (next: SemifinalState) => {
                const prevSeq = lastSeqRef.current;
                lastSeqRef.current = next.announceSeq;
                if (prevSeq !== null && next.announceSeq > prevSeq) {
                    const contenders = entrantsRef.current.filter(p => p.semifinalRank === 0);
                    setAnnounceEndsAt(Date.now() + ANNOUNCE_START_DELAY_MS + buildAnnouncePlan(contenders).totalMs);
                    setAnnounceDone(false);
                }
                const prevLineup = lastLineupSeqRef.current;
                lastLineupSeqRef.current = next.lineupSeq;
                if (prevLineup !== null && next.lineupSeq > prevLineup) {
                    setLineupEndsAt(Date.now() + lineupTotalMs(lineupCountRef.current));
                    setLineupDone(false);
                }
                setState(next);
            };
            const handleTimerUpdate = (next: SemifinalTimer) => setTimer(next);
            const handlePlayersUpdate = (allPlayers: Player[]) => setPlayers(allPlayers);

            socket.on("update_semifinal_state", handleStateUpdate);
            socket.on("update_semifinal_timer", handleTimerUpdate);
            socket.on("update_players", handlePlayersUpdate);
            socket.io.on("reconnect", loadAll);

            return () => {
                socket.off("update_semifinal_state", handleStateUpdate);
                socket.off("update_semifinal_timer", handleTimerUpdate);
                socket.off("update_players", handlePlayersUpdate);
                socket.io.off("reconnect", loadAll);
            };
        }
    }, [socket]);

    useEffect(() => {
        if (announceDone) return;
        const t = setTimeout(() => setAnnounceDone(true), Math.max(0, announceEndsAt - Date.now()));
        return () => clearTimeout(t);
    }, [announceDone, announceEndsAt]);
    useEffect(() => {
        if (lineupDone) return;
        const t = setTimeout(() => setLineupDone(true), Math.max(0, lineupEndsAt - Date.now()));
        return () => clearTimeout(t);
    }, [lineupDone, lineupEndsAt]);

    const set = state.set;
    const range = state.reviewRanges[set] ?? null;

    // セットが変わったら入力欄を初期化する（前のセットの続きの番号を初期値にする）
    const [formSet, setFormSet] = useState<number | null>(null);
    if (receivedState && formSet !== set) {
        setFormSet(set);
        const prevRange = state.reviewRanges[set - 1];
        setRangeFrom(range ? String(range.from) : prevRange ? String(prevRange.to + 1) : "");
        setRangeTo(range ? String(range.to) : "");
        setPointInputs({});
    }

    // 振り返り中の問題を取得する（Admin 用：別解つき）
    const pageCount = range ? Math.ceil((range.to - range.from + 1) / REVIEW_PAGE_SIZE) : 0;
    const page = Math.min(state.reviewPage, Math.max(0, pageCount - 1));
    const pageFrom = range ? range.from + page * REVIEW_PAGE_SIZE : 0;
    const pageTo = range ? Math.min(range.to, pageFrom + REVIEW_PAGE_SIZE - 1) : 0;
    const hasRange = range !== null;
    useEffect(() => {
        if (!hasRange || state.view !== 'review') return;
        let cancelled = false;
        fetch(`/api/questions?from=${pageFrom}&to=${pageTo}`).then(res => res.json()).then(data => {
            if (cancelled) return;
            if (data.success) setReviewQuestions(data.questions);
            else notify(data.error || '問題を読み込めません', 'error');
        }).catch(() => { if (!cancelled) notify('通信に失敗しました。振り返りの問題を読み込めません。', 'error'); });
        return () => { cancelled = true; };
    }, [hasRange, state.view, pageFrom, pageTo]);

    // ---- 導出 ----
    const stage = getSemifinalSetStage(entrants, set);
    const activeSorted = getActiveSortedByPoint(entrants);
    const activeInSeatOrder = entrants.filter(p => p.semifinalRank === 0);
    const playoffProgress = state.playoff ? getPlayoffProgress(state.playoff) : null;
    const remaining = timer.remainings[set] ?? SET_TIME_LIMIT_SECONDS;
    const isTimerRunning = timer.runningSet === set;
    const isLastPage = pageCount > 0 && page >= pageCount - 1;

    // ---- 操作 ----
    const changeState = useCallback((updates: Record<string, unknown>) => {
        if (socket) socket.emit('change_semifinal_state', updates);
    }, [socket]);

    const runGuarded = useCallback((fn: (() => void) | null) => {
        if (!fn) return;
        const now = Date.now();
        if (now - lastActionAt.current < CLICK_GUARD_MS) return;
        lastActionAt.current = now;
        fn();
    }, []);

    const changeTimer = (action: 'start' | 'stop' | 'reset') => {
        if (socket) socket.emit('change_semifinal_timer', { action });
    };

    /** 得点・判定の API を呼ぶ。成功したら選手を配って新しい選手一覧を返す。失敗は通知して null（通信の失敗は投げる） */
    const postScore = async (body: Record<string, unknown>): Promise<Player[] | null> => {
        const res = await fetch('/api/semifinal/updateScore', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!data.success) {
            notify(data.error || '更新に失敗しました', 'error');
            return null;
        }
        if (socket) socket.emit('broadcast_scores', data.allPlayers);
        setPlayers(data.allPlayers);
        return data.allPlayers;
    };

    const goReview = () => flight.run(async () => {
        const from = Number(rangeFrom.trim());
        const to = Number(rangeTo.trim());
        try {
            const res = await fetch(`/api/questions?from=${from}&to=${to}`);
            const data = await res.json();
            if (!data.success) {
                notify(data.error || '問題を読み込めません', 'error');
                return;
            }
            changeState({ reviewRange: { from, to }, view: 'review' });
        } catch (error) {
            notify(errorText(error, '通信に失敗しました。振り返りには進んでいません。'), 'error');
        }
    });

    const submitPoints = () => flight.run(async () => {
        const entries = activeInSeatOrder.map(p => ({ playerId: p.id, delta: parsePointInput(pointInputs[p.id] ?? '') }));
        if (entries.some(e => e.delta === null)) return;
        const summary = activeInSeatOrder.map((p, i) => `${p.name}: ${entries[i].delta! > 0 ? '+' : ''}${entries[i].delta}`).join('\n');
        if (!window.confirm(`第${set}セットの得点を確定しますか？\n\n${summary}`)) return;
        try {
            const updated = await postScore({ action: 'points', set, entries });
            if (updated) {
                changeState({ pointsEntered: true });
                actionLog.add({ who: '', what: `第${set}セット 得点確定`, tone: 'other', scope: 'semifinal' });
            }
        } catch (error) {
            notify(errorText(error, '通信に失敗しました。得点は反映されていないかもしれません。画面の点数を確かめてからやり直してください。'), 'error');
        }
    });

    const announce = () => {
        if (socket) socket.emit('announce_semifinal_results', { set });
    };

    // 判定。確定できるところまで API で確定し、同点が残ればサドンデスを始める
    // 判定。2026-10-17 から勝ち抜け（advance）と敗退（eliminate）を別のボタンで1つずつ行う。
    // planSemifinalJudgement は確定できるところまで続けて組み立てるので、今回の目的の手順だけを使う。
    // 同点ならサドンデスを始め、サドンデス後の「結果を確定」では playoffResult を渡して確定する
    const judge = (purpose: 'advance' | 'eliminate', playoffResult?: { purpose: 'advance' | 'eliminate'; chosenIds: number[] }) => flight.run(async () => {
        const plan = planSemifinalJudgement(entrants, set, playoffResult);
        if (plan.error) {
            notify(plan.error, 'error');
            return;
        }
        const action = purpose === 'advance' ? 'judgeAdvance' : 'judgeEliminate';
        const steps = plan.steps.filter(step => step.action === action);
        const playoff = plan.playoff && plan.playoff.purpose === purpose ? plan.playoff : null;
        const label = purpose === 'advance' ? '勝ち抜け' : '敗退';
        const describe = (step: SemifinalJudgeStep) => `${label}: ${nameList(entrants, step.playerIds)}`;
        if (steps.length > 0 && !window.confirm(`${label}を確定しますか？\n\n${steps.map(describe).join('\n')}`)) return;

        try {
            for (const step of steps) {
                const updated = await postScore({ action: step.action, set, chosenIds: step.chosenIds });
                if (!updated) return;
                actionLog.add({ who: nameList(entrants, step.playerIds), what: `${label}を確定`, tone: purpose === 'advance' ? 'ok' : 'ng', scope: 'semifinal' });
            }
            if (playoff) {
                changeState({ playoff: { ...playoff, set, actions: [] }, view: 'playoff' });
            } else if (state.playoff) {
                changeState({ playoff: null, view: 'results' });
            }
        } catch (error) {
            notify(errorText(error, '通信に失敗しました。判定は途中までしか反映されていないかもしれません。画面の勝ち抜け・敗退を確かめてください。'), 'error');
        }
    });

    // サドンデスの問題表示（2026-10-30 追加。項目17）。正解・誤答・スルーで、その問題を Main に出して次の問題へ進む。
    // 番号はラウンド（semifinal）で1つなので、セットをまたいでも続きから進む。
    // scope はセットと種類（勝ち抜け／失格）ごと。別のサドンデスの記録では問題を戻さない
    const { state: questionState, finishQuestion, undoWithQuestion } = useQuestionDisplay(socket, 'semifinal');
    const playoffScope = state.playoff ? `set${state.set}-${state.playoff.purpose}` : '';
    const lastQuestionEvent = questionState.lastEvents?.semifinal;
    const lastIsThrough = !!lastQuestionEvent && lastQuestionEvent.scope === playoffScope && lastQuestionEvent.kind === 'through';

    const markPlayoff = (playerId: number, action: 'correct' | 'wrong') => {
        if (!state.playoff) return;
        if (coverBlocksRound(cover)) {
            notify('Main が待機中のため採点できません。上のバーの「○○を始める ▶」で画面を出してから採点してください。', 'error');
            return;
        }
        const next = addPlayoffAction(state.playoff, playerId, action);
        if (!next) return;
        changeState({ playoff: next });
        // 採点できたら、その問題を Main に出して次の問題へ（Undo の履歴は playoff.actions に積まれる）
        finishQuestion(playoffScope, true);
        actionLog.add({
            who: players.find(p => p.id === playerId)?.name ?? '',
            what: action === 'correct' ? 'サドンデス 正解' : 'サドンデス 誤答',
            tone: action === 'correct' ? 'ok' : 'ng', scope: playoffScope,
        });
    };
    // スルー: 誰も解答しなかった。サドンデスの記録は変えず、問題だけ進める
    const throughPlayoff = () => {
        if (!state.playoff) return;
        if (coverBlocksRound(cover)) {
            notify('Main が待機中のためスルーできません。上のバーの「○○を始める ▶」で画面を出してからにしてください。', 'error');
            return;
        }
        finishQuestion(playoffScope, false);
        actionLog.add({ who: '', what: 'スルー', tone: 'through', scope: playoffScope });
    };
    // サドンデスの Undo（項目15）。2026-10-30 から問題も1つ戻す（直前がスルーなら問題だけ戻す。undoWithQuestion）
    const undoPlayoff = () => {
        const playoff = state.playoff;
        if (!playoff) return;
        void flight.run(async () => {
            const undone = await undoWithQuestion(playoffScope, async () => {
                const next = undoPlayoffAction(playoff);
                if (!next) return false;
                changeState({ playoff: next });
                return true;
            });
            if (undone) actionLog.markUndone(playoffScope);
        });
    };

    // Undo。判定前に戻したのは「得点の反映」なので、入力済みを取り消して振り返りに戻す
    // 得点を確定した直後に戻したときは、得点集計（tally）に戻って入れ直せるようにする（入力欄の値は残す）。
    // 取り消せたら true
    const undoDb = async (): Promise<boolean> => {
        // Final が始まっていたら Undo しない（提案B）
        if (blockUndoIfLaterStarted(progress, 'semifinal')) return false;
        const stageBefore = stage;
        try {
            const res = await fetch('/api/semifinal/undo', { method: 'POST' });
            const data = await res.json();
            if (!data.success) {
                notify(data.error || 'Undo に失敗しました', 'error');
                return false;
            }
            if (socket) socket.emit('broadcast_scores', data.allPlayers);
            setPlayers(data.allPlayers);
            if (stageBefore === 'beforeJudge') {
                changeState({ pointsEntered: false, view: state.view === 'results' ? 'tally' : state.view });
            } else if (state.playoff) {
                changeState({ playoff: null, view: 'results' });
            }
            actionLog.markUndone('semifinal');
            return true;
        } catch (error) {
            notify(errorText(error, '通信に失敗しました。Undo は反映されていません。'), 'error');
            return false;
        }
    };
    const handleUndo = () => flight.run(undoDb);
    // 判定前で、このセットの得点がまだ入っていないときの Undo は前のセットを戻してしまうので押せない
    const canUndo = stage !== 'mismatch' && !(stage === 'beforeJudge' && !state.pointsEntered);

    // サドンデス中は、Undo もサドンデスの1手を戻す（2026-10-29 ユーザー承認）。
    // サドンデスの途中経過は DB に書かないので、DB の Undo を押すとサドンデスより前の判定・得点が
    // 戻ってしまう（そのうえサドンデスが中止になり点数発表に戻っていた）。サドンデス中は DB の Undo を呼ばない
    const inPlayoff = state.playoff !== null;
    // 取り消す採点がある、または直前がこのサドンデスのスルーのときに Undo できる
    const canUndoPlayoff = !!playoffProgress && (playoffProgress.effectiveActions.length > 0 || lastIsThrough);

    // 得点を入力し直す（2026-10-17 変更）。以前は「入力済み」の印を外すだけで、入れ直すと得点が
    // 二重に加算されるおそれがあった。直前の得点入力を Undo で取り消してから得点集計に戻す
    const canReenterPoints = stage === 'beforeJudge' && state.pointsEntered;
    const handleReenterPoints = () => {
        if (!window.confirm(`第${set}セットの得点の確定を取り消して、入力し直しますか？`)) return;
        void flight.run(async () => {
            if (await undoDb()) {
                changeState({ view: 'tally' });
                setDrawer(null);
            }
        });
    };

    // 結果リセット（2026-10-17 追加。2nd / 3rd / Extra Round と同じ位置づけ）。
    // DB（ポイント・勝ち抜け／敗退・Undo 履歴）を API で戻し、進行（セット・タイマーなど）をサーバで戻す。
    // 二つ名・写真は消さない。2026-10-22: Final の結果も一緒にリセットする（一本道の前提）
    const handleReset = () => {
        if (!window.confirm(`Semi-Final の結果（ポイント・勝ち抜け・敗退）をリセットしますか？\n第1セットのクイズ画面に戻り、タイマーも 5:00 に戻ります。（元に戻せません）${cascadeNotice(progress, 'final', false)}`)) return;
        void flight.run(async () => {
            try {
                const res = await fetch('/api/semifinal/reset', { method: 'POST' });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    notify(data.error || 'リセットに失敗しました', 'error');
                    return;
                }
                // Semi-Final・Final の進行状態も戻す（サーバの reset_round_progress）
                broadcastAfterReset(socket, 'semifinal', data);
                setPlayers(data.allPlayers);
                setPointInputs({});
                setRangeFrom("");
                setRangeTo("");
                actionLog.add({ who: '', what: 'Semi-Final をリセット', tone: 'other', scope: 'reset' });
                setDrawer(null);
            } catch (error) {
                notify(errorText(error, '通信に失敗しました。リセットは反映されていません。'), 'error');
            }
        });
    };

    const handleTimerReset = () => {
        if (window.confirm('タイマーを5分に戻しますか？')) changeTimer('reset');
    };
    const handleTimerEditStart = () => {
        setEditMinutes(Math.floor(remaining / 60));
        setEditSeconds(remaining % 60);
        setIsEditingTimer(true);
    };
    const handleTimerEditSave = () => {
        if (socket) socket.emit('change_semifinal_timer', { action: 'edit', seconds: editMinutes * 60 + editSeconds });
        setIsEditingTimer(false);
    };

    // ---- 進出者紹介の進め方。二つ名が無い選手は二つ名の画面を飛ばす（2026-10-15 ユーザー決定） ----
    // 敗者復活者は未登録でも「敗者復活」を出すので、二つ名の画面を飛ばさない（2026-10-31 項目13）
    const hasNickname = (i: number) => {
        const p = introOrder[i];
        return !!p && displayNickname(p, profiles.find(pr => pr.playerId === p.id)) !== '';
    };
    const firstStepOf = (i: number): 'nickname' | 'profile' => hasNickname(i) ? 'nickname' : 'profile';
    const introNext = () => {
        const i = state.introIndex;
        if (state.introStep === 'nickname') changeState({ introStep: 'profile' });
        else if (i < introOrder.length - 1) changeState({ introIndex: i + 1, introStep: firstStepOf(i + 1) });
        else if (socket) socket.emit('start_semifinal_lineup');
    };
    const introBack = () => {
        const i = state.introIndex;
        if (state.introStep === 'profile' && hasNickname(i)) changeState({ introStep: 'nickname' });
        else if (i > 0) changeState({ introIndex: i - 1, introStep: 'profile' });
        else changeState({ view: 'standby' });
    };

    // ---- 1本道ボタン ----
    let onAirDetail = VIEW_LABELS[state.view];
    let primaryLabel = '';
    let primaryAction: (() => void) | null = null;
    let backLabel: string | null = null;
    let backAction: (() => void) | null = null;

    const rangeReady = /^\d+$/.test(rangeFrom.trim()) && /^\d+$/.test(rangeTo.trim())
        && Number(rangeFrom) >= 1 && Number(rangeFrom) <= Number(rangeTo);

    if (entrants.length === 0) {
        primaryLabel = '出場者が未確定です';
    } else if (state.view === 'standby') {
        primaryLabel = '進出者紹介へ ▶';
        if (introOrder.length > 0) primaryAction = () => changeState({ view: 'intro', introIndex: 0, introStep: firstStepOf(0) });
    } else if (state.view === 'intro') {
        const i = state.introIndex;
        onAirDetail = `進出者紹介 ${i + 1} / ${introOrder.length}（${state.introStep === 'nickname' ? '二つ名' : 'プロフィール'}）`;
        if (state.introStep === 'nickname') primaryLabel = '写真・プロフィールを表示 ▶';
        else primaryLabel = i < introOrder.length - 1 ? `${i + 2}人目へ ▶` : '選手カードを表示 ▶';
        primaryAction = introNext;
        backLabel = '◀ 戻る';
        backAction = introBack;
    } else if (state.view === 'lineup') {
        if (!lineupDone) {
            primaryLabel = '表示中…';
        } else {
            primaryLabel = `第${set}セット クイズ画面へ ▶`;
            primaryAction = () => changeState({ view: 'quiz' });
        }
        backLabel = '◀ 戻る';
        backAction = () => changeState({ view: 'intro', introIndex: Math.max(0, introOrder.length - 1), introStep: 'profile' });
    } else if (stage === 'mismatch') {
        // サーバ再起動などで、表示中のセットと DB の進み具合が合わない。DB から正しいセットを示す
        onAirDetail = 'セットの進み具合が合いません';
        const suggested = findSemifinalCurrentSet(entrants);
        if (suggested !== null && suggested !== set) {
            primaryLabel = `第${suggested}セットへ ▶`;
            primaryAction = () => changeState({ set: suggested });
        } else {
            primaryLabel = '「表示の切り替え」でセットを選び直してください';
        }
    } else if (stage === 'complete') {
        // ⑨ このセットの勝ち抜け・敗退が確定。次のセットのクイズ画面へ（サーバが表示を quiz にする）
        if (set < 3) {
            primaryLabel = `第${set + 1}セット クイズ画面へ ▶`;
            primaryAction = () => changeState({ set: set + 1 });
        } else {
            // 決勝へはモードごと切り替える（Admin・Main とも決勝の画面になる）。
            // 決勝は待機画面から始めるので、先に決勝の表示を待機に戻しておく（2026-10-17）
            // 2026-10-22: ボタン名は他のラウンドと同じ「Final へ ▶」（提案A）
            onAirDetail = '終了';
            ({ label: primaryLabel, action: primaryAction } = nextRoundPrimary(socket, progress, 'semifinal',
                () => socket?.emit('change_final_state', { view: 'standby', introIndex: 0 })));
        }
    } else if (state.view === 'playoff' && state.playoff && playoffProgress) {
        // ⑦⑧ 同点のサドンデス。決着したら、その目的（勝ち抜け／敗退）の判定をサドンデスの結果で確定する
        if (playoffProgress.resolved) {
            primaryLabel = '結果を確定 ▶';
            const result = { purpose: state.playoff.purpose, chosenIds: playoffProgress.chosenIds };
            primaryAction = () => { void judge(result.purpose, result); };
        } else {
            primaryLabel = 'サドンデス中...';
        }
    } else if (stage === 'advanced') {
        // ⑧ 勝ち抜けが確定済み。続けて敗退判定
        primaryLabel = '敗退判定 ▶';
        primaryAction = () => { void judge('eliminate'); };
    } else if (state.view === 'quiz') {
        // ①② タイマー開始 → 計測中。③ タイムアップしたら、振り返る問題の番号を入れて振り返りへ
        if (isTimerRunning) {
            primaryLabel = '計測中...';
        } else if (remaining > 0) {
            primaryLabel = remaining === SET_TIME_LIMIT_SECONDS ? 'タイマー START ▶' : 'タイマー再開 ▶';
            primaryAction = () => changeTimer('start');
        } else {
            onAirDetail = 'タイムアップ';
            primaryLabel = '問題振り返りへ ▶';
            if (rangeReady) primaryAction = () => { void goReview(); };
        }
    } else if (state.view === 'review') {
        // ④ 振り返り。最後のページまで見たら得点集計へ
        onAirDetail = `振り返り ${page + 1} / ${Math.max(1, pageCount)}`;
        if (!isLastPage) {
            primaryLabel = '次の3問 ▶';
            primaryAction = () => changeState({ reviewPage: page + 1 });
        } else {
            primaryLabel = '得点集計へ ▶';
            primaryAction = () => changeState({ view: 'tally' });
        }
        if (page > 0) {
            backLabel = '◀ 前の3問';
            backAction = () => changeState({ reviewPage: page - 1 });
        }
    } else if (state.view === 'tally') {
        // ⑤ 得点集計。全員の得点を入れて確定 → 点数発表へ
        if (!state.pointsEntered) {
            primaryLabel = '得点を確定 ▶';
            if (allPointsValid(activeInSeatOrder, pointInputs)) primaryAction = () => { void submitPoints(); };
            backLabel = '◀ 振り返りに戻る';
            backAction = () => changeState({ view: 'review' });
        } else {
            primaryLabel = '点数発表へ ▶';
            primaryAction = announce;
        }
    } else if (state.view === 'results') {
        // ⑥ 点数発表の演出が終わったら ⑦ 勝ち抜け判定
        if (!announceDone) {
            primaryLabel = '発表中...';
        } else if (!state.pointsEntered) {
            primaryLabel = '得点が未確定です（「表示の切り替え」で得点集計へ）';
        } else {
            primaryLabel = '勝ち抜け判定 ▶';
            primaryAction = () => { void judge('advance'); };
        }
    } else {
        primaryLabel = '「表示の切り替え」で表示を選び直してください';
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
            <DrawerGroup label="セット">
                {[1, 2, 3].map(s => (
                    <button key={s} type="button" className={set === s ? styles.btnOn : styles.btn} onClick={() => changeState({ set: s })}>第{s}セット</button>
                ))}
            </DrawerGroup>
            <DrawerGroup label="Main 表示">
                {MANUAL_VIEWS.map(v => {
                    const blocked = (v === 'review' || v === 'tally') && !range;
                    return (
                        <button key={v} type="button" className={state.view === v ? styles.btnOn : styles.btn}
                            onClick={() => changeState({ view: v })} disabled={blocked} style={blocked ? { opacity: .35 } : undefined}>
                            {VIEW_LABELS[v]}
                        </button>
                    );
                })}
            </DrawerGroup>
            <DrawerGroup label="やり直し" note="得点の確定を取り消して入力し直すときと、サドンデスをやめるときに使います。">
                <button type="button" className={styles.btn} onClick={handleReenterPoints} disabled={flight.pending || !canReenterPoints}>得点を入力し直す</button>
                {state.playoff && (
                    <button type="button" className={styles.btn}
                        onClick={() => { if (window.confirm('サドンデスを中止しますか？')) { changeState({ playoff: null }); setDrawer(null); } }}>
                        サドンデスを中止
                    </button>
                )}
            </DrawerGroup>
            <div className={styles.note}>通常は使いません。進行は上のバーの右端のボタンで行います。</div>
        </Drawer>
    );
    const drawerData = drawer === 'data' && (
        <Drawer title="データ修正" onClose={() => setDrawer(null)}>
            <DrawerGroup label="タイマー" note="編集すると時計は止まります。疑義で時間を戻すときや、開始を忘れたときに使います。">
                <button type="button" className={styles.btn} onClick={handleTimerReset}>RESET（5:00）</button>
                {!isEditingTimer ? (
                    <button type="button" className={styles.btn} onClick={handleTimerEditStart}>EDIT</button>
                ) : (
                    <>
                        <input type="number" min={0} max={5} value={editMinutes} aria-label="分" className={styles.input} style={{ width: 64 }}
                            onChange={e => setEditMinutes(Math.max(0, Number(e.target.value) || 0))} />
                        <span className={styles.note}>分</span>
                        <input type="number" min={0} max={59} value={editSeconds} aria-label="秒" className={styles.input} style={{ width: 64 }}
                            onChange={e => setEditSeconds(Math.max(0, Number(e.target.value) || 0))} />
                        <span className={styles.note}>秒</span>
                        <button type="button" className={styles.btnOn} onClick={handleTimerEditSave}>SAVE</button>
                        <button type="button" className={styles.btn} onClick={() => setIsEditingTimer(false)}>CANCEL</button>
                    </>
                )}
            </DrawerGroup>
            <DrawerGroup label="Semi-Final の結果" note="ポイント・勝ち抜け・敗退と Undo の履歴を消して、第1セットのクイズ画面に戻します。写真・二つ名は消しません。元に戻せません。">
                <button type="button" className={styles.btnDanger} onClick={handleReset} disabled={flight.pending}>Semi-Final の結果をリセット</button>
            </DrawerGroup>
            <div className={styles.note}>1手だけ戻すときは、上のバーの Undo を使ってください。</div>
        </Drawer>
    );

    // ---- 作業面 ----
    const opening = OPENING_VIEWS.includes(state.view);
    const showRangeForm = state.view === 'quiz' && stage === 'beforeJudge' && remaining === 0 && !isTimerRunning;
    let work: ReactNode;
    if (state.view === 'standby') {
        // 準備: 写真・二つ名の登録（登録の画面は載せ替え前のまま。大会前に済ませる作業のため）
        work = (
            <>
                <WorkHead meta={<MetaItem label="進出者" value={`${introOrder.length}名`} />} tools={tools} />
                <div className={styles.scrollBox} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <PrepPanel socket={socket} introOrder={introOrder} revived={revived} profiles={profiles} onError={notifyError} />
                </div>
            </>
        );
    } else if (state.view === 'intro') {
        work = (
            <>
                <WorkHead meta={<MetaItem label="紹介" value={`${state.introIndex + 1} / ${introOrder.length}`} />} tools={tools} />
                <IntroView introOrder={introOrder} index={state.introIndex} step={state.introStep} profiles={profiles} />
            </>
        );
    } else if (state.view === 'lineup') {
        work = (
            <>
                <WorkHead meta={<MetaItem label="選手" value={`${lineupOrder.length}名`} />} tools={tools} />
                <LineupView lineupOrder={lineupOrder} revived={revived} allShown={lineupDone} />
            </>
        );
    } else {
        const meta = (
            <>
                <MetaItem label="セット" value={`${set} / 3`} />
                {range && state.view !== 'quiz' && <MetaItem label="振り返り範囲" value={`No.${range.from}〜${range.to}`} />}
                <MetaItem label="対象" value={`${activeSorted.length}名`} />
            </>
        );
        let body: ReactNode;
        if (state.view === 'review' && range) {
            body = reviewQuestions.length > 0
                ? <ReviewList questions={reviewQuestions} />
                : <div className={styles.empty}>問題を読み込み中…</div>;
        } else if (state.view === 'tally' && stage === 'beforeJudge') {
            body = (
                <>
                    <StandingsRow entrants={entrants}
                        points={{ values: pointInputs, onChange: (id, v) => setPointInputs(prev => ({ ...prev, [id]: v })), disabled: state.pointsEntered || flight.pending }} />
                    <div className={styles.hint}>
                        {state.pointsEntered
                            ? `第${set}セットの得点を確定しました。上のバーの「点数発表へ」で Main に発表します。入れ直すときは「表示の切り替え」の「得点を入力し直す」。`
                            : '勝ち抜け・敗退が決まっていない選手の得点を入れて、上のバーの「得点を確定」を押します（例: 5、-3、＋2）。'}
                    </div>
                </>
            );
        } else if (state.view === 'playoff' && state.playoff && playoffProgress) {
            body = (
                <>
                    <QuestionStrip socket={socket} round="semifinal" state={questionState} />
                    <PlayoffRow playoff={state.playoff} progress={playoffProgress} seats={seats} busy={flight.pending} onMark={markPlayoff} />
                    <button type="button" className={styles.through} onClick={throughPlayoff} disabled={flight.pending || playoffProgress.resolved}>スルー（誰も答えなかった）</button>
                    <div className={styles.hint}>
                        {state.playoff.purpose === 'advance' ? '勝ち抜け' : '失格'}サドンデス（{state.playoff.purpose === 'advance' ? '勝ち抜け' : '失格'} {state.playoff.slots}名）。
                        正解・誤答・スルーで、その問題を Main に出して次の問題へ進みます。
                    </div>
                </>
            );
        } else if (stage === 'complete' && set === 3) {
            body = (
                <>
                    <StandingsRow entrants={lineupOrder} showSet />
                    <div className={styles.hint}>
                        第3セットの判定が終わりました。決勝進出者を確認して「Final へ」を押すと、Admin・Main とも決勝の画面に切り替わります。
                    </div>
                </>
            );
        } else {
            body = (
                <>
                    {showRangeForm && <RangeForm from={rangeFrom} to={rangeTo} onFrom={setRangeFrom} onTo={setRangeTo} />}
                    <StandingsRow entrants={entrants} />
                </>
            );
        }
        work = (
            <>
                <WorkHead meta={meta} tools={tools} />
                {body}
            </>
        );
    }

    const undoScope = inPlayoff ? playoffScope : 'semifinal';
    return (
        <ConsoleFrame
            onAir={opening && state.view === 'standby' ? 'Semi-Final' : `Semi-Final　第${set}セット`}
            onAirDetail={cover.kind !== 'none' ? describeCover(cover) : onAirDetail}
            barExtra={<>
                {backLabel && (
                    <button type="button" className={styles.btn} onClick={() => runGuarded(backAction)} disabled={flight.pending}>{backLabel}</button>
                )}
                {!opening && (
                    <TimerChip remaining={remaining} isRunning={isTimerRunning} urgentAt={60}
                        onStart={() => changeTimer('start')} onStop={() => changeTimer('stop')} />
                )}
                <CoverButtons cover={cover} setCover={setCover} forceRelease={coverControls.forceRelease} className={styles.btn} />
            </>}
            undo={{
                detail: actionLog.lastLabel(undoScope),
                onClick: inPlayoff ? undoPlayoff : () => { void handleUndo(); },
                disabled: flight.pending || (inPlayoff ? !canUndoPlayoff : !canUndo),
            }}
            next={{ label: primaryLabel, onClick: primaryAction }}
            side={<ConsoleSide socket={socket} round="semifinal" state={questionState} log={actionLog.entries} />}
        >
            {work}
            {drawerView}
            {drawerData}
        </ConsoleFrame>
    );
}
