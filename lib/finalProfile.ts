// 決勝の選手紹介・最終成績の画面に出す「それまでのラウンドの成績」（2026-10-17 追加。docs/final-design.md 8章）。
// DB に新しい列は持たず、各ラウンドの結果の列から都度組み立てる。画面（Main / Admin）から使う純関数。

import type { Player } from './types';
import { toOrdinal } from './ordinal';

/**
 * 成績1行の見た目の種類。
 *   rank    … 順位（1st / 22nd など）
 *   out     … 敗退
 *   none    … 不参加
 *   revival … 敗者復活（Revival !!!）
 *   gold    … 優勝（Champion）
 */
export type RecordTone = 'rank' | 'out' | 'none' | 'revival' | 'gold';

export type RecordRow = {
    /** ラウンド名（1st Round など） */
    label: string;
    /** ラウンド名に添える補足（3rd Round のコース名）。無ければ null */
    sub: string | null;
    value: string;
    tone: RecordTone;
};

/** 勝ち抜け→正の数、敗退→-1、どちらでもない→0 の列を表記にする（2nd / 3rd Round・準決勝で共通の形） */
function rankCell(rank: number): { value: string; tone: RecordTone } {
    if (rank > 0) return { value: toOrdinal(rank), tone: 'rank' };
    if (rank < 0) return { value: '敗退', tone: 'out' };
    return { value: '不参加', tone: 'none' };
}

/**
 * 1st Round から準決勝まで（withFinal なら決勝も）の成績を並べる。
 *
 * - 1st Round … 1st Round（筆記）の順位
 * - 2nd Round … 組の中で勝ち抜けた順。敗退、または 49位以下で出ていなければ不参加
 * - 3rd Round … 出たコース名を添えて、勝ち抜けた順／敗退。出ていなければ不参加
 * - Extra Round … 敗者復活なら「Revival !!!」。3rd Round を勝ち抜けて出ていなければ不参加
 * - Semi-Final … 勝ち抜けたセット（1st / 2nd / 3rd）
 * - Final … 優勝は「Champion」、ほかは 2nd / 3rd（2026-10-17 ユーザー選択）
 */
export function buildCareerRecords(p: Player, withFinal: boolean): RecordRow[] {
    const rows: RecordRow[] = [];
    rows.push({ label: '1st Round', sub: null, value: toOrdinal(p.paperRank), tone: 'rank' });
    rows.push({ label: '2nd Round', sub: null, ...rankCell(p.secondRoundRank) });
    rows.push({ label: '3rd Round', sub: p.thirdRoundCourseName || null, ...(p.thirdRoundCourseName ? rankCell(p.thirdRoundRank) : { value: '不参加', tone: 'none' as const }) });
    rows.push({
        label: 'Extra Round', sub: null,
        ...(p.extraRoundRank === 1 ? { value: 'Revival !!!', tone: 'revival' as const }
            : p.extraRoundRank < 0 ? { value: '敗退', tone: 'out' as const }
            : { value: '不参加', tone: 'none' as const }),
    });
    rows.push({ label: 'Semi-Final', sub: null, ...rankCell(p.semifinalRank) });
    if (withFinal) {
        rows.push({
            label: 'Final', sub: null,
            ...(p.finalRank === 1 ? { value: 'Champion', tone: 'gold' as const }
                : p.finalRank > 1 ? { value: toOrdinal(p.finalRank), tone: 'rank' as const }
                : { value: '—', tone: 'none' as const }),
        });
    }
    return rows;
}

/** 決勝の3名。準決勝の勝ち抜け順（席順・紹介順も同じ。設計メモ 決定事項1） */
export function getFinalists(players: Player[]): Player[] {
    return players.filter(p => p.semifinalRank > 0).sort((a, b) => a.semifinalRank - b.semifinalRank);
}

/** 最終成績の見出し（順位ごと） */
export function finalPlaceLabel(rank: number): string {
    return rank === 1 ? 'CHAMPION' : rank === 2 ? '2nd Place' : rank === 3 ? '3rd Place' : '';
}
