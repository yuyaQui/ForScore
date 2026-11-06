"use client"; // クライアントサイドで動作する必要がある場合に指定

import { useState, useEffect } from "react";
import type { Socket } from "socket.io-client";
import { createAdminSocket } from "@/lib/adminSocket";
import AdminNoticeHost from "../components/Admin/AdminNoticeHost";
import { useSocketSync } from "../components/useSocketSync";
import AdminFirstRound from "../components/Admin/AdminFirstRound";
import AdminFirstRoundUpload from "../components/Admin/AdminFirstRoundUpload";
import AdminSecondRound from "../components/Admin/AdminSecondRound";
import AdminThirdRound from "../components/Admin/AdminThirdRound";
import AdminExtraRound from "../components/Admin/AdminExtraRound";
import AdminSemifinal from "../components/Admin/AdminSemifinal";
import AdminFinal from "../components/Admin/AdminFinal";
import AdminWaiting from "../components/Admin/AdminWaiting";
import AdminPaperTop from "../components/Admin/AdminPaperTop";
import { RoundProgressProvider, useRoundProgressSource } from "../components/Admin/roundProgressContext";
import { AdminRoundSidebar } from "../components/Admin/AdminRoundNav";
import consoleStyles from "../components/Admin/console/console.module.css";
import { MainHealthProvider, useMainHealthSource } from "../components/Admin/mainHealth";

// 全モードを運営コンソール（1画面に収まる新しい枠。2026-10-31 改善案）で表示する（2026-11-05 に最後の大会準備を載せ替え）。
// 進行レールの右は画面いっぱいの枠で、各画面が ConsoleFrame を描く。

export default function AdminPage() {
  const [socket, setSocket] = useState<Socket | null>(null);
  // サーバから今のモードが届くまでは空（どの画面も描かない。以前は 2nd Round の初期値で一瞬描いていた）
  const [currentMode, setCurrentMode] = useState("");
  // 各ラウンドの状況（2026-10-22。サイドバーの鍵・各ラウンドの「○○へ ▶」・Undo の制限に使う）
  const progress = useRoundProgressSource(socket);
  // 今のモードは、つなぎ直したときにも必ず取り直す（切れていた間の変更を取りこぼさない。2026-11-04）。
  // 2nd Round の進行は 2nd Round の画面が自分で取り直す
  useSocketSync(socket, ['request_mode_sync']);
  // Main の表示の準備の状況（必要なデータがそろっているか。2026-11-06）。覆いを外すボタン・バーの下の帯が使う
  const mainHealth = useMainHealthSource(socket);

  // サーバー接続時の処理（ここだけ socket が使えない）
  useEffect(() => {
    // 切断中の操作は送らずに捨てて知らせる（つながった瞬間にまとめて実行されるのを防ぐ。lib/adminSocket.ts）
    const socketConnection = createAdminSocket();
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
    // クリーンアップ処理（画面が閉じられる時の処理）
    return () => {
      socketConnection.disconnect();
    };
  }, []);


  // モードの切り替え
  // mode に 切り替え先のモードを入れて送信
  // resume: すでに結果が入っているラウンドへ戻るとき。会場には「NEXT ○○」の待機画面ではなく、ブランクを出し、
  // 「この画面を表示する ▶」を押すまで何も出さない（途中のラウンドの画面がいきなり出るのを防ぐ。2026-11-04）
  const changeMode = (mode: string, resume = false) => {
    if (socket) {
      socket.emit('change_mode', resume ? { mode, resume: true } : mode);
    }
  }


  // スクロールしない1画面の枠で表示する
  return (
    <RoundProgressProvider value={progress}>
    <MainHealthProvider value={mainHealth}>
      <div className={consoleStyles.page}>
        <AdminNoticeHost socket={socket} />
        <AdminRoundSidebar currentMode={currentMode} progress={progress} onChangeMode={changeMode} />
        {currentMode === "waiting" && <AdminWaiting socket={socket} onChangeMode={changeMode} />}
        {currentMode === "1stRound" && (
          <AdminFirstRound socket={socket} onGoToResult={() => {
            if (socket) socket.emit("change_mode", "1stRoundResult");
          }} />
        )}
        {currentMode === "1stRoundResult" && <AdminFirstRoundUpload socket={socket} />}
        {currentMode === "secondRound" && <AdminSecondRound socket={socket} />}
        {currentMode === "thirdRound" && <AdminThirdRound socket={socket} />}
        {currentMode === "extraRound" && <AdminExtraRound socket={socket} />}
        {currentMode === "semifinal" && <AdminSemifinal socket={socket} />}
        {currentMode === "final" && <AdminFinal socket={socket} />}
        {currentMode === "paperTop100" && <AdminPaperTop socket={socket} />}
      </div>
    </MainHealthProvider>
    </RoundProgressProvider>
  );
}
