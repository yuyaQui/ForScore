import { Socket } from "socket.io-client";
import { useState, useEffect, useRef, useCallback } from "react";
import type { Player, ThirdRoundCourse, SemifinalState, SemifinalTimer, SemifinalView } from "@/lib/types";
import { DEFAULT_SEMIFINAL_STATE } from "@/lib/types";
import { getSemifinalSeats, SET_TIME_LIMIT_SECONDS } from "@/lib/semifinal";
import {
    getActiveSortedByPoint, getSemifinalSetStage, planSemifinalJudgement, findSemifinalCurrentSet, type SemifinalJudgeStep,
} from "@/lib/semifinalScoring";
import { getPlayoffProgress, addPlayoffAction, undoPlayoffAction } from "@/lib/semifinalPlayoff";
import { buildAnnouncePlan, ANNOUNCE_START_DELAY_MS } from "@/lib/semifinalAnnounce";
import type { PoolQuestion } from "@/lib/questionPool";
import {
    MANUAL_LABEL_STYLE, STAT_CARD_STYLE, STAT_LABEL_STYLE,
    manualPanelStyle, manualBtnStyle, manualBtnTextStyle, dangerBtnStyle, neutralBtnStyle,
    DANGER_BTN_TEXT, NEUTRAL_BTN_TEXT, primaryButtonStyle,
} from "./adminCyberStyles";
import {
    SemifinalTimerCard, SemifinalStandings, ReviewRangeForm, ReviewPreview, PointsForm, PlayoffPanel, parsePointInput, allPointsValid,
} from "./AdminSemifinalParts";
import { getIntroOrder, getLineupOrder, lineupTotalMs } from "@/lib/semifinalProfile";
import { useSemifinalProfiles, PrepPanel, IntroPanel, LineupPanel, FinishPanel } from "./AdminSemifinalPrep";
import { useRoundProgress, nextRoundPrimary, blockUndoIfLaterStarted, cascadeNotice, broadcastAfterReset } from "./roundProgressContext";

type Props = {
    socket: Socket | null;
}

/** 振り返り1ページの問題数（2026-10-10 ユーザー決定） */
const REVIEW_PAGE_SIZE = 3;
/** 1本道ボタンの連打防止（Extra Round と同じ。ボタンが同じ位置で入れ替わるため） */
const CLICK_GUARD_MS = 800;

const VIEW_LABELS: Record<SemifinalView, string> = {
    standby: '準備', intro: '進出者紹介', lineup: '選手カード表示', quiz: 'クイズ', review: '振り返り', tally: '得点集計', results: '点数発表', playoff: 'サドンデス',
};
/** 手動操作で切り替えられる Main 表示（サドンデスは判定からだけ始める） */
const MANUAL_VIEWS: SemifinalView[] = ['standby', 'intro', 'lineup', 'quiz', 'review', 'tally', 'results'];

function nameList(players: Player[], ids: number[]): string {
    return ids.map(id => players.find(p => p.id === id)?.name ?? `#${id}`).join('、');
}

// 準決勝: 3セット制タイムレース Nine Hundred の管理画面（設計メモ 6章）。
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
// 進行は上の1本道ボタンだけで完結し、直接切り替え・Undo は「手動操作」に退避する（他ラウンドと同じ）。
//
// 勝ち抜け・失格・ポイントは DB、表示の段階・振り返り範囲・サドンデスの進行はサーバのメモリ
// （server/SemifinalHandler.js）が持つ。「判定がどこまで進んだか」は DB から導く（getSemifinalSetStage）。
export default function AdminSemifinal(props: Props) {
    const { socket } = props;

    const [players, setPlayers] = useState<Player[]>([]);
    const [courses, setCourses] = useState<ThirdRoundCourse[]>([]);
    // サーバから届くまでは null（初期値で入力欄を作ってしまわないように）
    const [receivedState, setState] = useState<SemifinalState | null>(null);
    const state = receivedState ?? DEFAULT_SEMIFINAL_STATE;
    const [timer, setTimer] = useState<SemifinalTimer>({ remainings: {}, runningSet: null });
    const [isBusy, setIsBusy] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");

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

    useEffect(() => {
        fetch('/api/secondRound/loadPlayers').then(res => res.json()).then(data => {
            if (data.success) setPlayers(data.allPlayers);
        });
        fetch('/api/thirdRound/courses').then(res => res.json()).then(data => {
            if (data.success) setCourses(data.courses);
        });

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
            // 接続直後の配信はこの画面が無いうちに届いて失われるので、表示した時点で取り直す
            socket.emit("request_semifinal_sync");

            return () => {
                socket.off("update_semifinal_state", handleStateUpdate);
                socket.off("update_semifinal_timer", handleTimerUpdate);
                socket.off("update_players", handlePlayersUpdate);
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
            else setErrorMessage(data.error || '問題を読み込めません');
        }).catch(() => { if (!cancelled) setErrorMessage('通信に失敗しました'); });
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

    const postScore = async (body: Record<string, unknown>): Promise<Player[] | null> => {
        const res = await fetch('/api/semifinal/updateScore', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!data.success) {
            setErrorMessage(data.error || '更新に失敗しました');
            return null;
        }
        if (socket) socket.emit('broadcast_scores', data.allPlayers);
        setPlayers(data.allPlayers);
        return data.allPlayers;
    };

    const goReview = async () => {
        const from = Number(rangeFrom.trim());
        const to = Number(rangeTo.trim());
        setErrorMessage("");
        setIsBusy(true);
        try {
            const res = await fetch(`/api/questions?from=${from}&to=${to}`);
            const data = await res.json();
            if (!data.success) {
                setErrorMessage(data.error || '問題を読み込めません');
                return;
            }
            changeState({ reviewRange: { from, to }, view: 'review' });
        } catch {
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    const submitPoints = async () => {
        const entries = activeInSeatOrder.map(p => ({ playerId: p.id, delta: parsePointInput(pointInputs[p.id] ?? '') }));
        if (entries.some(e => e.delta === null)) return;
        const summary = activeInSeatOrder.map((p, i) => `${p.name}: ${entries[i].delta! > 0 ? '+' : ''}${entries[i].delta}`).join('\n');
        if (!window.confirm(`第${set}セットの得点を確定しますか？\n\n${summary}`)) return;
        setErrorMessage("");
        setIsBusy(true);
        try {
            const updated = await postScore({ action: 'points', set, entries });
            if (updated) changeState({ pointsEntered: true });
        } catch {
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    const announce = () => {
        if (socket) socket.emit('announce_semifinal_results', { set });
    };

    // 判定。確定できるところまで API で確定し、同点が残ればサドンデスを始める
    // 判定。2026-10-17 から勝ち抜け（advance）と敗退（eliminate）を別のボタンで1つずつ行う。
    // planSemifinalJudgement は確定できるところまで続けて組み立てるので、今回の目的の手順だけを使う。
    // 同点ならサドンデスを始め、サドンデス後の「結果を確定」では playoffResult を渡して確定する
    const judge = async (purpose: 'advance' | 'eliminate', playoffResult?: { purpose: 'advance' | 'eliminate'; chosenIds: number[] }) => {
        const plan = planSemifinalJudgement(entrants, set, playoffResult);
        if (plan.error) {
            setErrorMessage(plan.error);
            return;
        }
        const action = purpose === 'advance' ? 'judgeAdvance' : 'judgeEliminate';
        const steps = plan.steps.filter(step => step.action === action);
        const playoff = plan.playoff && plan.playoff.purpose === purpose ? plan.playoff : null;
        const label = purpose === 'advance' ? '勝ち抜け' : '敗退';
        const describe = (step: SemifinalJudgeStep) => `${label}: ${nameList(entrants, step.playerIds)}`;
        if (steps.length > 0 && !window.confirm(`${label}を確定しますか？\n\n${steps.map(describe).join('\n')}`)) return;

        setErrorMessage("");
        setIsBusy(true);
        try {
            for (const step of steps) {
                const updated = await postScore({ action: step.action, set, chosenIds: step.chosenIds });
                if (!updated) return;
            }
            if (playoff) {
                changeState({ playoff: { ...playoff, set, actions: [] }, view: 'playoff' });
            } else if (state.playoff) {
                changeState({ playoff: null, view: 'results' });
            }
        } catch {
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };

    const markPlayoff = (playerId: number, action: 'correct' | 'wrong') => {
        if (!state.playoff) return;
        const next = addPlayoffAction(state.playoff, playerId, action);
        if (next) changeState({ playoff: next });
    };
    const undoPlayoff = () => {
        if (!state.playoff) return;
        const next = undoPlayoffAction(state.playoff);
        if (next) changeState({ playoff: next });
    };

    // Undo。判定前に戻したのは「得点の反映」なので、入力済みを取り消して振り返りに戻す
    // 得点を確定した直後に戻したときは、得点集計（tally）に戻って入れ直せるようにする（入力欄の値は残す）
    const handleUndo = async () => {
        // Final が始まっていたら Undo しない（提案B）
        if (blockUndoIfLaterStarted(progress, 'semifinal')) return;
        const stageBefore = stage;
        setErrorMessage("");
        setIsBusy(true);
        try {
            const res = await fetch('/api/semifinal/undo', { method: 'POST' });
            const data = await res.json();
            if (!data.success) {
                setErrorMessage(data.error || 'Undo に失敗しました');
                return;
            }
            if (socket) socket.emit('broadcast_scores', data.allPlayers);
            setPlayers(data.allPlayers);
            if (stageBefore === 'beforeJudge') {
                changeState({ pointsEntered: false, view: state.view === 'results' ? 'tally' : state.view });
            } else if (state.playoff) {
                changeState({ playoff: null, view: 'results' });
            }
        } catch {
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
    };
    // 判定前で、このセットの得点がまだ入っていないときの Undo は前のセットを戻してしまうので押せない
    const canUndo = !isBusy && stage !== 'mismatch' && !(stage === 'beforeJudge' && !state.pointsEntered);

    // サドンデス中は、手動操作の Undo もサドンデスの1手を戻す（2026-10-29 ユーザー承認）。
    // サドンデスの途中経過は DB に書かないので、DB の Undo を押すとサドンデスより前の判定・得点が
    // 戻ってしまう（そのうえサドンデスが中止になり点数発表に戻っていた）。サドンデス中は DB の Undo を呼ばない
    const inPlayoff = state.playoff !== null;
    const canUndoPlayoff = !isBusy && !!playoffProgress && playoffProgress.effectiveActions.length > 0;

    // 得点を入力し直す（2026-10-17 変更）。以前は「入力済み」の印を外すだけで、入れ直すと得点が
    // 二重に加算されるおそれがあった。直前の得点入力を Undo で取り消してから得点集計に戻す
    const canReenterPoints = !isBusy && stage === 'beforeJudge' && state.pointsEntered;
    const handleReenterPoints = async () => {
        if (!window.confirm(`第${set}セットの得点の確定を取り消して、入力し直しますか？`)) return;
        await handleUndo();
        changeState({ view: 'tally' });
    };

    // 結果リセット（2026-10-17 追加。2nd / 3rd / Extra Round と同じ位置づけ）。
    // DB（ポイント・勝ち抜け／敗退・Undo 履歴）を API で戻し、進行（セット・タイマーなど）をサーバで戻す。
    // 二つ名・写真は消さない。2026-10-22: Final の結果も一緒にリセットする（一本道の前提）
    const handleReset = async () => {
        if (!window.confirm(`Semi-Final の結果（ポイント・勝ち抜け・敗退）をリセットしますか？\n第1セットのクイズ画面に戻り、タイマーも 5:00 に戻ります。（元に戻せません）${cascadeNotice(progress, 'final', false)}`)) return;
        setErrorMessage("");
        setIsBusy(true);
        try {
            const res = await fetch('/api/semifinal/reset', { method: 'POST' });
            const data = await res.json();
            if (!res.ok || !data.success) {
                setErrorMessage(data.error || 'リセットに失敗しました');
                return;
            }
            // Semi-Final・Final の進行状態も戻す（サーバの reset_round_progress）
            broadcastAfterReset(socket, 'semifinal', data);
            setPlayers(data.allPlayers);
            setPointInputs({});
            setRangeFrom("");
            setRangeTo("");
        } catch {
            setErrorMessage('通信に失敗しました');
        } finally {
            setIsBusy(false);
        }
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
    const hasNickname = (i: number) => {
        const p = introOrder[i];
        return !!p && (profiles.find(pr => pr.playerId === p.id)?.nickname ?? '') !== '';
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
    let statusLabel = `SEMIFINAL · SET ${set} · ${VIEW_LABELS[state.view]}`;
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
        statusLabel = `SEMIFINAL · 進出者紹介 · ${i + 1} / ${introOrder.length} · ${state.introStep === 'nickname' ? '二つ名' : 'プロフィール'}`;
        if (state.introStep === 'nickname') primaryLabel = '写真・プロフィールを表示 ▶';
        else primaryLabel = i < introOrder.length - 1 ? `${i + 2}人目へ ▶` : '選手カードを表示 ▶';
        primaryAction = introNext;
        backLabel = '◀ 戻る';
        backAction = introBack;
    } else if (state.view === 'lineup') {
        statusLabel = 'SEMIFINAL · 選手カード表示';
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
        statusLabel = `SEMIFINAL · SET ${set}`;
        const suggested = findSemifinalCurrentSet(entrants);
        if (suggested !== null && suggested !== set) {
            primaryLabel = `第${suggested}セットへ ▶`;
            primaryAction = () => changeState({ set: suggested });
        } else {
            primaryLabel = '手動操作でセットを選び直してください';
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
            statusLabel = 'SEMIFINAL · 終了';
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
            statusLabel = `SEMIFINAL · SET ${set} · クイズ`;
            primaryLabel = remaining === SET_TIME_LIMIT_SECONDS ? 'タイマー START ▶' : 'タイマー再開 ▶';
            primaryAction = () => changeTimer('start');
        } else {
            statusLabel = `SEMIFINAL · SET ${set} · タイムアップ`;
            primaryLabel = '問題振り返りへ ▶';
            if (rangeReady) primaryAction = () => { void goReview(); };
        }
    } else if (state.view === 'review') {
        // ④ 振り返り。最後のページまで見たら得点集計へ
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
            primaryLabel = '得点が未確定です（手動操作で得点集計へ）';
        } else {
            primaryLabel = '勝ち抜け判定 ▶';
            primaryAction = () => { void judge('advance'); };
        }
    } else {
        primaryLabel = '手動操作で表示を選び直してください';
    }

    return (
        <div className="flex flex-col gap-4 bg-white dark:bg-zinc-800 p-6 rounded-xl shadow-md w-full max-w-[1900px]">
            <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 border-b pb-4 border-zinc-200 dark:border-zinc-700">
                Semifinal 管理画面
            </h2>

            {errorMessage && (
                <div className="px-4 py-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300 text-sm font-bold">
                    {errorMessage}
                </div>
            )}

            <div className="flex flex-col items-center gap-3 bg-black py-5 rounded-none">
                <div className="text-xs tracking-[0.3em] text-[#5C7EA6] font-mono">{statusLabel}</div>
                <div className="flex flex-wrap items-center justify-center gap-4 px-4">
                    {backLabel && (
                        <button onClick={() => runGuarded(backAction)} disabled={isBusy} style={{ ...neutralBtnStyle(), padding: '18px 28px' }}>
                            <span style={{ ...NEUTRAL_BTN_TEXT, fontSize: 16 }}>{backLabel}</span>
                        </button>
                    )}
                    <button onClick={() => runGuarded(primaryAction)} disabled={!primaryAction || isBusy} style={primaryButtonStyle(!!primaryAction && !isBusy)}>
                        {primaryLabel}
                    </button>
                </div>
            </div>

            <details className="group">
                <summary
                    className="flex cursor-pointer select-none items-center gap-[10px] bg-black px-5 py-4 [&::-webkit-details-marker]:hidden"
                    style={{ listStyle: 'none' }}
                >
                    <span className="inline-block transition-transform duration-150 group-open:rotate-90" style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 15, letterSpacing: 2, color: '#7FA8D9' }}>▸</span>
                    <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 15, letterSpacing: 3, color: '#7FA8D9' }}>手動操作</span>
                </summary>
                <div className="flex flex-col gap-[22px] bg-black px-5 pb-6 pt-4">
                    <div style={{ height: 1, background: 'rgba(79,216,255,.22)', flexShrink: 0 }} />
                    <div className="flex flex-wrap gap-[18px]">
                        <div style={manualPanelStyle(true, 1.2)}>
                            <div style={MANUAL_LABEL_STYLE}>セット</div>
                            <div className="flex flex-wrap gap-[10px]">
                                {[1, 2, 3].map(s => (
                                    <button key={s} onClick={() => changeState({ set: s })} style={manualBtnStyle(set === s)}>
                                        <span style={manualBtnTextStyle(set === s)}>第{s}セット</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div style={manualPanelStyle(true, 1.4)}>
                            <div style={MANUAL_LABEL_STYLE}>Main 表示</div>
                            <div className="flex flex-wrap gap-[10px]">
                                {MANUAL_VIEWS.map(v => (
                                    <button key={v} onClick={() => changeState({ view: v })} disabled={(v === 'review' || v === 'tally') && !range} style={{ ...manualBtnStyle(state.view === v), opacity: (v === 'review' || v === 'tally') && !range ? 0.35 : 1 }}>
                                        <span style={manualBtnTextStyle(state.view === v)}>{VIEW_LABELS[v]}</span>
                                    </button>
                                ))}
                                <button onClick={() => { void handleReenterPoints(); }} disabled={!canReenterPoints} style={{ ...neutralBtnStyle(), opacity: canReenterPoints ? 1 : 0.35 }}>
                                    <span style={NEUTRAL_BTN_TEXT}>得点を入力し直す</span>
                                </button>
                                {state.playoff && (
                                    <button onClick={() => { if (window.confirm('サドンデスを中止しますか？')) changeState({ playoff: null }); }} style={neutralBtnStyle()}>
                                        <span style={NEUTRAL_BTN_TEXT}>サドンデスを中止</span>
                                    </button>
                                )}
                            </div>
                        </div>
                        <div style={manualPanelStyle(true, 1.6)}>
                            <div style={MANUAL_LABEL_STYLE}>タイマー・データ操作</div>
                            <div className="flex flex-wrap items-center gap-[10px]">
                                <button onClick={handleTimerReset} style={neutralBtnStyle()}>
                                    <span style={NEUTRAL_BTN_TEXT}>RESET（5:00）</span>
                                </button>
                                {!isEditingTimer ? (
                                    <button onClick={handleTimerEditStart} style={neutralBtnStyle()}>
                                        <span style={NEUTRAL_BTN_TEXT}>EDIT</span>
                                    </button>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <input type="number" min={0} max={5} value={editMinutes} onChange={e => setEditMinutes(Math.max(0, Number(e.target.value) || 0))} className="w-16 px-2 py-1.5 bg-zinc-900 border border-zinc-600 text-white text-right font-mono" />
                                        <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 12, color: '#9FB4D6' }}>分</span>
                                        <input type="number" min={0} max={59} value={editSeconds} onChange={e => setEditSeconds(Math.max(0, Number(e.target.value) || 0))} className="w-16 px-2 py-1.5 bg-zinc-900 border border-zinc-600 text-white text-right font-mono" />
                                        <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 12, color: '#9FB4D6' }}>秒</span>
                                        <button onClick={handleTimerEditSave} style={manualBtnStyle(true)}><span style={manualBtnTextStyle(true)}>SAVE</span></button>
                                        <button onClick={() => setIsEditingTimer(false)} style={manualBtnStyle(false)}><span style={manualBtnTextStyle(false)}>CANCEL</span></button>
                                    </div>
                                )}
                                <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(79,216,255,.18)', margin: '0 4px' }} />
                                {inPlayoff ? (
                                    <>
                                        <button onClick={undoPlayoff} disabled={!canUndoPlayoff} style={{ ...dangerBtnStyle(), opacity: canUndoPlayoff ? 1 : 0.35 }}>
                                            <span style={DANGER_BTN_TEXT}>Undo（サドンデス）</span>
                                        </button>
                                        {!canUndoPlayoff && (
                                            <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontSize: 12, color: '#9FB4D6' }}>
                                                サドンデスをやめるときは「サドンデスを中止」
                                            </span>
                                        )}
                                    </>
                                ) : (
                                    <button onClick={handleUndo} disabled={!canUndo} style={{ ...dangerBtnStyle(), opacity: canUndo ? 1 : 0.35 }}>
                                        <span style={DANGER_BTN_TEXT}>Undo</span>
                                    </button>
                                )}
                                <button onClick={() => { void handleReset(); }} disabled={isBusy} style={{ ...dangerBtnStyle(), opacity: isBusy ? 0.35 : 1 }}>
                                    <span style={DANGER_BTN_TEXT}>Semifinal の結果をリセット</span>
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
                {/* 始まり（準備・紹介・カード表示）と終了は専用の表示。それ以外はセットの進行 */}
                {state.view === 'standby' && (
                    <PrepPanel socket={socket} introOrder={introOrder} revived={revived} profiles={profiles} onError={setErrorMessage} />
                )}
                {state.view === 'intro' && (
                    <IntroPanel introOrder={introOrder} index={state.introIndex} step={state.introStep} profiles={profiles} />
                )}
                {state.view === 'lineup' && (
                    <LineupPanel lineupOrder={lineupOrder} revived={revived} allShown={lineupDone} />
                )}
                {stage === 'complete' && set === 3 && !['standby', 'intro', 'lineup'].includes(state.view) && (
                    <FinishPanel lineupOrder={lineupOrder} />
                )}
                {!['standby', 'intro', 'lineup'].includes(state.view) && (<>
                <div className="flex gap-[14px] flex-wrap">
                    <div style={STAT_CARD_STYLE}>
                        <div style={STAT_LABEL_STYLE}>セット</div>
                        <div style={{ marginTop: 4, fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 30, color: '#F3FAFF' }}>
                            {set} <span style={{ fontSize: 16, color: '#5C7EA6' }}>/ 3</span>
                        </div>
                    </div>
                    <SemifinalTimerCard remaining={remaining} isRunning={isTimerRunning} onStart={() => changeTimer('start')} onStop={() => changeTimer('stop')} />
                    {/* ③ タイムアップしたら、振り返る問題の通し番号を入力する */}
                    {state.view === 'quiz' && stage === 'beforeJudge' && remaining === 0 && !isTimerRunning && (
                        <ReviewRangeForm from={rangeFrom} to={rangeTo} onFrom={setRangeFrom} onTo={setRangeTo} />
                    )}
                    {state.view !== 'quiz' && range && (
                        <div style={STAT_CARD_STYLE}>
                            <div style={STAT_LABEL_STYLE}>振り返り範囲</div>
                            <div style={{ marginTop: 4, fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 24, color: '#F3FAFF' }}>
                                No.{range.from} 〜 {range.to}
                            </div>
                        </div>
                    )}
                </div>

                {state.view === 'review' && range && reviewQuestions.length > 0 && (
                    <ReviewPreview questions={reviewQuestions} page={page} pageCount={pageCount} />
                )}

                {/* ⑤ 得点集計。確定後は入力欄を閉じる（入れ直しは手動操作の「得点を入力し直す」） */}
                {stage === 'beforeJudge' && state.view === 'tally' && state.pointsEntered && (
                    <div style={{ ...STAT_CARD_STYLE, fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, fontSize: 14, color: '#7FE8FF' }}>
                        第{set}セットの得点を確定しました。上の「点数発表へ」で Main に発表します。
                    </div>
                )}
                {stage === 'beforeJudge' && state.view === 'tally' && !state.pointsEntered && (
                    <PointsForm
                        players={activeInSeatOrder}
                        values={pointInputs}
                        onChange={(id, v) => setPointInputs(prev => ({ ...prev, [id]: v }))}
                        entered={state.pointsEntered}
                        busy={isBusy}
                    />
                )}

                {state.view === 'playoff' && state.playoff && playoffProgress && (
                    <PlayoffPanel
                        playoff={state.playoff}
                        progress={playoffProgress}
                        players={entrants}
                        busy={isBusy}
                        onMark={markPlayoff}
                        onUndo={undoPlayoff}
                    />
                )}

                </>)}

                <div className="flex flex-col gap-[8px]">
                    <div style={MANUAL_LABEL_STYLE}>選手（席順・累計ポイント）{activeSorted.length > 0 ? ` 対象 ${activeSorted.length}名` : ''}</div>
                    <SemifinalStandings entrants={entrants} />
                </div>
            </div>
        </div>
    );
}
