/**
 * 準決勝（Nine Hundred）の採点ロジック
 *
 * タイムレース形式のため、1問ごとの正誤は記録しない。セット終了後、スタッフが手動で
 * 集計した「各選手のそのセットの得点」を入力し、累計 semifinalPoint に加算する
 * （2026-10-10 ユーザー決定。設計メモ 6.1）。DB の読み書きは app/api 側の仕事で、
 * ここには持ち込まない（3rd Round と同じ形）。
 *
 * ## 判定は2段階（勝ち抜け → 失格の順）
 *
 * 1. 勝ち抜け: 対象（semifinalRank === 0）のうち最高得点の1名。最高得点が同点なら
 *    その同点者でプレーオフ（1名を決める）。
 * 2. 失格: 勝ち抜けを除いた対象の下位2名。境界（安全圏の最後と失格圏の最初）が同点なら、
 *    境界の点数に並ぶ全員でプレーオフ（残りの失格枠の人数を決める）。境界より下の選手は
 *    プレーオフをせずに失格。対象が2名以下なら全員失格（第3セットは常にこれ）。
 *
 * どちらも「判定結果を出す関数」（get…Judgement）と「確定させる関数」（apply…）に分ける。
 * Admin は前者で次の操作（そのまま確定 / プレーオフ）を決め、API は後者の前に
 * 同じ前者で入力（プレーオフの勝者・敗者）を検証する。
 *
 * ## プレーオフはポイントを変えない（設計メモ 1章）
 *
 * プレーオフの進行（誰が正解・誤答したか）は lib/semifinalPlayoff.ts が扱い、
 * DB には最終的な勝ち抜け・失格だけを書く。
 */

import type { Player } from './types';

/** 1セットで勝ち抜ける人数 */
export const SEMIFINAL_ADVANCE_COUNT = 1;
/** 1セットで失格する人数 */
export const SEMIFINAL_ELIMINATE_COUNT = 2;
/** 1セットの得点として入力できる絶対値の上限（桁の打ち間違いを止めるため） */
export const SEMIFINAL_SET_POINT_LIMIT = 999;

/** まだ決着していない（semifinalRank === 0）選手を、ポイント降順で並べる */
export function getActiveSortedByPoint(players: Player[]): Player[] {
    return players
        .filter(p => p.semifinalRank === 0)
        .sort((a, b) => b.semifinalPoint - a.semifinalPoint || a.id - b.id);
}

export type SemifinalPointEntry = {
    playerId: number;
    /** そのセットの得点（増減）。累計 semifinalPoint に加算する */
    delta: number;
};

/**
 * セットの得点入力が正しいかを調べる。問題なければ null、あればエラー文。
 * 対象（semifinalRank === 0）の全員ぶんが1件ずつ、整数で入っていることを求める
 * （入力漏れ・二重入力・決着済みの選手への入力を止める）。
 */
export function validateSetPointEntries(players: Player[], entries: unknown): string | null {
    if (!Array.isArray(entries)) return '得点の形式が不正です';
    const activeIds = new Set(players.filter(p => p.semifinalRank === 0).map(p => p.id));
    const seen = new Set<number>();
    for (const e of entries) {
        if (!e || typeof e !== 'object') return '得点の形式が不正です';
        const { playerId, delta } = e as Record<string, unknown>;
        if (typeof playerId !== 'number' || !activeIds.has(playerId)) return '対象外の選手が含まれています';
        if (seen.has(playerId)) return '同じ選手が重複しています';
        if (typeof delta !== 'number' || !Number.isInteger(delta) || Math.abs(delta) > SEMIFINAL_SET_POINT_LIMIT) {
            return '得点は整数で入力してください';
        }
        seen.add(playerId);
    }
    if (seen.size !== activeIds.size) return '全員の得点を入力してください';
    return null;
}

/** セットの得点を累計に加算する。引数の players は書き換えない */
export function applySemifinalSetPoints(players: Player[], entries: SemifinalPointEntry[]): Player[] {
    const deltaByPlayerId = new Map(entries.map(e => [e.playerId, e.delta]));
    return players.map(p => {
        const delta = deltaByPlayerId.get(p.id);
        if (delta === undefined || p.semifinalRank !== 0) return p;
        return { ...p, semifinalPoint: p.semifinalPoint + delta };
    });
}

/**
 * いまのセットがどこまで進んだか（DB の値だけから導く）。
 *
 *   beforeJudge … 判定前（得点入力・点数発表はこの段階でだけ行う）
 *   advanced    … 勝ち抜けは確定、失格はまだ
 *   complete    … このセットの判定が終わった
 *   mismatch    … 指定したセットと DB が噛み合わない（画面が古い、セットの指定違いなど）
 */
export type SemifinalSetStage = 'beforeJudge' | 'advanced' | 'complete' | 'mismatch';

export function getSemifinalSetStage(players: Player[], set: number): SemifinalSetStage {
    if (!Number.isInteger(set) || set < 1 || set > 3) return 'mismatch';
    const advancedEarlier = players.filter(p => p.semifinalRank > 0 && p.semifinalRank < set).length;
    const advancedLater = players.some(p => p.semifinalRank > set);
    const advancedNow = players.some(p => p.semifinalRank === set);
    const eliminated = players.filter(p => p.semifinalRank === -1).length;
    const active = players.filter(p => p.semifinalRank === 0).length;
    const eliminatedBefore = SEMIFINAL_ELIMINATE_COUNT * (set - 1);

    if (advancedLater || advancedEarlier !== set - 1) return 'mismatch';
    if (!advancedNow) return eliminated === eliminatedBefore ? 'beforeJudge' : 'mismatch';
    if (eliminated === eliminatedBefore && active > 0) return 'advanced';
    if (eliminated > eliminatedBefore) return 'complete';
    return active === 0 ? 'complete' : 'mismatch';
}

/**
 * DB の状態から「いま進めるべきセット」を求める。判定前・途中のセットがあればそれ、
 * 全セット終わっていれば 3。どのセットとも噛み合わなければ null。
 * サーバ再起動で進行状態（セット番号）が 1 に戻ったときに、Admin が正しいセットを示すのに使う。
 */
export function findSemifinalCurrentSet(players: Player[]): number | null {
    for (let set = 1; set <= 3; set++) {
        const stage = getSemifinalSetStage(players, set);
        if (stage === 'beforeJudge' || stage === 'advanced') return set;
        if (stage === 'complete' && set === 3) return 3;
    }
    return null;
}

/** 判定の結果。そのまま確定できるか、プレーオフが要るか */
export type SemifinalJudgement =
    | { kind: 'decided'; playerIds: number[] }
    | {
        kind: 'playoff';
        /** プレーオフに参加する同点者 */
        candidateIds: number[];
        /** プレーオフで決める人数（勝ち抜けなら1、失格なら残りの失格枠） */
        slots: number;
        /** プレーオフをせずに確定する選手（失格判定で、境界より下の選手） */
        fixedIds: number[];
    };

/** 勝ち抜けの判定。対象がいなければ null */
export function getAdvanceJudgement(players: Player[]): SemifinalJudgement | null {
    const active = getActiveSortedByPoint(players);
    if (active.length === 0) return null;
    const top = active[0].semifinalPoint;
    const tied = active.filter(p => p.semifinalPoint === top);
    if (tied.length <= SEMIFINAL_ADVANCE_COUNT) return { kind: 'decided', playerIds: [active[0].id] };
    return { kind: 'playoff', candidateIds: tied.map(p => p.id), slots: SEMIFINAL_ADVANCE_COUNT, fixedIds: [] };
}

/** 失格の判定（勝ち抜け確定後に呼ぶ）。対象がいなければ null */
export function getEliminationJudgement(players: Player[]): SemifinalJudgement | null {
    const active = getActiveSortedByPoint(players);
    if (active.length === 0) return null;
    if (active.length <= SEMIFINAL_ELIMINATE_COUNT) return { kind: 'decided', playerIds: active.map(p => p.id) };

    const safeCount = active.length - SEMIFINAL_ELIMINATE_COUNT;
    const boundary = active[safeCount - 1].semifinalPoint;
    if (active[safeCount].semifinalPoint !== boundary) {
        return { kind: 'decided', playerIds: active.slice(safeCount).map(p => p.id) };
    }
    const candidateIds = active.filter(p => p.semifinalPoint === boundary).map(p => p.id);
    const fixedIds = active.filter(p => p.semifinalPoint < boundary).map(p => p.id);
    return { kind: 'playoff', candidateIds, slots: SEMIFINAL_ELIMINATE_COUNT - fixedIds.length, fixedIds };
}

/**
 * 判定に従って確定する選手を決める。プレーオフが要る判定では、プレーオフの結果
 * （chosenIds: 勝ち抜けなら勝者1名、失格なら失格者）を検証してから足し合わせる。
 * 入力が判定と合わなければエラー文を返す。
 */
export function resolveJudgement(
    judgement: SemifinalJudgement,
    chosenIds: unknown
): { ok: true; playerIds: number[] } | { ok: false; error: string } {
    if (judgement.kind === 'decided') {
        if (chosenIds !== undefined && chosenIds !== null) {
            const same = Array.isArray(chosenIds)
                && chosenIds.length === judgement.playerIds.length
                && judgement.playerIds.every(id => chosenIds.includes(id));
            if (!same) return { ok: false, error: '判定結果が一致しません。画面を再読み込みしてください' };
        }
        return { ok: true, playerIds: judgement.playerIds };
    }
    if (!Array.isArray(chosenIds) || chosenIds.length !== judgement.slots) {
        return { ok: false, error: 'プレーオフの結果が不正です' };
    }
    const unique = new Set(chosenIds);
    const valid = unique.size === chosenIds.length
        && chosenIds.every(id => typeof id === 'number' && judgement.candidateIds.includes(id));
    if (!valid) return { ok: false, error: 'プレーオフの結果が不正です' };
    return { ok: true, playerIds: [...judgement.fixedIds, ...(chosenIds as number[])] };
}

/** 勝ち抜けを確定する（semifinalRank = 勝ち抜けたセット番号） */
export function applyAdvance(players: Player[], set: number, winnerIds: number[]): Player[] {
    const ids = new Set(winnerIds);
    return players.map(p => (ids.has(p.id) && p.semifinalRank === 0 ? { ...p, semifinalRank: set } : p));
}

/** 失格を確定する（semifinalRank = -1、semifinalLostSet = 敗退したセット番号） */
export function applyElimination(players: Player[], set: number, loserIds: number[]): Player[] {
    const ids = new Set(loserIds);
    return players.map(p => (ids.has(p.id) && p.semifinalRank === 0 ? { ...p, semifinalRank: -1, semifinalLostSet: set } : p));
}

/**
 * 前のセットまでに決着した（勝ち抜け・敗退した）選手か（2026-11-11 ユーザー承認）。
 * Main ではこの選手を、そのセットの画面から消す（場所は空けたまま）。
 * 敗退したセットが記録されていない（semifinalLostSet = 0。列を足す前の敗退）ときは決着前として扱い、従来どおり出す
 */
export function isDecidedBeforeSet(p: Pick<Player, 'semifinalRank' | 'semifinalLostSet'>, set: number): boolean {
    if (p.semifinalRank > 0) return p.semifinalRank < set;
    if (p.semifinalRank !== -1) return false;
    const lostSet = p.semifinalLostSet ?? 0;
    return lostSet > 0 && lostSet < set;
}

const STALE_PLAYOFF_MESSAGE = 'プレーオフの結果が判定と一致しません。画面を再読み込みしてください';

/** 判定で行う1回ぶんの確定（API の judgeAdvance / judgeEliminate 1回に当たる） */
export type SemifinalJudgeStep = {
    action: 'judgeAdvance' | 'judgeEliminate';
    /** API に送る chosenIds（そのまま確定ならその選手、プレーオフ後なら勝者・失格者） */
    chosenIds: number[];
    /** 実際に確定する選手（失格では、プレーオフをせずに失格になる選手を含む） */
    playerIds: number[];
};

export type SemifinalJudgePlan = {
    steps: SemifinalJudgeStep[];
    /** 続けてプレーオフが必要なら、その内容 */
    playoff: { purpose: 'advance' | 'eliminate'; candidateIds: number[]; slots: number } | null;
    error: string | null;
};

/**
 * 「判定」ボタン1回で確定できるところまでの手順を組み立てる（Admin 用）。
 *
 * 勝ち抜け → 失格の順に、同点がなければそのまま確定し、同点ならそこで止めて
 * プレーオフを返す。playoffResult を渡すと、その目的の判定はプレーオフの結果で確定する
 * （プレーオフ後の「結果を確定」で使う）。各手順は API 側でも同じ関数で検証される。
 */
export function planSemifinalJudgement(
    players: Player[],
    set: number,
    playoffResult?: { purpose: 'advance' | 'eliminate'; chosenIds: number[] }
): SemifinalJudgePlan {
    const steps: SemifinalJudgeStep[] = [];
    let current = players;
    let resultUsed = false;

    for (;;) {
        const stage = getSemifinalSetStage(current, set);
        if (stage !== 'beforeJudge' && stage !== 'advanced') break;
        const purpose = stage === 'beforeJudge' ? 'advance' : 'eliminate';
        const judgement = purpose === 'advance' ? getAdvanceJudgement(current) : getEliminationJudgement(current);
        if (!judgement) break;

        let chosenIds: number[];
        if (judgement.kind === 'decided') {
            chosenIds = judgement.playerIds;
        } else if (playoffResult && !resultUsed && playoffResult.purpose === purpose) {
            chosenIds = playoffResult.chosenIds;
            resultUsed = true;
        } else if (playoffResult && !resultUsed) {
            // 渡されたプレーオフの結果が、いま必要な判定と合わない（古い画面など）
            return { steps: [], playoff: null, error: STALE_PLAYOFF_MESSAGE };
        } else {
            return { steps, playoff: { purpose, candidateIds: judgement.candidateIds, slots: judgement.slots }, error: null };
        }

        const resolved = resolveJudgement(judgement, chosenIds);
        if (!resolved.ok) return { steps, playoff: null, error: resolved.error };
        steps.push({ action: purpose === 'advance' ? 'judgeAdvance' : 'judgeEliminate', chosenIds, playerIds: resolved.playerIds });
        current = purpose === 'advance'
            ? applyAdvance(current, set, resolved.playerIds)
            : applyElimination(current, set, resolved.playerIds);
    }
    if (playoffResult && !resultUsed) {
        return { steps: [], playoff: null, error: STALE_PLAYOFF_MESSAGE };
    }
    return { steps, playoff: null, error: null };
}
