// 縦書きの選手カード（2026-10-31 ユーザー指示: Main との対応が分かるよう、横一列に並べて縦書きで表示する）。
// 上から「席番号・順位・状態」「縦書きの名前（幅に余裕があれば学校名・学年も）」「点数」「正解・誤答」。
// 点数とボタンは全員同じ高さにそろえる（名前の欄が伸び縮みする）。
import type { CSSProperties, ReactNode } from "react";
import { ACCENT, tierOf } from "@/lib/cyberpunkCard";
import { toOrdinal } from "@/lib/ordinal";
import styles from "./console.module.css";

export type SeatStatusTone = 'win' | 'lost' | 'dc' | 'info' | 'now';
export type SeatStatus = { label: string; tone: SeatStatusTone };

const BADGE_CLASS: Record<SeatStatusTone, string> = {
    win: styles.badgeWin, lost: styles.badgeLost, dc: styles.badgeDc, info: styles.badgeInfo, now: styles.badgeNow,
};

/**
 * 名前の文字の大きさ。並ぶ人数で上限を決め、長い名前は縦に収まるよう小さくする。
 * zoneHeight は名前の欄のおおよその高さ（1440×900 で 12名なら約 300px）
 */
export function seatNameSize(count: number, name: string, zoneHeight = 300): number {
    const byCount = count >= 11 ? 23 : count >= 9 ? 25 : count >= 7 ? 27 : count >= 5 ? 34 : count >= 4 ? 38 : 42;
    const chars = Array.from(name.replace(/\s+/g, '')).length + 0.5;   // 姓と名の間の空き（0.5字）
    return Math.max(14, Math.min(byCount, Math.floor((zoneHeight - 12) / (chars * 1.09))));
}

/** 「姓 名」の空白を、縦書きで見やすい半字の空きにする */
function VerticalName({ name, size }: { name: string; size: number }) {
    const parts = name.trim().split(/[\s　]+/);
    return (
        <span className={styles.name} style={{ fontSize: size }}>
            {parts.map((part, i) => (
                <span key={i}>{i > 0 && <span className={styles.nameGap} />}{part}</span>
            ))}
        </span>
    );
}

export function SeatCard({ seatNo, paperRank, name, school, nameSize, status, dimmed, highlighted, score, onCorrect, onWrong, canOperate }: {
    seatNo: number;
    paperRank: number;
    name: string;
    /** 学校名・学年（幅に余裕があるときだけ渡す） */
    school?: string;
    nameSize: number;
    status?: SeatStatus | null;
    /** 決着した・休み中など、操作しない選手 */
    dimmed?: boolean;
    /** いま Main で発表中など、目立たせる選手 */
    highlighted?: boolean;
    score?: ReactNode;
    /** 渡さなければボタンを出さない（ターンオーバーなど） */
    onCorrect?: () => void;
    onWrong?: () => void;
    canOperate?: boolean;
}) {
    const tier = tierOf(paperRank, ACCENT);
    const cls = [styles.seat, dimmed ? styles.seatOut : '', highlighted ? styles.seatHi : ''].join(' ');
    return (
        <div className={cls} style={{ '--tc': tier.color } as CSSProperties}>
            <div className={styles.seatHead}>
                <span className={styles.seatNo}>{seatNo}</span>
                <span className={styles.seatRank}>{toOrdinal(paperRank)}</span>
                {status ? <span className={BADGE_CLASS[status.tone]}>{status.label}</span> : <span className={styles.badge} />}
            </div>
            <div className={styles.nameZone}>
                <VerticalName name={name} size={nameSize} />
                {school && <span className={styles.school}>{school}</span>}
            </div>
            {score && <div className={styles.score}>{score}</div>}
            {onCorrect && onWrong && (
                <div className={styles.seatBtns}>
                    <button type="button" className={styles.ok} onClick={onCorrect} disabled={!canOperate}>正解</button>
                    <button type="button" className={styles.ng} onClick={onWrong} disabled={!canOperate}>誤答</button>
                </div>
            )}
        </div>
    );
}

/** 点数の目盛り（value / max 個） */
export function Pips({ value, max }: { value: number; max: number }) {
    return (
        <div className={styles.pips} aria-hidden="true">
            {Array.from({ length: max }, (_, i) => <i key={i} className={i < value ? styles.on : undefined} />)}
        </div>
    );
}

/** 誤答の × の並び（count / max 個） */
export function WrongMarks({ count, max }: { count: number; max: number }) {
    return (
        <div className={styles.marks} aria-label={`誤答 ${count}回`}>
            {Array.from({ length: max }, (_, i) => <span key={i} className={i < count ? styles.on : undefined}>×</span>)}
        </div>
    );
}

/** 大きな数字（size px）と、後ろの小さな補足（例「/ 5」） */
export function BigNumber({ value, size, suffix, color }: { value: number | string; size: number; suffix?: string; color?: string }) {
    return <span className={styles.num} style={{ fontSize: size, color }}>{value}{suffix && <small> {suffix}</small>}</span>;
}

/** 選手の列。count 人を横一列に並べる（少ないときはカードの幅に上限を付けて中央に寄せる） */
export function SeatRow({ count, children }: { count: number; children: ReactNode }) {
    const few = count <= 4;
    return (
        <div className={few ? styles.rowCenter : styles.row}
            style={{ gridTemplateColumns: few ? `repeat(${count}, minmax(0, 220px))` : `repeat(${Math.max(1, count)}, minmax(0, 1fr))`, gap: count <= 5 ? 10 : 6 }}>
            {children}
        </div>
    );
}
