/**
 * @author Codex
 * @description Edits the non-secret, Host-owned portion of one MCP Server definition.
 */

import { useEffect } from 'react';
import { isDirectToolsEnabled, resolveDirectTools } from '@/features/settings/utils/mcp-direct-tools';
import { useForm } from '@tanstack/react-form';
import { CircleHelpIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@octopus/ui/components/field';
import { Input } from '@octopus/ui/components/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@octopus/ui/components/select';
import { Spinner } from '@octopus/ui/components/spinner';
import { Switch } from '@octopus/ui/components/switch';
import { Textarea } from '@octopus/ui/components/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@octopus/ui/components/tooltip';
import { useI18n } from '@/i18n/use-i18n';
import type { McpServerConfigurationInput, McpServerDetailDto } from '@octopus/shared/protocol';

const TOOL_EXPOSURE_OPTION_NAMES = ['exposeResources', 'directTools'] as const;

interface FormValues {
  name: string;
  description: string;
  transport: 'stdio' | 'http' | 'socket';
  target: string;
  args: string;
  exposeResources: boolean;
  directTools: boolean;
  includeTools: string;
  excludeTools: string;
}

/** Produces stable form defaults for creation or detail editing. */
function defaults(server?: McpServerDetailDto): FormValues {
  const connection = server?.connection;
  /**
   * Selects target in the existing condition order.
   */
  function selectTarget() {
    if (connection?.type === 'http') {
      return connection.url;
    } else if (connection?.type === 'socket') {
      return connection.socket;
    } else if (connection?.type === 'stdio') {
      return connection.command;
    } else {
      return '' as const;
    }
  }
  return {
    name: server?.name ?? '',
    description: server?.description ?? '',
    transport: connection?.type === 'http' || connection?.type === 'socket' ? connection.type : 'stdio',
    target: selectTarget(),
    args: connection?.type === 'stdio' ? connection.args.join('\n') : '',
    exposeResources: server?.exposeResources ?? true,
    directTools: isDirectToolsEnabled(server?.directTools),
    includeTools: server?.includeTools.join('\n') ?? '',
    excludeTools: server?.excludeTools.join('\n') ?? '',
  };
}

/** Converts the form into the bounded shared Settings contract. */
function configuration(value: FormValues, server?: McpServerDetailDto): McpServerConfigurationInput {
  const lines = (text: string) =>
    text
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
  let connection;
  if (value.transport === 'stdio') {
    connection = {
      type: 'stdio',
      command: value.target,
      args: lines(value.args),
      ...(server?.connection.type === 'stdio' && server.connection.cwd ? { cwd: server.connection.cwd } : {}),
    } as const;
  } else if (value.transport === 'http') {
    connection = {
      type: 'http',
      url: value.target,
      transport: server?.connection.type === 'http' ? server.connection.transport : 'auto',
    } as const;
  } else {
    connection = { type: 'socket', socket: value.target } as const;
  }
  return {
    description: value.description.trim(),
    connection,
    enabled: server?.enabled ?? true,
    lifecycle: server?.lifecycle ?? 'lazy',
    ...(server?.idleTimeoutMinutes === undefined ? {} : { idleTimeoutMinutes: server.idleTimeoutMinutes }),
    ...(server?.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: server.requestTimeoutMs }),
    protocolVersion: server?.protocolVersion ?? 'legacy',
    exposeResources: value.exposeResources,
    directTools: resolveDirectTools(value.directTools, server?.directTools),
    toolPrefix: server?.toolPrefix ?? 'server',
    includeTools: lines(value.includeTools),
    excludeTools: lines(value.excludeTools),
    auth: editableAuth(server, value.transport),
  };
}

/** Projects detail authentication into the strict, writable request contract. */
function editableAuth(
  server: McpServerDetailDto | undefined,
  transport: FormValues['transport']
): McpServerConfigurationInput['auth'] {
  if (server === undefined) {
    return { type: serverAuthType(transport), bearerTokenStored: false };
  }
  return {
    type: server.auth.type,
    bearerTokenStored: server.auth.bearerTokenStored,
    ...(server.auth.bearerTokenEnv === undefined ? {} : { bearerTokenEnv: server.auth.bearerTokenEnv }),
    ...(server.auth.oauthClientId === undefined ? {} : { oauthClientId: server.auth.oauthClientId }),
    ...(server.auth.oauthScope === undefined ? {} : { oauthScope: server.auth.oauthScope }),
  };
}

/** Uses adapter auto-auth only for HTTP transports. */
function serverAuthType(transport: FormValues['transport']): 'auto' | 'none' {
  return transport === 'http' ? 'auto' : 'none';
}

export interface McpServerFormProps {
  server?: McpServerDetailDto;
  pending: boolean;
  onSubmit(name: string, value: McpServerConfigurationInput): Promise<void>;
}

/** Renders the create/edit MCP Server form. */
export function McpServerForm({ server, pending, onSubmit }: McpServerFormProps) {
  const { t } = useI18n();
  const form = useForm({
    defaultValues: defaults(server),
    onSubmit: async ({ value }) => onSubmit(value.name, configuration(value, server)),
  });
  useEffect(() => form.reset(defaults(server)), [form, server]);
  const transportItems = [
    { label: t('settings.mcp.transportStdio', 'stdio (local process)'), value: 'stdio' },
    { label: 'HTTP', value: 'http' },
    { label: 'Socket', value: 'socket' },
  ];
  const toolExposureOptions = TOOL_EXPOSURE_OPTION_NAMES.map((name) => ({
    name,
    label:
      name === 'exposeResources'
        ? t('settings.mcp.exposeResourcesLabel', 'Expose MCP resources as tools')
        : t('settings.mcp.directToolsLabel', 'Register tools'),
    description:
      name === 'exposeResources'
        ? t(
            'settings.mcp.exposeResourcesDescription',
            'Maps MCP Resources provided by the server to callable read_<resource> tools. When off, these resource tools are no longer exposed.'
          )
        : t(
            'settings.mcp.directToolsDescription',
            "Registers each of this server's MCP tools directly into the Agent tool list without retrieval through the mcp proxy first. More tools consume more context."
          ),
  }));
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Field
          name="name"
          validators={{
            onSubmit: ({ value }) =>
              value.trim() ? undefined : t('settings.mcp.nameRequired', 'Enter a name.'),
          }}
        >
          {(field) => (
            <Field>
              <FieldLabel className="text-xs text-muted-foreground">
                {t('settings.mcp.nameLabel', 'Name')}
              </FieldLabel>
              <Input
                value={field.state.value}
                disabled={server !== undefined}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
            </Field>
          )}
        </form.Field>
        <form.Field name="description">
          {(field) => (
            <Field>
              <FieldLabel className="text-xs text-muted-foreground">
                {t('settings.mcp.descriptionLabel', 'Description')}
              </FieldLabel>
              <Textarea
                value={field.state.value}
                maxLength={512}
                rows={2}
                placeholder={t(
                  'settings.mcp.descriptionPlaceholder',
                  'Briefly describe what this MCP server does'
                )}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="transport">
          {(field) => (
            <Field>
              <FieldLabel className="text-xs text-muted-foreground">
                {t('settings.mcp.transportLabel', 'Transport')}
              </FieldLabel>
              <Select
                items={transportItems}
                value={field.state.value}
                onValueChange={(value) => field.handleChange((value ?? 'stdio') as FormValues['transport'])}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(value: string) => transportItems.find((item) => item.value === value)?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {transportItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          )}
        </form.Field>
        <form.Field
          name="target"
          validators={{
            onSubmit: ({ value }) =>
              value.trim() ? undefined : t('settings.mcp.targetRequired', 'Enter a connection target.'),
          }}
        >
          {(field) => (
            <Field>
              <FieldLabel className="text-xs text-muted-foreground">
                {t('settings.mcp.targetLabel', 'Command or address')}
              </FieldLabel>
              <Input value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} />
              <FieldDescription className="text-xs">
                {t(
                  'settings.mcp.targetDescription',
                  'stdio takes a command, HTTP a URL, and Socket a socket address.'
                )}
              </FieldDescription>
              <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
            </Field>
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.values.transport}>
          {(transport) =>
            transport === 'stdio' ? (
              <form.Field name="args">
                {(field) => (
                  <Field>
                    <FieldLabel className="text-xs text-muted-foreground">
                      {t('settings.mcp.argsLabel', 'Arguments')}
                    </FieldLabel>
                    <Textarea
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      placeholder={t('settings.mcp.argsPlaceholder', 'One argument per line')}
                    />
                  </Field>
                )}
              </form.Field>
            ) : null
          }
        </form.Subscribe>
        {toolExposureOptions.map(({ name, label, description }) => (
          <form.Field key={name} name={name}>
            {(field) => (
              <Field orientation="horizontal" className="justify-between">
                <div className="flex items-center gap-1">
                  <FieldLabel htmlFor={`mcp-server-${name}`} className="text-xs text-muted-foreground">
                    {label}
                  </FieldLabel>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button type="button" variant="ghost" size="icon-xs" aria-label={`${label} help`}>
                          <CircleHelpIcon />
                        </Button>
                      }
                    />
                    <TooltipContent className="max-w-72 text-xs" side="top">
                      {name === 'directTools' && server?.directTools === 'search'
                        ? t(
                            'settings.mcp.directToolsSearchHint',
                            'Currently registers tools on demand after search. Saving other settings keeps this mode; turning off the switch disables direct registration.'
                          )
                        : description}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Switch
                  id={`mcp-server-${name}`}
                  checked={field.state.value}
                  onCheckedChange={field.handleChange}
                />
              </Field>
            )}
          </form.Field>
        ))}
        {(['includeTools', 'excludeTools'] as const).map((name) => (
          <form.Field key={name} name={name}>
            {(field) => (
              <Field>
                <FieldLabel className="text-xs text-muted-foreground">
                  {name === 'includeTools'
                    ? t('settings.mcp.includeToolsLabel', 'Include tools')
                    : t('settings.mcp.excludeToolsLabel', 'Exclude tools')}
                </FieldLabel>
                <Textarea
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder={t('settings.mcp.toolsPlaceholder', 'One tool pattern per line')}
                />
              </Field>
            )}
          </form.Field>
        ))}
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {server
            ? t('settings.mcp.saveChanges', 'Save changes')
            : t('settings.mcp.createServer', 'Create server')}
        </Button>
      </FieldGroup>
    </form>
  );
}
