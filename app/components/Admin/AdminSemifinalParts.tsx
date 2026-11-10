// 準決勝 Admin の作業面の部品（運営コンソール。2026-11-05 に載せ替え）。
// 選手のカードは 2nd / 3rd Round と同じ縦書きの SeatCard を使う。進行のボタンは上のバー（AdminSemifinal）に出す。
// 写真・二つ名の登録（PrepPanel）は AdminSemifinalPrep.tsx。
import type { Player } from "@/lib/types";
import type { PoolQuestion } from "@/lib/questionPool";
import type { PlayoffProgress, SemifinalPlayoff } from "@/lib/semifinalPlayoff";
import type { SemifinalSeatAssignment } from "@/lib/semifinal";
import { displayNickname, photoUrl, type SemifinalProfile } from "@/lib/semifinalProfile";
import { NoPhoto } from "@/app/components/Main/SemifinalCard";
import { courseLabel } from "./AdminSemifinalPrep";
import { SeatCard, SeatRow, BigNumber, seatNameSize, type SeatStatus } from "./console/SeatCard";
import styles from "./console/console.module.css";

// ---------------------------------------------------------------------------
// セットの得点入力の検証
// ---------------------------------------------------------------------------

/** 「5」「-3」「＋２」「−1」などを整数にする。整数でなければ null */
export function parsePointInput(raw: string): number | null {
    const half = raw.trim()
        .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
        .replace(/[−－ー]/g, '-')
        .replace(/[＋]/g, '+');
    return /^[+-]?\d{1,3}$/.test(half) ? parseInt(half, 10) : null;
}

/** 全員の入力が整数になっているか（「得点を確定 ▶」を押せるか） */
export function allPointsValid(players: Player[], values: Record<number, string>): boolean {
    return players.length > 0 && players.every(p => parsePointInput(values[p.id] ?? '') !== null);
}

// ---------------------------------------------------------------------------
// 選手の並び（席順・累計ポイント）。Admin は常にポイントが見える。
// points を渡すと、勝ち抜け・敗退が決まっていない選手のカードに、このセットの得点の入力欄を出す
// ---------------------------------------------------------------------------

export function StandingsRow({ entrants, points, showSet }: {
    entrants: Player[];
    points?: { values: Record<number, string>; onChange: (id: number, v: string) => void; disabled: boolean };
    /** 勝ち抜けの印に、勝ち抜けたセットを出す（決勝進出者の確認用） */
    showSet?: boolean;
}) {
    if (entrants.length === 0) return <div className={styles.empty}>出場者が未確定です</div>;
    return (
        <SeatRow count={entrants.length}>
            {entrants.map(p => {
                const won = p.semifinalRank > 0;
                const lost = p.semifinalRank === -1;
                const status: SeatStatus | null = lost ? { label: 'LOST', tone: 'lost' }
                    : won ? { label: showSet ? `SET ${p.semifinalRank}` : 'WIN', tone: 'win' } : null;
                const raw = points?.values[p.id] ?? '';
                const invalid = raw.trim() !== '' && parsePointInput(raw) === null;
                return (
                    <SeatCard key={p.id} paperRank={p.paperRank} name={p.name} nameSize={seatNameSize(entrants.length, p.name)}
                        status={status} dimmed={lost}
                        score={<>
                            <BigNumber value={p.semifinalPoint} size={32} />
                            {points && !won && !lost && (
                                <input type="text" inputMode="numeric" value={raw} disabled={points.disabled}
                                    className={invalid ? styles.pointInputBad : styles.pointInput}
                                    placeholder="±"
                                    onChange={e => points.onChange(p.id, e.target.value)}
                                    aria-label={`${p.name} の得点`} />
                            )}
                        </>} />
                );
            })}
        </SeatRow>
    );
}

// ---------------------------------------------------------------------------
// 振り返る問題の通し番号の入力（タイムアップ後。2026-10-17 の流れ）
// ---------------------------------------------------------------------------

export function RangeForm({ from, to, onFrom, onTo, note, noteOk }: {
    from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void;
    /** 範囲の中身（例「No.98〜No.100、No.1〜No.3（6問）」）か、使えない理由。2026-11-11 */
    note?: string | null; noteOk?: boolean;
}) {
    return (
        <div className={styles.rangeBox}>
            <span className={styles.rangeLabel}>TIME UP — 振り返る問題の通し番号を入力</span>
            <input type="text" inputMode="numeric" value={from} onChange={e => onFrom(e.target.value)} className={styles.rangeInput} aria-label="開始の通し番号" />
            <span className={styles.rangeLabel}>〜</span>
            <input type="text" inputMode="numeric" value={to} onChange={e => onTo(e.target.value)} className={styles.rangeInput} aria-label="終了の通し番号" />
            {note && <span className={noteOk ? styles.rangeNote : styles.rangeNoteNg} role="status">{note}</span>}
        </div>
    );
}

// ---------------------------------------------------------------------------
// 振り返り中の問題（Main に出している3問。別解・正誤判定基準は Admin だけ）
// ---------------------------------------------------------------------------

export function ReviewList({ questions }: { questions: PoolQuestion[] }) {
    return (
        <div className={styles.revList}>
            {questions.map(q => (
                <div key={q.serial} className={styles.revCard}>
                    <div className={styles.revHead}>No.{q.serial}</div>
                    <p className={styles.revText}>{q.text}</p>
                    <div className={styles.revAns}>
                        <span>{q.answer}</span>
                        {q.altAnswer && <span className={styles.revAlt}>別解: {q.altAnswer}</span>}
                    </div>
                </div>
            ))}
        </div>
    );
}

// ---------------------------------------------------------------------------
// サドンデス（2026-10-15 に「プレーオフ」から呼び名を変更）
// 対象の選手だけを Main と同じ席番号順に並べ、正解・誤答を押す。Undo・スルーは上のバー／下のボタン
// ---------------------------------------------------------------------------

export function PlayoffRow({ playoff, progress, seats, busy, onMark }: {
    playoff: SemifinalPlayoff; progress: PlayoffProgress;
    /** 出場者の席（席番号順。Main と同じ getSemifinalSeats から作ったもの） */
    seats: SemifinalSeatAssignment[]; busy: boolean;
    onMark: (playerId: number, action: 'correct' | 'wrong') => void;
}) {
    const isAdvance = playoff.purpose === 'advance';
    const winLabel = isAdvance ? 'WIN' : 'SAFE';
    const loseLabel = isAdvance ? '敗退' : 'LOST';
    // 並びは Main と同じ席番号順（2026-10-29 修正。以前は対象者を決めた順＝ポイント順で、Main と違っていた）
    const candidates = seats.filter(s => playoff.candidateIds.includes(s.player.id));
    return (
        <SeatRow count={candidates.length}>
            {candidates.map(({ seat, player: p }) => {
                const outcome = progress.outcomes[p.id];
                const canOperate = !progress.resolved && outcome === undefined && !busy;
                const status: SeatStatus | null = outcome === 'win' ? { label: winLabel, tone: 'win' }
                    : outcome === 'lose' ? { label: loseLabel, tone: 'lost' } : null;
                return (
                    <SeatCard key={p.id} seatNo={seat} paperRank={p.paperRank} name={p.name} nameSize={seatNameSize(candidates.length, p.name)}
                        status={status} dimmed={outcome === 'lose'}
                        score={<BigNumber value={p.semifinalPoint} size={32} />}
                        onCorrect={() => onMark(p.id, 'correct')} onWrong={() => onMark(p.id, 'wrong')} canOperate={canOperate} />
                );
            })}
        </SeatRow>
    );
}

// ---------------------------------------------------------------------------
// 進出者紹介の進行（1人ずつ 二つ名 → プロフィール）
// ---------------------------------------------------------------------------

export function IntroView({ introOrder, index, step, profiles }: {
    introOrder: Player[]; index: number; step: 'nickname' | 'profile'; profiles: SemifinalProfile[];
}) {
    const cur = introOrder[index];
    if (!cur) return null;
    const profile = profiles.find(p => p.playerId === cur.id);
    const photo = photoUrl(profile);
    const isNick = step === 'nickname';
    const nick = displayNickname(cur, profile);
    return (
        <>
            <div className={styles.introBox}>
                <div className={isNick ? styles.introPhotoDim : styles.introPhoto}>
                    {photo
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        : <NoPhoto color="#5C7EA6" />}
                </div>
                <div className={styles.introText}>
                    <span className={styles.sectionLabel}>Main に表示中</span>
                    <span className={nick ? styles.introNick : styles.introNickNone}>{nick || '（二つ名なし）'}</span>
                    <span className={isNick ? styles.introSubDim : styles.introSub}>
                        {cur.school} {cur.grade}　{cur.name}{isNick ? '（次に表示）' : ''}
                    </span>
                </div>
            </div>
            <OrderCells players={introOrder} index={index} />
        </>
    );
}

/** 紹介順の一覧（いま・済み・これから） */
function OrderCells({ players, index }: { players: Player[]; index: number }) {
    return (
        <div className={styles.cells} style={{ gridTemplateColumns: `repeat(${Math.max(1, players.length)}, minmax(0, 1fr))` }}>
            {players.map((p, i) => {
                const done = i < index;
                const now = i === index;
                return (
                    <div key={p.id} className={now ? styles.cellNow : done ? styles.cellDone : styles.cell}>
                        <span className={styles.cellNo}>{String(i + 1).padStart(2, '0')}</span>
                        <span className={styles.cellSub}>{courseLabel(p)}</span>
                        <span className={styles.cellName}>{p.name}</span>
                        <span className={styles.cellMark}>{now ? 'NOW' : done ? 'DONE' : ''}</span>
                    </div>
                );
            })}
        </div>
    );
}

// ---------------------------------------------------------------------------
// 選手カード表示（紹介順に1枚ずつ、最後に敗者復活者）
// ---------------------------------------------------------------------------

export function LineupView({ lineupOrder, revived, allShown }: { lineupOrder: Player[]; revived: Player | null; allShown: boolean }) {
    return (
        <>
            <div className={styles.hint}>
                紹介順に1枚ずつ表示し、最後に敗者復活者を表示します。全員そろったら「クイズ画面へ」で、カードが縮んでタイマーが現れます。
            </div>
            <div className={styles.cells} style={{ gridTemplateColumns: `repeat(${Math.max(1, lineupOrder.length)}, minmax(0, 1fr))` }}>
                {lineupOrder.map((p, i) => {
                    const isRev = revived !== null && p.id === revived.id;
                    return (
                        <div key={p.id} className={allShown ? styles.cellNow : styles.cell}>
                            <span className={isRev ? styles.cellNoRev : styles.cellNo}>{isRev ? 'EXTRA' : String(i + 1).padStart(2, '0')}</span>
                            <span className={styles.cellName}>{p.name}</span>
                        </div>
                    );
                })}
            </div>
        </>
    );
}
