/**
 * @author Codex
 * @description Presents uniform capability rows with concise copy and accessible dialogs for Runtime tool catalogs.
 */
import type { ComponentProps, ReactNode } from 'react';
import { ArrowUpDownIcon, ChevronRightIcon, MonitorCogIcon, WrenchIcon } from 'lucide-react';
import windowsIcon from '@/assets/platforms/windows.svg';
import { Button } from '@octopus/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@octopus/ui/components/dialog';
import type { AccessSnapshot } from '../../../../contracts/access';
import { BrowserBrandIcon } from './BrowserBrandIcon';
import { ConnectionBadge } from './ConnectionBadge';
import { ToolNameList } from './ToolNameList';

type Status = { label: string; variant: ComponentProps<typeof ConnectionBadge>['variant'] };
type RowProps = { title: string; description: string; icon: ReactNode; action: ReactNode };

/**
 * Aligns every capability's icon, description and trailing action on the same grid.
 */
function ToolRow({ title, description, icon, action }: RowProps) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div
        className="flex size-5 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-5"
        aria-hidden="true"
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

/**
 * Keeps tool names out of the overview while preserving live lists, unavailable states and focus restoration.
 */
function ToolDialogRow({
  title,
  description,
  icon,
  status,
  groups,
  note,
  summary,
}: Omit<RowProps, 'action'> & {
  status: Status;
  groups: { title: string; names: string[] }[];
  note: string;
  summary?: string;
}) {
  return (
    <Dialog>
      <ToolRow
        title={title}
        description={description}
        icon={icon}
        action={
          <DialogTrigger render={<Button variant="ghost" className="shrink-0" aria-label={`查看${title}`} />}>
            {summary && <span className="text-muted-foreground">{summary}</span>}
            <ConnectionBadge variant={status.variant}>{status.label}</ConnectionBadge>
            <ChevronRightIcon data-icon="inline-end" />
          </DialogTrigger>
        }
      />
      <DialogContent className="max-h-[calc(100dvh-4rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <section key={group.title} aria-label={group.title} className="flex flex-col gap-2">
              <h4 className="text-sm font-medium">
                {group.title}
                {group.names.length ? ` · ${group.names.length} 项` : ''}
              </h4>
              {group.names.length ? (
                <ToolNameList names={group.names} />
              ) : (
                <p className="text-sm text-muted-foreground">暂未取得工具清单，请等待执行服务就绪。</p>
              )}
            </section>
          ))}
          <p className="text-xs leading-relaxed text-muted-foreground">{note}</p>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>关闭</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Uses Runtime-provided names and status without executing tools or inferring remote client installation.
 */
export function ToolOverview({
  catalog,
  browser,
  computer,
  onManageBrowser,
}: {
  catalog: AccessSnapshot['toolCatalog'];
  browser: Status & { description: string };
  computer: Status & { description: string };
  onManageBrowser: () => void;
}) {
  /**
   * Counts only the current service catalog and does not claim that any individual tool was executed.
   */
  const registration = (names: string[] | undefined): Status => ({
    label: names?.length ? `${names.length} 项已注册` : '未就绪',
    variant: names?.length ? 'success' : 'secondary',
  });
  const note = '清单由执行服务提供，实际调用取决于客户端授权和连接状态。已注册不代表逐项执行验证。';
  return (
    <section aria-label="工具与桥接" className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">工具与桥接</h2>
      <ToolDialogRow
        title="基础工具"
        description="读取和编辑文件、搜索内容，以及运行命令。"
        icon={<WrenchIcon />}
        status={registration(catalog?.basic)}
        groups={[{ title: '工具清单', names: catalog?.basic ?? [] }]}
        note={note}
      />
      <ToolDialogRow
        title="文件传输"
        description="在智能体与执行器之间上传、下载文件并管理传输。"
        icon={<ArrowUpDownIcon />}
        status={registration(catalog?.transfer)}
        groups={[{ title: '工具清单', names: catalog?.transfer ?? [] }]}
        note="直接通过 MCP 准备和管理传输，再使用智能体已有本地 HTTP 工具发送或接收文件，无需额外客户端。没有本地文件传输能力不要调用；实际调用仍受文件权限和磁盘额度限制。"
      />
      <ToolDialogRow
        title="任务管理"
        description="查看执行状态，创建、结束或停止任务。"
        icon={<MonitorCogIcon />}
        status={registration(catalog?.control)}
        groups={[{ title: '工具清单', names: catalog?.control ?? [] }]}
        note={note}
      />
      <ToolDialogRow
        title="桌面控制工具"
        description="查看本机桌面，控制窗口、鼠标与键盘。"
        icon={<img src={windowsIcon} alt="" className="size-5 object-contain rounded-xs" />}
        status={computer}
        summary={catalog?.computer ? '支持 ' + catalog.computer.length + ' 项' : '清单读取中'}
        groups={[{ title: '工具清单', names: catalog?.computer ?? [] }]}
        note={`当前状态：${computer.label}。${computer.description} 支持数量来自产品目录；客户端实际可用工具取决于授权和后端状态。`}
      />
      <ToolRow
        title="浏览器桥接"
        description={browser.description}
        icon={
          <div className="relative size-5">
            <span className="absolute top-0 left-0 [&>img]:size-3.5">
              <BrowserBrandIcon browser="chrome" />
            </span>
            <span className="absolute right-0 bottom-0 rounded-full bg-background ring-1 ring-background [&>img]:size-3.5">
              <BrowserBrandIcon browser="edge" />
            </span>
          </div>
        }
        action={
          <Button variant="ghost" className="shrink-0" aria-label="管理浏览器桥接" onClick={onManageBrowser}>
            <ConnectionBadge variant={browser.variant}>{browser.label}</ConnectionBadge>
            <ChevronRightIcon data-icon="inline-end" />
          </Button>
        }
      />
    </section>
  );
}
