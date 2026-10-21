type Props = {
    text: string;
    // "1st Round 結果集計中..." など、1st Round のタイマー画面と同じ黒背景の流れで
    // 出す文言だけ、あちらと同じデザイン（角四角・#0C1628地に#F3FAFF文字・#2F7BFF枠）にするための切り替え。
    // 休憩画面など従来の呼び出しは何も指定しなければ今まで通りの見た目のまま
    variant?: "default" | "cyberpunk";
}

export default function MainText({ text, variant = "default" }: Props) {
    if (variant === "cyberpunk") {
        return (
            <div className="text-[4vw] font-bold p-[1.5vw] bg-[#0C1628] border-2 border-[#2F7BFF] rounded-none shadow-[0_0_40px_rgba(47,123,255,0.45)] text-[#F3FAFF] w-[90%] text-center whitespace-pre-wrap leading-relaxed z-10">
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