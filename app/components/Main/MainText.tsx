type Props = {
    text: string;
    // "1st Round 結果集計中..." など、1st Round のタイマー画面と同じ黒背景の流れで
    // 出す文言だけ、あちらと同じデザイン（角四角・#205359地に#FBFCF6文字）にするための切り替え。
    // 休憩画面など従来の呼び出しは何も指定しなければ今まで通りの見た目のまま
    variant?: "default" | "cyberpunk";
}

export default function MainText({ text, variant = "default" }: Props) {
    if (variant === "cyberpunk") {
        return (
            <div className="text-[4vw] font-bold p-[1.5vw] bg-[#205359] rounded-none shadow-[0_0_40px_rgba(162,215,221,0.5)] text-[#FBFCF6] w-[90%] text-center whitespace-pre-wrap leading-relaxed z-10">
                {text}
            </div>
        );
    }

    return (
        <div className="text-3xl font-bold p-8 bg-white dark:bg-zinc-800 rounded-2xl shadow-xl text-blue-600 dark:text-blue-400 transition-all duration-300 w-full max-w-3xl text-center whitespace-pre-wrap leading-relaxed z-10 mb-8">
            {text}
        </div>
    )
}