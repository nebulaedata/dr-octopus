/**
 * @author Codex
 * @description Manages access grants independently of client configuration and optional downloads.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@octopus/ui/components/button';
import { toast } from '@octopus/ui/components/toast';
import { Input } from '@octopus/ui/components/input';
import { Checkbox } from '@octopus/ui/components/checkbox';
import { ConnectionBadge } from './ConnectionBadge';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
  FieldDescription,
} from '@octopus/ui/components/field';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@octopus/ui/components/select';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@octopus/ui/components/dialog';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@octopus/ui/components/collapsible';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from '@octopus/ui/components/dropdown-menu';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@octopus/ui/components/empty';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { PlusIcon, MoreHorizontalIcon, ChevronRightIcon, CircleAlertIcon } from 'lucide-react';
import { runtimeStatusQuery } from '@/queries/runtime-queries';
import { accessQuery } from '@/queries/access-queries';
import { approveAccess, revokeAccess } from '@/api/executor';
import { ClientConfiguration } from './ClientConfiguration';
import type { ExecutorPermission } from '../../../../contracts/access';

const permissions = [
  ['files.read', '读取与搜索文件'],
  ['files.write', '写入与编辑文件（包含读取）'],
  ['shell.execute', '运行 PowerShell 命令'],
  ['browser', '控制浏览器网页'],
  ['computer.observe', '查看桌面'],
  ['computer.control', '控制桌面（包含查看）'],
] as const;
const permissionLabels: Record<ExecutorPermission, string> = {
  'files.read': '读取与搜索文件',
  'files.write': '写入与编辑文件',
  'shell.execute': '运行 PowerShell 命令',
  browser: '控制浏览器网页',
  'computer.observe': '查看桌面',
  'computer.control': '控制桌面',
};

/**
 * Keeps draft permissions in the creation dialog and opens setup only after an explicit configuration action.
 */
export function DeviceAccess({ ready }: { ready: boolean }) {
  const cache = useQueryClient();
  const runtime = useQuery(runtimeStatusQuery);
  const computerReady = ready && runtime.data?.capabilities.computer.available === true;
  const query = useQuery({ ...accessQuery, enabled: ready, refetchInterval: 2000 });
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<{ clientId: string; label: string } | null>(null);
  const [label, setLabel] = useState('本机智能体');
  const [selected, setSelected] = useState<ExecutorPermission[]>(['files.read']);
  const [budget, setBudget] = useState(120000);
  const approve = useMutation({
    mutationFn: approveAccess,
    networkMode: 'always',
    retry: false,
    onSuccess: (snapshot) => {
      cache.setQueryData(accessQuery.queryKey, snapshot);
      setCreating(false);
      toast.add({
        id: 'access-grant',
        type: 'success',
        title: '授权已创建',
        description: '点击“配置客户端”完成接入。',
      });
    },
    onSettled: () => cache.invalidateQueries({ queryKey: accessQuery.queryKey }),
  });
  const revoke = useMutation({
    mutationFn: revokeAccess,
    networkMode: 'always',
    retry: false,
    onSuccess: (snapshot) => {
      cache.setQueryData(accessQuery.queryKey, snapshot);
      setRevoking(null);
      setExpanded(null);
      cache.removeQueries({ queryKey: ['executor', 'client-configuration'] });
      toast.add({ id: 'access-grant', type: 'success', title: '授权已撤销' });
    },
    onSettled: () => cache.invalidateQueries({ queryKey: accessQuery.queryKey }),
  });
  const busy = approve.isPending || revoke.isPending;
  const error = query.error ?? revoke.error;
  return (
    <section aria-label="访问授权" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-3xl font-semibold tracking-tight">连接管理</h1>
          <p className="text-sm text-muted-foreground">创建访问授权，再在客户端配置 MCP。</p>
        </div>
        <Dialog
          open={creating}
          onOpenChange={(open) => {
            if (!approve.isPending) {
              setCreating(open);
              if (open) {
                approve.reset();
                setLabel('本机智能体');
                setSelected(['files.read']);
                setBudget(120000);
              }
            }
          }}
        >
          <DialogTrigger render={<Button disabled={!ready || busy || !query.data} />}>
            <PlusIcon data-icon="inline-start" />
            创建授权
          </DialogTrigger>
          <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
            <DialogHeader>
              <DialogTitle>创建访问授权</DialogTitle>
              <DialogDescription>选择客户端可使用的本机能力，创建后再配置客户端。</DialogDescription>
            </DialogHeader>
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                approve.mutate({ label, permissions: selected, waitBudgetMs: budget });
              }}
            >
              <FieldGroup>
                <Field data-disabled={busy}>
                  <FieldLabel htmlFor="authorization-name">授权名称</FieldLabel>
                  <Input
                    id="authorization-name"
                    name="authorization-name"
                    autoComplete="off"
                    value={label}
                    maxLength={100}
                    required
                    disabled={busy}
                    onChange={(event) => setLabel(event.target.value)}
                  />
                </Field>
                <FieldSet disabled={busy}>
                  <FieldLegend>允许的能力</FieldLegend>
                  <FieldGroup className="gap-3">
                    {permissions.map(([permission, text]) => (
                      <Field
                        key={permission}
                        orientation="horizontal"
                        data-disabled={
                          busy ||
                          (permission === 'browser' && !query.data?.browser.enabled) ||
                          (permission.startsWith('computer.') && !computerReady)
                        }
                      >
                        <Checkbox
                          id={permission}
                          disabled={
                            busy ||
                            (permission === 'browser' && !query.data?.browser.enabled) ||
                            (permission.startsWith('computer.') && !computerReady)
                          }
                          checked={selected.includes(permission)}
                          onCheckedChange={(checked) =>
                            setSelected((current) =>
                              checked
                                ? [...current, permission]
                                : current.filter((value) => value !== permission)
                            )
                          }
                        />
                        <FieldLabel htmlFor={permission}>{text}</FieldLabel>
                      </Field>
                    ))}
                  </FieldGroup>
                  {!query.data?.browser.enabled ? (
                    <FieldDescription>启用浏览器桥接后，可授权浏览器能力。</FieldDescription>
                  ) : null}
                  {selected.includes('shell.execute') ? (
                    <FieldDescription>
                      PowerShell 以当前 Windows 用户权限执行命令；执行目录由任务指定，不限制可访问的目录。
                    </FieldDescription>
                  ) : null}
                  {!computerReady ? (
                    <FieldDescription>桌面工具就绪后，可授权查看或控制桌面。</FieldDescription>
                  ) : null}
                  {selected.some((permission) => permission.startsWith('computer.')) ? (
                    <FieldDescription>
                      桌面能力作用于本机当前登录会话；控制桌面包含查看权限。
                    </FieldDescription>
                  ) : null}
                  <FieldDescription>授权适用于本设备，不限制工作区。</FieldDescription>
                </FieldSet>
                <Collapsible>
                  <CollapsibleTrigger render={<Button variant="ghost" className="group -ml-2.5" />}>
                    <ChevronRightIcon
                      data-icon="inline-start"
                      className="motion-safe:transition-transform group-aria-expanded:rotate-90"
                    />
                    高级选项
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-3">
                    <Field data-disabled={busy}>
                      <FieldLabel htmlFor="wait-budget">调用等待预算</FieldLabel>
                      <Select
                        items={[
                          { value: 120000, label: '120 秒' },
                          { value: 600000, label: '600 秒' },
                        ]}
                        value={budget}
                        disabled={busy}
                        onValueChange={(value) => {
                          if (value !== null) {
                            setBudget(value);
                          }
                        }}
                      >
                        <SelectTrigger id="wait-budget" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value={120000}>120 秒</SelectItem>
                            <SelectItem value={600000}>600 秒</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <FieldDescription>预留 10 秒用于停止与结果封装。</FieldDescription>
                    </Field>
                  </CollapsibleContent>
                </Collapsible>
              </FieldGroup>
              {approve.error ? (
                <Alert variant="destructive">
                  <CircleAlertIcon />
                  <AlertDescription>{approve.error.message}</AlertDescription>
                </Alert>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" disabled={busy} onClick={() => setCreating(false)}>
                  取消
                </Button>
                <Button
                  type="submit"
                  disabled={
                    !ready ||
                    busy ||
                    !selected.length ||
                    !label.trim() ||
                    (!computerReady && selected.some((permission) => permission.startsWith('computer.')))
                  }
                >
                  {approve.isPending ? '创建中…' : '创建授权'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      {query.data?.clients.length ? (
        <div className="flex flex-col gap-3" aria-label="访问授权列表">
          {query.data.clients.map((client) => (
            <Collapsible
              key={client.clientId}
              open={!client.revoked && expanded === client.clientId}
              onOpenChange={(open) => setExpanded(open ? client.clientId : null)}
              className="rounded-xl bg-muted/40 p-4"
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1 basis-40 sm:grid sm:grid-cols-[minmax(100px,160px)_minmax(0,1fr)] sm:items-center sm:gap-3">
                  <p className="truncate text-base font-semibold" title={client.label}>
                    {client.label}
                  </p>
                  <p
                    className="mt-1 min-w-0 truncate text-sm text-muted-foreground text-xs sm:mt-0"
                    title={client.permissions.map((permission) => permissionLabels[permission]).join(' · ')}
                  >
                    {client.permissions.map((permission) => permissionLabels[permission]).join(' · ')}
                  </p>
                </div>
                <ConnectionBadge variant={client.revoked ? 'secondary' : 'success'}>
                  {client.revoked ? '已撤销' : '已授权'}
                </ConnectionBadge>
                <div className="flex shrink-0 items-center gap-2">
                  <CollapsibleTrigger
                    render={<Button variant="ghost" disabled={client.revoked || busy} className="group" />}
                  >
                    配置客户端
                    <ChevronRightIcon
                      data-icon="inline-end"
                      className="motion-safe:transition-transform group-aria-expanded:rotate-90"
                    />
                  </CollapsibleTrigger>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={client.label + '的授权操作'}
                          disabled={client.revoked || busy}
                        />
                      }
                    >
                      <MoreHorizontalIcon />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          variant="destructive"
                          className="min-h-8"
                          onClick={() => {
                            approve.reset();
                            revoke.reset();
                            setRevoking({ clientId: client.clientId, label: client.label });
                          }}
                        >
                          撤销授权
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <CollapsibleContent className="pt-3">
                {!client.revoked && expanded === client.clientId ? (
                  <ClientConfiguration
                    clientId={client.clientId}
                    remoteAvailable={!!query.data.remoteEndpoint}
                    device={query.data.device}
                  />
                ) : null}
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      ) : (
        <Empty className="items-start bg-muted/40 p-5 md:p-5">
          <EmptyHeader className="items-start gap-1.5 text-left">
            <EmptyTitle>{query.isFetching ? '正在读取授权…' : '暂无访问授权'}</EmptyTitle>
            <EmptyDescription>创建授权后，可复制配置到智能体客户端。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {error ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : null}
      <Dialog
        open={!!revoking}
        onOpenChange={(open) => {
          if (!open && !revoke.isPending) {
            setRevoking(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>撤销访问授权</DialogTitle>
            <DialogDescription>撤销“{revoking?.label}”后，该客户端将无法继续使用本机工具。</DialogDescription>
          </DialogHeader>
          {revoke.error ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{revoke.error.message}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={revoke.isPending} onClick={() => setRevoking(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={revoke.isPending || !revoking}
              onClick={() => {
                if (revoking) {
                  revoke.mutate(revoking.clientId);
                }
              }}
            >
              {revoke.isPending ? '撤销中…' : '撤销授权'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
