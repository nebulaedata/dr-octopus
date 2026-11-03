/**
 * @author Codex
 * @description Keeps agent conversation history and detail status wording, icons and badge variants consistent.
 */
import {
  LoaderCircleIcon,
  CheckCircleIcon,
  CircleAlertIcon,
  CircleMinusIcon,
  CirclePauseIcon,
  ClockIcon,
} from 'lucide-react';
import type { SkillSession } from '../../lib/builtin-agent/skill-session';

export const sessionStatus = {
  running: { label: '正在执行', icon: LoaderCircleIcon, variant: 'secondary' },
  waiting_user: { label: '等待回答', icon: ClockIcon, variant: 'secondary' },
  saving: { label: '尚未保存', icon: ClockIcon, variant: 'secondary' },
  outcome_unknown: { label: '结果待核实', icon: ClockIcon, variant: 'secondary' },
  completed: { label: '已完成', icon: CheckCircleIcon, variant: 'secondary' },
  failed: { label: '失败', icon: CircleAlertIcon, variant: 'destructive' },
  cancelled: { label: '已停止', icon: CircleMinusIcon, variant: 'secondary' },
  interrupted: { label: '已中断', icon: CirclePauseIcon, variant: 'secondary' },
} satisfies Record<
  SkillSession['status'],
  { label: string; icon: typeof ClockIcon; variant: 'secondary' | 'destructive' }
>;
