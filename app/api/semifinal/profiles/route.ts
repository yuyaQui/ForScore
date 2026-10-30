import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isIntroTarget, validateNickname, type SemifinalProfile } from '@/lib/semifinalProfile';

/**
 * 準決勝の進出者の「二つ名」と「写真の有無」（2026-10-15 追加）。
 *
 *   GET  … 進出者（3rd Round 通過＋敗者復活者）全員ぶんの一覧
 *   POST … 二つ名を保存する { playerId, nickname }。進出者（3rd Round 通過＋敗者復活者。2026-10-31 から敗者復活者も紹介する）
 *
 * 写真そのものは /api/semifinal/photo が扱う。ここでは写真の版（最終更新時刻）だけを返し、
 * 画像のバイト列は読まない（一覧を軽く保つため）。
 */

/** 進出者全員の一覧を作る */
async function loadProfiles(): Promise<SemifinalProfile[]> {
    const players = await prisma.player.findMany({
        where: { OR: [{ thirdRoundRank: { gt: 0 } }, { extraRoundRank: 1 }] },
        // 写真は更新時刻だけを読む（data は読まない）
        select: { id: true, nickname: true, photo: { select: { updatedAt: true } } },
        orderBy: { paperRank: 'asc' },
    });
    return players.map(p => ({
        playerId: p.id,
        nickname: p.nickname,
        photoVersion: p.photo ? p.photo.updatedAt.getTime() : null,
    }));
}

export async function GET() {
    try {
        return NextResponse.json({ success: true, profiles: await loadProfiles() });
    } catch (error) {
        console.error('Semifinal profiles error:', error);
        return NextResponse.json({ error: '進出者の情報を読み込めません' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const playerId = body?.playerId;
        if (typeof playerId !== 'number' || !Number.isInteger(playerId)) {
            return NextResponse.json({ error: 'playerId が不正です' }, { status: 400 });
        }
        const nickname = validateNickname(body?.nickname);
        if (!nickname.ok) {
            return NextResponse.json({ error: nickname.error }, { status: 400 });
        }

        // 紹介の対象（3rd Round 通過＋敗者復活者）だけ。進出していない選手の二つ名は書き換えない
        const player = await prisma.player.findUnique({ where: { id: playerId }, select: { thirdRoundRank: true, extraRoundRank: true } });
        if (!player || !isIntroTarget(player)) {
            return NextResponse.json({ error: '二つ名を登録できるのは Semi-Final の進出者だけです' }, { status: 400 });
        }

        await prisma.player.update({ where: { id: playerId }, data: { nickname: nickname.value } });
        return NextResponse.json({ success: true, profiles: await loadProfiles() });
    } catch (error) {
        console.error('Semifinal nickname error:', error);
        return NextResponse.json({ error: '二つ名を保存できません' }, { status: 500 });
    }
}
