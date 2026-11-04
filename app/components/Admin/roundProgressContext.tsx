"use client";
// Admin 全体で共有する「各ラウンドの状況」（2026-10-22 追加。docs/linear-progress-design.md 3章）
//
// admin/page.tsx が useRoundProgressSource で読み込み、RoundProgressProvider で配る。
// 各ラウンドの Admin は useRoundProgress で受け取り、「○○へ ▶」ボタン・Undo の制限・リセットの確認文に使う。
// 選手・3rd Round のコース・大会の状態を読み込み、Socket の更新に追従する（各画面と同じ配信を受ける）。
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { Player, ThirdRoundCourse } from '@/lib/types';
import {
    getRoundStatuses, nextRound, laterRoundStarted, undoBlockedMessage, resetCascadeNotice,
    ROUND_LABEL, ROUND_MODE, type RoundKey, type RoundStatus,
} from '@/lib/roundProgress';

export type RoundProgress = {
    statuses: Record<RoundKey, RoundStatus>;
    players: Player[];
    extraRoundNoRevival: boolean;
    /** 二つ名が1人でも登録されているか（リセットの確認文で「二つ名と写真も削除」を出すかに使う） */
    hasProfiles: boolean;
    /** 大会名（2026-11-02 追加。未設定なら空文字。Admin 左上に表示） */
    tournamentName: string;
};

const RoundProgressContext = createContext<RoundProgress | null>(null);

export const RoundProgressProvider = RoundProgressContext.Provider;

/** 各ラウンドの Admin から使う。読み込み前は null */
export function useRoundProgress(): RoundProgress | null {
    return useContext(RoundProgressContext);
}

type CourseRow = Pick<ThirdRoundCourse, 'name' | 'playOrder'>;

/** admin/page.tsx で1回だけ使う。読み込みと Socket の追従 */
export function useRoundProgressSource(socket: Socket | null): RoundProgress | null {
    const [players, setPlayers] = useState<Player[] | null>(null);
    const [courses, setCourses] = useState<CourseRow[] | null>(null);
    const [noRevival, setNoRevival] = useState(false);
    const [tournamentName, setTournamentName] = useState('');

    useEffect(() => {
        if (!socket) return;
        let alive = true;

        // 大会の状態は中身を配信せず「変わった」合図だけ来るので、そのたびに読み直す
        const loadTournamentState = async () => {
            try {
                const res = await fetch('/api/tournamentState');
                const data = await res.json();
                if (alive && data.success) {
                    setNoRevival(!!data.state.extraRoundNoRevival);
                    setTournamentName(typeof data.state.tournamentName === 'string' ? data.state.tournamentName : '');
                }
            } catch (error) {
                console.error('Tournament state load failed', error);
            }
        };

        // 最初の読み込み（選手・コース・大会の状態）
        (async () => {
            try {
                const [pRes, cRes] = await Promise.all([fetch('/api/secondRound/loadPlayers'), fetch('/api/thirdRound/courses')]);
                const [pData, cData] = await Promise.all([pRes.json(), cRes.json()]);
                if (!alive) return;
                if (pData.success) setPlayers(pData.allPlayers);
                if (cData.success) setCourses(cData.courses);
            } catch (error) {
                console.error('Round progress load failed', error);
            }
        })();
        loadTournamentState();

        const onPlayers = (next: Player[]) => setPlayers(next);
        const onCourses = (next: CourseRow[]) => setCourses(next);
        socket.on('update_players', onPlayers);
        socket.on('update_third_round_courses', onCourses);
        socket.on('update_tournament_state', loadTournamentState);
        return () => {
            alive = false;
            socket.off('update_players', onPlayers);
            socket.off('update_third_round_courses', onCourses);
            socket.off('update_tournament_state', loadTournamentState);
        };
    }, [socket]);

    return useMemo(() => {
        if (!players || !courses) return null;
        return {
            statuses: getRoundStatuses({ players, courses, extraRoundNoRevival: noRevival }),
            players,
            extraRoundNoRevival: noRevival,
            hasProfiles: players.some(p => p.nickname !== ''),
            tournamentName,
        };
    }, [players, courses, noRevival, tournamentName]);
}

/** リセットの連鎖で戻す最初のラウンド（server/roundOrder.js と同じ値。'all' は選手 CSV の取り込み） */
export type ResetProgressFrom = 'all' | 'secondRound' | 'thirdRound' | 'extraRound' | 'semifinal' | 'final';

/**
 * DB のリセット（連鎖つき）に成功した後の配信をまとめて行う。
 * 選手・コースを全員に配り、サーバのメモリの進行状態を from 以降戻し、大会の状態を読み直させる。
 */
export function broadcastAfterReset(
    socket: Socket | null,
    from: ResetProgressFrom,
    data: { allPlayers?: Player[]; courses?: CourseRow[] }
) {
    if (!socket) return;
    if (data.allPlayers) socket.emit('broadcast_scores', data.allPlayers);
    if (data.courses) socket.emit('broadcast_third_round_courses', data.courses);
    socket.emit('reset_round_progress', { from });
    socket.emit('tournament_state_changed');
}

/**
 * 提案A: ラウンドが完了したら、大ボタンを「次のラウンド名 へ ▶」にする。
 * 完了していなければ押せないボタン（ラベルに未完了の理由）を返す。
 * before: 移る前に送るもの（Final へ移る前に決勝を待機画面にする、など）
 */
export function nextRoundPrimary(
    socket: Socket | null,
    progress: RoundProgress | null,
    round: RoundKey,
    before?: () => void
): { label: string; action: (() => void) | null } {
    const next = nextRound(round);
    if (!next) return { label: `${ROUND_LABEL[round]} 終了`, action: null };
    if (!progress) return { label: '読み込み中...', action: null };
    const status = progress.statuses[round];
    if (!status.complete) return { label: `${ROUND_LABEL[round]} 未完了（${status.detail}）`, action: null };
    return {
        label: `${ROUND_LABEL[next]} へ ▶`,
        action: () => {
            if (!socket) return;
            before?.();
            socket.emit('change_mode', ROUND_MODE[next]);
        },
    };
}

/**
 * 提案B: 後のラウンドが始まっていたら、Undo を止めて警告を出す。止めたら true
 * （API 側でも止めるが、押した時点で分かるように画面でも確かめる）
 */
export function blockUndoIfLaterStarted(progress: RoundProgress | null, round: RoundKey): boolean {
    if (!progress) return false;
    const later = laterRoundStarted(progress.statuses, round);
    if (!later) return false;
    window.alert(undoBlockedMessage(round, later));
    return true;
}

/** リセットの確認文に足す、後のラウンドへの影響（lib/roundProgress.ts の resetCascadeNotice） */
export function cascadeNotice(progress: RoundProgress | null, from: RoundKey, clearProfiles: boolean): string {
    if (!progress) return '';
    return resetCascadeNotice(progress.statuses, from, { clearProfiles, hasProfiles: progress.hasProfiles });
}
