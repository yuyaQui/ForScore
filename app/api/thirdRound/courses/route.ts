import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// 3rd Round の4コースを取得する API
export async function GET() {
    try {
        const courses = await prisma.thirdRoundCourse.findMany({
            // 並び順を2段にしているのは、抽選前と抽選後で意味のある順番が変わるため。
            // 抽選後は playOrder（1〜4）順、抽選前は全部 null なので id 順
            // （＝マイグレーションで投入した順）になる。
            orderBy: [{ playOrder: 'asc' }, { id: 'asc' }]
        });

        // 4コース全部に playOrder が入っていれば抽選済みとみなす。
        // every は「全要素が条件を満たすか」を判定する（1つでも null なら false）
        const isDrawn = courses.every(c => c.playOrder !== null);

        // 何回抽選が済んでいるか。抽選は1回1コースなので、
        // playOrder が入っている数がそのまま回数になる。
        const drawnCount = courses.filter(c => c.playOrder !== null).length;

        return NextResponse.json({
            success: true,
            courses,
            isDrawn,
            drawnCount
        });
    } catch (error) {
        console.error('Fetch third round courses error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
