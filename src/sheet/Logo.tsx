/** The Heroes Heaven brand mark — a "Heaven's gate" arch with a star in the opening. A single solid
 *  shape using currentColor, so it takes on whatever color (e.g. the theme accent) its parent sets. */
export function HeroesHeavenLogo({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fillRule="evenodd"
        d="M13 55 L13 30 C13 17 21 9 32 9 C43 9 51 17 51 30 L51 55 L42 55 L42 30 C42 23 38 18 32 18 C26 18 22 23 22 30 L22 55 Z"
      />
      <path d="M32 27 L34 32 L39 34 L34 36 L32 41 L30 36 L25 34 L30 32 Z" />
    </svg>
  );
}
