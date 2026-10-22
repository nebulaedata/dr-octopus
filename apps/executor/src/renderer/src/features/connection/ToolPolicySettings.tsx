/**
 * @author Codex
 * @description Presents one compact policy selector and opens detached policy editing without mixing listener drafts.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PencilIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { Field, FieldContent, FieldLabel, FieldDescription } from '@octopus/ui/components/field';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
} from '@octopus/ui/components/select';
import { Tooltip, TooltipTrigger, TooltipContent } from '@octopus/ui/components/tooltip';
import { toast } from '@octopus/ui/components/toast';
import { toolPoliciesQuery } from '@/queries/tool-policy-queries';
import { saveToolPolicies } from '@/api/tool-policies';
import { ToolPolicyEditor, type PolicyDraft } from './ToolPolicyEditor';

/**
 * Applies explicit policy choices immediately and keeps uncertain publication visible until confirmed.
 */
export function ToolPolicySettings() {
  const query = useQuery(toolPoliciesQuery);
  const cache = useQueryClient();
  const [editor, setEditor] = useState<PolicyDraft | null>(null);
  const mutation = useMutation({
    mutationFn: saveToolPolicies,
    networkMode: 'always',
    retry: false,
    onSuccess: (data) => {
      cache.setQueryData(toolPoliciesQuery.queryKey, data);
      setEditor(null);
      toast.add({
        type: 'success',
        title: data.applied ? '工具策略已生效' : '工具策略已保存，将在服务启动后生效',
      });
    },
    onError: (error) => {
      void cache.invalidateQueries({ queryKey: toolPoliciesQuery.queryKey });
      toast.add({ type: 'error', title: error.message });
    },
  });
  const data = query.data;
  const settings = data?.settings;
  const options = [
    { value: 'readonly', label: '只读' },
    { value: 'all', label: '全部' },
    ...(settings?.custom.map((policy) => ({ value: policy.id, label: policy.name })) ?? []),
    { value: 'new', label: '新建策略…' },
  ];

  /**
   * Builds a local editor snapshot; built-in definitions are copied only through an explicit user action.
   */
  function openEditor(create = false) {
    if (!settings || !data) {
      return;
    }
    mutation.reset();
    const custom = settings.custom.find((policy) => policy.id === settings.selectedId);
    if (custom && !create) {
      setEditor({ ...structuredClone(custom), system: false });
      return;
    }
    const all = !create && settings.selectedId === 'all';
    let name = '新策略';
    let suffix = 2;
    while (settings.custom.some((policy) => policy.name === name)) {
      name = `新策略 ${suffix++}`;
    }
    setEditor({
      id: crypto.randomUUID(),
      name: create ? name : options.find((option) => option.value === settings.selectedId)!.label,
      enabledTools: data.tools.filter((tool) => all || tool.readOnly).map((tool) => tool.name),
      system: !create,
    });
  }

  return (
    <section aria-label="工具权限策略" className="flex flex-col gap-3">
      <Field className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <FieldContent>
          <FieldLabel htmlFor="tool-policy">
            <h2 className="text-xl font-semibold">工具权限策略</h2>
          </FieldLabel>
          <FieldDescription>控制客户端可以调用的工具。</FieldDescription>
        </FieldContent>
        <div className="flex items-center gap-2">
          <Select
            value={settings?.selectedId ?? 'readonly'}
            items={options}
            disabled={!settings || mutation.isPending}
            onValueChange={(id) => {
              if (id === 'new') {
                openEditor(true);
              } else if (id && settings && id !== settings.selectedId) {
                mutation.mutate({ ...settings, selectedId: id });
              }
            }}
          >
            <SelectTrigger id="tool-policy" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>系统策略</SelectLabel>
                <SelectItem value="readonly">只读</SelectItem>
                <SelectItem value="all">全部</SelectItem>
              </SelectGroup>
              {settings?.custom.length ? (
                <SelectGroup>
                  <SelectLabel>自定义策略</SelectLabel>
                  {settings.custom.map((policy) => (
                    <SelectItem key={policy.id} value={policy.id}>
                      {policy.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null}
              <SelectSeparator />
              <SelectGroup>
                <SelectItem value="new">新建策略…</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="编辑工具策略"
                  disabled={!settings || mutation.isPending}
                  onClick={() => openEditor()}
                />
              }
            >
              <PencilIcon />
            </TooltipTrigger>
            <TooltipContent>查看与编辑策略</TooltipContent>
          </Tooltip>
        </div>
      </Field>
      {query.error ? (
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
      ) : null}
      {data && !data.applied ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>已保存，尚未在服务中生效。</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(data.settings)}
          >
            重新应用
          </Button>
        </div>
      ) : null}
      {editor && settings && data ? (
        <ToolPolicyEditor
          initial={editor}
          settings={settings}
          tools={data.tools}
          pending={mutation.isPending}
          error={mutation.error?.message}
          onSave={(next) => mutation.mutate(next)}
          onClose={() => {
            setEditor(null);
            mutation.reset();
          }}
        />
      ) : null}
    </section>
  );
}
