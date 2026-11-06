// 大会ロゴの DB の読み出し（2026-11-06）。API（/api/tournamentLogo・/api/tournamentState）から使う。
import { prisma } from '@/lib/prisma';
import { isTableMissingError } from '@/lib/questionPoolDb';
import type { TournamentLogoInfo } from '@/lib/tournamentLogo';

export const TOURNAMENT_LOGO_NOT_READY =
    '大会ロゴの表がまだ使えません。Mac のターミナルで `npx prisma migrate dev` を実行してから、サーバを再起動してください';

/** Prisma クライアントに大会ロゴの表があるか（migrate dev 前の古いクライアントでは無い） */
export function isTournamentLogoClientReady(client: object = prisma): boolean {
    return (client as Record<string, unknown>).tournamentLogo !== undefined;
}

/** 大会ロゴの情報（画像は含めない）。未登録・表がまだ無いときは null */
export async function loadTournamentLogoInfo(): Promise<TournamentLogoInfo | null> {
    if (!isTournamentLogoClientReady()) return null;
    try {
        const row = await prisma.tournamentLogo.findUnique({ where: { id: 1 }, select: { width: true, height: true, updatedAt: true } });
        return row ? { version: row.updatedAt.getTime(), width: row.width, height: row.height } : null;
    } catch (error) {
        if (isTableMissingError(error)) return null;
        throw error;
    }
}
