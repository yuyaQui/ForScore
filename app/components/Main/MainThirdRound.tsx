import { Socket } from "socket.io-client";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Player, ThirdRoundTimer } from "@/lib/types";
import { toOrdinal } from "@/lib/ordinal";
import {
    COURSE_TIME_LIMIT_SECONDS,
    THIRD_ROUND_COURSE_NAMES,
    THIRD_ROUND_COURSES,
    WINNERS_PER_COURSE,
    type ThirdRoundCourseName
} from "@/lib/thirdRoundCourses";
import { formatTime } from "@/lib/formatTime";
import { reelPoolFor, buildReelSequence } from "@/lib/courseReel";
import {
    getTenByTenTotal,
    getTenByTenWrongPoint,
    isEliminatedByCourseRule,
    getSwedishCrossToAdd,
} from "@/lib/thirdRoundScoring";
import {
    ACCENT,
    INNER_BG,
    HONEYCOMB_BG,
    tierOf,
    shade,
    outlineShadow,
} from "@/lib/cyberpunkCard";
import FixedStage from "@/app/components/FixedStage";
import { RoundStage, RemainingSlots } from "@/app/components/Main/RoundStage";
import { spacedName } from "@/lib/playerName";
import { PlayerCardFrame, useCardIntroPhase, WINNER_BAR_COLOR, NEUTRAL_FRAME, COURSE_DONE_FRAME_FILTER, COURSE_DONE_NAME_COLOR, type CardIntroPhase } from "@/app/components/Main/PlayerCardFrame";
import { BELOW_NUMBER_FONT, belowFontSize, BELOW_NUMBER_H, BELOW_MARK_FONT, BELOW_MARK_W, BELOW_MARK_H } from "@/app/components/Main/belowSizes";

type Props = {
    players: Player[],
    socket: Socket | null,
    setPlayers: (players: Player[]) => void
}

type Course = {
    id: number;
    name: string;
    playOrder: number | null;
}

type ThirdRoundState = {
    // playoff は判定基準で決着しなかった選手の早押しプレーオフ（Admin と同じ定義）
    phase: "courseSelect" | "quiz" | "playoff";
    step: "entry" | "closed";
    quizOrder: number;
    finishedOrder: number | null;
    // サドンデスの参加者（2026-10-29 追加。Admin と同じ）。無ければコースの5名全員を出す
    playoffIds?: number[] | null;
}

export default function MainThirdRound(props: Props) {
    const { players, socket, setPlayers } = props;

    const [thirdRoundState, setThirdRoundState] = useState<ThirdRoundState>({
        phase: "courseSelect",
        step: "entry",
        quizOrder: 1,
        finishedOrder: null
    });
    const [courses, setCourses] = useState<Course[]>([]);
    // 15分タイマー。時計はサーバが持っており、Main は受け取った値を映すだけ。
    // 接続直後にサーバから現在値が届くので、初期値は表示が一瞬崩れないための仮置き。
    const [timer, setTimer] = useState<ThirdRoundTimer>({
        remainings: {},
        runningOrder: null
    });

    useEffect(() => {
        // 画面を開いた直後の1回だけ、現在の状態を直接取得する。
        //
        // 選手データも自分で取りに行く。親（app/main/page.tsx）は Socket の
        // update_players しか見ていないため、これがないと投影画面を開いた直後は
        // 誰かが操作するまで選手が表示されない。
        fetch('/api/secondRound/loadPlayers')
            .then(res => res.json())
            .then(data => { if (data.success) setPlayers(data.allPlayers); })
            .catch(err => console.error("Failed to load players", err));

        fetch('/api/thirdRound/courses')
            .then(res => res.json())
            .then(data => { if (data.success) setCourses(data.courses); })
            .catch(err => console.error("Failed to load third round courses", err));

        if (socket) {
            const handleStateUpdate = (state: ThirdRoundState) => setThirdRoundState(state);
            const handleCoursesUpdate = (courses: Course[]) => setCourses(courses);
            const handleTimerUpdate = (next: ThirdRoundTimer) => setTimer(next);

            socket.on("update_third_round_state", handleStateUpdate);
            socket.on("update_third_round_courses", handleCoursesUpdate);
            socket.on("update_third_round_timer", handleTimerUpdate);

            // 接続直後の配信はこの画面が無いうちに届いて失われるので、表示した時点で
            // 現在の進行状態とタイマーを取り直す（server/ThirdRoundHandler.js）
            socket.emit("request_third_round_sync");

            return () => {
                socket.off("update_third_round_state", handleStateUpdate);
                socket.off("update_third_round_courses", handleCoursesUpdate);
                socket.off("update_third_round_timer", handleTimerUpdate);
            };
        }
        // setPlayers は親（app/main/page.tsx）の useState の setter で、React が
        // 参照の同一性を保証している。依存配列に加えても実行回数は変わらない。
    }, [socket, setPlayers]);

    // ---- 表示に使う値を導出する（Admin と同じ規則）----

    const drawnCourses = courses
        .filter(c => c.playOrder !== null)
        .sort((a, b) => (a.playOrder as number) - (b.playOrder as number));

    // 順番に処理していくので、playOrder が最大のものが現在のコースになる
    const currentCourse = drawnCourses.length > 0
        ? drawnCourses[drawnCourses.length - 1]
        : null;

    // コース選択の優先順位: 2nd Round 勝ち抜け順 → 1st Round 順位
    const winners = players
        .filter(p => p.secondRoundRank >= 1)
        .sort((a, b) =>
            a.secondRoundRank !== b.secondRoundRank
                ? a.secondRoundRank - b.secondRoundRank
                : a.paperRank - b.paperRank
        );

    // コース選択フェーズの画面(CourseSelectView)が、各選手を4行×5列のどこに置くかを
    // 決めるための並び。空き枠はnullのまま渡し、CourseSelectView側でプレースホルダーを出す。
    const gridItems = Array.from({ length: 20 }, (_, index) => winners[index] || null);

    // クイズ実施フェーズで対象になっているコース
    const quizCourse = drawnCourses.find(c => c.playOrder === thirdRoundState.quizOrder);

    // 表示中のコースの残り秒数。キーが無ければ「まだ動かしていない」＝制限時間のまま。
    // Main は稼働中かどうかを表示しないので runningOrder は使わない。
    const remaining = timer.remainings[thirdRoundState.quizOrder] ?? COURSE_TIME_LIMIT_SECONDS;

    // クイズ実施中のコースの出場者5名（Admin と同じ導出）。
    // winners が優先順位順に並んでいるので、絞り込んでも順序は保たれる。
    const quizPlayers = quizCourse
        ? winners.filter(p => p.thirdRoundCourseName === quizCourse.name)
        : [];



    // ===== プレーオフ =====
    //
    // Cowork Design アーティファクトにはこの画面(Main・Adminとも)のモックアップが
    // そもそも作られていない。ユーザー判断(2026-10-03)により、ここまでの実装で作った
    // 共通部品(PlayerCardFrame、ティア配色)をそのまま流用し、サイバーパンクのトーンに
    // 合わせて自分でデザインする。横線は 2026-10-11 のユーザー指示でコース本体と同じ黄色(#FFC93C)にした。
    //
    // そのコースの5名全員を出す。設計メモ7章は当初「対象者のみ」としていたが、対象者は
    // rank === 0 で絞って導出しているため、勝ち抜けた瞬間にその選手が一覧から外れて
    // **画面から消えてしまう**。会場から見ると勝った瞬間が分からないため、5名全員を出し、
    // 勝ち抜けはコース本体と同じ金色、敗退はグレーにすることで、プレーオフで勝った選手が
    // その場で金色に変わって残るようにする。
    if (thirdRoundState.phase === 'playoff') {
        return (
            <FixedStage>
                <PlayoffView quizCourse={quizCourse ?? null} quizPlayers={quizPlayers} playoffIds={thirdRoundState.playoffIds ?? null} socket={socket} />
            </FixedStage>
        );
    }

    // ===== クイズ実施フェーズ =====
    // ===== クイズ実施フェーズ =====
    //
    // Cowork Design アーティファクト(ThirdRound10UpDown.dc.html / ThirdRoundFreeze10.dc.html /
    // ThirdRoundSwedish10.dc.html / ThirdRound10by10.dc.html、いずれもユーザーとのコメント
    // レビューで確定した版)の見た目をそのまま移植する。4コースともカードの額縁(開扉演出・
    // 八角形カット・縁取り)は完全に共通で、枠下の表示(below)と枠内の追加演出(overlay)だけが
    // コースごとに違うため、共通部分を PlayerCardFrame に、コース別の差分を QuizPlayerCard に
    // 分けている。なお、どのモックアップにも15分タイマーの表示は無いが、Admin側でタイマーを
    // 操作する以上、会場にも残り時間を見せるべきというユーザー判断(2026-10-03)により
    // QuizHeader にタイマー表示を追加した。
    if (thirdRoundState.phase === 'quiz') {
        return (
            <FixedStage>
                {quizCourse ? (
                    <QuizView
                        key={`quiz-${quizCourse.name}`}
                        quizCourse={quizCourse}
                        quizPlayers={quizPlayers}
                        remaining={remaining}
                        socket={socket}
                    />
                ) : (
                    <div style={{ width: 1920, height: 1080, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000', fontFamily: "'Rajdhani','Noto Sans JP',sans-serif" }}>
                        <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: 36, color: '#5C7EA6' }}>
                            コースが確定していません
                        </span>
                    </div>
                )}
            </FixedStage>
        );
    }

    // ===== コース選択フェーズ =====
    //
    // Cowork Design アーティファクト(ThirdRoundCourseSelect.dc.html、ユーザーとの
    // コメントレビューで確定した版)の見た目をそのまま移植する。レビュー過程で
    // 「実施順4枠ストリップ」と「コース割当タグ」は一旦削除の指示が出て最終版から
    // 外れているため、ここにも含めない。
    return (
        <FixedStage>
            <CourseSelectView gridItems={gridItems} currentCourse={currentCourse} courses={courses} />
        </FixedStage>
    );
}

// ============================================================================
// コース選択フェーズ（Main）
// ============================================================================

type CourseSelectViewProps = {
    gridItems: (Player | null)[];
    currentCourse: Course | null;
    /** 全コース（ルーレットに流すコース＝その抽選の時点で未抽選だったコースを求めるのに使う） */
    courses: Course[];
}

// ルーレット表示の寸法・色・周回数。Design アーティファクトの値をそのまま使う。
const REEL_ITEM_H = 235, REEL_VIEW_W = 1150, REEL_VIEW_H = 295, CHAM_REEL = 20;
const REEL_FRAME_COLOR = '#FFC93C'; // 選手カードの黄色(13〜24位帯)と同じ色に揃えている
const REEL_LAPS = 16;
// reelSpin(app/globals.css)のanimation-durationと必ず一致させる
const REEL_SPIN_MS = 15000;
// INNER_BG/HONEYCOMB_BGはlib/cyberpunkCard.tsのものをそのまま使う(上のimport参照)。

// 固定px基準のchamferClip（ルーレットのような実サイズが既知の要素向け）
function chamferClip(w: number, h: number, c: number): string {
    return `polygon(${c}px 0, ${w - c}px 0, ${w}px ${c}px, ${w}px ${h - c}px, ${w - c}px ${h}px, ${c}px ${h}px, 0 ${h - c}px, 0 ${c}px)`;
}
// パーセント基準のchamferClip（CSS Gridのfr幅で実サイズが可変な選手カード向け）。
// buildTopBottomCutClip(lib/cyberpunkCard.ts、px固定)がそのまま使えないのはこのため。
// このコース選択カードだけで使うので、共通ライブラリへは加えずここに閉じている。
function chamferClipPct(refW: number, refH: number, c: number): string {
    const xp = c / refW * 100, yp = c / refH * 100;
    const f = (n: number) => n.toFixed(2);
    return `polygon(${f(xp)}% 0, ${f(100 - xp)}% 0, 100% ${f(yp)}%, 100% ${f(100 - yp)}%, ${f(100 - xp)}% 100%, ${f(xp)}% 100%, 0 ${f(100 - yp)}%, 0 ${f(yp)}%)`;
}
// cutClipPctのパーセント版。chamferClipPctと同じ理由でローカル関数にしている。
function cutClipPct(refW: number, refH: number, chamferPx: number, padPx: number): string {
    const outerX1 = chamferPx, outerX2 = refW - chamferPx;
    const innerX1 = padPx + chamferPx, innerX2 = refW - padPx - chamferPx;
    const px = (x: number) => (x / refW * 100).toFixed(2) + '%';
    const py = (y: number) => (y / refH * 100).toFixed(2) + '%';
    return `polygon(${px(outerX1)} ${py(0)}, ${px(innerX1)} ${py(padPx)}, ${px(innerX1)} ${py(refH - padPx)}, ${px(outerX1)} ${py(refH)}, ${px(outerX2)} ${py(refH)}, ${px(innerX2)} ${py(refH - padPx)}, ${px(innerX2)} ${py(padPx)}, ${px(outerX2)} ${py(0)})`;
}

// CSSカスタムプロパティ(--reel-from/--reel-to)をインラインstyleで渡すための型。
// reelSpin(app/globals.css)がこの2つを参照する。抽選のたびに値が変わるため、
// 固定値の@keyframesではなくCSS変数経由でアニメーションの始点・終点を渡している。
type ReelTrackStyle = CSSProperties & { '--reel-from': string; '--reel-to': string };

function CourseSelectView({ gridItems, currentCourse, courses }: CourseSelectViewProps) {
    // ルーレットの回転演出。抽選そのものは Admin 側(app/api/thirdRound/draw)がすでに
    // 確定させていて、ここは「currentCourse の名前が変わった」ことを検知して結果を
    // 演出するだけ。結果はここでは決めない(app/api/thirdRound/draw/route.ts のコメント
    // 「アニメーションは確定した結果を演出するだけで、結果を決めてはいけない」と同じ方針)。
    const [spinStage, setSpinStage] = useState<'landed' | 'spinning'>('landed');
    const [reelTarget, setReelTarget] = useState<string | null>(currentCourse?.name ?? null);
    // ルーレットに流すコース（2026-10-29: その抽選の時点で未抽選だったコースだけ）。
    // 回転を始めた時点で固定する（回転中にコースの配信が来ても並びが変わらないように）
    const [reelPool, setReelPool] = useState<string[]>(() => reelPoolFor(courses, currentCourse?.name ?? null));
    // コース一覧は回転を始めるときに読むだけなので ref で持つ（effect の依存に入れると、回転中にコースの
    // 配信が来たときに effect が作り直され、回転を終える setTimeout が消えてしまう）
    const coursesRef = useRef(courses);
    useEffect(() => { coursesRef.current = courses; });
    const prevCourseNameRef = useRef<string | null>(currentCourse?.name ?? null);

    useEffect(() => {
        const name = currentCourse?.name ?? null;
        if (name && name !== prevCourseNameRef.current) {
            // 新しい抽選が確定した。Cowork Design アーティファクトのplayDraw()と同じ、
            // 15秒かけて初速維持→減速→最終区間でさらに減速して停止する演出を1回再生する。
            prevCourseNameRef.current = name;
            setReelTarget(name);
            setReelPool(reelPoolFor(coursesRef.current, name));
            setSpinStage('spinning');
            const timer = setTimeout(() => setSpinStage('landed'), REEL_SPIN_MS);
            return () => clearTimeout(timer);
        }
        // currentCourseが無い(まだ1つも抽選されていない)間は何もしない。
    }, [currentCourse]);

    // 回転中に流れる全アイテムを的中アイテムと同じスタイル(白文字+縁取り)で揃える
    // (アーティファクトのコメント：「選択されない部分のスタイルも選択される部分に
    // 揃えてほしい」というユーザー指示による)。
    // 並びは固定の順番のまま、周回の続きで当選コースの位置まで進めて止める（lib/courseReel.ts。2026-10-29 修正。
    // 以前は周回の後ろに当選コースを付け足していたため、同じ名前が2つ続いたり順番が飛んだりした）
    const reelSequence = buildReelSequence(reelTarget, reelPool.length > 0 ? reelPool : THIRD_ROUND_COURSE_NAMES, REEL_LAPS);
    // track内では的中アイテムが先頭(最上部)に来るよう、時系列を反転させる
    const reelTrackItems = reelSequence.slice().reverse();
    const reelYLanded = (REEL_VIEW_H - REEL_ITEM_H) / 2;
    const reelYSpinning = reelYLanded - (reelTrackItems.length - 1) * REEL_ITEM_H;
    const reelItemTextStyle: CSSProperties = {
        color: '#FFFFFF',
        textShadow: outlineShadow(shade(REEL_FRAME_COLOR, -0.35), 5.7),
    };
    const trackStyle: ReelTrackStyle = {
        display: 'flex', flexDirection: 'column', width: '100%',
        transform: `translateY(${reelYLanded}px)`,
        animation: spinStage === 'spinning' ? `reelSpin ${REEL_SPIN_MS / 1000}s linear 1 forwards` : 'none',
        '--reel-from': `${reelYSpinning}px`,
        '--reel-to': `${reelYLanded}px`,
    };

    return (
        <div style={{ width: 1920, height: 1080, boxSizing: 'border-box', padding: '56px 72px', backgroundColor: '#000000', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', fontFamily: "'Rajdhani','Noto Sans JP',sans-serif" }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontWeight: 700, fontSize: 40, letterSpacing: 3, color: '#FFFFFF' }}>3rd Round</div>
                {/* 右上の「○ / 4 コース抽選済み」は 2026-10-11 のユーザー指示で削除した */}
            </div>

            <div style={{ height: 2, marginTop: 20, background: '#FFC93C', boxShadow: '0 0 12px rgba(255,201,60,.45)', flexShrink: 0 }} />

            {/* 抽選ルーレット。決定後もそのまま残り、着地した表示が「現在選択中のコース」を兼ねる */}
            <div style={{ marginTop: 44, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ position: 'relative', boxSizing: 'border-box', width: REEL_VIEW_W, height: REEL_VIEW_H, overflow: 'hidden', clipPath: chamferClip(REEL_VIEW_W, REEL_VIEW_H, CHAM_REEL), background: INNER_BG, border: `4px solid ${REEL_FRAME_COLOR}`, boxShadow: '0 0 28px rgba(255,201,60,.35), inset 0 0 32px rgba(0,0,0,.6)' }}>
                    <div style={trackStyle}>
                        {reelTrackItems.map((name, i) => (
                            <span key={i} style={{ flexShrink: 0, width: '100%', height: REEL_ITEM_H, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid rgba(255,255,255,.08)', fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: 170, ...reelItemTextStyle }}>
                                {name}
                            </span>
                        ))}
                    </div>
                    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 56, background: `linear-gradient(180deg, ${INNER_BG}, transparent)`, pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 56, background: `linear-gradient(0deg, ${INNER_BG}, transparent)`, pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: 0, height: 0, borderTop: '16px solid transparent', borderBottom: '16px solid transparent', borderLeft: `20px solid ${REEL_FRAME_COLOR}`, filter: `drop-shadow(0 0 10px ${REEL_FRAME_COLOR})`, pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', width: 0, height: 0, borderTop: '16px solid transparent', borderBottom: '16px solid transparent', borderRight: `20px solid ${REEL_FRAME_COLOR}`, filter: `drop-shadow(0 0 10px ${REEL_FRAME_COLOR})`, pointerEvents: 'none' }} />
                </div>
            </div>

            {/* 参加者20名。4行×5列、優先順位(2nd Round順位→ペーパー順位)順に並ぶ
                (gridItemsは親コンポーネント側ですでにその順に並べてある) */}
            <div style={{ marginTop: 26, flex: 1, minHeight: 0, maxHeight: 520, display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', gridTemplateRows: 'repeat(4,minmax(0,1fr))', gap: 8 }}>
                {gridItems.map((p, index) => (
                    p
                        ? <CourseSelectCard
                            key={p.id}
                            player={p}
                            isElsewhere={!!p.thirdRoundCourseName && p.thirdRoundCourseName !== currentCourse?.name}
                            isCurrent={!!currentCourse && p.thirdRoundCourseName === currentCourse.name}
                        />
                        : <EmptyCourseSelectSlot key={`empty-${index}`} />
                ))}
            </div>
        </div>
    );
}

type CourseSelectCardProps = {
    player: Player;
    isElsewhere: boolean;
    isCurrent: boolean;
}

function CourseSelectCard({ player: p, isElsewhere, isCurrent }: CourseSelectCardProps) {
    const tier = tierOf(p.paperRank, ACCENT);
    const textOutlineColor = shade(tier.color, -0.35);
    // コースが決まった選手（Admin で「出場者を確定」を押した時点。前のコースで決まった選手も含む）は、
    // クイズ画面の失格者（PlayerCardFrame の eliminated）と同じ見た目にする（2026-10-11 ユーザー指示）:
    // 枠をグレー（NEUTRAL_FRAME）にし、全体をグレースケール＋半透明、名前をグレーにする。
    const isDecided = isCurrent || isElsewhere;
    const frameColor = isDecided ? NEUTRAL_FRAME : tier.color;

    const OUTER_REF_W = 340, OUTER_REF_H = 120, OUTER_CHAMFER = 11, OUTER_PAD = 4;
    const outerStyle: CSSProperties = {
        position: 'relative', width: '100%', height: '100%', boxSizing: 'border-box',
        clipPath: chamferClipPct(OUTER_REF_W, OUTER_REF_H, OUTER_CHAMFER), background: frameColor, padding: OUTER_PAD,
        filter: isDecided ? COURSE_DONE_FRAME_FILTER : `drop-shadow(0 0 10px ${tier.glowA}) drop-shadow(0 0 20px ${tier.glowB})`,
    };
    const cutStyle: CSSProperties = {
        position: 'absolute', inset: 0, background: '#3A3F46',
        clipPath: cutClipPct(OUTER_REF_W, OUTER_REF_H, OUTER_CHAMFER, OUTER_PAD), pointerEvents: 'none',
    };
    const innerStyle: CSSProperties = {
        position: 'relative', width: '100%', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
        alignItems: 'stretch', gap: 4, padding: '5px 14px', clipPath: chamferClipPct(330, 112, 9), overflow: 'hidden',
        backgroundColor: INNER_BG, backgroundImage: HONEYCOMB_BG, backgroundRepeat: 'repeat', backgroundSize: '56px 100px',
        boxShadow: 'inset 0 3px 6px rgba(255,255,255,.06), inset 0 -6px 14px rgba(0,0,0,.65), inset 0 0 20px rgba(0,0,0,.35)',
    };

    return (
        <div style={{ position: 'relative', height: '100%', minWidth: 0, display: 'flex', alignItems: 'stretch', justifyContent: 'center' }}>
            <div style={{ position: 'relative', width: '100%', height: '100%', boxSizing: 'border-box', padding: 2, clipPath: chamferClipPct(344, 124, 13), background: '#3A3F46', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.05)' }}>
                <div style={outerStyle}>
                    <div style={cutStyle} />
                    <div style={innerStyle}>
                        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 5, backgroundImage: `linear-gradient(180deg, transparent, ${frameColor}, transparent)`, opacity: 0.95 }} />
                        <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 5, backgroundImage: `linear-gradient(180deg, transparent, ${frameColor}, transparent)`, opacity: 0.95 }} />
                        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, minWidth: 52, padding: '3px 10px', border: `3px solid ${tier.color}`, clipPath: 'polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)', fontFamily: 'Orbitron,"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: 20, color: '#FFFFFF', letterSpacing: 1, boxSizing: 'border-box' }}>
                                {toOrdinal(p.paperRank)}
                            </span>
                            <span style={{ flex: 1, minWidth: 0, display: 'block', fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, fontSize: 17, color: '#DFEBFA', textShadow: outlineShadow(textOutlineColor, 0.7), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {(p.school || '未登録') + ' ' + (p.grade || '-')}
                            </span>
                        </div>
                        <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: '0 2px' }}>
                            <span style={{ display: 'block', fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: 46, letterSpacing: 1, color: isDecided ? COURSE_DONE_NAME_COLOR : '#F3FAFF', textShadow: outlineShadow(textOutlineColor, 1.2), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', textAlign: 'center' }}>
                                {spacedName(p.name)}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function EmptyCourseSelectSlot() {
    return (
        <div style={{ position: 'relative', height: '100%', minWidth: 0, opacity: 0.3, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed rgba(255,255,255,.15)' }}>
            <span style={{ fontFamily: 'Orbitron, "Noto Sans JP", sans-serif', fontWeight: 800, fontSize: 20, color: '#3A4B63' }}>?</span>
        </div>
    );
}

// ============================================================================
// クイズ実施フェーズ（Main）
// ============================================================================

/**
 * Freeze 10固有：休み中(isFrozen)の選手に重ねる、氷のシート越しに見ているような
 * オーバーレイ。枠の色・フィルターは変えず、このオーバーレイと残り休み問題数の
 * 大きな数字だけで「休み中」を伝える(Design アーティファクトの構成をそのまま移植)。
 */
function FreezeOverlay({ remaining, opacity, transition }: { remaining: number; opacity: number; transition: string }) {
    const crackStroke = (w: number, o: number) => ({ fill: 'none', stroke: `rgba(235,250,255,${o})`, strokeWidth: w, strokeLinecap: 'round' as const, style: { filter: `drop-shadow(0 0 ${w >= 2 ? 3 : 2}px rgba(200,235,255,${o - 0.1}))` } });
    return (
        <div
            style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'radial-gradient(circle at 50% 50%, rgba(6,12,18,.55) 0%, rgba(6,12,18,.5) 34%, transparent 62%), linear-gradient(115deg, transparent 30%, rgba(255,255,255,.18) 45%, transparent 60%), linear-gradient(160deg, rgba(220,245,255,.42) 0%, rgba(150,210,235,.3) 45%, rgba(80,140,180,.4) 100%)',
                opacity, transition, zIndex: 7, pointerEvents: 'none',
            }}
        >
            <svg style={{ position: 'absolute', inset: 0 }} width="100%" height="100%" viewBox="0 0 158 694" preserveAspectRatio="none">
                <path d="M20 40 L55 120 L40 210 L70 300" {...crackStroke(2, 0.5)} />
                <path d="M140 60 L100 150 L120 260 L90 340" {...crackStroke(2, 0.5)} />
                <path d="M30 400 L65 480 L45 560 L75 640" {...crackStroke(2, 0.5)} />
                <path d="M130 420 L95 500 L115 580 L85 660" {...crackStroke(2, 0.5)} />
                <path d="M79 8 L60 90 L90 180" {...crackStroke(1.6, 0.4)} />
                <path d="M8 300 L45 340 L15 380" {...crackStroke(1.6, 0.4)} />
                <path d="M150 300 L113 340 L143 380" {...crackStroke(1.6, 0.4)} />
                <path d="M15 15 L35 45 L25 75" {...crackStroke(1.6, 0.4)} />
                <path d="M145 15 L125 50 L138 80" {...crackStroke(1.6, 0.4)} />
                <path d="M40 210 L90 228 L130 210" {...crackStroke(1.3, 0.35)} />
                <path d="M60 600 L79 650 L95 690" {...crackStroke(1.6, 0.4)} />
                <path d="M148 460 L120 490 L135 520" {...crackStroke(1.3, 0.35)} />
                <path d="M10 460 L38 490 L20 520" {...crackStroke(1.3, 0.35)} />
                <path d="M20 660 L45 685 L35 694" {...crackStroke(1.3, 0.35)} />
            </svg>
            <span style={{ display: 'inline-block', transform: 'rotate(-14deg)', fontFamily: 'Orbitron,"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: 104, color: '#EAF6FF', textShadow: '0 0 20px rgba(127,216,255,.7), 0 4px 12px rgba(0,0,0,.7)', lineHeight: 1 }}>
                {remaining}
            </span>
        </div>
    );
}

/**
 * そのコースの「残り参加者数 → 残り勝ち抜け枠数」（2026-10-29 ユーザー指示。2nd Round と同じ表示）。
 * 残り参加者 = 勝ち抜けも失格もしていない人数（サドンデス中はサドンデスの参加者）、残り枠 = 2 − 勝ち抜け人数
 */
function remainingOf(players: Player[]): { active: number; slots: number } {
    const active = players.filter(p => p.thirdRoundRank === 0).length;
    const slots = Math.max(0, WINNERS_PER_COURSE - players.filter(p => p.thirdRoundRank > 0).length);
    return { active, slots };
}

function QuizHeader({ courseName, players }: { courseName: string; players: Player[] }) {
    const { active, slots } = remainingOf(players);
    // 2026-10-03: タイマー表示はヘッダーの小さなバッジから、選手カードの右側に並ぶ
    // 大きなリングゲージ(TimerPanel)へ移設した。Cowork Design側(ThirdRound10UpDown.dc.html
    // 等)がこの形に更新されたため、それに合わせている。ヘッダーはタイトルのみに戻す。
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 40, letterSpacing: 3, color: '#FFFFFF' }}>3rd Round</div>
            {/* 2行目: 左にコース名、右に「残り参加者数 → 残り勝ち抜け枠数」（2nd Round と同じ配置） */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: 50, color: '#F3FAFF', letterSpacing: 1 }}>{courseName}</div>
                <RemainingSlots active={active} slots={slots} />
            </div>
        </div>
    );
}

/**
 * 残り時間のリング表示。Cowork Design の ThirdRound10UpDown.dc.html / Freeze10 / Swedish10 /
 * 10by10(2026-10-03更新版、4コースとも同一仕様)にある大きなリングゲージをそのまま移植した。
 * 半径200pxの円を残り秒数の割合で塗り分け、中央にmm:ss表示を重ねる。残り2分以下で
 * 警告色(#FF3B5C)に変わり点滅する(アーティファクトのtimerUrgent/timerPulseと同じ基準)。
 *
 * 開始アニメーション(0 → その時点の残り秒数まで850msでカウントアップし、ゲージも連動して
 * 充填される)もアーティファクトのanimateTimerFill()と同じイージング(1-(1-t)^3)・時間で
 * 移植している。カードの「開扉」演出がexpandingフェーズに入る瞬間(useCardIntroPhaseの
 * isExpanding)に合わせて1回だけ再生する(アーティファクトのplayIntro()がちょうどこの
 * タイミングでanimateTimerFill()を呼んでいるのと同じ)。再生が終わったあとは、ずっと
 * 実際のremaining(サーバから配信される本当の残り時間)をそのまま表示する。
 */
function TimerPanel({ remaining, playFillIntro }: { remaining: number; playFillIntro: boolean }) {
    const TOTAL = COURSE_TIME_LIMIT_SECONDS;
    const R = 200;
    const C = 2 * Math.PI * R;

    const [introSeconds, setIntroSeconds] = useState(0);
    const [introDone, setIntroDone] = useState(false);
    // 開始時点のremainingを演出の目標値として固定する(アニメーション中にremainingが
    // 1秒進んでも、目標が動いてカクつかないようにするため)。レンダー中にrefへ書き込むのは
    // 禁止されているので、専用のeffectで毎レンダー後に同期する。
    const remainingRef = useRef(remaining);
    useEffect(() => {
        remainingRef.current = remaining;
    });

    // 再生中のアニメーションのハンドル。演出の開始条件（playFillIntro）が false に戻っても
    // 途中で止めないよう、effect の cleanup ではなくアンマウント時だけ止める。
    //
    // 2026-10-11 修正: 以前は playFillIntro の effect の cleanup で cancelAnimationFrame
    // していた。playFillIntro（= カードの開扉演出の expanding 段階）は 850ms で false に
    // 戻り、充填演出も 850ms かかるため、演出が終わる直前に毎回キャンセルされて
    // introDone が true にならなかった。その結果、表示が演出の最終値のまま固まり、
    // Admin でタイマーを操作しても Main の残り時間が変わらなかった。
    const rafRef = useRef(0);
    useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

    useEffect(() => {
        if (!playFillIntro) return;
        const target = remainingRef.current;
        const duration = 850;
        const startTime = Date.now();
        // コースの切り替え(QuizViewの再マウント)ごとに1回だけ発生する初期化なので、
        // 連鎖的な再レンダーを招く心配はない(アーティファクトのplayIntro()が毎回
        // setState({timerDisplaySeconds:0})から始めるのと同じ)。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIntroDone(false);
        setIntroSeconds(0);
        cancelAnimationFrame(rafRef.current);
        const tick = () => {
            const elapsed = Date.now() - startTime;
            const t = Math.min(1, elapsed / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            setIntroSeconds(Math.round(eased * target));
            if (t < 1) {
                rafRef.current = requestAnimationFrame(tick);
            } else {
                setIntroDone(true);
            }
        };
        rafRef.current = requestAnimationFrame(tick);
    }, [playFillIntro]);

    const shownSeconds = introDone ? remaining : introSeconds;
    const frac = Math.max(0, Math.min(1, shownSeconds / TOTAL));
    const filled = frac * C;
    // 警告判定は演出中の値ではなく本来の残り時間で行う(充填序盤にゲージがほぼ空の
    // 状態で誤って赤く点滅しないようにする。アーティファクトのtimerUrgentと同じ考え方)。
    const urgent = remaining <= 120;
    const ringColor = urgent ? '#FF3B5C' : '#4FD8FF';
    const glow = urgent ? 'rgba(255,59,92,.65)' : 'rgba(79,216,255,.55)';

    return (
        <div style={{ width: 520, flexShrink: 0, height: 660, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
            {/* 全ルールでタイマーを約1.4倍に（2026-11-04 ユーザー指示。右の空いた場所に収まる大きさ） */}
            <div className={urgent ? 'animate-pulse' : undefined} style={{ position: 'relative', width: 460, height: 460, transform: 'scale(1.38)' }}>
                <svg width={460} height={460} viewBox="0 0 460 460" style={{ transform: 'rotate(-90deg)' }}>
                    <circle cx={230} cy={230} r={R} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth={24} />
                    <circle
                        cx={230} cy={230} r={R} fill="none" stroke={ringColor} strokeWidth={24} strokeLinecap="round"
                        strokeDasharray={`${filled.toFixed(1)} ${(C - filled).toFixed(1)}`}
                        style={{ filter: `drop-shadow(0 0 10px ${glow})` }}
                    />
                </svg>
                <div style={{
                    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'Orbitron, "Noto Sans JP", sans-serif', fontWeight: 900, fontSize: 104, letterSpacing: 2,
                    fontVariantNumeric: 'tabular-nums', color: '#FFFFFF', textShadow: `0 0 18px ${glow}`,
                }}>
                    {formatTime(shownSeconds)}
                </div>
            </div>
        </div>
    );
}

type QuizViewProps = {
    quizCourse: Course;
    quizPlayers: Player[];
    remaining: number;
    socket: Socket | null;
}

/** 選手カード（694）＋ 下の数字（16＋70）＋ 誤答の×・（4＋70）。RoundStage の縮小の基準（2026-10-22） */
const THIRD_ROUND_CONTENT_H = 694 + 16 + BELOW_NUMBER_H + 4 + BELOW_MARK_H;
/** サドンデスはカードの下が数字（勝ち抜け順位・LOST）だけ */
const THIRD_ROUND_PLAYOFF_CONTENT_H = 694 + 16 + BELOW_NUMBER_H;

function QuizView({ quizCourse, quizPlayers, remaining, socket }: QuizViewProps) {
    const phase = useCardIntroPhase();
    // 2026-10-22: 見出し → 問題欄 → 仕切り線 → カードの位置を全ラウンドでそろえる（RoundStage）
    return (
        <RoundStage socket={socket} round="thirdRound" ruleColor="#FFC93C" contentW={1776} contentH={THIRD_ROUND_CONTENT_H}
            header={<QuizHeader courseName={quizCourse.name} players={quizPlayers} />}>
            <div style={{ width: 1776, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 56 }}>
                    {quizPlayers.map(p => (
                        <QuizPlayerCard key={p.id} player={p} courseName={quizCourse.name as ThirdRoundCourseName} phase={phase} />
                    ))}
                </div>
                <TimerPanel remaining={remaining} playFillIntro={phase.isExpanding} />
            </div>
        </RoundStage>
    );
}

/** below表示(枠下の大きな数字+補助表示)の共通の「見出し数字」部分 */
/** Swedish 10 で次の誤答で付く×のマス（「・」）の色。Admin の「(+n)」と同じ淡い赤 */
const SWEDISH_PREVIEW_COLOR = '#FF9E9E';

function BelowNumber({ text, color }: { text: string | number; color: string }) {
    return (
        <div style={{ marginTop: 16, height: BELOW_NUMBER_H, lineHeight: `${BELOW_NUMBER_H}px`, fontFamily: 'Orbitron, "Noto Sans JP", sans-serif', fontSize: belowFontSize(text), fontWeight: 800, letterSpacing: 1, color }}>
            {text}
        </div>
    );
}

function QuizPlayerCard({ player: p, courseName, phase }: { player: Player; courseName: ThirdRoundCourseName; phase: CardIntroPhase }) {
    // LOST にするのは、コースのルールで失格した選手だけ（2026-10-29 ユーザー指示。2nd Round と同じ）。
    // 勝ち抜け枠が埋まってコースが終わった・15分経過で通過できなかった選手は、DB 上は −1 だが
    // 通常の表示（点数・×）のままにする
    const eliminated = p.thirdRoundRank < 0 && isEliminatedByCourseRule(courseName, p);
    const winner = p.thirdRoundRank > 0;
    // 勝ち抜け・失格の場合は枠下の表示を結果(順位/LOST)に差し替える。4コースとも共通の規則
    // (Design アーティファクトのbelowText/belowColor算出をそのまま踏襲)。
    const resultColor = eliminated ? '#8A93A3' : winner ? '#FFE28A' : '#EAF6FF';
    const resultText: string | null = eliminated ? 'LOST' : winner ? toOrdinal(p.thirdRoundRank) : null;

    let pct = 0;
    let belowContent: React.ReactNode;
    let extraOverlay: React.ReactNode;

    if (courseName === THIRD_ROUND_COURSES.UP_DOWN) {
        pct = Math.min(100, (p.thirdRoundUpDownPoint / 10) * 100);
        const wrongCount = Math.min(2, p.thirdRoundWrongCount);
        belowContent = (
            <>
                <BelowNumber text={resultText ?? p.thirdRoundUpDownPoint} color={resultColor} />
                <div style={{ display: 'flex', gap: 14, marginTop: 4, height: BELOW_MARK_H, alignItems: 'center' }}>
                    {Array.from({ length: wrongCount }).map((_, i) => (
                        <span key={`x${i}`} style={{ width: BELOW_MARK_W, height: BELOW_MARK_H, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: BELOW_MARK_FONT - 4, lineHeight: 1, fontWeight: 700, color: '#FF4D6D' }}>×</span>
                    ))}
                    {Array.from({ length: Math.max(0, 2 - wrongCount) }).map((_, i) => (
                        <span key={`d${i}`} style={{ width: BELOW_MARK_W, height: BELOW_MARK_H, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: BELOW_MARK_FONT - 4, lineHeight: 1, fontWeight: 700, color: '#3A5170' }}>・</span>
                    ))}
                </div>
            </>
        );
    } else if (courseName === THIRD_ROUND_COURSES.FREEZE) {
        pct = Math.min(100, (p.thirdRoundCorrectCount / 10) * 100);
        const isFrozen = p.thirdRoundFreezeRest > 0 && !eliminated && !winner;
        belowContent = (
            <>
                <BelowNumber text={resultText ?? p.thirdRoundCorrectCount} color={resultColor} />
                {/* Freeze 10には「2回で失格」のような固定の誤答上限が無いため、通算誤答回数を
                    そのまま数字で示す(10 up-downの×マーク+残り枠ドットとは異なる表現)。
                    2026-10-03 ユーザー指摘: アーティファクト自体がこの数字にfont-familyを
                    指定しておらず(ルートのRajdhaniを継承)、Orbitronで出している正解数(上の
                    BelowNumber)より小さく見えてしまっていた。見た目を正解数と揃えるため、
                    BelowNumberと同じ書体・サイズに統一する(アーティファクトからの意図的な変更。
                    その後BelowNumber自体が2nd Round側の58pxに揃えられたため、本表示も追従)。 */}
                <div style={{ marginTop: 4, height: BELOW_MARK_H, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontFamily: 'Orbitron, "Noto Sans JP", sans-serif', fontSize: BELOW_NUMBER_FONT, fontWeight: 800, letterSpacing: 1, lineHeight: 1, color: p.thirdRoundWrongCount > 0 ? '#FF4D6D' : '#3A5170' }}>
                        {p.thirdRoundWrongCount}×
                    </span>
                </div>
            </>
        );
        if (isFrozen) {
            extraOverlay = <FreezeOverlay remaining={p.thirdRoundFreezeRest} opacity={phase.revealOpacity} transition={phase.REVEAL_TRANSITION} />;
        }
    } else if (courseName === THIRD_ROUND_COURSES.SWEDISH) {
        pct = Math.min(100, (p.thirdRoundCorrectCount / 10) * 100);
        // 通算×の合計(crossCount、最大10)を2行5列のグリッドで示す。埋まっている分は赤い×、
        // 残りは薄暗い・のプレースホルダー(Design アーティファクトの構成をそのまま移植)。
        const filledCrosses = Math.min(10, p.thirdRoundSwedishCross);
        // 次に誤答したら付く×の数のマスは、「・」の色を変えて予告する（2026-10-29 ユーザー指示）。
        // 数は採点と同じ getSwedishCrossToAdd から求める。色は Admin の「(+n)」と同じ淡い赤。決着した選手には出さない
        const previewEnd = p.thirdRoundRank === 0
            ? Math.min(10, filledCrosses + getSwedishCrossToAdd(p.thirdRoundCorrectCount))
            : filledCrosses;
        belowContent = (
            <>
                <BelowNumber text={resultText ?? p.thirdRoundCorrectCount} color={resultColor} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', rowGap: 0, marginTop: 2, width: 172, boxSizing: 'border-box', overflow: 'hidden' }}>
                    {Array.from({ length: 10 }).map((_, i) => {
                        const filled = i < filledCrosses;
                        const preview = !filled && i < previewEnd;
                        return (
                            <span key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0, overflow: 'hidden', height: 38, fontSize: 44, lineHeight: 1, fontWeight: 700, color: filled ? '#FF4D6D' : preview ? SWEDISH_PREVIEW_COLOR : '#3A5170' }}>
                                {filled ? '×' : '・'}
                            </span>
                        );
                    })}
                </div>
            </>
        );
    } else {
        // 10 by 10: 総合ポイント(正解pt × 誤答pt の積)が枠下の大きな数字。内訳を小さく併記し、
        // 通算6回誤答で失格となるため6マスの×/・グリッドを添える。
        const total = getTenByTenTotal(p);
        const wrongPoints = getTenByTenWrongPoint(p);
        pct = Math.min(100, (total / 100) * 100);
        belowContent = (
            <>
                <BelowNumber text={resultText ?? total} color={resultColor} />
                {/* 2026-10-03 ユーザー指摘: 内訳(正解pt×誤答pt)のサイズ変更は一旦取り消し、
                    改めてアーティファクト(ThirdRound10by10.dc.html)のstyleFormula系を確認して
                    忠実に再現する。34px・fontWeight 800・letterSpacing .5pxで、正解ptは淡い赤
                    (#FF9E9E)、区切りの「×」は淡い青(#7FA8D9)、誤答ptは淡い水色(#8FD4FF)と
                    3色に分かれている。 */}
                {/* 2026-11-04 ユーザー指示: 誤答数の×・のマスは出さず、その分「正解pt × 誤答pt」を 34px → 56px に大きくする */}
                <div style={{ marginTop: 10, fontFamily: 'Orbitron, "Noto Sans JP", sans-serif', fontWeight: 800, fontSize: 56, letterSpacing: 0.5, whiteSpace: 'nowrap' }}>
                    <span style={{ color: '#FF9E9E' }}>{p.thirdRoundCorrectCount}</span>
                    <span style={{ color: '#7FA8D9' }}> × </span>
                    <span style={{ color: '#8FD4FF' }}>{wrongPoints}</span>
                </div>
            </>
        );
    }

    return (
        <PlayerCardFrame
            phase={phase}
            paperRank={p.paperRank}
            eliminated={eliminated}
            winner={winner}
            name={p.name}
            school={p.school}
            grade={p.grade}
            pct={pct}
            // 勝ち抜けたら 2nd Round と同じくバーをオレンジにする（2026-10-11、ユーザー指示）
            barColor={winner ? WINNER_BAR_COLOR : undefined}
            extraOverlay={extraOverlay}
            belowContent={belowContent}
        />
    );
}

// ============================================================================
// 早押しプレーオフ（Main）
// ============================================================================

type PlayoffViewProps = {
    quizCourse: Course | null;
    quizPlayers: Player[];
    /** サドンデスの参加者。null（記録なし）ならコースの5名全員を並べる */
    playoffIds: number[] | null;
    socket: Socket | null;
}

/**
 * Cowork Design アーティファクトにこの画面のモックアップが無かったため、クイズ実施
 * フェーズで作った PlayerCardFrame とティア配色をそのまま流用して自分でデザインした
 * (ユーザー判断、2026-10-03)。見出し下の横線は 2026-10-11 のユーザー指示で、
 * コース本体と同じ黄色(#FFC93C)にしている。
 */
function PlayoffView({ quizCourse, quizPlayers, playoffIds, socket }: PlayoffViewProps) {
    // 並べるのはサドンデスの参加者だけ（2026-10-29 ユーザー指示）。右上の「残り参加者 → 残り枠」は
    // 枠の計算にサドンデス前の勝ち抜け者も要るので、コースの5名全員から数える
    const shown = playoffIds && playoffIds.length > 0 ? quizPlayers.filter(p => playoffIds.includes(p.id)) : quizPlayers;
    const phase = useCardIntroPhase();
    const rowW = Math.max(1, shown.length * 172 + Math.max(0, shown.length - 1) * 56);
    // 2026-10-22: 見出し → 問題欄 → 仕切り線 → カードの位置を全ラウンドでそろえる（RoundStage）。
    // 見出し下の横線は通常のクイズ画面と同じ黄色にする（2026-10-11 ユーザー指示）
    return (
        <RoundStage socket={socket} round="thirdRound" ruleColor="#FFC93C" contentW={rowW} contentH={THIRD_ROUND_PLAYOFF_CONTENT_H} header={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 40, letterSpacing: 3, color: '#FFFFFF' }}>3rd Round</div>
                {/* 2行目: 左に見出し、右に「残り参加者数 → 残り勝ち抜け枠数」（2026-10-29。クイズ画面と同じ） */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    {/* 見出しはルール名だけにし、サドンデスの前後で変えない（2026-11-04 ユーザー指示） */}
                    <div style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: 50, color: '#F3FAFF', letterSpacing: 1 }}>{quizCourse ? quizCourse.name : 'サドンデス'}</div>
                    <RemainingSlots {...remainingOf(quizPlayers)} />
                </div>
            </div>

        }>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 56, justifyContent: 'center' }}>
                    {shown.map(p => {
                        // 勝ち抜け → 正の数、敗退 → −1、プレーオフ対象 → 0。
                        // LOST はコースのルールで失格した選手だけ（2026-10-29 ユーザー指示。2nd Round と同じ）。
                        // サドンデスで勝ち抜けられなかった選手は LOST にしない
                        const eliminated = p.thirdRoundRank < 0 && !!quizCourse && isEliminatedByCourseRule(quizCourse.name as ThirdRoundCourseName, p);
                        const winner = p.thirdRoundRank > 0;
                        const belowContent = winner
                            ? <BelowNumber text={toOrdinal(p.thirdRoundRank)} color="#FFE28A" />
                            : eliminated
                                ? <BelowNumber text="LOST" color="#8A93A3" />
                                : null;
                        // プレーオフは進捗バーの概念が無いコースなので pct は常に0(=非表示)にする
                        return (
                            <PlayerCardFrame
                                key={p.id}
                                phase={phase}
                                paperRank={p.paperRank}
                                eliminated={eliminated}
                                winner={winner}
                                name={p.name}
                                school={p.school}
                                grade={p.grade}
                                pct={0}
                                belowContent={belowContent}
                            />
                        );
                    })}
                    {shown.length === 0 && (
                        <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, fontSize: 24, color: '#5C7EA6' }}>
                            サドンデスの対象者がいません。
                        </span>
                    )}
                </div>
        </RoundStage>
    );
}
