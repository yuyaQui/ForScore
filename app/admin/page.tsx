"use client"; // クライアントサイドで動作する必要がある場合に指定

import { useState, useEffect } from "react";
import { io, Socket } from "socket.io-client";
import AdminText from "../components/Admin/AdminText";
import AdminQuestionPoolUpload from "../components/Admin/AdminQuestionPoolUpload";
import AdminTournamentName from "../components/Admin/AdminTournamentName";
import AdminFirstRound from "../components/Admin/AdminFirstRound";
import AdminFirstRoundUpload from "../components/Admin/AdminFirstRoundUpload";
import AdminSecondRound from "../components/Admin/AdminSecondRound";
import AdminThirdRound from "../components/Admin/AdminThirdRound";
import AdminExtraRound from "../components/Admin/AdminExtraRound";
import AdminSemifinal from "../components/Admin/AdminSemifinal";
import AdminFinal from "../components/Admin/AdminFinal";
import AdminPaperTop from "../components/Admin/AdminPaperTop";
import { AdminMainCoverBar } from "../components/Admin/MainCoverControls";
import type { SecondRoundState } from "@/lib/types";
import { DEFAULT_SECOND_ROUND_STATE } from "@/lib/types";
import { RoundProgressProvider, useRoundProgressSource } from "../components/Admin/roundProgressContext";
import { AdminRoundSidebar, AdminResumeBanner } from "../components/Admin/AdminRoundNav";
import consoleStyles from "../components/Admin/console/console.module.css";

// 運営コンソール（1画面に収まる新しい枠。2026-10-31 改善案）に載せ替え済みのモード。
// 載せ替えたモードは、進行レールの右を画面いっぱいの枠にする（各ラウンドが ConsoleFrame を描く）
const CONSOLE_MODES = new Set(["secondRound"]);

export default function AdminPage() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [currentMode, setCurrentMode] = useState("secondRound");
  // 2nd Round の表示画面（Turn Over / Quiz View）。背景色の切り替え判定に使う
  const [secondRoundState, setSecondRoundState] = useState<SecondRoundState>(DEFAULT_SECOND_ROUND_STATE);
  // 各ラウンドの状況（2026-10-22。サイドバーの鍵・各ラウンドの「○○へ ▶」・Undo の制限に使う）
  const progress = useRoundProgressSource(socket);

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

  // 運営コンソールに載せ替え済みのモードは、スクロールしない1画面の枠で表示する
  if (CONSOLE_MODES.has(currentMode)) {
    return (
      <RoundProgressProvider value={progress}>
        <div className={consoleStyles.page}>
          <AdminRoundSidebar currentMode={currentMode} progress={progress} onChangeMode={changeMode} />
          {currentMode === "secondRound" && <AdminSecondRound socket={socket} />}
        </div>
      </RoundProgressProvider>
    );
  }

  return (
    <RoundProgressProvider value={progress}>
    <div className="flex min-h-screen bg-black">

      {/* 左サイドバー: Select Round。Design アーティファクト(Admin.dc.html)の見た目を移植。
          2026-10-22: 前のラウンドが未完了のラウンドは押せない・状態の印・戻るときの確認（AdminRoundNav.tsx） */}
      <AdminRoundSidebar currentMode={currentMode} progress={progress} onChangeMode={changeMode} />

      {/* 右側: ラウンドごとの操作画面。サイドバーとは別領域なので絶対に重ならない */}
      <div className={`flex-1 flex flex-col items-center justify-center gap-[3vh] p-[3vw] overflow-y-auto ${backgroundClass}`}>

      {/* Main を覆う表示（待機画面・ブランク）の状況と操作。運営コンソールに載せ替えたラウンドは上のバーに出す（2026-11-04） */}
      <AdminMainCoverBar socket={socket} />

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
          {/* 大会準備（2026-11-02 に「待機画面」から改称）: いちばん上に大会名の入力 */}
          <AdminTournamentName socket={socket} />
          {/* DB の結果から見た、いま進めるべきラウンド（提案E。サーバ再起動で待機画面に戻ったとき用） */}
          <AdminResumeBanner progress={progress} onChangeMode={changeMode} />
          <AdminText socket={socket} />
          {/* 大会共通の問題データの取り込み（大会前に一度。2026-10-22） */}
          <AdminQuestionPoolUpload />
        </>
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

      {/* ペーパークイズ上位100名の発表（大会終了後。2026-10-31） */}
      {currentMode === "paperTop100" && (
        <AdminPaperTop socket={socket} />
      )}

      </div>
    </div>
    </RoundProgressProvider>
  );
}
