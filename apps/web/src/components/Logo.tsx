/**
 * @author Codex
 * @description Renders the application logo inside a polished, dimensional accent container with light and shadow.
 */

export interface LogoProps {
  /**
   * Visual size of the logo.
   * - `xs`: small logo for compact chrome
   * - `sm`: default logo size matching the sidebar/header usage
   * - `lg`: large logo for prominent placements
   */
  size?: 'xs' | 'sm' | 'lg';
  /**
   * Source URL for the logo image.
   * @default `${import.meta.env.BASE_URL}logo-256.png`
   */
  imgSrc?: string;
  /**
   * Accessible text description of the logo.
   * @default 'logo'
   */
  alt?: string;
}

const logoSizeClasses: Record<NonNullable<LogoProps['size']>, { container: string; image: string }> = {
  xs: { container: 'size-7', image: 'size-6' },
  sm: { container: 'size-9', image: 'size-8' },
  lg: { container: 'size-11', image: 'size-10' },
};

const DEFAULT_LOGO_SRC = `${import.meta.env.BASE_URL}logo-256.png`;

/**
 * Displays the application logo with a glassy, light-aware accent backing and subtle depth.
 * The image itself is left untouched; all visual flair lives on the surrounding container.
 */
export function Logo({ size = 'sm', imgSrc = DEFAULT_LOGO_SRC, alt = 'logo' }: LogoProps) {
  const classes = logoSizeClasses[size];

  return (
    <span
      className={`
        group relative grid shrink-0 place-items-center overflow-hidden
        rounded-2xl bg-linear-to-br from-accent via-accent to-accent/75
        shadow-[0_12px_40px_-12px_hsl(var(--accent)/0.4),0_4px_12px_-4px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.25),inset_0_-1px_0_rgba(0,0,0,0.05)]
        ring-1 ring-white/15 ring-inset
        transition-all duration-500 ease-out
        hover:scale-[1.03] hover:-translate-y-0.5
        hover:shadow-[0_20px_50px_-16px_hsl(var(--accent)/0.5),0_8px_20px_-6px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-1px_0_rgba(0,0,0,0.05)]
        ${classes.container}
      `}
    >
      {/* Glossy top light source. */}
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-linear-to-b from-white/30 via-white/10 to-transparent" />

      {/* Grounding bottom reflection. */}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t from-black/10 to-transparent" />

      {/* Sweeping light ray that glides across the container on hover. */}
      <span className="pointer-events-none absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-white/20 to-transparent transition-transform duration-1000 ease-in-out group-hover:translate-x-full" />

      <img className={`relative z-10 object-contain ${classes.image}`} src={imgSrc} alt={alt} />
    </span>
  );
}
