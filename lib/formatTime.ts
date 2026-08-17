/**
 * 秒数を mm:ss 形式にする。
 *
 * 1st Round のコンポーネントは同じ処理をそれぞれの中に持っているが、
 * 今回はまとめていない（工程を跨いだ変更を避けるため）。あとで寄せられる。
 */
export function formatTime(totalSeconds: number): string {
    const safe = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}
