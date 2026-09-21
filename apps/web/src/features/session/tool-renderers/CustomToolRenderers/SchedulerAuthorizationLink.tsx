/**
 * @author Codex
 * @description Links a historical Scheduler reminder to the current task authorization review.
 */
import { Link, useParams } from '@tanstack/react-router';
import { ArrowUpRightIcon } from 'lucide-react';
import { buttonVariants } from '@octopus/ui/components/button';
import { cn } from '@octopus/ui/lib/utils';
import { useI18n } from '@/i18n/use-i18n';

/**
 * Uses the owning Session workspace to open the task, falling back to task management without context.
 */
export function SchedulerAuthorizationLink({ taskId, className }: { taskId?: string; className?: string }) {
  const { t } = useI18n();
  const { workspaceId } = useParams({ strict: false });
  const canReview = Boolean(workspaceId && taskId);
  return (
    <Link
      to="/schedules"
      search={
        canReview
          ? { tab: 'tasks', authorizeWorkspaceId: workspaceId, authorizeTaskId: taskId }
          : { tab: 'tasks' }
      }
      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), className)}
    >
      {canReview
        ? t('session.schedulerAuth.review', 'Review and authorize')
        : t('session.schedulerAuth.open', 'Open scheduled tasks')}
      <ArrowUpRightIcon data-icon="inline-end" aria-hidden="true" />
    </Link>
  );
}
