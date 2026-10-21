import type { Metadata } from "next";
import { Noto_Sans_JP, Geist_Mono } from "next/font/google";
import "./globals.css";

const notoSansJP = Noto_Sans_JP({
  variable: "--font-noto-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = { // Google 検索の時の説明文
  title: "KQK abc 得点表示",
  description: "KQK 主催の abc フォーマット大会で使用した得点表示アプリ",
};

export default function RootLayout({ // Web ページの一番大きい枠組
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${notoSansJP.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* 2026-10-03 ユーザー指摘: デザインアーティファクト(Cowork Design)では各画面が
          Google FontsのOrbitron/Rajdhaniを<link>で読み込んでいたが、実装側はこの2書体を
          どこにも読み込んでおらず、各コンポーネントのfontFamily:'Orbitron, sans-serif'等の
          指定が実際にはブラウザのデフォルトsans-serifにフォールバックしていた
          (fontWeight:900指定箇所も含め、アーティファクトと異なる見た目になっていた原因)。
          next/font/googleで読み込むとローカルな生成フォント名になり、既存の無数の
          インライン指定(リテラルの'Orbitron'/'Rajdhani'という名前を参照)をすべて
          書き換える必要が出てしまうため、アーティファクトと同じGoogle Fonts CSS APIの
          <link>読み込みで実フォント名を登録する方式に揃える(アーティファクトの読み込み
          方法をそのまま踏襲)。 */}
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* no-page-custom-fontはPages Router(_document.js)向けのルールで、「1ページにしか
            読み込まれない」ことを問題視している。App Routerではこのroot layout自体が
            _document.js相当の、全ページに適用される唯一の場所のため、ここでの指摘は
            該当しない(意図的な抑制)。 */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Orbitron:wght@700;800;900&family=Rajdhani:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

// 常に画面上部・下部にロゴを表示したい時とかにこのファイルをいじる