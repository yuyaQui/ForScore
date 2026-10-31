// 運営コンソールの枠（2026-10-31 ユーザー承認。改善案 Step 1）。
// 上に ON AIR バー（Main に出ている画面・Undo・次の操作）、中央に採点面、右に Main の確認の列を置く。
// 進行レール（AdminRoundNav）は admin/page.tsx が左に置く。全ラウンドで押す場所をそろえるため、
// Undo と次の操作は必ずこのバーに出す（各ラウンドの画面の中には置かない）。
import type { ReactNode } from "react";
import styles from "./console.module.css";

export type ConsoleUndo = {
    /** 取り消す操作の説明（例「直前: 吉田 蓮 正解」）。分からなければ null */
    detail: string | null;
    onClick: () => void;
    disabled?: boolean;
};

export type ConsoleNext = {
    label: string;
    /** 押せないときは null（label に理由を書く。例「進行中（残り 10名）」） */
    onClick: (() => void) | null;
};

export function ConsoleFrame({ onAir, onAirDetail, undo, next, barExtra, side, children }: {
    /** Main に出ている画面（例「2nd Round　2組目」） */
    onAir: string;
    /** その補足（例「クイズ画面」） */
    onAirDetail?: string;
    undo: ConsoleUndo | null;
    next: ConsoleNext;
    /** バーに足す物（3rd Round のタイマーなど） */
    barExtra?: ReactNode;
    side: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className={styles.frame}>
            <header className={styles.bar}>
                <div className={styles.air}>
                    <span className={styles.lamp}><i />ON AIR</span>
                    <span className={styles.airTitle}>
                        {onAir}
                        {onAirDetail && <span className={styles.airDetail}>{onAirDetail}</span>}
                    </span>
                </div>
                {barExtra}
                {undo && (
                    <button type="button" className={styles.undo} onClick={undo.onClick} disabled={undo.disabled}>
                        ↶ Undo{undo.detail && <small>{undo.detail}</small>}
                    </button>
                )}
                {next.onClick
                    ? <button type="button" className={styles.next} onClick={next.onClick}>{next.label}</button>
                    : <span className={styles.nextWait} role="status">{next.label}</span>}
            </header>
            <main className={styles.work}>{children}</main>
            <aside className={styles.side}>{side}</aside>
        </div>
    );
}

/** 採点面の見出し（タイトル・状況・右端の道具） */
export function WorkHead({ title, meta, tools }: { title: string; meta?: ReactNode; tools?: ReactNode }) {
    return (
        <div className={styles.workHead}>
            <h1 className={styles.workTitle}>{title}</h1>
            {meta && <div className={styles.meta}>{meta}</div>}
            {tools && <div className={styles.headTools}>{tools}</div>}
        </div>
    );
}

/** 見出しの状況の1項目（例: 残り 10/12） */
export function MetaItem({ label, value }: { label: string; value: ReactNode }) {
    return <span>{label}<b>{value}</b></span>;
}

/** 引き出し（表示の切り替え・データ修正）。採点面の右上から開く */
export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
    return (
        <div className={styles.drawer} role="dialog" aria-label={title}>
            <div className={styles.drawerTitle}>
                {title}
                <button type="button" className={styles.btn} onClick={onClose}>閉じる</button>
            </div>
            {children}
        </div>
    );
}

/** 引き出しの中の1まとまり。disabled のときは薄くして押せなくする */
export function DrawerGroup({ label, disabled, note, children }: { label: string; disabled?: boolean; note?: string; children: ReactNode }) {
    return (
        <div className={`${styles.group} ${disabled ? styles.groupDisabled : ''}`}>
            <div className={styles.groupLabel}>{label}</div>
            <div className={styles.groupBtns}>{children}</div>
            {note && <div className={styles.note}>{note}</div>}
        </div>
    );
}
