/**
 * @author Codex
 * @description Edits a detached tool policy draft with category navigation, scoped selection and explicit discard confirmation.
 */
import { useState } from 'react';
import { EllipsisIcon, SearchIcon, MinusIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { Checkbox } from '@octopus/ui/components/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@octopus/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from '@octopus/ui/components/dropdown-menu';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
  FieldSet,
  FieldLegend,
} from '@octopus/ui/components/field';
import { Input } from '@octopus/ui/components/input';
import { InputGroup, InputGroupInput, InputGroupAddon } from '@octopus/ui/components/input-group';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@octopus/ui/components/tabs';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@octopus/ui/components/select';
import { ScrollArea } from '@base-ui/react/scroll-area';
import { CSPProvider } from '@base-ui/react/csp-provider';
import { Separator } from '@octopus/ui/components/separator';
import { Tooltip, TooltipTrigger, TooltipContent } from '@octopus/ui/components/tooltip';
import { Empty, EmptyHeader, EmptyTitle } from '@octopus/ui/components/empty';
import { Spinner } from '@octopus/ui/components/spinner';
import {
  toolPolicySettingsSchema,
  type PolicyTool,
  type CustomToolPolicy,
  type ToolPolicySettings,
} from '../../../../contracts/tool-policy';

const groups = [
  { id: 'basic', label: '基础工具' },
  { id: 'control', label: '任务管理' },
  { id: 'transfer', label: '文件传输' },
  { id: 'browser', label: '浏览器工具' },
  { id: 'computer', label: '桌面控制' },
] as const;

export type PolicyDraft = CustomToolPolicy & { system: boolean };

/**
 * Keeps edits local until the single save-and-apply action succeeds; system presets remain immutable.
 */
export function ToolPolicyEditor({
  initial,
  settings: latestSettings,
  tools,
  pending,
  error,
  onSave,
  onClose,
}: {
  initial: PolicyDraft;
  settings: ToolPolicySettings;
  tools: PolicyTool[];
  pending: boolean;
  error?: string;
  onSave: (settings: ToolPolicySettings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [settings] = useState(latestSettings);
  const [category, setCategory] = useState('basic');
  const [search, setSearch] = useState('');
  const [confirmation, setConfirmation] = useState<'discard' | 'delete' | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const term = search.trim().toLocaleLowerCase();
  const matches = tools.filter((tool) =>
    `${tool.label} ${tool.name} ${tool.description}`.toLocaleLowerCase().includes(term)
  );
  const visible = matches.filter((tool) => tool.group === category);
  const allChecked = visible.length > 0 && visible.every((tool) => draft.enabledTools.includes(tool.name));
  const someChecked = visible.some((tool) => draft.enabledTools.includes(tool.name));
  const exists = settings.custom.some((policy) => policy.id === draft.id);
  const next = {
    ...settings,
    selectedId: draft.id,
    custom: [
      ...settings.custom.filter((policy) => policy.id !== draft.id),
      {
        id: draft.id,
        name: draft.name,
        enabledTools: draft.enabledTools,
      },
    ],
  };
  const validation = toolPolicySettingsSchema.safeParse(next);

  /**
   * Clones a preset or custom policy without mutating saved policies or silently switching the active selection.
   */
  function duplicate() {
    const base = `${draft.name.slice(0, 28)} 副本`;
    let name = base;
    let suffix = 2;
    while (settings.custom.some((policy) => policy.name === name)) {
      name = `${base} ${suffix++}`;
    }
    setDraft({ ...draft, id: crypto.randomUUID(), name, system: false });
  }

  /**
   * Changes only currently visible switches, preserving other categories and filtered-out tools.
   */
  function selectVisible(checked: boolean) {
    const names = new Set(draft.enabledTools);
    for (const tool of visible) {
      if (checked) {
        names.add(tool.name);
      } else {
        names.delete(tool.name);
      }
    }
    setDraft({ ...draft, enabledTools: [...names] });
  }

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !pending) {
            if (dirty) {
              setConfirmation('discard');
            } else {
              onClose();
            }
          }
        }}
      >
        <DialogContent
          className="flex h-[640px] max-h-[calc(100dvh-3rem)] flex-col gap-5 overflow-hidden p-6 sm:max-w-[820px]"
          showCloseButton={!pending}
        >
          <DialogHeader className="shrink-0 pr-8">
            <div className="flex items-center gap-2">
              <DialogTitle>{draft.system ? draft.name : '自定义策略'}</DialogTitle>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label="策略操作"
                      disabled={pending}
                    />
                  }
                >
                  <EllipsisIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={duplicate}>复制策略</DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={draft.system || !exists}
                      onClick={() => setConfirmation('delete')}
                    >
                      删除策略
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <DialogDescription className="sr-only">
              选择启用的工具。工具说明可通过悬停或键盘聚焦查看。
            </DialogDescription>
          </DialogHeader>
          {!draft.system ? (
            <FieldGroup className="shrink-0">
              <Field orientation="horizontal" data-invalid={!validation.success}>
                <FieldLabel htmlFor="policy-name" className="shrink-0 whitespace-nowrap">
                  策略名称
                </FieldLabel>
                <Input
                  id="policy-name"
                  value={draft.name}
                  maxLength={40}
                  disabled={pending}
                  aria-invalid={!validation.success}
                  aria-describedby={!validation.success ? 'policy-name-error' : undefined}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </Field>
              {!validation.success ? (
                <FieldError id="policy-name-error">{validation.error.issues[0]?.message}</FieldError>
              ) : null}
            </FieldGroup>
          ) : null}
          <Separator className="shrink-0" />
          <Tabs
            value={category}
            orientation="vertical"
            onValueChange={(value) => setCategory(String(value))}
            className="min-h-0 flex-1 flex-col gap-4 sm:flex-row sm:gap-6"
          >
            <div className="shrink-0 sm:hidden">
              <Select
                value={category}
                items={groups.map((group) => ({ value: group.id, label: group.label }))}
                onValueChange={(value) => {
                  if (value) {
                    setCategory(value);
                  }
                }}
              >
                <SelectTrigger aria-label="工具分类" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {groups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <TabsList className="hidden h-auto w-full shrink-0 justify-start sm:flex sm:w-44 sm:items-stretch">
              {groups.map((group) => {
                const names = tools.filter((tool) => tool.group === group.id);
                const selected = names.filter((tool) => draft.enabledTools.includes(tool.name)).length;
                return (
                  <TabsTrigger
                    key={group.id}
                    value={group.id}
                    className="flex-none justify-between gap-4 px-3 py-3"
                  >
                    {group.label}
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {selected} / {names.length}
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 sm:border-l sm:pl-6">
              <div className="flex shrink-0 items-center gap-4">
                <InputGroup>
                  <InputGroupInput
                    placeholder="搜索工具"
                    aria-label="搜索工具"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <InputGroupAddon>
                    <SearchIcon />
                  </InputGroupAddon>
                </InputGroup>
                <Field orientation="horizontal" className="w-auto shrink-0">
                  <span className="relative flex shrink-0">
                    <Checkbox
                      className="data-indeterminate:border-primary data-indeterminate:bg-primary [&[data-indeterminate]_[data-slot=checkbox-indicator]]:invisible"
                      id="policy-select-all"
                      checked={allChecked}
                      indeterminate={someChecked && !allChecked}
                      disabled={pending || draft.system || visible.length === 0}
                      onCheckedChange={selectVisible}
                    />
                    {someChecked && !allChecked ? (
                      <MinusIcon
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 size-4 text-primary-foreground"
                      />
                    ) : null}
                  </span>
                  <FieldLabel htmlFor="policy-select-all">全选</FieldLabel>
                </Field>
              </div>
              {groups.map((group) => (
                <TabsContent key={group.id} value={group.id} className="min-h-0 min-w-0 overflow-hidden">
                  <CSPProvider disableStyleElements>
                    <ScrollArea.Root className="relative h-full">
                      <ScrollArea.Viewport className="size-full [scrollbar-width:none] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-scrollbar]:hidden">
                        <FieldSet className="min-w-0 gap-0 px-1 pr-3">
                          <FieldLegend className="sr-only">{group.label}</FieldLegend>
                          {visible.map((tool) => (
                            <Field
                              key={tool.name}
                              orientation="horizontal"
                              className="rounded-lg px-2 py-3 hover:bg-muted/50"
                              data-disabled={pending || draft.system}
                            >
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <button
                                      type="button"
                                      className="min-w-0 flex-1 rounded-sm text-left outline-offset-4"
                                      aria-label={`${tool.label}说明`}
                                    />
                                  }
                                >
                                  <span className="block font-medium">{tool.label}</span>
                                  <span className="block truncate font-mono text-xs text-muted-foreground">
                                    {tool.name}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>{tool.description}</TooltipContent>
                              </Tooltip>
                              <Checkbox
                                aria-label={tool.label}
                                checked={draft.enabledTools.includes(tool.name)}
                                disabled={pending || draft.system}
                                onCheckedChange={(checked) =>
                                  setDraft({
                                    ...draft,
                                    enabledTools: checked
                                      ? [...draft.enabledTools, tool.name]
                                      : draft.enabledTools.filter((name) => name !== tool.name),
                                  })
                                }
                              />
                            </Field>
                          ))}
                          {visible.length === 0 ? (
                            <Empty>
                              <EmptyHeader>
                                <EmptyTitle>没有匹配的工具</EmptyTitle>
                              </EmptyHeader>
                            </Empty>
                          ) : null}
                        </FieldSet>
                      </ScrollArea.Viewport>
                      <ScrollArea.Scrollbar
                        orientation="vertical"
                        className="flex h-full w-2.5 touch-none border-l border-l-transparent p-px select-none"
                      >
                        <ScrollArea.Thumb className="relative flex-1 rounded-full bg-border" />
                      </ScrollArea.Scrollbar>
                    </ScrollArea.Root>
                  </CSPProvider>
                </TabsContent>
              ))}
            </div>
          </Tabs>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter className="-mx-6 -mb-6 shrink-0 flex-row items-center justify-between px-6 sm:justify-between">
            <span className="text-sm text-muted-foreground">已启用 {draft.enabledTools.length} 项工具</span>
            {draft.system ? (
              <Button onClick={duplicate}>复制为自定义</Button>
            ) : (
              <Button
                disabled={pending || !validation.success || (!dirty && exists)}
                onClick={() => onSave(next)}
              >
                {pending ? <Spinner data-icon="inline-start" /> : null}保存并应用
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmation(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmation === 'delete' ? '删除这个策略？' : '放弃未保存的修改？'}</DialogTitle>
            <DialogDescription>
              {confirmation === 'delete' ? '删除后将使用系统的只读策略。' : '关闭后，本次工具选择不会保存。'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setConfirmation(null)}>
              继续编辑
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                if (confirmation === 'delete') {
                  onSave({
                    ...settings,
                    selectedId: 'readonly',
                    custom: settings.custom.filter((policy) => policy.id !== draft.id),
                  });
                  setConfirmation(null);
                } else {
                  onClose();
                }
              }}
            >
              {confirmation === 'delete' ? '删除并使用只读' : '放弃修改'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
