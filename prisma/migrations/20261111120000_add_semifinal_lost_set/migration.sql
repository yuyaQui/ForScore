-- Semi-Final で敗退したセット番号（2026-11-11）。0 は敗退していない・記録前の敗退
ALTER TABLE "Player" ADD COLUMN "semifinalLostSet" INTEGER NOT NULL DEFAULT 0;
