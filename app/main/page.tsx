"use client";

import { useState, useEffect } from "react";
import { io, Socket } from "socket.io-client";
import MainText from "../components/Main/MainText";
import MainFirstRound from "../components/Main/MainFirstRound";
import MainSecondRound from "../components/Main/MainSecondRound";
import MainThirdRound from "../components/Main/MainThirdRound";

export default function MainPage() {
  // 複数の画面で使う情報の設定
  const [socket, setSocket] = useState<Socket | null>(null);
  const [currentMode, setCurrentMode] = useState("waiting");
  const [displayText, setDisplayText] = useState("まだ変更されていません");
  const [players, setPlayers] = useState<any[]>([]); // プレイヤー一覧状態

  useEffect(() => {
    // サーバーと同じホスト・ポートに接続
    const newSocket = io();
    setSocket(newSocket);

    // モード切り替え
    newSocket.on("mode_update", (newMode: string) => {
      setCurrentMode(newMode);
    })

    // 管理画面からの更新イベントを受け取る
    newSocket.on("text_updated", (newText: string) => {
      setDisplayText(newText);
    });

    // サーバーからのプレイヤーデータを受け取る
    newSocket.on("update_players", (allPlayers: any[]) => {
      setPlayers(allPlayers);
    });

    // クリーンアップ処理
    return () => {
      newSocket.disconnect();
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 bg-zinc-50 dark:bg-zinc-900 relative">
      {currentMode === "1stRound" && <MainFirstRound socket={socket} />}
      {currentMode === "1stRoundResult"
        && (<MainText text="1st Round 結果集計中..." />)}
      {currentMode === "secondRound" && <MainSecondRound players={players} socket={socket} setPlayers={setPlayers} />}
      {currentMode === "thirdRound" && <MainThirdRound players={players} socket={socket} setPlayers={setPlayers} />}
      {currentMode === "waiting" && <MainText text={displayText} />}
    </div>
  );
}
