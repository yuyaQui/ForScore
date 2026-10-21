import { useState } from "react";
import { Socket } from "socket.io-client";

type Props = {
    socket: Socket | null;
}

export default function AdminText({ socket }: Props) {
    const [text, setText] = useState("");

    const handleSend = () => {
        if (socket && text.trim() !== "") {
            socket.emit("update_text", text);
        }
    };

    return (
        < div className="flex flex-col gap-4 bg-white dark:bg-zinc-800 p-8 rounded-xl shadow-md w-full max-w-md" >
            <label className="text-sm font-bold text-zinc-700 dark:text-zinc-300">
                案内テキスト
            </label>
            <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="border border-zinc-300 dark:border-zinc-700 p-3 rounded-lg text-black bg-white dark:bg-zinc-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 h-32 resize-none"
                placeholder="案内テキスト"
            />
            <button
                onClick={handleSend}
                className="mt-2 bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-4 rounded-lg transition-colors"
            >
                反映する
            </button>
        </div >
    )
}