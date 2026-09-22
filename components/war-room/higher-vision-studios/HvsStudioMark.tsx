export function HvsStudioMark() {
  return (
    <svg
      viewBox="0 0 128 128"
      className="hvs-studio-mark h-full w-full"
      data-testid="hvs-home-app-icon-mark"
      role="img"
      aria-label="Higher Vision Studios"
    >
      <title>Higher Vision Studios</title>
      <defs>
        <radialGradient id="hvs-mark-bg" cx="38%" cy="30%" r="78%">
          <stop offset="0%" stopColor="#2a1a08" />
          <stop offset="42%" stopColor="#120c06" />
          <stop offset="100%" stopColor="#050302" />
        </radialGradient>
        <radialGradient id="hvs-mark-glass" cx="38%" cy="32%" r="68%">
          <stop offset="0%" stopColor="#8ef0ff" stopOpacity="0.55" />
          <stop offset="38%" stopColor="#1d6a78" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#071018" stopOpacity="0.92" />
        </radialGradient>
        <linearGradient id="hvs-mark-gold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f6e7c1" />
          <stop offset="45%" stopColor="#d4a017" />
          <stop offset="100%" stopColor="#8a5a12" />
        </linearGradient>
        <linearGradient id="hvs-mark-gold-soft" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#c9a227" />
          <stop offset="100%" stopColor="#f4e2b0" />
        </linearGradient>
        <filter id="hvs-mark-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect x="4" y="4" width="120" height="120" rx="18" fill="url(#hvs-mark-bg)" />
      <rect x="5.5" y="5.5" width="117" height="117" rx="16.5" fill="none" stroke="url(#hvs-mark-gold)" strokeWidth="1.4" opacity="0.9" />

      <g fill="none" stroke="url(#hvs-mark-gold-soft)" strokeWidth="2.1" strokeLinecap="square">
        <path d="M16 28 V18 H28" />
        <path d="M112 28 V18 H100" />
        <path d="M16 100 V110 H28" />
        <path d="M112 100 V110 H100" />
      </g>

      <g className="hvs-studio-mark-lens" filter="url(#hvs-mark-glow)">
        <circle cx="64" cy="56" r="36" fill="none" stroke="url(#hvs-mark-gold)" strokeWidth="3.6" />
        <circle cx="64" cy="56" r="30.5" fill="none" stroke="#67e8f9" strokeWidth="1.25" opacity="0.62" />
        <circle cx="64" cy="56" r="26" fill="url(#hvs-mark-glass)" />
        <g className="hvs-studio-mark-iris" fill="#0b1220" fillOpacity="0.48" stroke="#d4a017" strokeWidth="0.7">
          <path d="M64 32 L73 43 L64 48 L55 43 Z" />
          <path d="M88 46 L81 58 L70 53 L75 42 Z" />
          <path d="M88 66 L75 71 L70 59 L81 54 Z" />
          <path d="M64 80 L55 69 L64 64 L73 69 Z" />
          <path d="M40 66 L47 54 L58 59 L53 71 Z" />
          <path d="M40 46 L53 42 L58 53 L47 58 Z" />
        </g>
        <circle cx="64" cy="56" r="13.5" fill="#07141c" stroke="#f6e7c1" strokeWidth="1.35" />
        <path
          className="hvs-studio-mark-tree"
          d="M64 67 V55.5 M54 58 C54 49 59 44 64 47 C69 44 74 49 74 58 C69 61 64 61 64 55.5 C64 61 59 61 54 58 Z"
          fill="#f4e2b0"
          fillOpacity="0.22"
          stroke="#f6e7c1"
          strokeWidth="1.55"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx="53" cy="48" r="2.4" fill="#67e8f9" opacity="0.7" />
      </g>

      <g fill="url(#hvs-mark-gold)" opacity="0.85">
        <rect x="8" y="48" width="5" height="3.2" rx="0.6" />
        <rect x="8" y="56" width="5" height="3.2" rx="0.6" />
        <rect x="8" y="64" width="5" height="3.2" rx="0.6" />
        <rect x="115" y="48" width="5" height="3.2" rx="0.6" />
        <rect x="115" y="56" width="5" height="3.2" rx="0.6" />
        <rect x="115" y="64" width="5" height="3.2" rx="0.6" />
      </g>

      <g className="hvs-studio-mark-timeline">
        <rect x="18" y="96" width="92" height="12" rx="3" fill="#0a0704" stroke="url(#hvs-mark-gold)" strokeWidth="0.8" opacity="0.95" />
        <path
          d="M22 105 L26 101 L30 106 L35 99 L40 105 L46 98 L52 104 L58 97 L64 103 L70 98 L76 105 L82 100 L88 106 L94 99 L104 104"
          fill="none"
          stroke="#67e8f9"
          strokeWidth="0.9"
          opacity="0.7"
        />
        <rect className="hvs-studio-mark-playhead" x="61" y="97" width="2.2" height="10" rx="0.6" fill="#f6e7c1" />
      </g>
    </svg>
  )
}
