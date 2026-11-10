// lib/questionWrap.js の型（2026-11-11）
export type PoolBounds = { min: number; max: number };
export type WrapRange = { from: number; to: number; min?: number; max?: number };
export const RANGE_MAX: number;
export function cleanBounds(b: unknown): PoolBounds | null;
export function nextSerial(serial: number, bounds: PoolBounds | null | undefined): number;
export function prevSerial(serial: number, bounds: PoolBounds | null | undefined): number | null;
export function rangeSerials(range: WrapRange | null | undefined): { ok: true; serials: number[] } | { ok: false; error: string };
export function describeRange(range: WrapRange): string | null;
export function continueFrom(prevTo: number, bounds: PoolBounds | null | undefined): number;
