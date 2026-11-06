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
import MainPaperTop from "../components/Main/MainPaperTop";
import StandbyScreen, { BlankScreen } from "../components/Main/StandbyScreen";
import { useMainCover } from "../components/useMainCover";
import { MainReadyContext, useMainReadinessHost } from "../components/Main/mainReadiness";
// import type は型だけを読み込む書き方で、ビルド時に削除される
import type { Player } from "@/lib/types";

export default function MainPage() {
  // 複数の画面で使う情報の設定
  const [socket, setSocket] = useState<Socket | null>(null);
  const [currentMode, setCurrentMode] = useState("waiting");
  const [displayText, setDisplayText] = useState("まだ変更されていません");
  const [players, setPlayers] = useState<Player[]>([]); // プレイヤー一覧状態
  // Main を覆う表示（待機画面・ブランク。2026-11-04）。覆っている間はラウンドの画面を出さない。
  // 覆いを外すとラウンドの画面がはじめから表示され、登場の演出もそのときに再生される
  const [cover] = useMainCover(socket);
  // 表示の準備（必要なデータがそろっているか）を Admin に報告する（2026-11-06。lib/mainReadiness.js）
  const readiness = useMainReadinessHost(socket, currentMode, cover.kind !== "none");

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

    // つなぎ直したときは選手データを DB から読み直す。切れている間の更新の配信は受け取れていないので、
    // 読み直さないと、次の更新が来るまで会場の得点が古いままになる(2026-11-04)
    const reloadPlayers = () => {
      fetch("/api/secondRound/loadPlayers")
        .then((res) => res.json())
        .then((data) => { if (data.success) setPlayers(data.allPlayers); })
        .catch((err) => console.error("Failed to reload players", err));
    };
    newSocket.io.on("reconnect", reloadPlayers);


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
    cover.kind !== "none" ||
    currentMode === "1stRound" ||
    currentMode === "1stRoundResult" ||
    currentMode === "secondRound" ||
    currentMode === "extraRound" ||
    currentMode === "semifinal" ||
    currentMode === "final" ||
    currentMode === "paperTop100"
      ? "bg-black"
      : "bg-zinc-50 dark:bg-zinc-900";

  return (
    <MainReadyContext.Provider value={readiness}>
    <div className={`flex flex-col items-center justify-center min-h-screen p-[3vw] ${backgroundClass} relative`}>
      {/* 待機画面・ブランクで覆っている間は、ラウンドの画面を出さない */}
      {cover.kind === "standby" && <StandbyScreen title={cover.title} sub={cover.sub} />}
      {cover.kind === "blank" && <BlankScreen />}
      {cover.kind === "none" && (<>
      {currentMode === "1stRound" && <MainFirstRound socket={socket} />}
      {/* 1st Round の集計中は、次の 2nd Round の待機画面（2026-11-04 ユーザー指示） */}
      {currentMode === "1stRoundResult" && <StandbyScreen title="2nd Round" />}
      {currentMode === "secondRound" && <MainSecondRound players={players} socket={socket} setPlayers={setPlayers} />}
      {currentMode === "thirdRound" && <MainThirdRound players={players} socket={socket} setPlayers={setPlayers} />}
      {currentMode === "extraRound" && <MainExtraRound socket={socket} />}
      {currentMode === "semifinal" && <MainSemifinal socket={socket} />}
      {currentMode === "final" && <MainFinal socket={socket} />}
      {/* ペーパークイズ上位100名の発表（大会終了後。2026-10-31） */}
      {currentMode === "paperTop100" && <MainPaperTop socket={socket} />}
      {currentMode === "waiting" && <MainText text={displayText} />}
      </>)}
    </div>
    </MainReadyContext.Provider>
  );
}
