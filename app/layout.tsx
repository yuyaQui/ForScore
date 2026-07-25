import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

// 常に画面上部・下部にロゴを表示したい時とかにこのファイルをいじる