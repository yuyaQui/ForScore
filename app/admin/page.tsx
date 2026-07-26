"use client"; // クライアントサイドで動作する必要がある場合に指定

import { useState, useEffect } from "react";
import { io, Socket } from "socket.io-client";
import AdminText from "../components/Admin/AdminText";
import AdminFirstRound from "../components/Admin/AdminFirstRound";
import AdminFirstRoundUpload from "../components/Admin/AdminFirstRoundUpload";
import AdminSecondRound from "../components/Admin/AdminSecondRound";
import AdminThirdRound from "../components/Admin/AdminThirdRound";

export default function AdminPage() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [currentMode, setCurrentMode] = useState("secondRound");

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


  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 bg-zinc-50 dark:bg-zinc-900 gap-8">

      {/* 画面切り替えボタン */}
      <div className="bg-white dark:bg-zinc-800 p-6 rounded-xl shadow-md border border-zinc-200 dark:border-zinc-700 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4 text-zinc-900 dark:text-zinc-100 text-center">画面の切り替え</h2>
        <div className="flex gap-4">
          <button
            onClick={() => changeMode("waiting")}
            className="flex-1 bg-zinc-500 hover:bg-zinc-600 text-white font-bold py-3 rounded-lg transition-colors text-sm"
          >
            休憩画面
          </button>
          <button
            onClick={() => changeMode("1stRound")}
            className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 rounded-lg transition-colors text-sm"
          >
            1st Round
          </button>
          <button
            onClick={() => changeMode("secondRound")}
            className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 rounded-lg transition-colors text-sm"
          >
            2nd Round
          </button>
          <button
            onClick={() => changeMode("thirdRound")}
            className="flex-1 bg-purple-500 hover:bg-purple-600 text-white font-bold py-3 rounded-lg transition-colors text-sm"
          >
            3rd Round
          </button>
        </div>
      </div>



      {/* // admin 画面の切り替え */}
      {currentMode === "1stRound" && (
        <AdminFirstRound socket={socket} onGoToResult={() => {
          if (socket) socket.emit("change_mode", "1stRoundResult");
        }}
        />
      )}

      {currentMode === "1stRoundResult" && (
        <AdminFirstRoundUpload />
      )}

      {currentMode === "waiting" && (
        <AdminText socket={socket} />
      )}

      {currentMode === "secondRound" && (
        <AdminSecondRound socket={socket} />
      )}

      {currentMode === "thirdRound" && (
        <AdminThirdRound socket={socket} />
      )}

    </div>
  );
}
