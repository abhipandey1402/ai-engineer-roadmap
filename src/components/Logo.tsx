/**
 * Brand mark: a winding roadmap from a start node to an orange destination.
 * Tile and path swap with the theme (black tile in light mode, white in dark).
 */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--fg)" />
      <path
        d="M9 23.5 C9 16.5 23 16 23 9.5"
        stroke="var(--bg)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="9" cy="23.5" r="2.6" fill="var(--bg)" />
      <circle cx="23" cy="9.5" r="3.8" fill="var(--accent)" />
    </svg>
  )
}
