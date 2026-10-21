import { prisma } from '@/lib/prisma';

/** Undo で戻せる履歴が無い（または使えない）ときに画面へ返す文言。全ラウンド共通 */
export const NO_HISTORY_MESSAGE = '履歴が存在しません';

/**
 * 履歴スナップショットが参照している選手が、すべて現在の DB に存在するかを調べる。
 *
 * 選手名簿を取り込み直すと選手の id は別物になるため、古い履歴の復元は
 * 「存在しない選手の更新」になって失敗する。復元の前にここで確かめ、
 * 存在しなければ Undo を行わずに中止する（履歴行にも手を付けない）。
 */
export async function allSnapshotPlayersExist(playerIds: number[]): Promise<boolean> {
    const uniqueIds = [...new Set(playerIds)];
    const found = await prisma.player.count({ where: { id: { in: uniqueIds } } });
    return found === uniqueIds.length;
}
