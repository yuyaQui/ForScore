// 大会準備: 大会ロゴの登録（2026-11-06 ユーザー承認）。大会名の面の下に置く。
// 登録したロゴは DB（TournamentLogo）に保存し、Main のクイズ画面の見出しの中央に大会名と並べて出す。
//
//   ［画像を選ぶ…］→ プレビューと「クイズ画面での見え方」→［登録する］／［やめる］。登録済みなら［削除］（確認つき）
//   ・PNG・WebP・JPEG（SVG は受け付けない）。長い辺 1600px までに縮めて送る（透過は保つ・切り抜きはしない）。2MB まで
//   ・保存・削除のあとは tournament_state_changed を送り、Admin と Main が読み直す
import { Socket } from "socket.io-client";
import { useRef, useState } from "react";
import {
    LOGO_MAX_BYTES, LOGO_MIME_TYPES, LOGO_MAX_SIDE, fitWithin, logoUrl,
} from "@/lib/tournamentLogo";
import { notify, errorText } from "@/lib/adminNotice";
import { useRoundProgress } from "./roundProgressContext";
import { useSingleFlight } from "../useSingleFlight";
import { TournamentBrandView } from "../Main/TournamentBrand";
import styles from "./console/console.module.css";

type Pending = { dataUrl: string; width: number; height: number; fileName: string };

/** 選んだ画像を、長い辺 1600px までに縮めて同じ形式の data URL にする */
async function prepareLogo(file: File): Promise<Pending> {
    if (!(LOGO_MIME_TYPES as readonly string[]).includes(file.type)) {
        throw new Error("PNG・WebP・JPEG の画像を選んでください（SVG などは使えません）");
    }
    const url = URL.createObjectURL(file);
    try {
        const img = new Image();
        img.src = url;
        await img.decode().catch(() => { throw new Error("画像を読み取れません（壊れているか、形式が違います）"); });
        const size = fitWithin(img.naturalWidth, img.naturalHeight, LOGO_MAX_SIDE);
        const canvas = document.createElement("canvas");
        canvas.width = size.width;
        canvas.height = size.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("画像を処理できません");
        ctx.drawImage(img, 0, 0, size.width, size.height);
        const dataUrl = canvas.toDataURL(file.type, 0.92);
        if (!dataUrl.startsWith(`data:${file.type};`)) throw new Error("このブラウザではこの形式の画像を処理できません。PNG で選んでください");
        const bytes = Math.floor((dataUrl.length - dataUrl.indexOf(",") - 1) * 3 / 4);
        if (bytes > LOGO_MAX_BYTES) throw new Error("画像が大きすぎます（縮めても 2MB を超えます）。画像を小さくしてから選んでください");
        return { dataUrl, width: size.width, height: size.height, fileName: file.name };
    } finally {
        URL.revokeObjectURL(url);
    }
}

export default function AdminTournamentLogo({ socket }: { socket: Socket | null }) {
    const progress = useRoundProgress();
    const saved = progress?.tournamentLogo ?? null;
    const name = progress?.tournamentName ?? "";
    const [pending, setPending] = useState<Pending | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const flight = useSingleFlight();

    const onFile = async (file: File | undefined) => {
        if (!file) return;
        setError(null);
        try {
            setPending(await prepareLogo(file));
        } catch (e) {
            setPending(null);
            setError(e instanceof Error ? e.message : "画像を読み取れません");
        } finally {
            if (fileRef.current) fileRef.current.value = "";
        }
    };

    const send = (method: "POST" | "DELETE", done: string, fail: string) => flight.run(async () => {
        try {
            const res = await fetch("/api/tournamentLogo", {
                method,
                headers: { "Content-Type": "application/json" },
                body: method === "POST" ? JSON.stringify({ dataUrl: pending?.dataUrl }) : undefined,
            });
            const data = await res.json().catch(() => ({}));
            if (data.success) {
                setPending(null);
                socket?.emit("tournament_state_changed");
                notify(done);
            } else {
                notify(errorText(data.error, fail), "error");
            }
        } catch (e) {
            notify(errorText(e, `${fail}。通信を確かめてください`), "error");
        }
    });

    const shown = pending
        ? { src: pending.dataUrl, width: pending.width, height: pending.height }
        : saved ? { src: logoUrl(saved), width: saved.width, height: saved.height } : null;

    return (
        <section className={styles.pnl} aria-label="大会ロゴ">
            <div className={styles.pnlHead}>
                <span className={styles.pnlTitle}>大会ロゴ</span>
                {pending
                    ? <span className={styles.pnlWarn}>登録前（{pending.width}×{pending.height}）</span>
                    : <span className={saved ? styles.pnlOk : styles.pnlWarn}>{saved ? `✓ 登録済み（${saved.width}×${saved.height}）` : "未設定"}</span>}
            </div>
            <div className={styles.logoRow}>
                <div className={styles.logoPreview} aria-label="大会ロゴのプレビュー">
                    {shown
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={shown.src} alt="大会ロゴ" />
                        : <span>なし</span>}
                </div>
                <div className={styles.logoSide}>
                    <div className={styles.logoMockLabel}>クイズ画面での見え方（見出しの中央）</div>
                    <div className={styles.logoMock} aria-label="クイズ画面での見え方">
                        <div className={styles.logoMockInner}>
                            <TournamentBrandView name={name} logoSrc={shown?.src ?? null} logoWidth={shown?.width ?? 0} logoHeight={shown?.height ?? 0} />
                        </div>
                    </div>
                </div>
            </div>
            <div className={styles.pnlRow}>
                <input ref={fileRef} type="file" accept={LOGO_MIME_TYPES.join(",")} aria-label="大会ロゴの画像" hidden
                    onChange={e => { void onFile(e.target.files?.[0]); }} />
                {pending ? (
                    <>
                        <button type="button" className={styles.btnOn} disabled={flight.pending}
                            onClick={() => { void send("POST", saved ? "大会ロゴを差し替えました" : "大会ロゴを登録しました", "大会ロゴを保存できません"); }}>
                            {flight.pending ? "保存中…" : "登録する"}
                        </button>
                        <button type="button" className={styles.btn} disabled={flight.pending} onClick={() => setPending(null)}>やめる</button>
                    </>
                ) : (
                    <>
                        <button type="button" className={styles.btn} disabled={flight.pending} onClick={() => fileRef.current?.click()}>
                            {saved ? "画像を差し替える…" : "画像を選ぶ…"}
                        </button>
                        {saved && (
                            <button type="button" className={styles.btnDanger} disabled={flight.pending}
                                onClick={() => {
                                    if (window.confirm("大会ロゴを削除します。クイズ画面の見出しには大会名だけが出ます。よろしいですか？")) {
                                        void send("DELETE", "大会ロゴを削除しました", "大会ロゴを削除できません");
                                    }
                                }}>
                                削除
                            </button>
                        )}
                    </>
                )}
                <span className={styles.pnlCount}>PNG・WebP・JPEG／2MB まで</span>
            </div>
            {error && <div className={styles.pnlError}>{error}</div>}
        </section>
    );
}
