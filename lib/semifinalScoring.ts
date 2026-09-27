/**
 * 準決勝（Nine Hundred）の採点ロジック
 *
 * タイムレース形式のため、セット中は1問ごとの正解・誤答をリアルタイムでは
 * 記録しない。セット終了後、まとめて集計した得点変動（1セットぶんの増減）を
 * 選手ごとに入力する（applySemifinalSetPoints）。この lib が扱うのはそれに加え、
 * 「セット終了時に勝ち抜け1名・失格2名をどう確定するか」と「境界の同点を
 * プレーオフでどう決めるか」。DB の読み書きは app/api 側の仕事で、ここには
 * 持ち込まない（3rd Round と同じ形）。
 *
 * ## セット終了時の確定は2段階（勝ち抜け→失格の順）
 *
 * 1. 対象（semifinalRank === 0）をポイント降順に並べ、1位が同点でなければ
 *    その1名を勝ち抜け（semifinalRank = 何セット目に勝ち抜けたか）にする。
 *    同点ならこの関数は何もしない。呼び出し側が同点者だけのプレーオフに
 *    進める（phase: 'playoff'）。
 * 2. 勝ち抜けが確定した後、残り（semifinalRank === 0 で再フィルタするだけで
 *    勝ち抜け者は自然に除外される）をポイント降順に並べ、下位2名の境界に
 *    同点がなければ確定失格。同点ならこの関数も何もしない。
 *
 * ## 「残り2名なら自動失格」は特別扱いしない
 *
 * 第3セット終了時は、勝ち抜け1名を除くと残りがちょうど2名（＝失格枠と同数）になる。
 * このとき比較すべき「安全圏の最後の1名」が存在しないため、境界同点の判定自体が
 * 発生せず、残った2名がそのまま失格になる。これは3rd Round の「残り人数＝残り枠」
 * のような自動ショートカットを別途実装したものではなく、同じ境界判定の式が
 * 安全枠0という入力を受けたときに導く自然な結果。したがってこの状況は算数上
 * 第3セット終了時にしか起こらず、他のセットで誤って自動発火することもない。
 *
 * ## プレーオフはポイントを変えない（設計メモ 1章）
 *
 * プレーオフの正解・誤答は勝ち抜け/失格の決定にのみ使い、それまでのポイントには
 * 影響しない。境界が2箇所あるぶん、3rd Round の early-buzzer プレーオフ
 * （正解=勝ち抜け／誤答=失格）とは意味が逆になる場面がある（下記 purpose 参照）。
 */

import type { Player } from './types';

/** プレーオフで押すボタン */
export type SemifinalAction = 'correct' | 'wrong';

/** 1セットで勝ち抜ける人数（常に1名） */
const ADVANCE_COUNT = 1;
/** 1セットで失格する人数（常に2名） */
const ELIMINATE_COUNT = 2;

/**
 * まだ決着していない（semifinalRank === 0）対象を、ポイント降順で並べる。
 * 勝ち抜け・失格が決まった選手は rank が 0 でなくなるため、このフィルタだけで
 * 「今どのセットのどの段階を争っているか」に応じた対象が自然に絞り込める。
 */
function getActiveSortedByPoint(players: Player[]): Player[] {
    return players
        .filter(p => p.semifinalRank === 0)
        .sort((a, b) => b.semifinalPoint - a.semifinalPoint);
}

export type SemifinalPointEntry = {
    playerId: number;
    /** そのセットぶんの得点変動（増減）。累計 semifinalPoint に加算する */
    delta: number;
};

/**
 * セット終了後にまとめて入力した得点変動を、対象選手の累計ポイントへ加算する。
 * 引数の players は書き換えない。
 *
 * entries に含まれない選手（そのセットの対象外）や、すでに勝ち抜け／失格が
 * 確定した選手（semifinalRank !== 0）は変更しない。値の正しさ（何点が妥当か）は
 * 判定しない。入力されたとおりに加算するだけで、集計はスタッフの目視に委ねる
 * （このコースは1問ごとの記録を持たないため、システム側で検算できない）。
 */
export function applySemifinalSetPoints(players: Player[], entries: SemifinalPointEntry[]): Player[] {
    const deltaByPlayerId = new Map(entries.map(e => [e.playerId, e.delta]));

    return players.map(p => {
        const delta = deltaByPlayerId.get(p.id);
        if (delta === undefined) return p;
        if (p.semifinalRank !== 0) return p;

        return { ...p, semifinalPoint: p.semifinalPoint + delta };
    });
}

/**
 * 勝ち抜け境界（1位）に同点があれば、その同点者全員を返す。同点がなければ空配列。
 * Admin がプレーオフに進めるべきか、対象は誰かを判断するための読み取り専用関数。
 */
export function getAdvanceTieGroup(players: Player[]): Player[] {
    const active = getActiveSortedByPoint(players);
    if (active.length < ADVANCE_COUNT + 1) return [];

    const topPoint = active[0].semifinalPoint;
    if (active[1].semifinalPoint !== topPoint) return [];

    return active.filter(p => p.semifinalPoint === topPoint);
}

/**
 * 失格境界（下位2名とその上）に同点があれば、その同点者全員を返す。同点がなければ空配列。
 *
 * 勝ち抜けが確定済みであること（対象を rank === 0 で絞る時点で自然に満たされる）が前提。
 * 対象が ELIMINATE_COUNT 以下（＝第3セット終了時）は比較対象の「安全圏最後の1名」が
 * 存在しないため、判定不要（＝同点扱いにしない。finalizeSetElimination が直接処理する）。
 */
export function getEliminateTieGroup(players: Player[]): Player[] {
    const active = getActiveSortedByPoint(players);
    if (active.length <= ELIMINATE_COUNT) return [];

    const safeCount = active.length - ELIMINATE_COUNT;
    const boundaryPoint = active[safeCount - 1].semifinalPoint;
    if (active[safeCount].semifinalPoint !== boundaryPoint) return [];

    return active.filter(p => p.semifinalPoint === boundaryPoint);
}

/**
 * 勝ち抜け1名を確定する。1位が同点なら何もしない（呼び出し側が getAdvanceTieGroup で
 * 検出し、プレーオフに進める）。引数の players は書き換えない。
 */
export function finalizeSetAdvance(players: Player[], set: number): Player[] {
    const active = getActiveSortedByPoint(players);
    if (active.length === 0) return players;
    if (getAdvanceTieGroup(players).length > 0) return players;

    const winnerId = active[0].id;
    return players.map(p => (p.id === winnerId ? { ...p, semifinalRank: set } : p));
}

/**
 * 失格2名を確定する。境界が同点なら何もしない（呼び出し側が getEliminateTieGroup で
 * 検出し、プレーオフに進める）。勝ち抜けが確定済みであることが前提
 * （finalizeSetAdvance の後に呼ぶ）。引数の players は書き換えない。
 */
export function finalizeSetElimination(players: Player[]): Player[] {
    const active = getActiveSortedByPoint(players);
    if (active.length === 0) return players;

    // 安全圏なし（第3セット終了時）。比較対象がないので残り全員がそのまま失格になる。
    // 特別扱いの分岐ではなく、下の一般処理が safeCount <= 0 を受けたときに導く結果と同じ。
    if (active.length <= ELIMINATE_COUNT) {
        const eliminatedIds = new Set(active.map(p => p.id));
        return players.map(p => (eliminatedIds.has(p.id) ? { ...p, semifinalRank: -1 } : p));
    }

    if (getEliminateTieGroup(players).length > 0) return players;

    const safeCount = active.length - ELIMINATE_COUNT;
    const eliminatedIds = new Set(active.slice(safeCount).map(p => p.id));
    return players.map(p => (eliminatedIds.has(p.id) ? { ...p, semifinalRank: -1 } : p));
}

/** プレーオフがどちらの境界を決めるためのものか */
export type SemifinalPlayoffPurpose = 'advance' | 'eliminate';

export type SemifinalPlayoffInput = {
    players: Player[];
    playerId: number;
    /** 現在のセット 1〜3。advance 側の勝ち抜けセット番号として使う */
    set: number;
    purpose: SemifinalPlayoffPurpose;
    action: SemifinalAction;
};

/**
 * プレーオフの1問ぶんの正解・誤答を適用する。ポイントは変えない（設計メモ 1章）。
 *
 * purpose によって正解・誤答の意味が逆になる。
 *   advance   … 正解した1名が勝ち抜け。誤答はこのプレーオフから外れるだけで、
 *               まだ1位タイの実力者なので失格にはしない（rank は 0 のまま）。
 *   eliminate … 誤答した人が失格。正解はこのプレーオフから外れて残留するだけで、
 *               まだ勝ち抜けが決まったわけではない（rank は 0 のまま）。
 *
 * どちらの場合も「対象から外れるだけ」のケースは rank を変更しない＝players をそのまま
 * 返す形になる。同点者が3名以上いても、この関数は1名ぶんの結果を反映するだけで、
 * 「プレーオフを終えて次に進んでよいか」は Admin が見て判断する（3rd Round と同じ）。
 */
export function applySemifinalPlayoffScore({ players, playerId, set, purpose, action }: SemifinalPlayoffInput): Player[] {
    return players.map(p => {
        if (p.id !== playerId) return p;
        if (p.semifinalRank !== 0) return p;

        if (purpose === 'advance') {
            return action === 'correct' ? { ...p, semifinalRank: set } : p;
        }
        return action === 'wrong' ? { ...p, semifinalRank: -1 } : p;
    });
}
