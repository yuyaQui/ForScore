import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isSemifinalist, parseImageDataUrl, PHOTO_MAX_BYTES } from '@/lib/semifinalProfile';

/**
 * 準決勝・決勝で表示する選手の写真（2026-10-15 追加）。
 *
 *   GET  ?playerId=… … 画像そのものを返す（<img src> で使う）
 *   POST { playerId, dataUrl } … 写真を登録・差し替える。進出者9名（敗者復活者を含む）だけ
 *
 * 写真は Admin の切り抜きで 600×800 の JPEG にしてから data URL で送る。
 * 1人1枚なので upsert（あれば上書き、なければ作成）にする。
 */

export async function GET(request: Request) {
    try {
        const playerId = Number(new URL(request.url).searchParams.get('playerId'));
        if (!Number.isInteger(playerId)) {
            return NextResponse.json({ error: 'playerId が不正です' }, { status: 400 });
        }
        const photo = await prisma.playerPhoto.findUnique({ where: { playerId } });
        if (!photo) {
            return NextResponse.json({ error: '写真がありません' }, { status: 404 });
        }
        // URL に版（v=最終更新時刻）を付けて呼ぶので、同じ URL の中身は変わらない。
        // それでも会場の PC にずっと残らないよう、キャッシュは短めにする
        return new Response(new Uint8Array(photo.data), {
            headers: { 'Content-Type': photo.mimeType, 'Cache-Control': 'private, max-age=3600' },
        });
    } catch (error) {
        console.error('Semifinal photo GET error:', error);
        return NextResponse.json({ error: '写真を読み込めません' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const playerId = body?.playerId;
        if (typeof playerId !== 'number' || !Number.isInteger(playerId)) {
            return NextResponse.json({ error: 'playerId が不正です' }, { status: 400 });
        }
        const image = parseImageDataUrl(body?.dataUrl);
        if (!image) {
            return NextResponse.json({ error: '画像の形式が不正です（JPEG / PNG / WebP）' }, { status: 400 });
        }
        const data = Buffer.from(image.base64, 'base64');
        if (data.length === 0 || data.length > PHOTO_MAX_BYTES) {
            return NextResponse.json({ error: '画像が大きすぎます' }, { status: 400 });
        }

        // 進出者（敗者復活者を含む9名）だけ
        const player = await prisma.player.findUnique({ where: { id: playerId }, select: { thirdRoundRank: true, extraRoundRank: true } });
        if (!player || !isSemifinalist(player)) {
            return NextResponse.json({ error: '写真を登録できるのは準決勝の進出者だけです' }, { status: 400 });
        }

        const saved = await prisma.playerPhoto.upsert({
            where: { playerId },
            create: { playerId, mimeType: image.mimeType, data },
            update: { mimeType: image.mimeType, data },
            select: { updatedAt: true },
        });
        return NextResponse.json({ success: true, playerId, photoVersion: saved.updatedAt.getTime() });
    } catch (error) {
        console.error('Semifinal photo POST error:', error);
        return NextResponse.json({ error: '写真を保存できません' }, { status: 500 });
    }
}
