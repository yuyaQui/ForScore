// 準決勝 Admin の「準備・進出者紹介・選手カード表示・終了」の表示部品（2026-10-15 追加）。
// 進行の1本道ボタンは AdminSemifinal.tsx が持ち、ここは本文の表示と、写真・二つ名の登録だけを扱う。
import { Socket } from "socket.io-client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Player } from "@/lib/types";
import { ACCENT, tierOf } from "@/lib/cyberpunkCard";
import { toOrdinal } from "@/lib/ordinal";
import {
    NICKNAME_MAX, PHOTO_WIDTH, PHOTO_HEIGHT, countChars, photoUrl, type SemifinalProfile,
} from "@/lib/semifinalProfile";
import { NoPhoto } from "@/app/components/Main/SemifinalCard";
import {
    MANUAL_LABEL_STYLE, MANUAL_PANEL_BASE, STAT_CARD_STYLE, STAT_LABEL_STYLE,
    manualBtnStyle, manualBtnTextStyle, neutralBtnStyle, NEUTRAL_BTN_TEXT,
} from "./adminCyberStyles";

const JP = '"Noto Sans JP",sans-serif';
const ORB = 'Orbitron, sans-serif';
const GOLD = '#FFC93C';

function courseLabel(p: Player): string {
    return `${p.thirdRoundCourseName ?? ''} ${p.thirdRoundRank}位`;
}

/** 写真・二つ名の一覧を読み、保存の通知（update_semifinal_profiles）で取り直す */
export function useSemifinalProfiles(socket: Socket | null): { profiles: SemifinalProfile[]; reload: () => void } {
    const [profiles, setProfiles] = useState<SemifinalProfile[]>([]);
    const reload = useCallback(() => {
        fetch('/api/semifinal/profiles').then(res => res.json()).then(data => {
            if (data.success) setProfiles(data.profiles);
        }).catch(err => console.error('Failed to load semifinal profiles', err));
    }, []);
    useEffect(() => {
        reload();
        if (!socket) return;
        socket.on('update_semifinal_profiles', reload);
        return () => { socket.off('update_semifinal_profiles', reload); };
    }, [socket, reload]);
    return { profiles, reload };
}

// ============================================================================
// 準備: 写真・二つ名の登録
// ============================================================================

export function PrepPanel({ socket, introOrder, revived, profiles, onError }: {
    socket: Socket | null; introOrder: Player[]; revived: Player | null; profiles: SemifinalProfile[]; onError: (msg: string) => void;
}) {
    const all = [...introOrder, ...(revived ? [revived] : [])];
    const profileOf = (id: number) => profiles.find(p => p.playerId === id);
    // 登録済み = 写真あり（紹介する8名は二つ名も）
    const isDone = (p: Player) => {
        const pr = profileOf(p.id);
        return !!pr && pr.photoVersion !== null && (p === revived || pr.nickname !== '');
    };
    const done = all.filter(isDone).length;
    const [cropping, setCropping] = useState<{ player: Player; src: string } | null>(null);

    // 保存したら Main・他の Admin に知らせる（中身は各画面が取り直す）
    const notifyChanged = () => { if (socket) socket.emit('semifinal_profiles_changed'); };

    const closeCrop = () => {
        if (cropping) URL.revokeObjectURL(cropping.src);
        setCropping(null);
    };

    return (
        <>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div style={MANUAL_LABEL_STYLE}>進出者の写真・二つ名（紹介順・敗者復活者は最後）</div>
                <span style={{ fontFamily: JP, fontWeight: 700, fontSize: 14, color: done === all.length ? '#7FE8FF' : '#9FB4D6' }}>登録済み {done} / {all.length}名</span>
            </div>
            <div className="grid gap-[14px]" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                {all.map((p, i) => (
                    <PrepCard
                        key={p.id} player={p} index={i} revived={p === revived} profile={profileOf(p.id)} done={isDone(p)}
                        onPickPhoto={file => setCropping({ player: p, src: URL.createObjectURL(file) })}
                        onSaved={notifyChanged} onError={onError}
                    />
                ))}
            </div>
            <div style={{ fontFamily: JP, fontWeight: 700, fontSize: 13, color: '#5C7EA6' }}>
                未登録のままでも進行できます（二つ名が無い選手は二つ名の画面を飛ばし、写真が無い選手は NO PHOTO を表示）。登録した情報は大会後に削除します。
            </div>
            {cropping && (
                <CropModal
                    player={cropping.player} src={cropping.src} onCancel={closeCrop} onError={onError}
                    onSaved={() => { notifyChanged(); closeCrop(); }}
                />
            )}
        </>
    );
}

function PrepCard({ player, index, revived, profile, done, onPickPhoto, onSaved, onError }: {
    player: Player; index: number; revived: boolean; profile: SemifinalProfile | undefined; done: boolean;
    onPickPhoto: (file: File) => void; onSaved: () => void; onError: (msg: string) => void;
}) {
    const tier = tierOf(player.paperRank, ACCENT);
    const saved = profile?.nickname ?? '';
    const photo = photoUrl(profile);
    // 入力中の二つ名。保存済みの値が変わったら（他の Admin で保存されたときも）入力欄を合わせる
    const [nick, setNick] = useState(saved);
    const [savedSeen, setSavedSeen] = useState(saved);
    if (savedSeen !== saved) {
        setSavedSeen(saved);
        setNick(saved);
    }
    const [busy, setBusy] = useState(false);
    const dirty = nick.trim() !== saved;
    const tooLong = countChars(nick.trim()) > NICKNAME_MAX;
    const fileRef = useRef<HTMLInputElement>(null);

    const saveNickname = async () => {
        setBusy(true);
        try {
            const res = await fetch('/api/semifinal/profiles', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerId: player.id, nickname: nick }),
            });
            const data = await res.json();
            if (!data.success) onError(data.error || '二つ名を保存できません');
            else onSaved();
        } catch {
            onError('通信に失敗しました');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={{ ...MANUAL_PANEL_BASE, padding: '14px 14px 16px', gap: 10, borderColor: done ? 'rgba(79,216,255,.22)' : 'rgba(255,201,60,.45)' }}>
            <div className="flex items-center justify-between">
                {revived
                    ? <span style={{ fontFamily: ORB, fontWeight: 800, fontSize: 13, letterSpacing: 2, color: '#B98BFF' }}>EXTRA</span>
                    : <span style={{ fontFamily: ORB, fontWeight: 800, fontSize: 13, letterSpacing: 2, color: '#7FA8D9' }}>{String(index + 1).padStart(2, '0')}</span>}
                <span style={{ fontFamily: JP, fontWeight: 700, fontSize: 12, color: '#9FB4D6' }}>{revived ? '敗者復活' : courseLabel(player)}</span>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ width: 96, height: 128, flexShrink: 0, position: 'relative', overflow: 'hidden', background: '#0B0F16', border: `1px solid ${photo ? 'rgba(79,216,255,.3)' : 'rgba(255,201,60,.5)'}` }}>
                    {photo
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        : <NoPhoto color="#5C7EA6" />}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                    <span style={{ fontFamily: ORB, fontWeight: 800, fontSize: 12, color: tier.color }}>{toOrdinal(player.paperRank)}</span>
                    <span style={{ fontFamily: JP, fontWeight: 900, fontSize: 16, color: '#F3FAFF', lineHeight: 1.3 }}>{player.name}</span>
                    <span style={{ fontFamily: JP, fontWeight: 700, fontSize: 12, color: '#9FB4D6' }}>{player.school} {player.grade}</span>
                    {/* 写真を選ぶと切り抜きの画面を開く。同じファイルを選び直せるよう value を空に戻す */}
                    <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) onPickPhoto(file);
                    }} />
                    <button onClick={() => fileRef.current?.click()} style={{ ...manualBtnStyle(!photo), marginTop: 'auto', alignSelf: 'flex-start', padding: '7px 12px' }}>
                        <span style={{ ...manualBtnTextStyle(!photo), fontFamily: JP, fontSize: 12 }}>{photo ? '写真を変更' : '写真を選択'}</span>
                    </button>
                </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ ...STAT_LABEL_STYLE, fontSize: 11 }}>二つ名</span>
                {revived ? (
                    <div style={{ display: 'flex', alignItems: 'center', minHeight: 36, fontFamily: JP, fontWeight: 700, fontSize: 13, color: '#5C7EA6' }}>
                        なし（敗者復活者は紹介しません）
                    </div>
                ) : (
                    <div style={{ display: 'flex', gap: 6 }}>
                        <input type="text" value={nick} onChange={e => setNick(e.target.value)} placeholder="未登録"
                            onKeyDown={e => { if (e.key === 'Enter' && dirty && !tooLong && !busy) void saveNickname(); }}
                            className="px-2 py-1.5 bg-zinc-900 border text-white"
                            style={{ flex: 1, minWidth: 0, fontFamily: JP, fontSize: 14, borderColor: tooLong ? '#FF3B5C' : dirty ? ACCENT : saved ? '#52525b' : 'rgba(255,201,60,.6)' }} />
                        <span style={{ alignSelf: 'center', fontFamily: ORB, fontWeight: 700, fontSize: 11, color: tooLong ? '#FF3B5C' : '#5C7EA6', whiteSpace: 'nowrap' }}>
                            {countChars(nick.trim())}/{NICKNAME_MAX}
                        </span>
                        <button onClick={() => { void saveNickname(); }} disabled={!dirty || tooLong || busy} style={{ ...manualBtnStyle(dirty), padding: '7px 12px', opacity: dirty && !tooLong && !busy ? 1 : 0.35 }}>
                            <span style={{ ...manualBtnTextStyle(dirty), fontFamily: JP, fontSize: 12 }}>保存</span>
                        </button>
                    </div>
                )}
            </div>
            <div style={{ fontFamily: JP, fontWeight: 700, fontSize: 12, color: done ? '#7FE8FF' : GOLD }}>
                {done ? '登録済み' : revived ? '写真が未登録' : !photo && !saved ? '写真・二つ名が未登録' : !photo ? '写真が未登録' : '二つ名が未登録'}
            </div>
        </div>
    );
}

// ============================================================================
// 写真の切り抜き（2026-10-15 ユーザー指示: 切り抜く範囲を手で調整できるようにする）
// 枠の内側をドラッグで移動、四隅で拡大縮小（縦横比 3:4 固定）。保存時に 600×800 の JPEG にして送る。
// ============================================================================

const VIEW_W = 600, VIEW_H = 450;   // 元の写真を表示する箱
const MIN_CROP = 60;                // 枠の最小幅（元の写真の px）

type Crop = { x: number; y: number; w: number };   // 元の写真の座標。高さは w × 4/3
type Drag = { kind: 'move' | 'nw' | 'ne' | 'sw' | 'se'; startX: number; startY: number; crop: Crop };

function CropModal({ player, src, onCancel, onSaved, onError }: {
    player: Player; src: string; onCancel: () => void; onSaved: () => void; onError: (msg: string) => void;
}) {
    const [img, setImg] = useState<HTMLImageElement | null>(null);
    const [crop, setCrop] = useState<Crop>({ x: 0, y: 0, w: 0 });
    const [busy, setBusy] = useState(false);
    const dragRef = useRef<Drag | null>(null);

    // 画像を読み込み、最初の枠は「入る最大の 3:4」の 8 割を中央に置く
    useEffect(() => {
        const el = new Image();
        el.onload = () => {
            const W = el.naturalWidth, H = el.naturalHeight;
            const w = Math.min(W, H * 3 / 4) * 0.8;
            setCrop({ x: (W - w) / 2, y: (H - w * 4 / 3) / 2, w });
            setImg(el);
        };
        el.onerror = () => onError('画像を読み込めません');
        el.src = src;
    }, [src, onError]);

    const W = img?.naturalWidth ?? 1, H = img?.naturalHeight ?? 1;
    const scale = Math.min(VIEW_W / W, VIEW_H / H);
    const h = crop.w * 4 / 3;

    const startDrag = (kind: Drag['kind'], e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        dragRef.current = { kind, startX: e.clientX, startY: e.clientY, crop };
    };
    const onMove = (e: React.PointerEvent) => {
        const d = dragRef.current;
        if (!d || !img) return;
        const dx = (e.clientX - d.startX) / scale, dy = (e.clientY - d.startY) / scale;
        const c = d.crop, ch = c.w * 4 / 3;
        if (d.kind === 'move') {
            setCrop({ w: c.w, x: Math.min(W - c.w, Math.max(0, c.x + dx)), y: Math.min(H - ch, Math.max(0, c.y + dy)) });
            return;
        }
        // 四隅: 反対側の角を固定して大きさを変える（縦横比 3:4 を保ち、写真の外には出さない）
        const right = d.kind === 'ne' || d.kind === 'se', down = d.kind === 'sw' || d.kind === 'se';
        const ax = right ? c.x : c.x + c.w, ay = down ? c.y : c.y + ch;
        const want = Math.max((right ? 1 : -1) * dx + c.w, ((down ? 1 : -1) * dy + ch) * 3 / 4);
        const maxW = Math.min(right ? W - ax : ax, (down ? H - ay : ay) * 3 / 4);
        const w = Math.max(Math.min(MIN_CROP, maxW), Math.min(maxW, want));
        setCrop({ w, x: right ? ax : ax - w, y: down ? ay : ay - w * 4 / 3 });
    };
    const endDrag = () => { dragRef.current = null; };

    const save = async () => {
        if (!img) return;
        // 切り抜いた範囲を 600×800 に縮めて JPEG にする
        const canvas = document.createElement('canvas');
        canvas.width = PHOTO_WIDTH;
        canvas.height = PHOTO_HEIGHT;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, crop.x, crop.y, crop.w, h, 0, 0, PHOTO_WIDTH, PHOTO_HEIGHT);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        setBusy(true);
        try {
            const res = await fetch('/api/semifinal/photo', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerId: player.id, dataUrl }),
            });
            const data = await res.json();
            if (!data.success) onError(data.error || '写真を保存できません');
            else onSaved();
        } catch {
            onError('通信に失敗しました');
        } finally {
            setBusy(false);
        }
    };

    const preview = (pw: number): React.CSSProperties => {
        const sc = pw / Math.max(1, crop.w);
        return {
            width: pw, height: Math.round(pw * 4 / 3), backgroundImage: `url("${src}")`, backgroundRepeat: 'no-repeat',
            backgroundSize: `${W * sc}px ${H * sc}px`, backgroundPosition: `${-crop.x * sc}px ${-crop.y * sc}px`,
            border: '1px solid rgba(79,216,255,.3)',
        };
    };
    const handle = (kind: Drag['kind'], pos: React.CSSProperties) => (
        <span onPointerDown={e => startDrag(kind, e)} style={{ position: 'absolute', width: 16, height: 16, background: '#DFF7FF', border: `2px solid ${ACCENT}`, boxSizing: 'border-box', touchAction: 'none', ...pos }} />
    );

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,4,10,.72)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 120, zIndex: 50 }}>
            <div style={{ ...MANUAL_PANEL_BASE, width: 1000, padding: '22px 26px 24px', gap: 18, background: '#07101E', border: '1px solid rgba(79,216,255,.4)' }}>
                <div className="flex items-baseline justify-between">
                    <div style={{ fontFamily: JP, fontWeight: 900, fontSize: 20, color: '#F3FAFF' }}>写真の切り抜き — {player.name}</div>
                    {img && <div style={{ fontFamily: JP, fontWeight: 700, fontSize: 12, color: '#5C7EA6' }}>元の写真 {W} × {H}</div>}
                </div>
                <div style={{ display: 'flex', gap: 28 }}>
                    <div style={{ width: VIEW_W, height: VIEW_H, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
                        {img && (
                            <div onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag}
                                style={{ position: 'relative', width: W * scale, height: H * scale, overflow: 'hidden', userSelect: 'none', touchAction: 'none' }}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={src} alt="" draggable={false} style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }} />
                                <div onPointerDown={e => startDrag('move', e)} style={{
                                    position: 'absolute', left: crop.x * scale, top: crop.y * scale, width: crop.w * scale, height: h * scale,
                                    boxShadow: '0 0 0 9999px rgba(0,0,0,.62)', outline: `2px solid ${ACCENT}`, cursor: 'move', touchAction: 'none',
                                }}>
                                    {[1, 2].map(k => <span key={'v' + k} style={{ position: 'absolute', top: 0, bottom: 0, left: `${(k / 3) * 100}%`, width: 1, background: 'rgba(223,247,255,.35)', pointerEvents: 'none' }} />)}
                                    {[1, 2].map(k => <span key={'h' + k} style={{ position: 'absolute', left: 0, right: 0, top: `${(k / 3) * 100}%`, height: 1, background: 'rgba(223,247,255,.35)', pointerEvents: 'none' }} />)}
                                    {handle('nw', { left: -8, top: -8, cursor: 'nwse-resize' })}
                                    {handle('ne', { right: -8, top: -8, cursor: 'nesw-resize' })}
                                    {handle('sw', { left: -8, bottom: -8, cursor: 'nesw-resize' })}
                                    {handle('se', { right: -8, bottom: -8, cursor: 'nwse-resize' })}
                                </div>
                            </div>
                        )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
                        <div style={STAT_LABEL_STYLE}>プレビュー</div>
                        {img && (
                            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
                                    <div style={preview(150)} />
                                    <span style={{ fontFamily: JP, fontWeight: 700, fontSize: 12, color: '#9FB4D6' }}>進出者紹介・カード</span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
                                    <div style={preview(96)} />
                                    <span style={{ fontFamily: JP, fontWeight: 700, fontSize: 12, color: '#9FB4D6' }}>一覧</span>
                                </div>
                            </div>
                        )}
                        <ul style={{ margin: 0, paddingLeft: 18, fontFamily: JP, fontWeight: 700, fontSize: 13, lineHeight: 1.8, color: '#9FB4D6' }}>
                            <li>枠の内側をドラッグして位置を合わせる</li>
                            <li>四隅をドラッグして大きさを変える（縦横比 3:4 は固定）</li>
                            <li>保存すると 600 × 800 に縮めて登録します</li>
                        </ul>
                    </div>
                </div>
                <div className="flex items-center justify-end gap-3">
                    <button onClick={onCancel} disabled={busy} style={neutralBtnStyle()}><span style={NEUTRAL_BTN_TEXT}>キャンセル</span></button>
                    <button onClick={() => { void save(); }} disabled={!img || busy} style={{ ...manualBtnStyle(true), opacity: img && !busy ? 1 : 0.35 }}>
                        <span style={{ ...manualBtnTextStyle(true), fontFamily: JP }}>この範囲で保存</span>
                    </button>
                </div>
            </div>
        </div>
    );
}

// ============================================================================
// 進出者紹介の進行
// ============================================================================

export function IntroPanel({ introOrder, index, step, profiles }: {
    introOrder: Player[]; index: number; step: 'nickname' | 'profile'; profiles: SemifinalProfile[];
}) {
    const cur = introOrder[index];
    if (!cur) return null;
    const profile = profiles.find(p => p.playerId === cur.id);
    const photo = photoUrl(profile);
    const isNick = step === 'nickname';
    return (
        <>
            <div className="flex gap-[14px] flex-wrap">
                <div style={{ ...STAT_CARD_STYLE, flex: 1.3, display: 'flex', gap: 18, alignItems: 'center' }}>
                    <div style={{ width: 90, height: 120, flexShrink: 0, position: 'relative', overflow: 'hidden', background: '#0B0F16', border: '1px solid rgba(79,216,255,.3)', opacity: isNick ? 0.45 : 1 }}>
                        {photo
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                            : <NoPhoto color="#5C7EA6" />}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                        <div style={STAT_LABEL_STYLE}>Main に表示中</div>
                        <div style={{ fontFamily: JP, fontWeight: 900, fontSize: 22, color: profile?.nickname ? '#F3FAFF' : '#5C7EA6' }}>{profile?.nickname || '（二つ名なし）'}</div>
                        <div style={{ fontFamily: JP, fontWeight: 700, fontSize: 14, color: isNick ? '#5C7EA6' : '#9FB4D6' }}>
                            {cur.school} {cur.grade}　{cur.name}{isNick ? '（次に表示）' : ''}
                        </div>
                    </div>
                </div>
            </div>
            <div className="flex flex-col gap-[8px]">
                <div style={MANUAL_LABEL_STYLE}>紹介順</div>
                <div className="grid gap-[8px]" style={{ gridTemplateColumns: `repeat(${introOrder.length}, minmax(0, 1fr))` }}>
                    {introOrder.map((p, i) => {
                        const done = i < index;
                        const now = i === index;
                        const color = now ? ACCENT : done ? '#3A4B63' : 'rgba(79,216,255,.18)';
                        return (
                            <div key={p.id} style={{ boxSizing: 'border-box', padding: '10px 8px', minWidth: 0, textAlign: 'center', background: now ? 'rgba(51,198,255,.10)' : 'rgba(12,22,40,.75)', borderTop: `3px solid ${color}`, opacity: done ? 0.55 : 1 }}>
                                <div style={{ fontFamily: ORB, fontWeight: 800, fontSize: 12, color: '#7FA8D9' }}>{String(i + 1).padStart(2, '0')}</div>
                                <div style={{ fontFamily: JP, fontWeight: 700, fontSize: 11, color: '#9FB4D6', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{courseLabel(p)}</div>
                                <div style={{ fontFamily: JP, fontWeight: 800, fontSize: 14, color: '#F3FAFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                                <div style={{ fontFamily: ORB, fontWeight: 800, fontSize: 11, letterSpacing: 1, color: now ? ACCENT : '#5C7EA6', minHeight: 16 }}>{now ? 'NOW' : done ? 'DONE' : ''}</div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </>
    );
}

// ============================================================================
// 選手カード表示
// ============================================================================

export function LineupPanel({ lineupOrder, revived, allShown }: { lineupOrder: Player[]; revived: Player | null; allShown: boolean }) {
    return (
        <>
            <div style={{ fontFamily: JP, fontWeight: 700, fontSize: 14, color: '#9FB4D6' }}>
                紹介順に1枚ずつ表示し、最後に敗者復活者を表示します。全員そろったら「クイズ画面へ」で、カードが縮んでタイマーが現れます。
            </div>
            <div className="grid gap-[8px]" style={{ gridTemplateColumns: `repeat(${lineupOrder.length}, minmax(0, 1fr))` }}>
                {lineupOrder.map((p, i) => {
                    const isRev = revived !== null && p.id === revived.id;
                    return (
                        <div key={p.id} style={{ boxSizing: 'border-box', padding: '10px 8px', minWidth: 0, textAlign: 'center', background: 'rgba(12,22,40,.75)', borderTop: `3px solid ${allShown ? ACCENT : 'rgba(79,216,255,.18)'}` }}>
                            <div style={{ fontFamily: ORB, fontWeight: 800, fontSize: 12, color: isRev ? '#B98BFF' : '#7FA8D9' }}>{isRev ? 'EXTRA' : String(i + 1).padStart(2, '0')}</div>
                            <div style={{ fontFamily: JP, fontWeight: 800, fontSize: 14, color: '#F3FAFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                        </div>
                    );
                })}
            </div>
        </>
    );
}

// ============================================================================
// 準決勝の終了（決勝進出者の確認）
// ============================================================================

export function FinishPanel({ lineupOrder }: { lineupOrder: Player[] }) {
    return (
        <>
            <div style={{ fontFamily: JP, fontWeight: 700, fontSize: 14, color: '#9FB4D6' }}>
                第3セットの判定が終わりました。決勝進出者を確認して「Final へ」を押すと、Admin・Main とも決勝の画面に切り替わります。
            </div>
            <div className="grid gap-[8px]" style={{ gridTemplateColumns: `repeat(${Math.max(1, lineupOrder.length)}, minmax(0, 1fr))` }}>
                {lineupOrder.map(p => {
                    const won = p.semifinalRank > 0;
                    const color = won ? GOLD : '#4A5568';
                    return (
                        <div key={p.id} style={{ boxSizing: 'border-box', padding: '10px 8px', minWidth: 0, textAlign: 'center', background: 'rgba(12,22,40,.75)', borderTop: `3px solid ${color}`, opacity: won ? 1 : 0.55 }}>
                            <div style={{ fontFamily: ORB, fontWeight: 800, fontSize: 12, color: tierOf(p.paperRank, ACCENT).color }}>{toOrdinal(p.paperRank)}</div>
                            <div style={{ fontFamily: JP, fontWeight: 800, fontSize: 14, color: '#F3FAFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                            <div style={{ fontFamily: ORB, fontWeight: 800, fontSize: 12, letterSpacing: 1, color, marginTop: 4 }}>{won ? `WIN · SET ${p.semifinalRank}` : 'LOST'}</div>
                        </div>
                    );
                })}
            </div>
        </>
    );
}
