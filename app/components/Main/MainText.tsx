type Props = {
    text: string;
}

export default function MainText({ text }: Props) {
    return (
        <div className="text-3xl font-bold p-8 bg-white dark:bg-zinc-800 rounded-2xl shadow-xl text-blue-600 dark:text-blue-400 transition-all duration-300 w-full max-w-3xl text-center whitespace-pre-wrap leading-relaxed z-10 mb-8">
            {text}
        </div>
    )
}