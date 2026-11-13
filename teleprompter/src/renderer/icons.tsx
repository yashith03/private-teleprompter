import type { ReactNode } from 'react';

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const PlayIcon = () => (
  <Svg>
    <polygon points="7 4 19 12 7 20 7 4" />
  </Svg>
);
export const PauseIcon = () => (
  <Svg>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </Svg>
);
export const RestartIcon = () => (
  <Svg>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </Svg>
);
export const EditIcon = () => (
  <Svg>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </Svg>
);
export const CheckIcon = () => <Svg><polyline points="20 6 9 17 4 12" /></Svg>;
export const SettingsIcon = () => (
  <Svg>
    <line x1="4" y1="6" x2="7" y2="6" />
    <line x1="11" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="13" y2="12" />
    <line x1="17" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="6" y2="18" />
    <line x1="10" y1="18" x2="20" y2="18" />
    <circle cx="9" cy="6" r="2" />
    <circle cx="15" cy="12" r="2" />
    <circle cx="8" cy="18" r="2" />
  </Svg>
);
export const ShieldIcon = ({ on }: { on: boolean }) => (
  <Svg>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    {on && <polyline points="8.5 12 11 14.5 15.5 9.5" />}
  </Svg>
);
export const MinimizeIcon = () => (
  <Svg>
    <line x1="5" y1="12" x2="19" y2="12" />
  </Svg>
);
export const CloseIcon = () => (
  <Svg>
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </Svg>
);
