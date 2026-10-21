/**
 * 準決勝のプレーオフ（境界の同点を早押しで決める）の進行
 *
 * ルール: 該当者のみで、1問正解で勝利・1問誤答で敗退。ポイントには影響しない。
 *
 *   advance（勝ち抜けを1名決める）
 *     正解 → その選手が勝ち抜け（終了）
 *     誤答 → その選手は敗退（プレーオフから外れる）。残りが1名になったらその選手が勝ち抜け
 *   eliminate（失格枠 slots 名を決める）
 *     誤答 → その選手は失格
 *     正解 → その選手は残留（プレーオフから外れる）
 *     失格が slots 名に達したら残り全員が残留、残りの人数が残りの失格枠と同じになったら
 *     残り全員が失格（どちらも終了）
 *
 * 進行状態は「押された操作の列」（actions）だけを持ち、結果は毎回ここで計算する。
 * 終了後の操作・すでに外れた選手への操作は無視するので、二重送信があっても結果は変わらない。
 * Undo は actions の末尾を取り除くだけで済む。
 */

export type SemifinalPlayoffPurpose = 'advance' | 'eliminate';
export type SemifinalPlayoffMark = 'correct' | 'wrong';

export type SemifinalPlayoffAction = { playerId: number; action: SemifinalPlayoffMark };

export type SemifinalPlayoff = {
    purpose: SemifinalPlayoffPurpose;
    /** どのセットのプレーオフか */
    set: number;
    candidateIds: number[];
    /** 決める人数。advance は 1（勝ち抜け）、eliminate は失格にする人数 */
    slots: number;
    actions: SemifinalPlayoffAction[];
};

/** 選手ごとの結果。win = 勝ち抜け（advance）／残留（eliminate）、lose = 敗退（advance）／失格（eliminate） */
export type PlayoffOutcome = 'win' | 'lose';

export type PlayoffProgress = {
    outcomes: Record<number, PlayoffOutcome>;
    /** まだ結果が出ていない選手 */
    remainingIds: number[];
    resolved: boolean;
    /** 確定に使う選手。advance は勝ち抜け1名、eliminate は失格者（resolved のときだけ意味を持つ） */
    chosenIds: number[];
    /** 結果に影響した操作（無視された操作を除いた列）。Undo はこの末尾を取り除く */
    effectiveActions: SemifinalPlayoffAction[];
};

export function getPlayoffProgress(playoff: SemifinalPlayoff): PlayoffProgress {
    const outcomes: Record<number, PlayoffOutcome> = {};
    const effectiveActions: SemifinalPlayoffAction[] = [];
    const remaining = () => playoff.candidateIds.filter(id => outcomes[id] === undefined);
    const countOf = (o: PlayoffOutcome) => playoff.candidateIds.filter(id => outcomes[id] === o).length;

    const isResolved = (): boolean => {
        if (playoff.purpose === 'advance') return countOf('win') >= 1;
        return countOf('lose') >= playoff.slots || remaining().length === 0;
    };

    // 自動で決まる分（残り1名の勝ち抜け、残り全員の残留・失格）を反映する
    const settle = () => {
        const rest = remaining();
        if (playoff.purpose === 'advance') {
            if (countOf('win') === 0 && rest.length === 1) outcomes[rest[0]] = 'win';
            return;
        }
        const needLose = playoff.slots - countOf('lose');
        if (needLose <= 0) rest.forEach(id => { outcomes[id] = 'win'; });
        else if (rest.length <= needLose) rest.forEach(id => { outcomes[id] = 'lose'; });
    };

    settle();
    for (const a of playoff.actions) {
        if (isResolved()) break;
        if (!playoff.candidateIds.includes(a.playerId) || outcomes[a.playerId] !== undefined) continue;
        if (a.action !== 'correct' && a.action !== 'wrong') continue;
        outcomes[a.playerId] = a.action === 'correct' ? 'win' : 'lose';
        effectiveActions.push(a);
        settle();
    }

    const resolved = isResolved();
    const chosenIds = playoff.candidateIds.filter(id => outcomes[id] === (playoff.purpose === 'advance' ? 'win' : 'lose'));
    return { outcomes, remainingIds: remaining(), resolved, chosenIds, effectiveActions };
}

/** 操作を1つ加えた playoff を返す。結果に影響しない操作なら null（送らなくてよい） */
export function addPlayoffAction(playoff: SemifinalPlayoff, playerId: number, action: SemifinalPlayoffMark): SemifinalPlayoff | null {
    const before = getPlayoffProgress(playoff);
    if (before.resolved || !before.remainingIds.includes(playerId)) return null;
    return { ...playoff, actions: [...before.effectiveActions, { playerId, action }] };
}

/** 最後の操作を取り消した playoff を返す。取り消す操作がなければ null */
export function undoPlayoffAction(playoff: SemifinalPlayoff): SemifinalPlayoff | null {
    const { effectiveActions } = getPlayoffProgress(playoff);
    if (effectiveActions.length === 0) return null;
    return { ...playoff, actions: effectiveActions.slice(0, -1) };
}
