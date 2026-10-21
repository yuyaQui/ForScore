"use client";

import { useState, useEffect } from "react";
import { io, Socket } from "socket.io-client";
import MainText from "../components/Main/MainText";
import MainFirstRound from "../components/Main/MainFirstRound";
import MainSecondRound from "../components/Main/MainSecondRound";
import MainThirdRound from "../components/Main/MainThirdRound";
import MainExtraRound from "../components/Main/MainExtraRound";
import MainSemifinal from "../components/Main/MainSemifinal";
import MainFinal from "../components/Main/MainFinal";
// import type は型だけを読み込む書き方で、ビルド時に削除される
import type { Player } from "@/lib/types";

export default function MainPage() {
  // 複数の画面で使う情報の設定
  const [socket, setSocket] = useState<Socket | null>(null);
  const [currentMode, setCurrentMode] = useState("waiting");
  const [displayText, setDisplayText] = useState("まだ変更されていません");
  const [players, setPlayers] = useState<Player[]>([]); // プレイヤー一覧状態

  useEffect(() => {
    // サーバーと同じホスト・ポートに接続
    const newSocket = io();
    // socket を state に入れているのは、子コンポーネントへ props で渡すため。
    // useRef にすると値の更新で再描画が起きず、子に socket が永久に届かない。
    //
    // このルールが指摘しているのは「初回レンダー → effect → setState → 再レンダー」
    // という連鎖レンダー。実害として MainSecondRound / MainThirdRound の初期 fetch が
    // マウント時に2回走っているが、GET なので壊れはしない。
    //
    // 抜本対応（socket をモジュールレベルの1個にする）は工程0-2 で扱う。
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    newSocket.on("update_players", (allPlayers: Player[]) => {
      setPlayers(allPlayers);
    });


    // クリーンアップ処理
    return () => {
      newSocket.disconnect();
    };
  }, []);

  // 1st Round・その結果集計中の画面・2nd Round(Turn Over/Quiz View とも) だけ
  // サイバーパンク調（黒背景）にする。他のモードは従来の背景のまま。
  //
  // 2nd Round は MainSecondRound 内の FixedStage が position:fixed で画面全体を
  // 黒背景ごと覆うため、実際にはこの親要素の背景色は Turn Over / Quiz View の
  // どちらでもほぼ隠れて見えない。ただし currentMode が secondRound に切り替わった
  // 直後の1フレームなど、FixedStage が覆う前に一瞬見える可能性はゼロではないため、
  // 安全側に倒して secondRound は view を問わず黒にしておく。
  const backgroundClass =
    currentMode === "1stRound" ||
    currentMode === "1stRoundResult" ||
    currentMode === "secondRound" ||
    currentMode === "extraRound" ||
    currentMode === "semifinal" ||
    currentMode === "final"
      ? "bg-black"
      : "bg-zinc-50 dark:bg-zinc-900";

  return (
    <div className={`flex flex-col items-center justify-center min-h-screen p-[3vw] ${backgroundClass} relative`}>
      {currentMode === "1stRound" && <MainFirstRound socket={socket} />}
      {currentMode === "1stRoundResult"
        && (<MainText text="集計中..." variant="cyberpunk" />)}
      {currentMode === "secondRound" && <MainSecondRound players={players} socket={socket} setPlayers={setPlayers} />}
      {currentMode === "thirdRound" && <MainThirdRound players={players} socket={socket} setPlayers={setPlayers} />}
      {currentMode === "extraRound" && <MainExtraRound socket={socket} />}
      {currentMode === "semifinal" && <MainSemifinal socket={socket} />}
      {currentMode === "final" && <MainFinal socket={socket} />}
      {currentMode === "waiting" && <MainText text={displayText} />}
    </div>
  );
}
