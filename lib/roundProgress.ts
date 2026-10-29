// 大会は 1st Round → 2nd Round → 3rd Round → Extra Round → Semi-Final → Final の順に
// 不可逆に進む（2026-10-22 追加。docs/linear-progress-design.md）。
// 各ラウンドが「始まっているか」「完了したか（次のラウンドに進めるか）」を選手データから判定する純関数。
// Admin のサイドバー・各ラウンドの「○○へ ▶」ボタン・Undo の制限（画面）と、API の順番チェックの両方で使う。

import type { Player, ThirdRoundCourse } from './types';
import { SECOND_ROUND_GROUP_COUNT, SECOND_ROUND_WINNERS_PER_GROUP } from './secondRound';
import { THIRD_ROUND_COURSE_NAMES, WINNERS_PER_COURSE } from './thirdRoundCourses';

export type RoundKey = 'firstRound' | 'secondRound' | 'thirdRound' | 'extraRound' | 'semifinal' | 'final';

/** 実施順 */
export const ROUND_ORDER: RoundKey[] = ['firstRound', 'secondRound', 'thirdRound', 'extraRound', 'semifinal', 'final'];

/** 画面に出す名前 */
export const ROUND_LABEL: Record<RoundKey, string> = {
    firstRound: '1st Round', secondRound: '2nd Round', thirdRound: '3rd Round',
    extraRound: 'Extra Round', semifinal: 'Semi-Final', final: 'Final',
};

/** 表示モード（server/ModeHandler.js の mode）との対応 */
export const ROUND_MODE: Record<RoundKey, string> = {
    firstRound: '1stRound', secondRound: 'secondRound', thirdRound: 'thirdRound',
    extraRound: 'extraRound', semifinal: 'semifinal', final: 'final',
};

/** 表示モードからラウンドを引く（待機画面は null。1st Round の結果取込は 1st Round として扱う） */
export function roundOfMode(mode: string): RoundKey | null {
    if (mode === '1stRoundResult') return 'firstRound';
    return ROUND_ORDER.find(r => ROUND_MODE[r] === mode) ?? null;
}

const SECOND_ROUND_WINNERS = SECOND_ROUND_GROUP_COUNT * SECOND_ROUND_WINNERS_PER_GROUP;   // 20
const THIRD_ROUND_WINNERS = THIRD_ROUND_COURSE_NAMES.length * WINNERS_PER_COURSE;          // 8
const SEMIFINAL_WINNERS = 3;

export type ProgressInput = {
    players: Player[];
    courses: Pick<ThirdRoundCourse, 'name' | 'playOrder'>[];
    /** Extra Round で「敗者復活者なし」を確定したか（DB の TournamentState） */
    extraRoundNoRevival: boolean;
};

export type RoundStatus = {
    round: RoundKey;
    /** 結果が1つでも入っているか */
    started: boolean;
    /** 勝ち抜け者がすべて決まり、次のラウンドに進めるか */
    complete: boolean;
    /** 状況の短い説明（サイドバーなどに出す） */
    detail: string;
};

/** 全ラウンドの状況 */
export function getRoundStatuses({ players, courses, extraRoundNoRevival }: ProgressInput): Record<RoundKey, RoundStatus> {
    const count = (f: (p: Player) => boolean) => players.filter(f).length;

    const secondWinners = count(p => p.secondRoundRank > 0);
    const thirdWinners = count(p => p.thirdRoundRank > 0);
    const revived = players.find(p => p.extraRoundRank === 1) ?? null;
    const sfWinners = count(p => p.semifinalRank > 0);
    const champion = players.find(p => p.finalRank === 1) ?? null;

    return {
        firstRound: {
            round: 'firstRound', started: players.length > 0, complete: players.length > 0,
            detail: players.length > 0 ? `${players.length}名登録` : '選手が未登録',
        },
        secondRound: {
            round: 'secondRound',
            started: players.some(p => p.secondRoundRank !== 0 || p.secondRoundWrongCount > 0),
            complete: secondWinners >= SECOND_ROUND_WINNERS,
            detail: `勝ち抜け ${secondWinners} / ${SECOND_ROUND_WINNERS}名`,
        },
        thirdRound: {
            round: 'thirdRound',
            started: courses.some(c => c.playOrder !== null) || players.some(p => p.thirdRoundCourseName !== null || p.thirdRoundRank !== 0),
            complete: thirdWinners >= THIRD_ROUND_WINNERS,
            detail: `勝ち抜け ${thirdWinners} / ${THIRD_ROUND_WINNERS}名`,
        },
        extraRound: {
            round: 'extraRound',
            started: extraRoundNoRevival || players.some(p => p.extraRoundSecondStep || p.extraRoundRank !== 0 || p.extraRoundCorrectCount > 0),
            complete: revived !== null || extraRoundNoRevival,
            detail: revived ? `敗者復活: ${revived.name}` : extraRoundNoRevival ? '敗者復活者なし' : '敗者復活者 未決定',
        },
        semifinal: {
            round: 'semifinal',
            started: players.some(p => p.semifinalRank !== 0 || p.semifinalPoint !== 0),
            complete: sfWinners >= SEMIFINAL_WINNERS,
            detail: `勝ち抜け ${sfWinners} / ${SEMIFINAL_WINNERS}名`,
        },
        final: {
            round: 'final',
            started: players.some(p => p.finalCorrectCount > 0 || p.finalWrongCount > 0 || p.finalSetsWon > 0 || p.finalRank !== 0),
            complete: champion !== null,
            detail: champion ? `優勝: ${champion.name}` : '優勝者 未決定',
        },
    };
}

/** 1つ前のラウンド（1st Round は null） */
export function previousRound(round: RoundKey): RoundKey | null {
    const i = ROUND_ORDER.indexOf(round);
    return i > 0 ? ROUND_ORDER[i - 1] : null;
}

/** 1つ後のラウンド（Final は null） */
export function nextRound(round: RoundKey): RoundKey | null {
    const i = ROUND_ORDER.indexOf(round);
    return i >= 0 && i < ROUND_ORDER.length - 1 ? ROUND_ORDER[i + 1] : null;
}

/** そのラウンドに進めるか（1つ前のラウンドが完了しているか）。進めないときは理由を返す */
export function canEnterRound(statuses: Record<RoundKey, RoundStatus>, round: RoundKey): { ok: true } | { ok: false; reason: string } {
    const prev = previousRound(round);
    if (!prev || statuses[prev].complete) return { ok: true };
    return { ok: false, reason: `${ROUND_LABEL[prev]} が未完了（${statuses[prev].detail}）` };
}

/** そのラウンドより後のラウンドが1つでも始まっているか。始まっていれば最初に見つかったラウンドを返す */
export function laterRoundStarted(statuses: Record<RoundKey, RoundStatus>, round: RoundKey): RoundKey | null {
    return ROUND_ORDER.slice(ROUND_ORDER.indexOf(round) + 1).find(r => statuses[r].started) ?? null;
}

/** DB の結果から見た「いま進めるべきラウンド」（始まっている最後のラウンド。完了していれば次のラウンド） */
export function currentRoundFromData(statuses: Record<RoundKey, RoundStatus>): RoundKey | null {
    const started = ROUND_ORDER.filter(r => statuses[r].started);
    if (started.length === 0) return null;
    const last = started[started.length - 1];
    return statuses[last].complete ? (nextRound(last) ?? last) : last;
}

/** Undo を止めるときの警告文（提案B。後のラウンドが始まっているとき） */
export function undoBlockedMessage(round: RoundKey, later: RoundKey): string {
    return `${ROUND_LABEL[later]} が始まっているため、${ROUND_LABEL[round]} の Undo はできません。\n`
        + `${ROUND_LABEL[round]} の結果を直すときはリセットを使ってください（${ROUND_LABEL[later]} 以降の結果も一緒にリセットされます）。`;
}

/**
 * リセットの確認文に足す「後のラウンドへの影響」（2.4。後のラウンドに結果があるときだけ）。
 * from: 連鎖で初期化される最初のラウンド（例: 2nd Round の組のリセットなら thirdRound）
 * clearProfiles: Semi-Final 進出者が決まる前のフェーズのリセットか（二つ名と写真も消える）
 * hasProfiles: 二つ名か写真が登録されているか
 */
export function resetCascadeNotice(
    statuses: Record<RoundKey, RoundStatus>,
    from: RoundKey,
    { clearProfiles, hasProfiles }: { clearProfiles: boolean; hasProfiles: boolean }
): string {
    const started = ROUND_ORDER.slice(ROUND_ORDER.indexOf(from)).filter(r => statuses[r].started);
    const lines: string[] = [];
    if (started.length > 0) {
        lines.push(`${ROUND_LABEL[from]} 以降の結果もすべてリセットされます（結果あり: ${started.map(r => ROUND_LABEL[r]).join('・')}）。`);
    }
    if (clearProfiles && hasProfiles) lines.push('Semi-Final 出場者の二つ名と写真も削除されます。');
    return lines.length > 0 ? `\n\n${lines.join('\n')}` : '';
}
