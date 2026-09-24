/**
 * @author Codex
 * @description Renders the 3D application logo at compact navigation sizes.
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
   * @default `${import.meta.env.BASE_URL}brand/logo-128.png`
   */
  imgSrc?: string;
  /**
   * Accessible text description of the logo.
   * @default 'Dr.Octopus logo'
   */
  alt?: string;
}

const logoSizeClasses: Record<NonNullable<LogoProps['size']>, { container: string; image: string }> = {
  xs: { container: 'size-7', image: 'size-6' },
  sm: { container: 'size-9', image: 'size-8' },
  lg: { container: 'size-11', image: 'size-10' },
};

const DEFAULT_LOGO_SRC = `${import.meta.env.BASE_URL}brand/logo-128.png`;

/**
 * Displays the 3D logo without adding highlights over the artwork.
 */
export function Logo({ size = 'sm', imgSrc = DEFAULT_LOGO_SRC, alt = 'Dr.Octopus logo' }: LogoProps) {
  const classes = logoSizeClasses[size];

  return (
    <span
      className={`group grid shrink-0 place-items-center rounded-xl bg-accent/70 shadow-sm ring-1 ring-border/50 transition-transform duration-200 hover:-translate-y-0.5 ${classes.container}`}
    >
      <img className={`object-contain ${classes.image}`} src={imgSrc} alt={alt} draggable={false} />
    </span>
  );
}
