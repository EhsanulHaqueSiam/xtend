/** Xtend's mark in `currentColor`; the same drawing as `assets/icon.svg`. Render one per page: its clip ids are fixed. */
export function XtendMark({ className }: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden className={className}>
      <defs>
        <clipPath id="xtend-mark-a">
          <path d="M0 0 H91.96 L0 91.96 Z" />
        </clipPath>
        <clipPath id="xtend-mark-b">
          <path d="M100 8.04 V100 H8.04 Z" />
        </clipPath>
        <path
          id="xtend-mark-leg"
          fillRule="evenodd"
          d="M22 37 H40 L72 69 H54 Z M31.6 41 L55.6 65 H62.4 L38.4 41 Z"
        />
      </defs>
      <g fill="currentColor">
        <path
          d="M80.83 40.69 A36 36 0 1 1 59.31 19.17"
          fill="none"
          stroke="currentColor"
          strokeWidth={5}
          strokeLinecap="round"
        />
        <use href="#xtend-mark-leg" clipPath="url(#xtend-mark-a)" />
        <use href="#xtend-mark-leg" clipPath="url(#xtend-mark-b)" />
        <path d="M26.5 69 H35.5 L90.5 14 H81.5 Z" />
      </g>
    </svg>
  );
}
