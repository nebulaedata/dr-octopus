/**
 * @author Codex
 * @description Owns fixed alert layout, semantic status icons, content, actions and temporary dismissal through props.
 */
import { useState, type ComponentProps, type ReactNode } from 'react';
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon, XIcon } from 'lucide-react';
import { Alert as BaseAlert, AlertTitle, AlertDescription } from '@octopus/ui/components/alert';
import { Button } from '@octopus/ui/components/button';
import { cn } from '@octopus/ui/lib/utils';

export type AlertVariant = 'success' | 'warning' | 'danger' | 'info';

export type AlertProps = Omit<
  ComponentProps<typeof BaseAlert>,
  'variant' | 'title' | 'children' | 'dangerouslySetInnerHTML' | 'onClose'
> & {
  /** Semantic presentation; defaults to info. */
  variant?: AlertVariant;
  /** Optional heading above the description. */
  title?: ReactNode;
  /** Main notice content; the component owns its width and placement. */
  description: ReactNode;
  /** Shows the status icon; defaults to false. */
  showIcon?: boolean;
  /** Replaces the status icon when showIcon is true. */
  icon?: ReactNode;
  /** Optional supporting content below the description, such as expandable diagnostics. */
  details?: ReactNode;
  /** Business controls placed in the component-owned, wrapping, right-aligned action row. */
  action?: ReactNode;
  /** Allows dismissal until unmounted; defaults to false. No persistent storage is used. */
  allowClose?: boolean;
  /** Notifies the host of a button dismissal; hosts own notification removal and timers. */
  onClose?: () => void;
  /** Accessible close-button label; callers may localize it. */
  closeLabel?: string;
};

const variantClasses: Record<AlertVariant, string> = {
  success: 'border-success/30 bg-success/10 text-foreground',
  warning: 'border-warning/50 bg-warning/30 text-warning-foreground',
  danger: 'border-destructive/30 bg-destructive/10 text-destructive',
  info: 'border-border bg-muted/50 text-foreground',
};

const statusIcons: Record<AlertVariant, typeof InfoIcon> = {
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
  danger: CircleAlertIcon,
  info: InfoIcon,
};

/**
 * Keeps dismissal local to this instance, including across content and variant updates.
 * Remount with a new key when a new notice must become visible after dismissal.
 * Owns all layout: icons sit beside one shrinkable content column, with actions below its details.
 * Callers supply content through props rather than arranging primitive children.
 * Danger defaults to assertive alert semantics; other states default to status. Hosts may override role.
 */
export function Alert({
  variant = 'info',
  title,
  description,
  showIcon = false,
  icon,
  details,
  action,
  allowClose = false,
  onClose,
  closeLabel = 'Close alert',
  className,
  role = variant === 'danger' ? 'alert' : 'status',
  ...props
}: AlertProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const StatusIcon = statusIcons[variant];

  return (
    <BaseAlert
      {...props}
      role={role}
      data-variant={variant}
      className={cn(
        variantClasses[variant],
        'block min-w-0 wrap-anywhere backdrop-blur-xl',
        allowClose && 'pr-10',
        className
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        {showIcon ? (
          <span
            data-slot="alert-icon"
            aria-hidden="true"
            className={cn(
              'mt-0.5 flex size-4 shrink-0 items-center justify-center [&>svg]:size-4',
              variant === 'success' && 'text-success'
            )}
          >
            {icon ?? <StatusIcon />}
          </span>
        ) : null}
        <div data-slot="alert-content" className="flex min-w-0 flex-1 flex-col gap-2">
          {title != null ? <AlertTitle>{title}</AlertTitle> : null}
          <AlertDescription className="min-w-0 text-current">{description}</AlertDescription>
          {details != null ? (
            <div data-slot="alert-details" className="min-w-0">
              {details}
            </div>
          ) : null}
          {action != null ? (
            <div data-slot="alert-actions" className="flex min-w-0 flex-wrap justify-end gap-2">
              {action}
            </div>
          ) : null}
        </div>
      </div>
      {allowClose ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute top-1.5 right-1.5"
          aria-label={closeLabel}
          onClick={() => {
            setDismissed(true);
            onClose?.();
          }}
        >
          <XIcon aria-hidden="true" />
        </Button>
      ) : null}
    </BaseAlert>
  );
}
