import { Socket } from "socket.io-client";
import { useState, useEffect, useRef } from "react";
import type { Player, ThirdRoundCourse, SemifinalState, SemifinalTimer } from "@/lib/types";
import { DEFAULT_SEMIFINAL_STATE } from "@/lib/types";
import { getSemifinalSeats, SET_TIME_LIMIT_SECONDS, type SemifinalSeatAssignment } from "@/lib/semifinal";
import { getPlayoffProgress } from "@/lib/semifinalPlayoff";
import {
    buildAnnouncePlan, getAnnounceFrame, pointToPct, ANNOUNCE_START_DELAY_MS, type AnnouncePlan,
} from "@/lib/semifinalAnnounce";
import { getIntroOrder, getLineupOrder, photoUrl, lineupDelayMs, type SemifinalProfile } from "@/lib/semifinalProfile";
import type { PublicPoolQuestion } from "@/lib/questionPool";
import { ACCENT, tierOf, shade, outlineShadow } from "@/lib/cyberpunkCard";
import { toOrdinal } from "@/lib/ordinal";
import FixedStage from "@/app/components/FixedStage";
import { WINNER_BAR_COLOR } from "./PlayerCardFrame";
import { SemifinalCard, SemifinalTimerGauge, NoPhoto, useSfCardIntro, SF_CHASSIS_W, BELOW_H } from "./SemifinalCard";
import { BELOW_NUMBER_FONT, belowFontSize } from "@/app/components/Main/belowSizes";

type Props = {
    socket: Socket | null;
}

const GOLD = '#FFC93C';
const GOLD_SOFT = '#FFE28A';
const REVIEW_PAGE_SIZE = 3;

/** 点数発表の演出。どの発表（announceSeq）を、いつから、どの計算で動かすか */
type Animation = { seq: number; startAt: number; plan: AnnouncePlan };

// 準決勝（Nine Hundred）の Main 画面（設計メモ 6章・7章）。
//
//   standby … 準備中（Admin で写真・二つ名を登録している間）
//   intro   … 進出者紹介。1人ずつ「二つ名」→「写真・学校名・学年・名前」
//   lineup  … 選手カード表示。紹介順 → 最後に敗者復活者の順に1枚ずつ現れる
//   quiz    … クイズ中。カードは写真だけを囲む小さい枠になり、下に5分タイマー
//   review  … 問題の振り返り。1画面に3問（横書き・縦並び）、ページ送りは Admin
//   tally   … 得点集計（2026-10-17 追加）。Admin で得点を入力している間。カードは元の大きさで、得点の欄は空
//   results … 点数発表。ポイントバーが合計得点まで上がり、最高得点者だけ加速して 100%
//             （それまでのラウンドの勝ち抜けと同じ高さ）。判定後は WIN / LOST に切り替わる
//   playoff … 同点者だけのサドンデス（コード上の名前は playoff のまま）
//
// lineup・quiz・results は同じカードの並び（CardsStage）を使い回すので、切り替えるとカードが
// その場で縮んだり伸びたりする。演出（カード表示・点数発表）は「この画面を開いている間に回数が
// 増えた」ときだけ再生する。リロード・途中から開いた場合は最終状態をそのまま出す。
export default function MainSemifinal(props: Props) {
    const { socket } = props;

    const [players, setPlayers] = useState<Player[]>([]);
    const [courses, setCourses] = useState<ThirdRoundCourse[]>([]);
    const [profiles, setProfiles] = useState<SemifinalProfile[]>([]);
    const [state, setState] = useState<SemifinalState | null>(null);
    const [timer, setTimer] = useState<SemifinalTimer>({ remainings: {}, runningSet: null });
    const [animation, setAnimation] = useState<Animation | null>(null);
    // 選手カード表示の演出（lineupSeq が増えたときだけ）。null なら演出せず全員を出す
    const [lineupSeqPlayed, setLineupSeqPlayed] = useState<number | null>(null);

    // 発表・カード表示の回数が増えたのを受信したら演出を組み立てる。最初に受け取った状態（開いた時点）では演出しない
    const lastSeqRef = useRef<number | null>(null);
    const lastLineupSeqRef = useRef<number | null>(null);
    const contendersRef = useRef<Player[]>([]);

    useEffect(() => {
        const loadProfiles = () => {
            fetch('/api/semifinal/profiles').then(res => res.json()).then(data => {
                if (data.success) setProfiles(data.profiles);
            }).catch(err => console.error('Failed to load semifinal profiles', err));
        };
        fetch('/api/secondRound/loadPlayers').then(res => res.json()).then(data => {
            if (data.success) setPlayers(data.allPlayers);
        });
        fetch('/api/thirdRound/courses').then(res => res.json()).then(data => {
            if (data.success) setCourses(data.courses);
        });
        loadProfiles();

        if (socket) {
            const handleStateUpdate = (next: SemifinalState) => {
                const prevSeq = lastSeqRef.current;
                lastSeqRef.current = next.announceSeq;
                if (prevSeq !== null && next.announceSeq > prevSeq) {
                    setAnimation({
                        seq: next.announceSeq,
                        startAt: Date.now() + ANNOUNCE_START_DELAY_MS,
                        plan: buildAnnouncePlan(contendersRef.current),
                    });
                }
                const prevLineup = lastLineupSeqRef.current;
                lastLineupSeqRef.current = next.lineupSeq;
                if (prevLineup !== null && next.lineupSeq > prevLineup) {
                    setLineupSeqPlayed(next.lineupSeq);
                }
                setState(next);
            };
            const handleTimerUpdate = (next: SemifinalTimer) => setTimer(next);
            const handlePlayersUpdate = (allPlayers: Player[]) => setPlayers(allPlayers);

            socket.on("update_semifinal_state", handleStateUpdate);
            socket.on("update_semifinal_timer", handleTimerUpdate);
            socket.on("update_players", handlePlayersUpdate);
            // 写真・二つ名が保存されたら取り直す（中身はサーバが送らない）
            socket.on("update_semifinal_profiles", loadProfiles);

            // 接続直後の配信はこの画面が無いうちに届いて失われるので、表示した時点で取り直す
            socket.emit("request_semifinal_sync");

            return () => {
                socket.off("update_semifinal_state", handleStateUpdate);
                socket.off("update_semifinal_timer", handleTimerUpdate);
                socket.off("update_players", handlePlayersUpdate);
                socket.off("update_semifinal_profiles", loadProfiles);
            };
        }
    }, [socket]);

    const seats = getSemifinalSeats(players, courses);
    const current = state ?? DEFAULT_SEMIFINAL_STATE;
    const profileOf = (id: number) => profiles.find(p => p.playerId === id);

    useEffect(() => {
        contendersRef.current = seats.map(s => s.player).filter(p => p.semifinalRank === 0);
    });

    // 振り返りの問題（Main 用：別解なし）
    const range = current.reviewRanges[current.set] ?? null;
    const pageCount = range ? Math.ceil((range.to - range.from + 1) / REVIEW_PAGE_SIZE) : 0;
    const page = Math.min(current.reviewPage, Math.max(0, pageCount - 1));
    const pageFrom = range ? range.from + page * REVIEW_PAGE_SIZE : 0;
    const pageTo = range ? Math.min(range.to, pageFrom + REVIEW_PAGE_SIZE - 1) : 0;
    const [questions, setQuestions] = useState<{ key: string; items: PublicPoolQuestion[] } | null>(null);
    const isReview = current.view === 'review' && range !== null;
    useEffect(() => {
        if (!isReview) return;
        const key = `${pageFrom}-${pageTo}`;
        let cancelled = false;
        fetch(`/api/questions?from=${pageFrom}&to=${pageTo}&public=1`).then(res => res.json()).then(data => {
            if (!cancelled && data.success) setQuestions({ key, items: data.questions });
        }).catch(err => console.error('Failed to load questions', err));
        return () => { cancelled = true; };
    }, [isReview, pageFrom, pageTo]);

    const remaining = timer.remainings[current.set] ?? SET_TIME_LIMIT_SECONDS;

    let body: React.ReactNode;
    if (current.view === 'standby') {
        body = <StandbyView />;
    } else if (current.view === 'intro') {
        const introOrder = getIntroOrder(players, courses);
        const player = introOrder[current.introIndex];
        body = player
            ? <IntroView key={`${current.introIndex}-${current.introStep}`} player={player} index={current.introIndex} step={current.introStep} profile={profileOf(player.id)} />
            : <StandbyView />;
    } else if (current.view === 'review' && range) {
        const loaded = questions && questions.key === `${pageFrom}-${pageTo}` ? questions.items : [];
        body = <ReviewView set={current.set} questions={loaded} />;
    } else if (current.view === 'playoff' && current.playoff) {
        body = <PlayoffView seats={seats} state={current} profileOf={profileOf} />;
    } else {
        // lineup / quiz / tally / results は同じ並びを使い回す（切り替えでカードがその場で縮む・伸びる）。
        // 得点集計 → 点数発表は同じカードのまま、バーだけが上がる（開扉演出をやり直さない）
        const mode = current.view === 'lineup' ? 'lineup'
            : current.view === 'results' ? 'results'
            : current.view === 'tally' ? 'tally'
            : 'quiz';
        const anim = animation && animation.seq === current.announceSeq ? animation : null;
        const lineupAnim = lineupSeqPlayed !== null && lineupSeqPlayed === current.lineupSeq ? lineupSeqPlayed : null;
        body = (
            <CardsStage
                key="stage"
                seats={seats} lineupOrder={getLineupOrder(players, courses)} set={current.set} mode={mode}
                animation={mode === 'results' ? anim : null} lineupAnim={mode === 'lineup' ? lineupAnim : null}
                remaining={remaining} profileOf={profileOf}
            />
        );
    }

    return <FixedStage>{body}</FixedStage>;
}

// ============================================================================
// 共通部品（Extra Round / 3rd Round の Main と同じ寸法）
// ============================================================================

const STAGE_STYLE = {
    width: 1920, height: 1080, boxSizing: 'border-box' as const, padding: '56px 72px', backgroundColor: '#000000',
    display: 'flex', flexDirection: 'column' as const, position: 'relative' as const, overflow: 'hidden',
    fontFamily: "'Rajdhani',sans-serif",
};

/** 見出し。準備中は副題なし、それ以外は「Nine Hundred」（進出者紹介も同じ。2026-10-15 ユーザー指示） */
function Header({ subtitle, right }: { subtitle?: string; right?: React.ReactNode }) {
    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 40, letterSpacing: 3, color: '#FFFFFF' }}>Semifinal</div>
                {subtitle && <div style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: 50, color: '#F3FAFF', letterSpacing: 1 }}>{subtitle}</div>}
            </div>
            {right}
        </div>
    );
}

function Rule({ color }: { color: string }) {
    return <div style={{ height: 2, marginTop: 26, background: color, boxShadow: `0 0 12px ${color}73`, flexShrink: 0 }} />;
}

function SetLabel({ set }: { set: number }) {
    return <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 40, letterSpacing: 3, color: ACCENT }}>SET {set}</span>;
}

function BelowText({ text, color }: { text: React.ReactNode; color: string }) {
    return (
        <div style={{ marginTop: 16, fontFamily: 'Orbitron, sans-serif', fontSize: typeof text === 'string' || typeof text === 'number' ? belowFontSize(text) : BELOW_NUMBER_FONT, fontWeight: 800, letterSpacing: 1, color, height: BELOW_H - 16, lineHeight: `${BELOW_H - 16}px`, fontVariantNumeric: 'tabular-nums' }}>
            {text}
        </div>
    );
}

// ============================================================================
// 準備中
// ============================================================================

function StandbyView() {
    return (
        <div style={STAGE_STYLE}>
            <Header />
            <Rule color={ACCENT} />
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
                    <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: 120, letterSpacing: 12, color: '#F3FAFF', textShadow: `0 0 28px ${ACCENT}66` }}>準備中</span>
                    <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 22, letterSpacing: 10, color: '#5C7EA6' }}>STANDBY</span>
                </div>
            </div>
        </div>
    );
}

// ============================================================================
// 進出者紹介（二つ名 → 写真・学校名・学年・名前）
// ============================================================================

// 現れ方。二つ名はぼかしからくっきり。プロフィールは写真の枠が縦の軸で回りながら現れ、
// 少し遅れて文字が横から入る（奇数番目は写真が左・偶数番目は右で、向きも逆）
const INTRO_CSS = `
@keyframes sfNickIn { 0% { opacity:0; filter:blur(12px); transform:translateY(18px); } 100% { opacity:1; filter:blur(0); transform:translateY(0); } }
@keyframes sfSpinL { 0% { opacity:0; transform:perspective(1800px) rotateY(-100deg) scale(.86); } 100% { opacity:1; transform:perspective(1800px) rotateY(0) scale(1); } }
@keyframes sfSpinR { 0% { opacity:0; transform:perspective(1800px) rotateY(100deg) scale(.86); } 100% { opacity:1; transform:perspective(1800px) rotateY(0) scale(1); } }
@keyframes sfTextL { 0% { opacity:0; transform:translateX(-56px); filter:blur(8px); } 100% { opacity:1; transform:translateX(0); filter:blur(0); } }
@keyframes sfTextR { 0% { opacity:0; transform:translateX(56px); filter:blur(8px); } 100% { opacity:1; transform:translateX(0); filter:blur(0); } }
@keyframes sfSweep { 0% { transform:translateX(-120%); } 100% { transform:translateX(120%); } }
`;

const BIG_PHOTO_W = 480, BIG_PHOTO_H = 640;

function IntroView({ player, index, step, profile }: { player: Player; index: number; step: 'nickname' | 'profile'; profile: SemifinalProfile | undefined }) {
    const tier = tierOf(player.paperRank, ACCENT);
    const nickname = profile?.nickname ?? '';
    return (
        <div style={STAGE_STYLE}>
            <style>{INTRO_CSS}</style>
            <Header subtitle="Nine Hundred" />
            <Rule color={ACCENT} />
            {/* 二つ名が未登録なら二つ名の画面は出さずプロフィールを出す（Admin も通常は飛ばす） */}
            {step === 'nickname' && nickname !== '' ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: 40 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 44, animation: 'sfNickIn .7s ease-out .45s both' }}>
                        <span style={{ width: 120, height: 3, background: `linear-gradient(90deg, transparent, ${tier.color})` }} />
                        <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: Math.max(72, Math.min(150, Math.floor(1500 / Math.max(1, Array.from(nickname).length)))), letterSpacing: 8, color: '#F3FAFF', textShadow: `0 0 34px ${tier.glowA}, 0 0 80px ${tier.glowB}`, whiteSpace: 'nowrap' }}>
                            {nickname}
                        </span>
                        <span style={{ width: 120, height: 3, background: `linear-gradient(90deg, ${tier.color}, transparent)` }} />
                    </div>
                </div>
            ) : (
                <ProfileBody player={player} index={index} nickname={nickname} photo={photoUrl(profile)} />
            )}
        </div>
    );
}

function ProfileBody({ player, index, nickname, photo }: { player: Player; index: number; nickname: string; photo: string | null }) {
    // 奇数番目（1人目・3人目…）は写真が左、偶数番目は右
    const photoLeft = index % 2 === 0;
    const tier = tierOf(player.paperRank, ACCENT);
    const outline = shade(tier.color, -0.35);
    const nameParts = player.name.trim().split(/\s+/);
    const nameLen = Array.from(player.name.replace(/\s+/g, '')).length + (nameParts.length - 1) * 0.5;
    const nameSize = Math.max(84, Math.min(150, Math.floor(1000 / nameLen)));
    const align = photoLeft ? 'flex-start' : 'flex-end';
    const clip = (c: number) => `polygon(${c}px 0,calc(100% - ${c}px) 0,100% ${c}px,100% calc(100% - ${c}px),calc(100% - ${c}px) 100%,${c}px 100%,0 calc(100% - ${c}px),0 ${c}px)`;

    return (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 96, padding: '0 40px', flexDirection: photoLeft ? 'row' : 'row-reverse' }}>
            <div style={{ position: 'relative', width: BIG_PHOTO_W + 24, height: BIG_PHOTO_H + 24, flexShrink: 0, animation: `${photoLeft ? 'sfSpinL' : 'sfSpinR'} .9s cubic-bezier(.22,1,.36,1) both` }}>
                {/* 額縁（カードと同じ面取り・順位帯の色） */}
                <div style={{ position: 'absolute', inset: 0, background: tier.color, clipPath: clip(36), filter: `drop-shadow(0 0 18px ${tier.glowA})` }} />
                <div style={{ position: 'absolute', inset: 12, overflow: 'hidden', background: '#0B0F16', clipPath: clip(30) }}>
                    {photo
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        : <NoPhoto color={tier.color} />}
                    <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(105deg, transparent 35%, ${tier.color}55 50%, transparent 65%)`, animation: 'sfSweep .9s ease-in-out .2s both' }} />
                </div>
            </div>
            <div style={{ flex: 1, display: 'flex', justifyContent: align, minWidth: 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: align, gap: 26, textAlign: photoLeft ? 'left' : 'right', animation: `${photoLeft ? 'sfTextR' : 'sfTextL'} .6s ease-out .35s both`, minWidth: 0 }}>
                    {/* 二つ名（未登録なら出さない） */}
                    {nickname && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexDirection: photoLeft ? 'row' : 'row-reverse' }}>
                            <span style={{ width: 54, height: 3, background: tier.color, boxShadow: `0 0 10px ${tier.glowA}` }} />
                            <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: 40, letterSpacing: 4, color: tier.color, textShadow: `0 0 18px ${tier.glowB}` }}>{nickname}</span>
                        </div>
                    )}
                    <div style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 800, fontSize: 52, letterSpacing: 2, color: '#FFFFFF', textShadow: outlineShadow(outline, 1.4) }}>
                        {player.school}<span style={{ marginLeft: 24 }}>{player.grade}</span>
                    </div>
                    <div style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: nameSize, lineHeight: 1.1, letterSpacing: 6, color: '#F3FAFF', textShadow: `${outlineShadow(outline, 2.2)}, 0 0 40px ${tier.glowB}`, whiteSpace: 'nowrap' }}>
                        {nameParts.map((part, i) => <span key={i} style={{ marginLeft: i === 0 ? 0 : '0.35em' }}>{part}</span>)}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ============================================================================
// 選手カード表示・クイズ中・点数発表（9名のカード。同じ並びを使い回す）
// ============================================================================

const ROW_GAP = 10;
const ROW_W = 9 * SF_CHASSIS_W + 8 * ROW_GAP;   // 1772

/** 演出中だけ毎フレーム現在時刻を返す（終わったら止まる）。最初のフレームまでは 0 */
function useAnimationClock(animation: Animation | null): number {
    const [now, setNow] = useState(0);
    useEffect(() => {
        if (!animation) return;
        const endAt = animation.startAt + animation.plan.totalMs;
        let raf = 0;
        const tick = () => {
            const t = Date.now();
            setNow(t);
            if (t <= endAt) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [animation]);
    return now;
}

function CardsStage({ seats, lineupOrder, set, mode, animation, lineupAnim, remaining, profileOf }: {
    seats: SemifinalSeatAssignment[]; lineupOrder: Player[]; set: number; mode: 'lineup' | 'quiz' | 'tally' | 'results';
    animation: Animation | null; lineupAnim: number | null; remaining: number;
    profileOf: (id: number) => SemifinalProfile | undefined;
}) {
    const players = seats.map(s => s.player);
    const compact = mode === 'quiz';

    // このセットで争っている選手（未決着＋このセットの勝ち抜け者）。高さの基準はこの中の最高得点
    const contenders = players.filter(p => p.semifinalRank === 0 || p.semifinalRank === set);
    const scale = Math.max(1, ...contenders.map(p => p.semifinalPoint));
    // 演出後の最終状態で 100% になる選手。判定済みならこのセットの勝ち抜け者、
    // 判定前なら単独の最高得点者（同点なら誰もいない）
    const staticTopId = players.find(p => p.semifinalRank === set)?.id ?? buildAnnouncePlan(contenders).topId;

    const now = useAnimationClock(animation);
    // now は最初のフレームまで 0。そのあいだは開始待ちとして扱う
    const elapsed = animation && now > 0 ? now - animation.startAt : -Infinity;
    const playing = animation !== null && elapsed < animation.plan.totalMs;

    // 得点集計・点数発表を開いたとき（振り返りなど別の画面からこのステージを新しく作ったとき）だけ、
    // カードの開扉演出を見せる。得点集計 → 点数発表は同じステージなので開扉はしない
    const [doorOnMount] = useState(mode === 'results' || mode === 'tally');

    // タイマーはカードが縮み終わってから出す（縮むときは文字 0.3s → 枠 0.7s）
    const [timerReady, setTimerReady] = useState(false);
    useEffect(() => {
        const id = requestAnimationFrame(() => setTimerReady(true));
        return () => cancelAnimationFrame(id);
    }, []);

    return (
        <div style={STAGE_STYLE}>
            <Header subtitle="Nine Hundred" right={mode === 'lineup' ? undefined : <SetLabel set={set} />} />
            {/* 仕切り線は Semi-Final の間ずっと青（2026-10-29 ユーザー指示。以前は判定後に金色へ変わっていた） */}
            <Rule color={ACCENT} />
            {/* カードの上端はどの表示でも同じ位置（縮むのは下辺だけ）。空いた下の部分にタイマーを出す */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 70, gap: 72 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: ROW_GAP }}>
                    {seats.map(({ player: p }) => {
                        const k = lineupOrder.findIndex(x => x.id === p.id);
                        const won = p.semifinalRank > 0;
                        const wonEarlier = won && p.semifinalRank < set;
                        const lost = p.semifinalRank === -1;
                        let pct = 0;
                        let below: React.ReactNode = '';
                        let color = '#EAF6FF';

                        if (mode === 'tally') {
                            // 得点集計中: 決着済みの選手だけ WIN / LOST、他は空欄（得点はまだ出さない）
                            if (won) {
                                pct = 100; below = 'WIN'; color = GOLD_SOFT;
                            } else if (lost) {
                                below = 'LOST'; color = '#8A93A3';
                            }
                        } else if (mode === 'results') {
                            if (wonEarlier || won) {
                                pct = 100; below = 'WIN'; color = GOLD_SOFT;
                            } else if (lost) {
                                below = 'LOST'; color = '#8A93A3';
                            } else if (playing && animation && animation.plan.points[p.id] !== undefined) {
                                // 開始待ち（カードの開扉中）は 0 から。getAnnounceFrame は負の経過時間を 0 として扱う
                                const frame = getAnnounceFrame(animation.plan, p.id, elapsed);
                                pct = frame.pct;
                                below = elapsed < 0 ? 0 : frame.shownPoint;
                            } else {
                                pct = p.id === staticTopId ? 100 : pointToPct(p.semifinalPoint, scale);
                                below = p.semifinalPoint;
                            }
                        }
                        // カード表示の演出: 紹介順に1枚ずつ。最後（敗者復活者）の前は少し間を空ける
                        const lineupDelay = lineupAnim !== null && k >= 0 ? lineupDelayMs(k, lineupOrder.length) : null;
                        return (
                            <StageCard
                                key={`${p.id}-${lineupAnim ?? 0}`}
                                player={p} photo={photoUrl(profileOf(p.id))}
                                introDelay={lineupDelay ?? (doorOnMount ? 0 : null)}
                                compact={compact}
                                eliminated={lost}
                                winner={won && (wonEarlier || mode !== 'lineup')}
                                pct={pct}
                                barColor={pct >= 100 ? WINNER_BAR_COLOR : undefined}
                                statusLabel={won ? toOrdinal(p.semifinalRank) : lost ? 'LOST' : null}
                                below={<BelowText text={below} color={color} />}
                            />
                        );
                    })}
                    {seats.length === 0 && (
                        <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, fontSize: 28, color: '#5C7EA6' }}>
                            出場者が確定していません。
                        </span>
                    )}
                </div>
                {/* 5分タイマー（クイズ中だけ。カードが縮み終わってから現れる） */}
                <div style={{
                    opacity: compact && timerReady ? 1 : 0, transform: compact && timerReady ? 'translateY(0)' : 'translateY(28px)',
                    transition: timerReady ? (compact ? 'opacity .5s ease 1s, transform .6s cubic-bezier(.22,1,.36,1) 1s' : 'opacity .25s ease, transform .25s ease') : 'none',
                }}>
                    <SemifinalTimerGauge remaining={remaining} total={SET_TIME_LIMIT_SECONDS} width={ROW_W} />
                </div>
            </div>
        </div>
    );
}

function StageCard({ player, photo, introDelay, compact, eliminated, winner, pct, barColor, statusLabel, below }: {
    player: Player; photo: string | null; introDelay: number | null; compact: boolean; eliminated: boolean; winner: boolean;
    pct: number; barColor?: string; statusLabel: string | null; below: React.ReactNode;
}) {
    const intro = useSfCardIntro(introDelay);
    return (
        <SemifinalCard intro={intro} paperRank={player.paperRank} name={player.name} school={player.school} grade={player.grade}
            photo={photo} eliminated={eliminated} winner={winner} pct={pct} barColor={barColor}
            compact={compact} statusLabel={statusLabel} belowContent={below} />
    );
}

// ============================================================================
// 問題の振り返り（1画面3問）
// ============================================================================

function ReviewView({ set, questions }: { set: number; questions: PublicPoolQuestion[] }) {
    return (
        <div style={STAGE_STYLE}>
            <Header
                subtitle="Nine Hundred" // 振り返り中もクイズ画面と同じ見出しのまま（2026-10-11 ユーザー指示）
                // ページ番号（○ / ○）は 2026-10-11 のユーザー指示で Main には出さない
                right={<SetLabel set={set} />}
            />
            <Rule color={ACCENT} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 28, paddingTop: 28 }}>
                {questions.map(q => (
                    <div key={q.serial} style={{
                        display: 'flex', gap: 32, alignItems: 'flex-start', padding: '24px 32px', boxSizing: 'border-box', minHeight: 230,
                        background: 'rgba(12,22,40,.75)', border: '1px solid rgba(79,216,255,.22)',
                        clipPath: 'polygon(18px 0,100% 0,100% calc(100% - 18px),calc(100% - 18px) 100%,0 100%,0 18px)',
                    }}>
                        {/* 通し番号（No.○）は 2026-10-11 のユーザー指示で Main には出さない（Admin のプレビューには出す） */}
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
                            <div style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, fontSize: 40, lineHeight: 1.45, color: '#F3FAFF', wordBreak: 'break-word', lineBreak: 'strict' }}>
                                {q.text}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
                                <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 30, color: GOLD }}>A.</span>
                                <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: 48, color: GOLD_SOFT, textShadow: `0 0 18px ${GOLD}66`, wordBreak: 'break-word' }}>
                                    {q.answer}
                                </span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ============================================================================
// サドンデス（2026-10-15 に「プレーオフ」から呼び名を変更。コード上の名前は playoff のまま）
// ============================================================================

function PlayoffView({ seats, state, profileOf }: { seats: SemifinalSeatAssignment[]; state: SemifinalState; profileOf: (id: number) => SemifinalProfile | undefined }) {
    const playoff = state.playoff!;
    const progress = getPlayoffProgress(playoff);
    const isAdvance = playoff.purpose === 'advance';
    const candidates = seats.filter(s => playoff.candidateIds.includes(s.player.id)).map(s => s.player);

    return (
        <div style={STAGE_STYLE}>
            <Header subtitle={isAdvance ? '勝ち抜けサドンデス' : '失格サドンデス'} right={<SetLabel set={state.set} />} />
            {/* サドンデスも仕切り線は青（2026-10-29 ユーザー指示） */}
            <Rule color={ACCENT} />
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 70 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 56 }}>
                    {candidates.map(p => {
                        const outcome = progress.outcomes[p.id];
                        // 勝ち抜けサドンデス: 勝者 WIN・誤答は × ／ 失格サドンデス: 失格 LOST・正解は ○
                        let below: React.ReactNode = '';
                        let color = '#EAF6FF';
                        if (outcome === 'win') {
                            below = isAdvance ? 'WIN' : '○'; color = isAdvance ? GOLD_SOFT : '#EAF6FF';
                        } else if (outcome === 'lose') {
                            below = isAdvance ? '×' : 'LOST'; color = '#8A93A3';
                        }
                        return (
                            <StageCard
                                key={p.id}
                                player={p} photo={photoUrl(profileOf(p.id))}
                                introDelay={0} compact={false}
                                eliminated={!isAdvance && outcome === 'lose'}
                                winner={isAdvance && outcome === 'win'}
                                pct={isAdvance && outcome === 'win' ? 100 : 0}
                                barColor={isAdvance && outcome === 'win' ? WINNER_BAR_COLOR : undefined}
                                statusLabel={null}
                                below={<BelowText text={below} color={color} />}
                            />
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
