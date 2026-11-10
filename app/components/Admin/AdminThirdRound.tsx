// 3rd Round（Number 10）の Admin。
// 2026-11-05: 運営コンソール（console/）に載せ替え。2nd Round と同じ枠で、1440×900 の1画面に収める。
//   上のバー … Main に出ている画面・15分タイマー・Undo（直前の操作名）・次の操作（1本道）
//   採点面   … コース選択（実施順・エントリー）／クイズ（問題欄・5名を横一列・縦書き・スルー）／サドンデス
//   右の列   … 開始番号・操作の記録
//   引き出し … 「表示の切り替え」（フェーズ・コース）と「データ修正」（抽選・確定・タイマー・コース結果）
// 採点・抽選・確定・Undo・リセットの処理と呼ぶ API は、載せ替え前と同じ。
// 同時に、2nd Round と同じ堅牢化を入れた（2026-11-04 の docs/robust-flow-design.md）:
//   ・採点・Undo・リセットは同時に1つだけ（useSingleFlight）。応答待ちの押し直しで二重に効かない
//   ・Main が待機画面・ブランクで覆っている間は採点しない
//   ・画面を開いた時・つなぎ直した時に、進行状態・コース・選手を取り直す
//   ・失敗は画面の上の通知（notify）で知らせる
import { Socket } from "socket.io-client";
import { useState, useEffect } from "react";
import type { Player, ThirdRoundTimer } from "@/lib/types";
import { TIMER_URGENT_SECONDS } from "@/lib/thirdRoundCourses";
import {
    COURSE_TIME_LIMIT_SECONDS,
    THIRD_ROUND_COURSES,
    WINNERS_PER_COURSE,
    type ThirdRoundCourseName
} from "@/lib/thirdRoundCourses";
import {
    getCourseFinishState,
    getTenByTenTotal,
    getTenByTenWrongPoint,
    getSwedishCrossToAdd
} from "@/lib/thirdRoundScoring";
import { toOrdinal } from "@/lib/ordinal";
import { ACCENT, tierOf } from "@/lib/cyberpunkCard";
import { useQuestionDisplay } from "./AdminQuestionPanel";
import { useRoundProgress, nextRoundPrimary, blockUndoIfLaterStarted, cascadeNotice, broadcastAfterReset } from "./roundProgressContext";
import { ConsoleFrame, WorkHead, MetaItem, Drawer, DrawerGroup } from "./console/ConsoleFrame";
import { SeatCard, SeatRow, Pips, WrongMarks, BigNumber, seatNameSize, type SeatStatus } from "./console/SeatCard";
import { QuestionStrip } from "./console/QuestionStrip";
import { ConsoleSide } from "./console/ConsoleSide";
import { TimerChip } from "./console/TimerChip";
import { useActionLog } from "./console/useActionLog";
import styles from "./console/console.module.css";
import { useMainCover } from "../useMainCover";
import { coverStartPrimary, CoverButtons } from "./MainCoverControls";
import { useSocketSync } from "../useSocketSync";
import { useSingleFlight } from "../useSingleFlight";
import { notify, errorText } from "@/lib/adminNotice";
import { BLANK_END_COVER, blankStartCover, standbyCover, standbyAfterCover, coverBlocksRound, describeCover, rewindCover } from "@/lib/mainCover";

type Props = {
    socket: Socket | null;
}

type Course = {
    id: number;
    name: string;
    playOrder: number | null;
}

type ThirdRoundState = {
    // playoff は判定基準で決着しなかった選手の早押しプレーオフ。
    // quizOrder はそのまま使うので、どのコースの分かが分かる。
    phase: "courseSelect" | "quiz" | "playoff";
    step: "entry" | "closed";
    quizOrder: number;
    // コース終了処理を走らせたコースの quizOrder。未実行なら null。
    // 「終了処理を走らせたか」はデータから導出できないため状態として持つ。
    finishedOrder: number | null;
    // サドンデスの参加者（始めた時点の未決着者。2026-10-29 追加）。無ければコースの5名全員を出す
    playoffIds?: number[] | null;
}

// 確定結果の内訳。掲げた／強制出場の区別を表示するためだけに使う。
// DB には保存しないため、リロードすると消える（大会結果には影響しない情報）。
type AssignedPlayer = {
    id: number;
    entryNo: number;
    name: string;
    secondRoundRank: number;
    paperRank: number;
    forced: boolean;
}

/** 1コースの出場者数 */
const COURSE_SEATS = 5;

/** 3rd Round の選手1人の、カード中央の点数まわり。コースごとに見せる物が変わる（Main の QuizPlayerCard と同じ考え方） */
function courseScore(p: Player, courseName: ThirdRoundCourseName): React.ReactNode {
    const isSettled = p.thirdRoundRank !== 0;
    if (courseName === THIRD_ROUND_COURSES.TEN_BY_TEN) {
        // 10 by 10: 正解pt × 誤答pt = 総合pt（100以上で勝ち抜け）
        const total = getTenByTenTotal(p);
        return (
            <>
                <BigNumber value={total} size={32} suffix="/ 100" />
                <Pips value={Math.min(10, Math.floor(total / 10))} max={10} />
                <span className={styles.formula}><b>{p.thirdRoundCorrectCount}</b> × <b>{getTenByTenWrongPoint(p)}</b></span>
            </>
        );
    }
    if (courseName === THIRD_ROUND_COURSES.UP_DOWN) {
        // 10 up-down: ポイント/10、2誤答で失格
        return (
            <>
                <BigNumber value={p.thirdRoundUpDownPoint} size={32} suffix="/ 10" />
                <Pips value={Math.min(10, p.thirdRoundUpDownPoint)} max={10} />
                <WrongMarks count={p.thirdRoundWrongCount} max={2} />
            </>
        );
    }
    if (courseName === THIRD_ROUND_COURSES.FREEZE) {
        // Freeze 10: 正解数/10、誤答の回数（通算の誤答回数ぶん休み）
        return (
            <>
                <BigNumber value={p.thirdRoundCorrectCount} size={32} suffix="/ 10" />
                <Pips value={Math.min(10, p.thirdRoundCorrectCount)} max={10} />
                <span className={p.thirdRoundWrongCount > 0 ? styles.crossOn : styles.crossOff}>誤答 {p.thirdRoundWrongCount}</span>
            </>
        );
    }
    // Swedish 10: 正解数/10、×の数（次に誤答したときに加わる×の数も出す）
    return (
        <>
            <BigNumber value={p.thirdRoundCorrectCount} size={32} suffix="/ 10" />
            <Pips value={Math.min(10, p.thirdRoundCorrectCount)} max={10} />
            <span className={p.thirdRoundSwedishCross > 0 ? styles.crossOn : styles.crossOff}>
                × {p.thirdRoundSwedishCross}
                {!isSettled && <small> (+{getSwedishCrossToAdd(p.thirdRoundCorrectCount)})</small>}
            </span>
        </>
    );
}

export default function AdminThirdRound(props: Props) {
    const { socket } = props;

    // 問題表示（2026-10-22）。採点（正解・誤答・スルー）が成功したら、その問題を Main に表示して次の問題に進める。
    // コースが変わっても通し番号は続きから（ラウンドで1本の番号）
    const { state: questionState, finishQuestion, recordEvent, undoWithQuestion } = useQuestionDisplay(socket, 'thirdRound');
    // 各ラウンドの状況（2026-10-22。「Extra Round へ ▶」・Undo の制限・リセットの確認文に使う）
    const progress = useRoundProgress();

    const [thirdRoundState, setThirdRoundState] = useState<ThirdRoundState>({
        phase: "courseSelect",
        step: "entry",
        quizOrder: 1,
        finishedOrder: null
    });
    const [courses, setCourses] = useState<Course[]>([]);
    // Main を覆う表示（待機画面・ブランク。2026-11-04）
    const [cover, setCover, coverControls] = useMainCover(socket);
    const [winners, setWinners] = useState<Player[]>([]);
    // プレートを掲げていた人。Admin のローカル状態で、確定時にサーバへ送る
    const [raisedIds, setRaisedIds] = useState<number[]>([]);
    // 直前に確定した結果の内訳（掲げた／強制出場）
    const [lastAssigned, setLastAssigned] = useState<AssignedPlayer[]>([]);
    // 抽選・確定・採点・Undo・リセットは同時に1つだけ走らせる（応答待ちの押し直しで二重に効かない。2026-11-05）
    const flight = useSingleFlight();
    // 開いている引き出し（表示の切り替え／データ修正）
    const [drawer, setDrawer] = useState<'view' | 'data' | null>(null);
    // 操作の記録（この画面の中だけ。Undo ボタンの説明にも使う）
    const actionLog = useActionLog();
    // 15分タイマー。サーバが唯一の時計で、ここは受け取った値を表示するだけ。
    // 接続直後にサーバから現在値が届くので、初期値は表示が一瞬崩れないための仮置き。
    const [timer, setTimer] = useState<ThirdRoundTimer>({
        remainings: {},
        runningOrder: null
    });
    // タイマーの手動編集。入力中の値は Admin のローカル状態で持つ
    const [isEditingTimer, setIsEditingTimer] = useState(false);
    const [editMinutes, setEditMinutes] = useState(0);
    const [editSeconds, setEditSeconds] = useState(0);

    // 進行状態・タイマーは、この画面を開いた時・つなぎ直した時に必ず取り直す（2026-11-04。server/ThirdRoundHandler.js）
    useSocketSync(socket, ['request_third_round_sync']);

    useEffect(() => {
        // 画面を開いた直後の1回だけ、現在の状態を直接取得する。
        // この時点では他の画面に配信すべき新しい情報がないため setState してよい。
        const loadAll = () => {
            fetch('/api/thirdRound/courses')
                .then(res => res.json())
                .then(data => { if (data.success) setCourses(data.courses); })
                .catch(err => console.error("Failed to load third round courses", err));

            fetch('/api/thirdRound/courseSelect')
                .then(res => res.json())
                .then(data => { if (data.success) setWinners(data.winners); })
                .catch(err => console.error("Failed to load third round winners", err));
        };
        loadAll();

        if (socket) {
            const handleStateUpdate = (state: ThirdRoundState) => setThirdRoundState(state);

            const handlePlayersUpdate = (allPlayers: Player[]) => {
                setWinners(
                    allPlayers
                        .filter(p => p.secondRoundRank >= 1)
                        .sort((a, b) =>
                            a.secondRoundRank !== b.secondRoundRank
                                ? a.secondRoundRank - b.secondRoundRank
                                : a.paperRank - b.paperRank
                        )
                );
            };

            // 抽選結果はここで受け取る。
            // fetch の戻り値を直接 setState しないのは、更新経路を1本に保つため。
            // Socket 経由に統一すると Admin と Main が同じデータを同じタイミングで受け取る。
            //
            // このイベントが運ぶのはコース情報だけ。選手データは update_players で受け取る。
            // 経路を種別ごとに1本に保たないと、片方の画面だけが更新される事故が起きる。
            const handleCoursesUpdate = (nextCourses: Course[]) => {
                setCourses(nextCourses);
                setRaisedIds([]);       // 新しいコースに移るのでチェックを外す
                setLastAssigned([]);    // 前のコースの内訳表示も消す
            };

            const handleTimerUpdate = (next: ThirdRoundTimer) => setTimer(next);

            socket.on("update_third_round_state", handleStateUpdate);
            socket.on("update_third_round_courses", handleCoursesUpdate);
            socket.on("update_players", handlePlayersUpdate);
            socket.on("update_third_round_timer", handleTimerUpdate);
            // つなぎ直したときはコース・選手を読み直す（切れている間の更新の配信は受け取れていないため。2026-11-05）
            socket.io.on("reconnect", loadAll);

            return () => {
                socket.off("update_third_round_state", handleStateUpdate);
                socket.off("update_third_round_courses", handleCoursesUpdate);
                socket.off("update_players", handlePlayersUpdate);
                socket.off("update_third_round_timer", handleTimerUpdate);
                socket.io.off("reconnect", loadAll);
            };
        }
    }, [socket]);

    const changeState = (updates: Partial<ThirdRoundState>) => {
        if (socket) socket.emit('change_3rd_round_state', updates);
    };

    // タイマー操作。サーバが時計を持っているので、ここは要求を送るだけ。
    // 自分の画面も配信（update_third_round_timer）経由で更新される。
    const changeTimer = (action: 'start' | 'stop' | 'reset') => {
        if (socket) socket.emit('change_third_round_timer', { action });
    };

    const handleTimerReset = () => {
        // 進行中に誤って押すと15分が巻き戻るため確認する
        if (window.confirm('タイマーを15分に戻しますか？')) changeTimer('reset');
    };

    // 残り秒数の手動編集。疑義の申し立てで時間を戻す場合や、開始を忘れたまま
    // 進行してしまった場合の復旧手段。サーバ側で編集時に時計は止まる。
    const handleTimerEditStart = () => {
        setEditMinutes(Math.floor(remaining / 60));
        setEditSeconds(remaining % 60);
        setIsEditingTimer(true);
    };

    const handleTimerEditSave = () => {
        if (socket) {
            socket.emit('change_third_round_timer', {
                action: 'edit',
                seconds: editMinutes * 60 + editSeconds
            });
        }
        setIsEditingTimer(false);
    };

    // スコア更新。成功したら true。
    // fetch の結果を直接 setState せず、Socket で配って update_players 経由で
    // 自分の画面も更新する。自分だけ別経路で更新すると Main と表示がずれる。
    // playerId はスルーのとき null。スルーは「問題が1問終わった」というイベントで
    // 選手に紐づかないため、対象コースは常に courseName で伝える。
    const handleScore = (
        playerId: number | null,
        action: 'correct' | 'wrong' | 'through' | 'finish'
    ) => flight.run(async (): Promise<boolean> => {
        if (!quizCourse) return false;
        // Main が待機画面・ブランクで「これから始まる場面」を覆っている間は採点しない（会場に出ていない問題が進むのを防ぐ）
        if (action !== 'finish' && coverBlocksRound(cover)) {
            notify('Main が待機中のため採点できません。上のバーの「○○を始める ▶」で画面を出してから採点してください。', 'error');
            return false;
        }
        try {
            const res = await fetch('/api/thirdRound/updateScores', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerId, action, courseName: quizCourse.name })
            });
            const data = await res.json();

            if (data.success && socket) {
                // 選手データ専用の経路で配る。コース情報のイベントに同乗させない。
                socket.emit('broadcast_scores', data.allPlayers);

                // 勝ち抜けまたは失格が出たら時計を止める（設計メモ 4.2）。
                // 判定は API 側にある。server/ は DB を見ないので勝ち抜けを知らず、
                // Admin が中継役になる。止まっていても stop は無害。
                if (data.shouldStopTimer) {
                    socket.emit('change_third_round_timer', { action: 'stop' });
                }
                // 正解・誤答・スルーでその問題は終わる。コース終了処理（finish）は問題と関係しない。
                // 2026-10-29: どのコースの操作か・得点の Undo 履歴を積んだか（historyAdded）を問題表示の記録に残す
                const historyAdded = data.historyAdded !== false;
                if (action !== 'finish') finishQuestion(quizCourse.name, historyAdded);
                else if (historyAdded) recordEvent(quizCourse.name);

                // 操作の記録（勝ち抜け・失格が決まったら添える）
                if (action === 'finish') {
                    actionLog.add({ who: '', what: 'コース終了', tone: 'other', scope: quizCourse.name });
                } else if (action === 'through') {
                    actionLog.add({ who: '', what: 'スルー', tone: 'through', scope: quizCourse.name });
                } else {
                    const after: Player | undefined = (data.allPlayers as Player[]).find(p => p.id === playerId);
                    const who = after?.name ?? '';
                    const note = action === 'correct'
                        ? (after && after.thirdRoundRank > 0 ? '正解（勝ち抜け）' : '正解')
                        : (after && after.thirdRoundRank < 0 ? '誤答（失格）' : '誤答');
                    actionLog.add({ who, what: note, tone: action === 'correct' ? 'ok' : 'ng', scope: quizCourse.name });
                }
                return true;
            }
            notify(data.error || '更新に失敗しました', 'error');
            return false;
        } catch (error) {
            notify(errorText(error, '通信に失敗しました。採点は反映されていません。画面を確かめてからやり直してください。'), 'error');
            return false;
        }
    });

    // サドンデスの採点部分
    const handlePlayoffScore = (playerId: number, action: 'correct' | 'wrong') => flight.run(async () => {
        if (!quizCourse) return;
        if (coverBlocksRound(cover)) {
            notify('Main が待機中のため採点できません。上のバーの「○○を始める ▶」で画面を出してから採点してください。', 'error');
            return;
        }
        try {
            const res = await fetch('/api/thirdRound/updateScores', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    playerId,
                    action,
                    courseName: quizCourse.name,
                    playoff: true
                })
            });
            const data = await res.json()
            if (data.success && socket) {
                socket.emit('broadcast_scores', data.allPlayers)
                // サドンデスも早押しの1問。Main に表示して次の問題へ
                finishQuestion(quizCourse.name, data.historyAdded !== false);
                const after: Player | undefined = (data.allPlayers as Player[]).find(p => p.id === playerId);
                actionLog.add({
                    who: after?.name ?? '',
                    what: action === 'correct' ? 'サドンデス 正解' : 'サドンデス 誤答',
                    tone: action === 'correct' ? 'ok' : 'ng',
                    scope: quizCourse.name,
                });
            } else {
                notify(data.error || '更新に失敗しました', 'error');
            }
        } catch (error) {
            notify(errorText(error, '通信に失敗しました。採点は反映されていません。画面を確かめてからやり直してください。'), 'error');
        }
    });

    // スルー（誰も解答しなかった）。2026-10-22: 問題表示のため、スルーは全コースで出す。
    // Freeze 10 では従来どおり API に記録し（休み中の選手の残り問数を減らす）、
    // 他の3コースはスコアを変えずに問題だけ進める
    const handleThrough = () => {
        if (!quizCourse) return;
        if (coverBlocksRound(cover)) {
            notify('Main が待機中のためスルーできません。上のバーの「○○を始める ▶」で画面を出してからにしてください。', 'error');
            return;
        }
        if (quizCourse.name === THIRD_ROUND_COURSES.FREEZE) {
            void handleScore(null, 'through');
        } else {
            finishQuestion(quizCourse.name, false);
            actionLog.add({ who: '', what: 'スルー', tone: 'through', scope: quizCourse.name });
        }
    };

    // スコア更新を1手戻す。履歴はコース単位なので、いま実施中のコース名を送る。
    // タイマーと出場者の割当は戻らない（別系統）。
    // 2026-10-29: 問題表示も一緒に戻す（直前がスルーなら問題だけ戻す。undoWithQuestion）
    // 2026-11-04: 直前の操作が「前のコース」のものなら（次のコースへ進めた後に、前のコースの誤りに気づいたとき）、
    // そのコースまで戻して取り消す。取り消した先の画面をいきなり会場に出さないよう、Main はブランクにして
    // 「クイズを再開する ▶」で出す。コースの終了後（ブランク・待機画面）に戻したときも同じ
    const handleScoreUndo = () => flight.run(async () => {
        if (!quizCourse) return;
        // Extra Round が始まっていたら Undo しない（提案B）
        if (blockUndoIfLaterStarted(progress, 'thirdRound')) return;
        if (cover.at === 'manual') {
            notify('手動の待機画面が出ています。「待機画面を消す ▶」を押してから Undo してください。', 'error');
            return;
        }
        const courseName = crossing && lastCourse ? lastCourse.name : quizCourse.name;
        const undone = await undoWithQuestion(courseName, async () => {
            try {
                const res = await fetch('/api/thirdRound/undo', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ courseName })
                });
                const data = await res.json();

                if (data.success && socket) {
                    socket.emit('broadcast_scores', data.allPlayers);
                    // 戻したのがコース終了だった可能性があるので、安全側に倒して解除する。
                    // それ以外の操作を戻した場合でも、押し直せば同じ結果になる（終了処理は冪等）。
                    changeState({ finishedOrder: null });
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
        actionLog.markUndone(courseName);
        if (crossing || cover.at === 'end') {
            if (crossing && lastCourse && lastCourse.playOrder !== null) changeState({ phase: 'quiz', quizOrder: lastCourse.playOrder });
            setCover(rewindCover());
        }
    });

    // 表示中のコースのスコアを初期状態に戻す（2026-10-11 ユーザー承認済み）。
    // 所属コース・抽選結果・タイマーはそのまま。そのコースの Undo 履歴は消える。
    const handleScoreReset = () => {
        if (!quizCourse) return;
        if (!window.confirm(`${quizCourse.name} の結果をリセットしますか？（元に戻せません）${cascadeNotice(progress, 'extraRound', true)}`)) return;
        const course = quizCourse;
        void flight.run(async () => {
            try {
                const res = await fetch('/api/thirdRound/resetScores', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ courseName: course.name })
                });
                const data = await res.json();

                if (data.success && socket) {
                    // Extra Round 以降も DB で初期化済み。選手を配り、Extra Round 以降の進行状態も戻す
                    broadcastAfterReset(socket, 'extraRound', data);
                    // コース終了の確定も無効になるので解除する（Undo と同じ扱い）
                    changeState({ finishedOrder: null });
                    actionLog.add({ who: '', what: `${course.name} をリセット`, tone: 'other', scope: `reset-${course.name}` });
                    setDrawer(null);
                } else {
                    notify(data.error || '更新に失敗しました', 'error');
                }
            } catch (error) {
                notify(errorText(error, '通信に失敗しました。リセットは反映されていません。'), 'error');
            }
        });
    };

    // ---- ここから、表示に使う値を状態から導出する ----

    // 抽選済みのコースを実施順に並べる
    const drawnCourses = courses
        .filter(c => c.playOrder !== null)
        .sort((a, b) => (a.playOrder as number) - (b.playOrder as number));
    const remainingCourses = courses.filter(c => c.playOrder === null);
    const isAllDrawn = courses.length > 0 && remainingCourses.length === 0;

    // いま処理中のコース＝最後に抽選されたコース。
    // 順番に処理していくので、playOrder が最大のものが常に現在のコースになる。
    const currentCourse = drawnCourses.length > 0
        ? drawnCourses[drawnCourses.length - 1]
        : null;

    // クイズ実施フェーズで対象になっているコース（Main 側と同じ導出）
    const quizCourse = drawnCourses.find(c => c.playOrder === thirdRoundState.quizOrder);
    // 直前の採点がどのコースのものか（サーバの記録。再読み込みや再起動の後も残る）。
    // 今のコースと違えば「次のコースへ進めた後の Undo」で、前のコースまで戻して取り消す
    const lastScope = questionState.lastEvents?.thirdRound?.scope;
    const lastCourse = lastScope ? drawnCourses.find(c => c.name === lastScope) : undefined;
    const crossing = !!lastCourse && lastCourse.playOrder !== thirdRoundState.quizOrder;
    // 「次のコースへ」ボタンの表記。2026-10-11 のユーザー指示で「○コース目（コース名）」にした
    const nextOrder = thirdRoundState.quizOrder + 1;
    const nextCourseName = drawnCourses.find(c => c.playOrder === nextOrder)?.name;
    const nextCourseLabel = `${nextOrder}コース目${nextCourseName ? `（${nextCourseName}）` : ''}`;

    // 表示中のコースのタイマー。配信された状態から導出する。
    // キーが無いコースは「まだ一度も動かしていない」＝制限時間のまま。
    const remaining = timer.remainings[thirdRoundState.quizOrder] ?? COURSE_TIME_LIMIT_SECONDS;
    const isTimerRunning = timer.runningOrder === thirdRoundState.quizOrder;

    // そのコースに割り当て済みの選手。
    // 「確定済みかどうか」を状態として持たず、ここから判定する。
    const assignedToCurrent = currentCourse
        ? winners.filter(p => p.thirdRoundCourseName === currentCourse.name)
        : [];
    const isCurrentAssigned = assignedToCurrent.length >= COURSE_SEATS;

    // 3rd Round の進行は「4コースすべての参加者を先に決めてから、各コースを実施する」
    // 流れ(ユーザー指示)。下の primaryLabel/primaryAction の導出で、全コース確定前は
    // クイズ実施フェーズへの1本道ボタンを出さないことでこれを強制する。
    // (引き出しの直接切り替えはトラブル対応用の退避ハッチなので、あえてここでは縛らない。)

    // まだどのコースにも割り当てられていない選手（エントリー対象）
    const unassignedWinners = winners.filter(p => !p.thirdRoundCourseName);

    // クイズ実施中のコースの出場者5名。
    // winners は優先順位（2R勝ち抜け順 → 1R順位）で並んでいるので、絞り込んでも順序は保たれる。
    // 「誰が出場するか」は Player.thirdRoundCourseName が持っているため、ここでは導出するだけ。
    const quizPlayers = quizCourse
        ? winners.filter(p => p.thirdRoundCourseName === quizCourse.name)
        : [];

    // 終了条件を満たしたか。データは変えず、提示するだけ（決定事項5）
    const finishState = getCourseFinishState(quizPlayers);

    // コース終了の操作。タイマーが0でも自動では発火させない（決定事項5）。
    // 最後に読まれていた問題の判定を入力できなくなるため。
    const handleFinishCourse = async () => {
        if (!window.confirm('コースを終了して順位を確定しますか？')) return;
        const ok = await handleScore(null, 'finish');
        // 「終了処理を走らせた」という事実はデータから復元できないので状態に残す（API が成功したときだけ）
        if (ok) changeState({ finishedOrder: thirdRoundState.quizOrder });
    };

    // プレーオフの対象者。コース終了処理で決着した人には順位が入っているので、
    // rank === 0 で残った選手がそのまま対象になる。リストは保存しない。
    const playoffPlayers = quizPlayers.filter(p => p.thirdRoundRank === 0);

    // サドンデスを始める。その時点の未決着者を参加者として記録し、Main・Admin はその選手だけ並べる（2026-10-29）
    const startPlayoff = () => changeState({ phase: 'playoff', playoffIds: playoffPlayers.map(p => p.id) });
    // サドンデスの画面に並べる選手（記録が無いとき＝サーバ再起動などは、従来どおりコースの5名全員）
    const playoffShownIds = thirdRoundState.playoffIds;
    const playoffShown = playoffShownIds && playoffShownIds.length > 0
        ? quizPlayers.filter(p => playoffShownIds.includes(p.id))
        : quizPlayers;
    const playoffSeats = 2 - finishState.winnersCount;

    // 終了処理を走らせたうえで、判定基準で決着しなかった選手が残っている状態。
    //
    // 「終了処理を走らせたか」を敗退者の有無で代用してはいけない。コース途中でも
    // 失格者は出るため、たとえば「失格2名・勝ち抜け0名・解答席3名」で成立してしまう。
    const needsPlayoff =
        thirdRoundState.finishedOrder === thirdRoundState.quizOrder
        && playoffPlayers.length > 0;

    const isClosed = thirdRoundState.step === 'closed';

    // ---- 操作 ----

    const handleDraw = () => flight.run(async () => {
        try {
            const res = await fetch('/api/thirdRound/draw', { method: 'POST' });
            const data = await res.json();

            if (data.success && socket) {
                // 必要なデータだけを送る。レスポンス全体を送ると、そのイベントが
                // 何を運ぶのかが曖昧になり、受信側ごとに読む項目がずれる原因になる。
                socket.emit('broadcast_third_round_courses', data.courses);
                // 新しいコースのエントリータイムが始まるので、締切状態を解除する
                changeState({ step: 'entry' });
            } else {
                notify(data.error || '更新に失敗しました', 'error');
            }
        } catch (error) {
            notify(errorText(error, '通信に失敗しました。抽選は反映されていません。'), 'error');
        }
    });

    const handleReset = () => {
        if (!window.confirm(`抽選をリセットしますか？（元に戻せません）\n全コースの出場者と 3rd Round の結果もリセットされ、コース選択から始め直します。${cascadeNotice(progress, 'extraRound', true)}`)) return;
        void flight.run(async () => {
            try {
                const res = await fetch('/api/thirdRound/draw', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    // 確認ダイアログでOKされたときだけ force を送る
                    body: JSON.stringify({ force: true })
                });
                const data = await res.json();

                if (data.success && socket) {
                    // 3rd Round 全体と Extra Round 以降を DB で初期化済み。
                    // コース情報・選手情報を配り、3rd Round 以降の進行状態（コース選択・エントリー中・タイマー）も戻す
                    broadcastAfterReset(socket, 'thirdRound', data);
                    setDrawer(null);
                } else {
                    notify(data.error || 'リセットに失敗しました', 'error');
                }
            } catch (error) {
                notify(errorText(error, '通信に失敗しました。リセットは反映されていません。'), 'error');
            }
        });
    };

    const toggleRaised = (playerId: number) => {
        if (!isClosed) return;   // 締切前は操作させない
        setRaisedIds(prev =>
            prev.includes(playerId)
                ? prev.filter(id => id !== playerId)
                : [...prev, playerId]
        );
    };

    const handleAssign = () => flight.run(async () => {
        if (!currentCourse) return;
        try {
            const res = await fetch('/api/thirdRound/assignCourse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseName: currentCourse.name, raisedIds })
            });
            const data = await res.json();

            if (data.success && socket) {
                // 掲げた／強制出場の内訳は自分の画面でしか使わないので、ここで持つ
                setLastAssigned(data.assigned);
                // 選手データは Socket 経由で全画面に配る（Main の強調表示に必要）
                socket.emit('broadcast_scores', data.allPlayers);
            } else {
                notify(data.error || '更新に失敗しました', 'error');
            }
        } catch (error) {
            notify(errorText(error, '通信に失敗しました。出場者の確定は反映されていません。'), 'error');
        }
    });

    const handleUnassign = () => {
        if (!currentCourse) return;
        if (!window.confirm(`${currentCourse.name} の出場者確定を取り消しますか？\nこのコースの結果もリセットされます。${cascadeNotice(progress, 'extraRound', true)}`)) return;
        const course = currentCourse;
        void flight.run(async () => {
            try {
                const res = await fetch('/api/thirdRound/assignCourse', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ courseName: course.name, force: true })
                });
                const data = await res.json();

                if (data.success && socket) {
                    setLastAssigned([]);
                    setRaisedIds([]);
                    // そのコースの結果と Extra Round 以降も DB で初期化済み
                    broadcastAfterReset(socket, 'extraRound', data);
                    // 締切前に戻して、エントリーからやり直せるようにする
                    changeState({ step: 'entry' });
                    setDrawer(null);
                } else {
                    notify(data.error || '更新に失敗しました', 'error');
                }
            } catch (error) {
                notify(errorText(error, '通信に失敗しました。取り消しは反映されていません。'), 'error');
            }
        });
    };

    // ==================== 進行の「次の一手」を導出する ====================
    // ユーザー指示:「4コースすべての参加者を決定してから、各コースを実施する」という
    // 1本道で進める(2nd Round の Admin と同じ導線パターン)。ここではあくまで表示用の
    // ラベルとボタンの出し分けを決めているだけで、呼び出す先はすべて既存のハンドラの
    // ままであり、新しいデータ操作は増やしていない。
    let primaryLabel: string;
    let primaryAction: (() => void) | null = null;

    // コースの決着の後（2026-11-04 ユーザー指示。早押しの場面の終わりは何も表示しない）:
    //   「クイズを終了する」→ ブランク →「待機画面を表示する」→ 待機 NEXT 3rd Round / 次のコース名（裏で次のコースへ進める）
    //   4コース目の後は 待機 NEXT Extra Round →「Extra Round へ ▶」
    const courseEndPrimary = (): { label: string; action: (() => void) | null } => {
        if (cover.kind === 'none') return { label: 'クイズを終了する ▶', action: () => setCover(BLANK_END_COVER) };
        if (cover.kind === 'blank') {
            if (thirdRoundState.quizOrder < 4) {
                return {
                    label: '待機画面を表示する ▶',
                    action: () => {
                        changeState({ phase: 'quiz', quizOrder: thirdRoundState.quizOrder + 1 });
                        setCover(standbyCover('3rd Round', nextCourseName ?? `${nextOrder}コース目`, 'クイズを始める'));
                    },
                };
            }
            return { label: '待機画面を表示する ▶', action: () => setCover(standbyAfterCover('Extra Round')) };
        }
        if (thirdRoundState.quizOrder < 4) return { label: `${nextCourseLabel}へ ▶`, action: null };
        // 4コース目まで終わった。8名の勝ち抜けが決まっていれば「Extra Round へ ▶」（提案A）
        return nextRoundPrimary(socket, progress, 'thirdRound');
    };

    if (thirdRoundState.phase === 'courseSelect') {
        if (!currentCourse) {
            primaryLabel = `${drawnCourses.length + 1}番目のコースを抽選 ▶`;
            primaryAction = handleDraw;
        } else if (!isCurrentAssigned) {
            if (!isClosed) {
                primaryLabel = 'エントリー締切 ▶';
                primaryAction = () => changeState({ step: 'closed' });
            } else {
                primaryLabel = `出場者を確定（挙手 ${raisedIds.length}名＋強制 ${Math.max(0, COURSE_SEATS - raisedIds.length)}名） ▶`;
                primaryAction = handleAssign;
            }
        } else if (!isAllDrawn) {
            primaryLabel = `${drawnCourses.length + 1}番目のコースを抽選 ▶`;
            primaryAction = handleDraw;
        } else {
            // 2026-10-11 のユーザー指示で、2コース目以降と同じ「○コース目（コース名）へ ▶」にした
            const firstCourseName = drawnCourses.find(c => c.playOrder === 1)?.name;
            primaryLabel = `1コース目${firstCourseName ? `（${firstCourseName}）` : ''}へ ▶`;
            // クイズの場面の始まりは Main をブランクにし、上のバーの「クイズを始める」で出す（2026-11-04 ユーザー指示）
            primaryAction = () => { changeState({ phase: 'quiz', quizOrder: 1 }); setCover(blankStartCover('クイズを始める')); };
        }
    } else if (thirdRoundState.phase === 'quiz') {
        if (needsPlayoff) {
            primaryLabel = `サドンデスへ（${playoffPlayers.length}名同点） ▶`;
            primaryAction = startPlayoff;
        } else if (finishState.finished) {
            ({ label: primaryLabel, action: primaryAction } = courseEndPrimary());
        } else if (quizPlayers.length > 0 && finishState.activeCount > 0 && remaining === 0) {
            primaryLabel = 'コース終了 ▶';
            primaryAction = handleFinishCourse;
        } else {
            primaryLabel = `進行中（残り ${finishState.activeCount}名）`;
        }
    } else {
        if (playoffPlayers.length === 0) {
            ({ label: primaryLabel, action: primaryAction } = courseEndPrimary());
        } else {
            primaryLabel = `サドンデス中（残り ${playoffPlayers.length}名）`;
        }
    }

    // 待機画面・ブランクで「これから始まる場面」を覆っている間は、進行ボタンを覆いの操作にする
    // （待機画面を消す → クイズを始める。裏で画面を進めてしまわないように。2026-11-04）
    const coverStart = coverStartPrimary(cover, setCover);
    if (coverStart) {
        primaryLabel = coverStart.label;
        primaryAction = coverStart.action;
    } else if (coverBlocksRound(cover)) {
        primaryAction = null;
    }
    // 処理中は次の操作を受け付けない
    if (flight.pending) primaryAction = null;

    // ---- 上のバー（Main に出ている画面） ----
    const inPlay = thirdRoundState.phase !== 'courseSelect' && !!quizCourse;
    const onAir = thirdRoundState.phase === 'courseSelect' ? '3rd Round' : `3rd Round　${thirdRoundState.quizOrder}コース目`;
    const onAirDetail = thirdRoundState.phase === 'courseSelect'
        ? `コース選択（抽選 ${drawnCourses.length}/4）`
        : thirdRoundState.phase === 'playoff'
            ? `サドンデス${quizCourse ? `（${quizCourse.name}）` : ''}`
            : quizCourse?.name ?? '';
    const undoScope = crossing && lastCourse ? lastCourse.name : quizCourse?.name ?? '';

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
            <DrawerGroup label="フェーズ・コース">
                <button type="button" className={thirdRoundState.phase === 'courseSelect' ? styles.btnOn : styles.btn}
                    onClick={() => changeState({ phase: 'courseSelect' })}>コース選択</button>
                {[1, 2, 3, 4].map(order => {
                    const on = thirdRoundState.phase === 'quiz' && thirdRoundState.quizOrder === order;
                    return (
                        <button key={order} type="button" className={on ? styles.btnOn : styles.btn}
                            onClick={() => changeState({ phase: 'quiz', quizOrder: order })}>
                            {drawnCourses.find(c => c.playOrder === order)?.name ?? `${order}コース目`}
                        </button>
                    );
                })}
                <button type="button" className={thirdRoundState.phase === 'playoff' ? styles.btnOn : styles.btn} onClick={startPlayoff}>サドンデス</button>
            </DrawerGroup>
            <div className={styles.note}>通常は使いません。進行は上のバーの右端のボタンで行います。</div>
        </Drawer>
    );
    const drawerData = drawer === 'data' && (
        <Drawer title="データ修正" onClose={() => setDrawer(null)}>
            <DrawerGroup label="抽選・出場者" disabled={thirdRoundState.phase !== 'courseSelect'}
                note={thirdRoundState.phase === 'courseSelect' ? '抽選のやり直し・出場者の確定の取り消しは、元に戻せません。' : 'コース選択のときに使えます。'}>
                <button type="button" className={styles.btnDanger} onClick={handleReset} disabled={flight.pending || drawnCourses.length === 0}>抽選をリセット</button>
                <button type="button" className={styles.btn} onClick={handleUnassign} disabled={flight.pending || !currentCourse || !isCurrentAssigned}>確定を取り消す</button>
            </DrawerGroup>
            <DrawerGroup label="タイマー" disabled={!inPlay}
                note={inPlay ? '編集すると時計は止まります。疑義で時間を戻すときや、開始を忘れたときに使います。' : 'クイズ・サドンデスのときに使えます。'}>
                <button type="button" className={styles.btn} onClick={handleTimerReset}>RESET（15:00）</button>
                {!isEditingTimer ? (
                    <button type="button" className={styles.btn} onClick={handleTimerEditStart}>EDIT</button>
                ) : (
                    <>
                        <input type="number" min={0} max={15} value={editMinutes} aria-label="分" className={styles.input} style={{ width: 64 }}
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
            <DrawerGroup label={quizCourse ? `${quizCourse.name} の結果` : 'コースの結果'} disabled={!inPlay}
                note={inPlay ? 'このコースの得点・判定と Undo の履歴を消して、コースの最初に戻します。所属コース・抽選・タイマーはそのままです。元に戻せません。' : 'クイズ・サドンデスのときに使えます。'}>
                <button type="button" className={styles.btnDanger} onClick={handleScoreReset} disabled={flight.pending || !quizCourse}>
                    リセット（{quizCourse ? quizCourse.name : 'コース未選択'}）
                </button>
            </DrawerGroup>
            <div className={styles.note}>1手だけ戻すときは、上のバーの Undo を使ってください。</div>
        </Drawer>
    );

    // ---- 採点面 ----
    let work: React.ReactNode;
    if (thirdRoundState.phase === 'courseSelect') {
        // コース選択: 実施順の4枠、確定した出場者、エントリーの確認リスト
        const order = [1, 2, 3, 4];
        work = (
            <>
                <WorkHead
                    meta={<>
                        <MetaItem label="抽選済み" value={`${drawnCourses.length}/4`} />
                        <MetaItem label="抽選したコース" value={currentCourse ? currentCourse.name : '-'} />
                        <MetaItem label="挙手" value={isClosed ? `${raisedIds.length}名` : '-'} />
                        <MetaItem label="未割当" value={`${unassignedWinners.length}名`} />
                    </>}
                    tools={tools} />
                <div className={styles.slots}>
                    {order.map(o => {
                        const course = drawnCourses.find(c => c.playOrder === o);
                        const isCurrent = currentCourse?.playOrder === o;
                        return (
                            <div key={o} className={isCurrent ? styles.slotNow : styles.slot}>
                                <span className={styles.slotNo}>{o}番目</span>
                                <span className={course ? styles.slotName : styles.slotEmpty}>{course ? course.name : '？'}</span>
                            </div>
                        );
                    })}
                </div>
                {!currentCourse ? (
                    <div className={styles.empty}>上のバーのボタンで抽選してください</div>
                ) : isCurrentAssigned ? (
                    <>
                        <div className={styles.sectionLabel}>{currentCourse.playOrder}番目 {currentCourse.name} の出場者</div>
                        <SeatRow count={assignedToCurrent.length}>
                            {assignedToCurrent.map((p, i) => {
                                const detail = lastAssigned.find(a => a.id === p.id);
                                const status: SeatStatus | null = detail ? (detail.forced ? { label: '強制', tone: 'dc' } : { label: '挙手', tone: 'win' }) : null;
                                return (
                                    <SeatCard key={p.id} seatNo={i + 1} paperRank={p.paperRank} name={p.name} nameSize={seatNameSize(assignedToCurrent.length, p.name)}
                                        status={status}
                                        score={<span className={styles.seatNo}>2R {p.secondRoundRank}位</span>} />
                                );
                            })}
                        </SeatRow>
                        {lastAssigned.length === 0 && <div className={styles.hint}>挙手／強制の内訳は確定した直後だけ表示します（再読み込みで消えます）。</div>}
                    </>
                ) : (
                    <>
                        <div className={styles.sectionHead}>
                            <span className={styles.sectionLabel}>エントリー（優先順位順・締切後にチェックできます）</span>
                            <span className={isClosed ? styles.stateClosed : styles.stateOpen}>{isClosed ? 'エントリー締切済み' : 'エントリータイム中'}</span>
                        </div>
                        <div className={isClosed ? styles.entryList : styles.entryListOff}>
                            {unassignedWinners.map((p, index) => {
                                const checked = raisedIds.includes(p.id);
                                return (
                                    <button key={p.id} type="button" className={checked ? styles.entryRowOn : styles.entryRow}
                                        onClick={() => toggleRaised(p.id)} disabled={!isClosed} aria-pressed={checked}>
                                        <span className={styles.check}>{checked ? '✓' : ''}</span>
                                        <span className={styles.entryNo}>#{index + 1}</span>
                                        <span className={styles.entryRank} style={{ color: tierOf(p.paperRank, ACCENT).color }}>{toOrdinal(p.paperRank)}</span>
                                        <span className={styles.entryName}>{p.name}</span>
                                        <span className={styles.entrySub}>2R {p.secondRoundRank}位</span>
                                        <span className={checked ? styles.entryTagOn : styles.entryTag}>{checked ? '挙手' : '未挙手'}</span>
                                    </button>
                                );
                            })}
                            {unassignedWinners.length === 0 && <div className={styles.empty}>未割当の選手がいません</div>}
                        </div>
                    </>
                )}
            </>
        );
    } else if (thirdRoundState.phase === 'quiz') {
        // クイズ: 5名の正誤判定
        work = (
            <>
                <WorkHead
                    meta={<>
                        <MetaItem label="勝ち抜け" value={`${finishState.winnersCount}/${WINNERS_PER_COURSE}`} />
                        <MetaItem label="敗退" value={finishState.eliminatedCount} />
                        <MetaItem label="解答席" value={finishState.activeCount} />
                        <MetaItem label="残り勝抜枠" value={`${finishState.activeCount}→${Math.max(0, WINNERS_PER_COURSE - finishState.winnersCount)}`} />
                    </>}
                    tools={tools} />
                <QuestionStrip socket={socket} round="thirdRound" state={questionState} />
                {finishState.finished && (
                    <div className={styles.bannerFinish}>
                        終了条件成立{finishState.reason === 'allWinnersDecided'
                            ? `：${finishState.winnersCount}名が勝ち抜け`
                            : `：${finishState.eliminatedCount}名が失格（残り${finishState.activeCount}名＝残り枠）`}
                    </div>
                )}
                {needsPlayoff && (
                    <div className={styles.bannerPlayoff}>同点のためサドンデス（{playoffPlayers.length}名・残り{playoffSeats}枠）</div>
                )}
                {quizCourse && quizPlayers.length > 0 ? (
                    <SeatRow count={quizPlayers.length}>
                        {quizPlayers.map((p, i) => {
                            const isEliminated = p.thirdRoundRank < 0;
                            const isWinner = p.thirdRoundRank > 0;
                            const isSettled = p.thirdRoundRank !== 0;
                            const isResting = quizCourse.name === THIRD_ROUND_COURSES.FREEZE && p.thirdRoundFreezeRest > 0;
                            const status: SeatStatus | null = isEliminated ? { label: 'LOST', tone: 'lost' }
                                : isWinner ? { label: toOrdinal(p.thirdRoundRank), tone: 'win' }
                                : isResting ? { label: `休み ${p.thirdRoundFreezeRest}`, tone: 'now' } : null;
                            return (
                                <SeatCard key={p.id} seatNo={i + 1} paperRank={p.paperRank} name={p.name} nameSize={seatNameSize(quizPlayers.length, p.name)}
                                    status={status} dimmed={isSettled}
                                    score={courseScore(p, quizCourse.name as ThirdRoundCourseName)}
                                    onCorrect={() => handleScore(p.id, 'correct')} onWrong={() => handleScore(p.id, 'wrong')}
                                    canOperate={!isSettled && !isResting && !flight.pending} />
                            );
                        })}
                    </SeatRow>
                ) : (
                    <div className={styles.empty}>出場者が未確定です</div>
                )}
                <button type="button" className={styles.through} onClick={handleThrough} disabled={flight.pending || quizPlayers.length === 0}>スルー（誰も答えなかった）</button>
                <div className={styles.hint}>並びは Main と同じ（左から優先順位）。正解・誤答・スルーで、その問題を Main に出して次の問題へ進みます。</div>
            </>
        );
    } else {
        // サドンデス: 同点の選手だけの早押し
        work = (
            <>
                <WorkHead
                    meta={<><MetaItem label="残り枠" value={playoffSeats} /><MetaItem label="対象" value={`${playoffPlayers.length}名`} /></>}
                    tools={tools} />
                <QuestionStrip socket={socket} round="thirdRound" state={questionState} />
                {playoffShown.length === 0 ? (
                    <div className={styles.empty}>サドンデスの対象者がいません</div>
                ) : (
                    <SeatRow count={playoffShown.length}>
                        {playoffShown.map((p, i) => {
                            const isWinner = p.thirdRoundRank > 0;
                            const isUndecided = p.thirdRoundRank === 0;
                            const status: SeatStatus | null = isWinner ? { label: toOrdinal(p.thirdRoundRank), tone: 'win' }
                                : isUndecided ? null : { label: 'LOST', tone: 'lost' };
                            return (
                                <SeatCard key={p.id} seatNo={i + 1} paperRank={p.paperRank} name={p.name} nameSize={seatNameSize(playoffShown.length, p.name)}
                                    status={status} dimmed={!isUndecided}
                                    onCorrect={() => handlePlayoffScore(p.id, 'correct')} onWrong={() => handlePlayoffScore(p.id, 'wrong')}
                                    canOperate={isUndecided && !flight.pending} />
                            );
                        })}
                    </SeatRow>
                )}
                <div className={styles.hint}>サドンデスは1問ごとに決着します。正解で勝ち抜け、誤答で失格です。</div>
            </>
        );
    }

    const showTimer = thirdRoundState.phase === 'quiz';
    return (
        <ConsoleFrame
            onAir={onAir}
            onAirDetail={cover.kind !== 'none' ? describeCover(cover) : onAirDetail}
            barExtra={<>
                {showTimer && (
                    <TimerChip remaining={remaining} isRunning={isTimerRunning} urgentAt={TIMER_URGENT_SECONDS} onStart={() => changeTimer('start')} onStop={() => changeTimer('stop')} />
                )}
                <CoverButtons cover={cover} setCover={setCover} forceRelease={coverControls.forceRelease} className={styles.btn} />
            </>}
            undo={{
                detail: inPlay ? actionLog.lastLabel(undoScope) : null,
                onClick: () => { void handleScoreUndo(); },
                disabled: !inPlay || flight.pending,
            }}
            next={{ label: primaryLabel, onClick: primaryAction }}
            side={<ConsoleSide socket={socket} round="thirdRound" state={questionState} log={actionLog.entries} />}
        >
            {work}
            {drawerView}
            {drawerData}
        </ConsoleFrame>
    );
}
