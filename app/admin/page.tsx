"use client"; // クライアントサイドで動作する必要がある場合に指定

import { useState, useEffect } from "react";
import { io, Socket } from "socket.io-client";
import AdminText from "../components/Admin/AdminText";
import AdminQuestionPoolUpload from "../components/Admin/AdminQuestionPoolUpload";
import AdminFirstRound from "../components/Admin/AdminFirstRound";
import AdminFirstRoundUpload from "../components/Admin/AdminFirstRoundUpload";
import AdminSecondRound from "../components/Admin/AdminSecondRound";
import AdminThirdRound from "../components/Admin/AdminThirdRound";
import AdminExtraRound from "../components/Admin/AdminExtraRound";
import AdminSemifinal from "../components/Admin/AdminSemifinal";
import AdminFinal from "../components/Admin/AdminFinal";
import type { SecondRoundState } from "@/lib/types";
import { DEFAULT_SECOND_ROUND_STATE } from "@/lib/types";

export default function AdminPage() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [currentMode, setCurrentMode] = useState("secondRound");
  // 2nd Round の表示画面（Turn Over / Quiz View）。背景色の切り替え判定に使う
  const [secondRoundState, setSecondRoundState] = useState<SecondRoundState>(DEFAULT_SECOND_ROUND_STATE);

  // サーバー接続時の処理（ここだけ socket が使えない）
  useEffect(() => {
    const socketConnection = io();
    // socket を state に入れているのは、子コンポーネントへ props で渡すため。
    // useRef にすると値の更新で再描画が起きず、子に socket が永久に届かない。
    //
    // このルールが指摘しているのは「初回レンダー → effect → setState → 再レンダー」
    // という連鎖レンダー。実害として子の初期 fetch がマウント時に2回走っているが、
    // GET なので壊れはしない。
    //
    // 抜本対応（socket をモジュールレベルの1個にする）は工程0-2 で扱う。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSocket(socketConnection);

    socketConnection.on("mode_update", (newMode: string) => {
      setCurrentMode(newMode);
    })

    // 2nd Round の表示画面（Turn Over / Quiz View）。背景色の切り替え判定に使う
    socketConnection.on("update_second_round_state", (state: SecondRoundState) => {
      setSecondRoundState(state);
    });
    // クリーンアップ処理（画面が閉じられる時の処理）
    return () => {
      socketConnection.disconnect();
    };
  }, []);


  // モードの切り替え
  // mode に 切り替え先のモードを入れて送信
  const changeMode = (mode: string) => {
    if (socket) {
      socket.emit('change_mode', mode);
    }
  }


  // 1st Round・その結果アップロード画面・2nd Round の Quiz View だけサイバーパンク調（黒背景）にする。他のモードは従来の背景のまま
  const backgroundClass =
    currentMode === "1stRound" ||
    currentMode === "1stRoundResult" ||
    (currentMode === "secondRound" && secondRoundState.view === "quiz")
      ? "bg-black"
      : "bg-zinc-50 dark:bg-zinc-900";

  // Design アーティファクト(Admin.dc.html)左サイドバーの「SELECT ROUND」見た目をそのまま
  // 移植したナビゲーション項目。ラベルは 2026-10-11 のユーザー指示で
  // 「1ST ROUND」「2ND ROUND」「3RD ROUND」「EXTRA ROUND」「SEMI-FINAL」「FINAL」に変更した。
  const ROUND_NAV: { mode: string; label: string }[] = [
    { mode: "waiting", label: "待機画面" },
    { mode: "1stRound", label: "1ST ROUND" },
    { mode: "secondRound", label: "2ND ROUND" },
    { mode: "thirdRound", label: "3RD ROUND" },
    { mode: "extraRound", label: "EXTRA ROUND" },
    { mode: "semifinal", label: "SEMI-FINAL" },
    { mode: "final", label: "FINAL" },
  ];
  // 「1stRoundResult」は 1R のサブ画面なので、サイドバー上は親ラウンドをアクティブ表示にする。
  // （Extra Round の問題取込は、AdminExtraRound 内の最初の段階（setup）に組み込んだ）
  const isRoundActive = (mode: string) => {
    if (mode === "1stRound") return currentMode === "1stRound" || currentMode === "1stRoundResult";
    return currentMode === mode;
  };

  return (
    <div className="flex min-h-screen bg-black">

      {/* 左サイドバー: Select Round。Design アーティファクト(Admin.dc.html)の見た目を
          そのまま移植。ラウンドをまたいで常にこの配色で固定表示する
          (下段の各ラウンド画面自体の背景色とは独立させ、絶対に重ならないようにする) */}
      <div
        className="shrink-0 flex flex-col gap-[10px]"
        style={{
          width: 220,
          minHeight: "100vh",
          boxSizing: "border-box",
          padding: "30px 18px",
          background: "rgba(8,15,28,.7)",
          borderRight: "1px solid rgba(79,216,255,.18)",
        }}
      >
        <div
          style={{
            fontFamily: "Orbitron, sans-serif",
            fontWeight: 800,
            fontSize: 13,
            letterSpacing: 5,
            color: "#5C7EA6",
            marginBottom: 10,
          }}
        >
          SELECT ROUND
        </div>
        {ROUND_NAV.map((r) => {
          const active = isRoundActive(r.mode);
          return (
            <button
              key={r.mode}
              onClick={() => changeMode(r.mode)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 12px",
                cursor: "pointer",
                background: active ? "rgba(79,216,255,.10)" : "transparent",
                border: "none",
                textAlign: "left",
              }}
            >
              <span
                style={{
                  display: "block",
                  width: 3,
                  height: 20,
                  flexShrink: 0,
                  background: active ? "#4FD8FF" : "transparent",
                  boxShadow: active ? "0 0 8px #4FD8FF" : "none",
                }}
              />
              <span
                style={{
                  fontFamily: "Orbitron, sans-serif",
                  fontWeight: 700,
                  fontSize: 14,
                  letterSpacing: 2,
                  color: active ? "#F3FAFF" : "#5C7EA6",
                }}
              >
                {r.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* 右側: ラウンドごとの操作画面。サイドバーとは別領域なので絶対に重ならない */}
      <div className={`flex-1 flex flex-col items-center justify-center gap-[3vh] p-[3vw] overflow-y-auto ${backgroundClass}`}>

      {/* // admin 画面の切り替え */}
      {currentMode === "1stRound" && (
        <AdminFirstRound socket={socket} onGoToResult={() => {
          if (socket) socket.emit("change_mode", "1stRoundResult");
        }}
        />
      )}

      {currentMode === "1stRoundResult" && (
        <AdminFirstRoundUpload socket={socket} />
      )}

      {currentMode === "waiting" && (
        <>
          <AdminText socket={socket} />
          {/* 大会共通の問題データの取り込み（大会前に一度。2026-10-22） */}
          <AdminQuestionPoolUpload />
        </>
      )}

      {currentMode === "secondRound" && (
        <AdminSecondRound socket={socket} />
      )}

      {currentMode === "thirdRound" && (
        <AdminThirdRound socket={socket} />
      )}

      {currentMode === "extraRound" && (
        <AdminExtraRound socket={socket} />
      )}

      {currentMode === "semifinal" && (
        <AdminSemifinal socket={socket} />
      )}

      {currentMode === "final" && (
        <AdminFinal socket={socket} />
      )}

      </div>
    </div>
  );
}
