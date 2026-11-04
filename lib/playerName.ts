// 選手名の表示の決まり（2026-11-04 ユーザー指示。キャンバスの変更を実装に反映）
//   ・縦書きの選手枠では、姓を上・名を下に分け、全員の名前の先頭と末尾の高さをそろえる
//   ・横書きで姓・名が1文字ずつの名前（例「林 海」）は、間を全角スペースにする（「林　海」）

/** 姓と名に分ける（半角・全角スペースで区切る）。区切りが無ければ名は null */
export function splitName(name: string): { surname: string; given: string | null } {
    const parts = (name || '').trim().split(/[\s　]+/).filter(Boolean);
    if (parts.length <= 1) return { surname: parts[0] ?? '', given: null };
    return { surname: parts[0], given: parts.slice(1).join(' ') };
}

/** 横書きの名前。姓・名が1文字ずつなら全角スペースでつなぐ */
export function spacedName(name: string): string {
    const { surname, given } = splitName(name);
    if (given && Array.from(surname).length === 1 && Array.from(given).length === 1) return `${surname}　${given}`;
    return name;
}

/**
 * 縦書きで姓を上・名を下に置くときの文字の大きさ。
 * 名前の帯の高さ zoneH に「姓＋名の文字数＋半文字ぶんの間」が収まる大きさと、base の小さいほう
 */
export function splitNameFontSize(name: string, base: number, zoneH: number): number {
    const { surname, given } = splitName(name);
    const n = Array.from(surname).length + (given ? Array.from(given).length + 0.5 : 0);
    return Math.max(1, Math.min(base, Math.floor(zoneH / Math.max(1, n))));
}
