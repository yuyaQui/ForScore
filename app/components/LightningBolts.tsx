/**
 * 選手カード登場時の電撃エフェクト（複数の不規則なジグザグ線が非同期に明滅する）。
 * Design アーティファクトで作った線の座標・色・タイミングをそのまま移植している。
 * @keyframes boltFlicker は app/globals.css 側で共通定義している。
 *
 * Vertical: Quiz View（縦長カード）向け、viewBox 64×150、8本。
 * Horizontal: Turn Over（横長カード）向け、viewBox 150×150、16本。
 */

export function LightningBoltsVertical() {
    return (
        <svg width="100%" height="100%" viewBox="0 0 64 150" preserveAspectRatio="none" style={{ overflow: "visible" }}>
            <path d="M4 0 L-1 15 L9 20 L2 38 L10 45 L3 62 L11 70 L4 92 L12 100 L5 118 L11 135 L4 150" fill="none" stroke="#7FE8FF" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" style={{ filter: "drop-shadow(0 0 5px #7FE8FF) drop-shadow(0 0 12px #33C6FF)", animation: "boltFlicker .45s steps(3) infinite" }} />
            <path d="M12 0 L18 12 L8 22 L16 40 L6 52 L14 68 L10 90 L14 100" fill="none" stroke="#AEEFFF" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" style={{ opacity: .8, filter: "drop-shadow(0 0 4px #AEEFFF)", animation: "boltFlicker .3s steps(2) infinite reverse", animationDelay: ".05s" }} />
            <path d="M20 0 L26 16 L14 28 L24 47 L12 58 L22 79 L16 100 L26 122 L20 150" fill="none" stroke="#5CD6FF" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" style={{ filter: "drop-shadow(0 0 5px #5CD6FF) drop-shadow(0 0 12px #33C6FF)", animation: "boltFlicker .55s steps(4) infinite", animationDelay: ".12s" }} />
            <path d="M28 20 L22 38 L30 50 L20 70 L28 88 L18 110 L28 130 L24 150" fill="none" stroke="#FFFFFF" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" style={{ opacity: .7, animation: "boltFlicker .25s steps(2) infinite reverse", animationDelay: ".2s" }} />
            <path d="M36 0 L30 14 L40 19 L28 37 L38 44 L42 61 L30 70 L36 92 L26 101 L38 118 L32 135 L36 150" fill="none" stroke="#6FE0FF" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" style={{ filter: "drop-shadow(0 0 5px #6FE0FF) drop-shadow(0 0 12px #33C6FF)", animation: "boltFlicker .4s steps(3) infinite", animationDelay: ".08s" }} />
            <path d="M44 0 L50 12 L40 22 L48 40 L38 52 L46 68 L42 90" fill="none" stroke="#AEEFFF" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" style={{ opacity: .8, filter: "drop-shadow(0 0 4px #AEEFFF)", animation: "boltFlicker .35s steps(2) infinite reverse", animationDelay: ".15s" }} />
            <path d="M52 0 L58 16 L46 28 L56 47 L44 58 L54 79 L48 100 L58 122 L52 150" fill="none" stroke="#7FE8FF" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" style={{ filter: "drop-shadow(0 0 5px #7FE8FF) drop-shadow(0 0 12px #33C6FF)", animation: "boltFlicker .5s steps(4) infinite", animationDelay: ".03s" }} />
            <path d="M60 25 L54 42 L62 55 L52 75 L60 92 L50 115 L60 132 L56 150" fill="none" stroke="#FFFFFF" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" style={{ opacity: .7, animation: "boltFlicker .28s steps(2) infinite reverse", animationDelay: ".22s" }} />
        </svg>
    );
}

export function LightningBoltsHorizontal() {
    return (
        <svg width="100%" height="100%" viewBox="0 0 150 150" preserveAspectRatio="none" style={{ overflow: "visible" }}>
            <path d="M0 5 L15 -1 L20 11 L38 3 L45 13 L62 4 L70 14 L92 5 L100 15 L118 6 L135 14 L150 5" fill="none" stroke="#7FE8FF" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" style={{ filter: "drop-shadow(0 0 5px #7FE8FF) drop-shadow(0 0 12px #33C6FF)", animation: "boltFlicker .45s steps(3) infinite" }} />
            <path d="M0 15 L12 23 L22 10 L40 20 L52 8 L68 18 L90 13 L100 18" fill="none" stroke="#AEEFFF" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" style={{ opacity: .8, filter: "drop-shadow(0 0 4px #AEEFFF)", animation: "boltFlicker .3s steps(2) infinite reverse", animationDelay: ".05s" }} />
            <path d="M0 25 L16 33 L28 18 L47 30 L58 15 L79 28 L100 20 L122 33 L150 25" fill="none" stroke="#5CD6FF" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" style={{ filter: "drop-shadow(0 0 5px #5CD6FF) drop-shadow(0 0 12px #33C6FF)", animation: "boltFlicker .55s steps(4) infinite", animationDelay: ".12s" }} />
            <path d="M20 35 L38 28 L50 38 L70 25 L88 35 L110 23 L130 35 L150 30" fill="none" stroke="#FFFFFF" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" style={{ opacity: .7, animation: "boltFlicker .25s steps(2) infinite reverse", animationDelay: ".2s" }} />
            <path d="M0 45 L14 38 L19 50 L37 35 L44 48 L61 53 L70 38 L92 45 L101 33 L118 48 L135 40 L150 45" fill="none" stroke="#6FE0FF" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" style={{ filter: "drop-shadow(0 0 5px #6FE0FF) drop-shadow(0 0 12px #33C6FF)", animation: "boltFlicker .4s steps(3) infinite", animationDelay: ".08s" }} />
            <path d="M0 55 L12 63 L22 50 L40 60 L52 48 L68 58 L90 53" fill="none" stroke="#AEEFFF" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" style={{ opacity: .8, filter: "drop-shadow(0 0 4px #AEEFFF)", animation: "boltFlicker .35s steps(2) infinite reverse", animationDelay: ".15s" }} />
            <path d="M0 65 L16 73 L28 58 L47 70 L58 55 L79 68 L100 60 L122 73 L150 65" fill="none" stroke="#7FE8FF" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" style={{ filter: "drop-shadow(0 0 5px #7FE8FF) drop-shadow(0 0 12px #33C6FF)", animation: "boltFlicker .5s steps(4) infinite", animationDelay: ".03s" }} />
            <path d="M25 75 L42 68 L55 78 L75 65 L92 75 L115 63 L132 75 L150 70" fill="none" stroke="#FFFFFF" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" style={{ opacity: .7, animation: "boltFlicker .28s steps(2) infinite reverse", animationDelay: ".22s" }} />
            <path d="M0 83 L15 76 L20 89 L38 80 L45 90 L62 81 L70 91 L92 83 L100 93 L118 84 L135 91 L150 83" fill="none" stroke="#7FE8FF" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" style={{ filter: "drop-shadow(0 0 5px #7FE8FF) drop-shadow(0 0 12px #33C6FF)", animation: "boltFlicker .48s steps(3) infinite", animationDelay: ".1s" }} />
            <path d="M0 93 L12 100 L22 88 L40 98 L52 85 L68 95 L90 90 L100 95" fill="none" stroke="#AEEFFF" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" style={{ opacity: .8, filter: "drop-shadow(0 0 4px #AEEFFF)", animation: "boltFlicker .32s steps(2) infinite reverse", animationDelay: ".18s" }} />
            <path d="M0 103 L16 110 L28 95 L47 108 L58 93 L79 105 L100 98 L122 110 L150 103" fill="none" stroke="#6FE0FF" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" style={{ filter: "drop-shadow(0 0 5px #6FE0FF) drop-shadow(0 0 12px #33C6FF)", animation: "boltFlicker .52s steps(4) infinite", animationDelay: ".06s" }} />
            <path d="M20 113 L38 105 L50 115 L70 103 L88 113 L110 100 L130 113 L150 108" fill="none" stroke="#FFFFFF" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" style={{ opacity: .7, animation: "boltFlicker .27s steps(2) infinite reverse", animationDelay: ".25s" }} />
            <path d="M0 120 L15 114 L20 126 L38 118 L45 128 L62 119 L70 129 L92 120 L100 130 L118 121 L135 129 L150 120" fill="none" stroke="#7FE8FF" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" style={{ filter: "drop-shadow(0 0 5px #7FE8FF) drop-shadow(0 0 12px #33C6FF)", animation: "boltFlicker .45s steps(3) infinite", animationDelay: ".13s" }} />
            <path d="M0 128 L12 135 L22 123 L40 133 L52 120 L68 130 L90 125 L100 130" fill="none" stroke="#AEEFFF" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" style={{ opacity: .8, filter: "drop-shadow(0 0 4px #AEEFFF)", animation: "boltFlicker .3s steps(2) infinite reverse", animationDelay: ".21s" }} />
            <path d="M0 133 L16 140 L28 125 L47 138 L58 123 L79 135 L100 128 L122 140 L150 133" fill="none" stroke="#6FE0FF" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" style={{ filter: "drop-shadow(0 0 5px #6FE0FF) drop-shadow(0 0 12px #33C6FF)", animation: "boltFlicker .55s steps(4) infinite", animationDelay: ".09s" }} />
            <path d="M20 140 L38 133 L50 143 L70 130 L88 140 L110 128 L130 140 L150 135" fill="none" stroke="#FFFFFF" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" style={{ opacity: .7, animation: "boltFlicker .25s steps(2) infinite reverse", animationDelay: ".28s" }} />
        </svg>
    );
}
