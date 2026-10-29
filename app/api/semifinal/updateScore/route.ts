import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    applySemifinalSetPoints,
    applyAdvance,
    applyElimination,
    getAdvanceJudgement,
    getEliminationJudgement,
    getSemifinalSetStage,
    resolveJudgement,
    validateSetPointEntries,
    type SemifinalPointEntry,
    type SemifinalSetStage,
} from '@/lib/semifinalScoring';
import type { Player } from '@/lib/types';
import { guardRound } from '@/lib/roundGuard';

/**
 * 準決勝の得点入力と判定（設計メモ 6章）。
 *
 *   points        … セットの得点を入力（対象全員ぶん。判定前のみ）
 *   judgeAdvance  … 勝ち抜けを確定（同点ならプレーオフの勝者 chosenIds が必要）
 *   judgeEliminate… 失格を確定（同点ならプレーオフの失格者 chosenIds が必要）
 *
 * どの操作も対象のセット（set）を受け取り、DB の状態がそのセットのその段階に
 * あるときだけ受け付ける（古い画面からの操作や二重送信で、別の段階のデータを
 * 書き換えないため）。スナップショット・履歴・配信の流れは同じなので1本のルートにまとめる。
 */
type UpdateScoreBody =
    | { action: 'points'; set: number; entries: SemifinalPointEntry[] }
    | { action: 'judgeAdvance'; set: number; chosenIds?: number[] }
    | { action: 'judgeEliminate'; set: number; chosenIds?: number[] };

/** 各操作を受け付ける段階 */
const REQUIRED_STAGE: Record<UpdateScoreBody['action'], SemifinalSetStage> = {
    points: 'beforeJudge',
    judgeAdvance: 'beforeJudge',
    judgeEliminate: 'advanced',
};

const STALE_MESSAGE = '状態が変わっています。画面を再読み込みしてください';

/**
 * 準決勝の対象9名を取得する。参加者は新しい列を持たず、3rd Round 通過（thirdRoundRank > 0）
 * と Extra Round 敗者復活（extraRoundRank === 1）から都度導出する（設計メモ 3.4）。
 */
async function loadSemifinalPlayers() {
    return prisma.player.findMany({
        where: { OR: [{ thirdRoundRank: { gt: 0 } }, { extraRoundRank: 1 }] },
        orderBy: { paperRank: 'asc' }
    });
}

export async function POST(request: Request) {
    try {
        const body = (await request.json()) as UpdateScoreBody;

        // 前のラウンドが完了していなければ採点しない（2026-10-22 提案C。docs/linear-progress-design.md）
        const blocked = await guardRound('semifinal');
        if (blocked) return blocked;
        if (!body || typeof body !== 'object' || !(body.action in REQUIRED_STAGE)) {
            return NextResponse.json({ error: 'action が不正です' }, { status: 400 });
        }

        const semifinalPlayers = await loadSemifinalPlayers();

        // Undo 用のスナップショット（更新「前」の状態）を、読んだ直後に固める（3rd Round と同じ規律）
        const snapshot = JSON.stringify(semifinalPlayers);

        if (getSemifinalSetStage(semifinalPlayers, body.set) !== REQUIRED_STAGE[body.action]) {
            return NextResponse.json({ error: STALE_MESSAGE }, { status: 409 });
        }

        let updated: Player[];
        if (body.action === 'points') {
            const error = validateSetPointEntries(semifinalPlayers, body.entries);
            if (error) return NextResponse.json({ error }, { status: 400 });
            updated = applySemifinalSetPoints(semifinalPlayers, body.entries);
        } else {
            const isAdvance = body.action === 'judgeAdvance';
            const judgement = isAdvance ? getAdvanceJudgement(semifinalPlayers) : getEliminationJudgement(semifinalPlayers);
            if (!judgement) return NextResponse.json({ error: STALE_MESSAGE }, { status: 409 });
            const resolved = resolveJudgement(judgement, body.chosenIds);
            if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 });
            updated = isAdvance
                ? applyAdvance(semifinalPlayers, body.set, resolved.playerIds)
                : applyElimination(semifinalPlayers, resolved.playerIds);
        }

        // 変化した選手だけを書き戻す。id で突き合わせる（並び順に頼らない）
        const before = new Map(semifinalPlayers.map(p => [p.id, JSON.stringify(p)]));
        const changed = updated.filter(p => before.get(p.id) !== JSON.stringify(p));

        // 得点入力は全員0点でも履歴を残す（Undo で「入力」を1手として戻せるように。
        // 残さないと、入力直後の Undo が1つ前の判定を戻してしまう）
        if (changed.length > 0 || body.action === 'points') {
            await prisma.$transaction([
                prisma.semifinalHistory.create({ data: { snapshot } }),
                ...changed.map(p =>
                    prisma.player.update({
                        where: { id: p.id },
                        data: { semifinalPoint: p.semifinalPoint, semifinalRank: p.semifinalRank }
                    })
                )
            ]);
        }

        const allPlayers = await prisma.player.findMany({ orderBy: { paperRank: 'asc' } });
        return NextResponse.json({ success: true, allPlayers });
    } catch (error) {
        console.error('Semifinal score update error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
