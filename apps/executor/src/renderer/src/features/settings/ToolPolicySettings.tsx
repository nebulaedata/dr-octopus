/**
 * @author Codex
 * @description Edits the settings page policy draft without publishing selection or editor changes.
 */
import { Alert } from '@octopus/custom-ui/components/alert';
import { useState } from 'react';
import { PencilIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { FieldContent, FieldLabel, FieldDescription } from '@octopus/ui/components/field';
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
import type { ToolPolicySettings as PolicySettings, PolicyTool } from '../../../../contracts/tool-policy';
import { SettingsField } from './SettingsField';
import { SettingsEffectBadge } from './SettingsEffectBadge';
import { ToolPolicyEditor, type PolicyDraft } from './ToolPolicyEditor';

/**
 * Returns policy edits to the shared page draft; persistence belongs exclusively to Save settings.
 */
export function ToolPolicySettings({
  settings,
  changed,
  tools,
  disabled,
  error,
  onChange,
}: {
  settings: PolicySettings;
  changed: boolean;
  tools: PolicyTool[];
  disabled: boolean;
  error?: string;
  onChange: (settings: PolicySettings) => void;
}) {
  const [editor, setEditor] = useState<PolicyDraft | null>(null);
  const options = [
    { value: 'readonly', label: '只读' },
    { value: 'all', label: '全部' },
    ...settings.custom.map((policy) => ({ value: policy.id, label: policy.name })),
    { value: 'new', label: '新建策略…' },
  ];

  /**
   * Builds a local editor snapshot; built-in definitions are copied only through an explicit user action.
   */
  function openEditor(create = false) {
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
      enabledTools: tools.filter((tool) => all || tool.readOnly).map((tool) => tool.name),
      system: !create,
    });
  }

  return (
    <section aria-labelledby="tool-policy-heading" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="tool-policy-heading" className="text-xl font-semibold">
          工具权限策略
        </h2>
        <SettingsEffectBadge setting="toolPolicy" />
      </div>
      <SettingsField
        changed={changed}
        className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
        data-disabled={disabled}
      >
        <FieldContent>
          <FieldLabel htmlFor="tool-policy">工具策略</FieldLabel>
          <FieldDescription>与其他设置一起保存，完整重启后生效。</FieldDescription>
        </FieldContent>
        <div className="flex min-w-0 w-full max-w-60 items-center gap-2 sm:justify-self-end">
          <Select
            value={settings.selectedId}
            items={options}
            disabled={disabled}
            onValueChange={(id) => {
              if (id === 'new') {
                openEditor(true);
              } else if (id && id !== settings.selectedId) {
                onChange({ ...settings, selectedId: id });
              }
            }}
          >
            <SelectTrigger id="tool-policy" className="min-w-0 flex-1">
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
                  disabled={disabled}
                  onClick={() => openEditor()}
                />
              }
            >
              <PencilIcon />
            </TooltipTrigger>
            <TooltipContent>查看与编辑策略</TooltipContent>
          </Tooltip>
        </div>
      </SettingsField>
      {error ? <Alert variant="danger" showIcon description={error} /> : null}
      {editor ? (
        <ToolPolicyEditor
          initial={editor}
          settings={settings}
          tools={tools}
          pending={disabled}
          onSave={(next) => {
            onChange(next);
            setEditor(null);
          }}
          onClose={() => {
            setEditor(null);
          }}
        />
      ) : null}
    </section>
  );
}
