/**
 * @author Codex
 * @description Edits MCP connections, write-only credentials, tool exposure and runtime settings.
 */

import {
  CableIcon,
  ChevronRightIcon,
  FingerprintIcon,
  SlidersHorizontalIcon,
  WrenchIcon,
  VariableIcon,
  BugIcon,
  InfoIcon,
  ListFilterIcon,
} from 'lucide-react';
import { McpSettingsCard } from './McpSettingsCard';
import { useRef, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { Button } from '@octopus/ui/components/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@octopus/ui/components/field';
import { Input } from '@octopus/ui/components/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@octopus/ui/components/select';
import { Switch } from '@octopus/ui/components/switch';
import { Textarea } from '@octopus/ui/components/textarea';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { Spinner } from '@octopus/ui/components/spinner';
import { useI18n } from '@/i18n/use-i18n';
import { mcpFormDefaults, mcpFormInput, mcpTargetChanged } from '../utils/mcp-server-form';
import type { McpFormValues } from '../utils/mcp-server-form';
import type { McpServerConfigurationInput, McpServerDetailDto } from '@octopus/shared/protocol';

type TextName = {
  [K in keyof McpFormValues]: McpFormValues[K] extends string ? K : never;
}[keyof McpFormValues];
type BooleanName = {
  [K in keyof McpFormValues]: McpFormValues[K] extends boolean ? K : never;
}[keyof McpFormValues];

export interface McpServerFormProps {
  server?: McpServerDetailDto;
  pending: boolean;
  /**
   * Saves the draft and returns the secret-free committed configuration.
   */
  onSubmit(name: string, value: McpServerConfigurationInput): Promise<McpServerDetailDto | undefined>;
}

/**
 * Owns a per-server draft; query refreshes never replace unsubmitted edits.
 */
export function McpServerForm({ server, pending, onSubmit }: McpServerFormProps) {
  const { t } = useI18n();
  const [error, setError] = useState('');
  const [invalidField, setInvalidField] = useState('');
  const formElement = useRef<HTMLFormElement>(null);
  const form = useForm({
    defaultValues: mcpFormDefaults(server),
    onSubmit: async ({ value }) => {
      setError('');
      setInvalidField('');
      let input: McpServerConfigurationInput;
      try {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value.name.trim())) {
          throw { issues: [{ path: ['name'] }] };
        }
        input = mcpFormInput(value, server);
      } catch (failure) {
        const issue = (failure as { issues?: Array<{ path: string[] }> }).issues?.[0];
        const path = issue?.path ?? ['searchKeywords'];
        let fieldName = path[0];
        if (fieldName === 'connection') {
          fieldName = path[1] === 'cwd' ? 'cwd' : 'target';
        }
        if (fieldName === 'auth') {
          fieldName = path[1] ?? 'authType';
        }
        setInvalidField(fieldName);
        formElement.current?.querySelector<HTMLElement>(`#mcp-${fieldName}`)?.focus();
        setError(
          t(
            'settings.mcp.invalidForm',
            'Check the name, connection, authentication, numbers and JSON. Binding names must be unique; header values cannot contain line breaks.'
          )
        );
        return;
      }
      try {
        const saved = await onSubmit(value.name.trim(), input);
        form.reset(mcpFormDefaults(saved));
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : t('settings.mcp.operationFailed', 'MCP operation failed')
        );
      }
    },
  });

  /**
   * Renders a labelled text, number or multiline field with a stable accessible name.
   */
  function textField(
    name: TextName,
    label: string,
    options: { multiline?: boolean; number?: boolean; disabled?: boolean; placeholder?: string } = {}
  ) {
    return (
      <form.Field name={name} key={name}>
        {(field) => (
          <Field>
            <FieldLabel htmlFor={`mcp-${name}`}>{label}</FieldLabel>
            {options.multiline ? (
              <Textarea
                id={`mcp-${name}`}
                name={name}
                aria-label={name}
                aria-invalid={invalidField === name}
                spellCheck={false}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            ) : (
              <Input
                id={`mcp-${name}`}
                name={name}
                aria-label={name}
                aria-invalid={invalidField === name}
                spellCheck={false}
                autoComplete="off"
                type={options.number ? 'number' : 'text'}
                min={options.number ? 0 : undefined}
                step={options.number ? 1 : undefined}
                disabled={options.disabled}
                placeholder={options.placeholder}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </Field>
        )}
      </form.Field>
    );
  }

  /**
   * Renders a bounded adapter enum using the existing select primitive.
   */
  function selectField(name: TextName, label: string, items: Array<{ value: string; label: string }>) {
    return (
      <form.Field name={name} key={name}>
        {(field) => (
          <Field>
            <FieldLabel htmlFor={`mcp-${name}`}>{label}</FieldLabel>
            <Select
              items={items}
              value={field.state.value}
              onValueChange={(value) => field.handleChange(value ?? '')}
            >
              <SelectTrigger
                id={`mcp-${name}`}
                aria-label={name}
                aria-invalid={invalidField === name}
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {items.map((item) => (
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
    );
  }

  /**
   * Renders an independent boolean option.
   */
  function toggleField(name: BooleanName, label: string) {
    return (
      <form.Field name={name} key={name}>
        {(field) => (
          <Field orientation="horizontal">
            <FieldLabel htmlFor={`mcp-${name}`} className="flex-1">
              {label}
            </FieldLabel>
            <Switch
              id={`mcp-${name}`}
              aria-label={name}
              checked={field.state.value}
              onCheckedChange={field.handleChange}
            />
          </Field>
        )}
      </form.Field>
    );
  }

  /**
   * Allows replacing or explicitly clearing a secret without reading its current value.
   */
  function secretField(
    name: 'bearerToken' | 'oauthClientSecret',
    clear: 'clearBearer' | 'clearOAuth',
    label: string,
    configured: boolean
  ) {
    return (
      <form.Subscribe selector={(state) => state.values[clear]}>
        {(clearing) => (
          <Field key={name}>
            <FieldLabel htmlFor={`mcp-${name}`}>{label}</FieldLabel>
            <form.Field name={name}>
              {(field) => (
                <Input
                  id={`mcp-${name}`}
                  name={name}
                  aria-label={name}
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  disabled={clearing}
                  placeholder={
                    configured
                      ? t('settings.mcp.secretConfigured', '******** (configured)')
                      : t('settings.mcp.enterSecret', 'Enter a secret')
                  }
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              )}
            </form.Field>
            <FieldDescription>
              {t(
                'settings.mcp.secretStorage',
                'Leave blank to keep the current value. Saved in the Server configuration file; existing values are never displayed.'
              )}
            </FieldDescription>
            {configured && (
              <Button
                type="button"
                variant={clearing ? 'outline' : 'destructive'}
                size="sm"
                onClick={() => {
                  form.setFieldValue(clear, !clearing);
                  form.setFieldValue(name, '');
                }}
              >
                {clearing
                  ? t('settings.mcp.undoClear', 'Cancel clearing')
                  : t('settings.mcp.clearSecret', 'Clear this saved secret (takes effect after saving)')}
              </Button>
            )}
          </Field>
        )}
      </form.Subscribe>
    );
  }

  /**
   * Edits a complete binding list while untouched password inputs retain existing values.
   */
  function bindingFields(name: 'environment' | 'headers', label: string) {
    return (
      <form.Field name={name} mode="array">
        {(field) => (
          <FieldGroup>
            <FieldLabel>{label}</FieldLabel>
            <FieldDescription>
              {t(
                'settings.mcp.bindingHint',
                'Existing values are hidden. Leave them untouched to keep them; remove a row to delete the binding.'
              )}
            </FieldDescription>
            {field.state.value.map((entry, index) => (
              <Field key={index} className="rounded-lg border p-3">
                <FieldLabel htmlFor={`mcp-${name}-${index}-name`}>
                  {t('settings.mcp.bindingName', 'Name')}
                </FieldLabel>
                <Input
                  id={`mcp-${name}-${index}-name`}
                  name={`${name}.${index}.name`}
                  aria-label={`${name} name ${index + 1}`}
                  spellCheck={false}
                  value={entry.name}
                  onChange={(event) => field.replaceValue(index, { ...entry, name: event.target.value })}
                />
                <FieldLabel htmlFor={`mcp-${name}-${index}-value`}>
                  {t('settings.mcp.bindingValue', 'Value')}
                </FieldLabel>
                <Input
                  id={`mcp-${name}-${index}-value`}
                  name={`${name}.${index}.value`}
                  aria-label={`${name} value ${index + 1}`}
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  value={entry.value ?? ''}
                  placeholder={
                    entry.value === undefined
                      ? t('settings.mcp.secretConfigured', '******** (configured)')
                      : undefined
                  }
                  onChange={(event) => field.replaceValue(index, { ...entry, value: event.target.value })}
                />
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => field.removeValue(index)}
                >
                  {t('settings.mcp.removeBinding', 'Remove binding')}
                </Button>
              </Field>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => field.pushValue({ name: '', value: '' })}
            >
              {t('settings.mcp.addBinding', 'Add binding')}
            </Button>
          </FieldGroup>
        )}
      </form.Field>
    );
  }

  return (
    <form
      ref={formElement}
      className="@container"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <fieldset disabled={pending} className="min-w-0 border-0 p-0">
        <FieldGroup>
          <McpSettingsCard title={t('settings.mcp.basicTitle', 'Basic information')} icon={InfoIcon}>
            <FieldGroup>
              {textField('name', t('settings.mcp.nameLabel', 'Name'), { disabled: server !== undefined })}
              {textField('description', t('settings.mcp.descriptionLabel', 'Description'), {
                multiline: true,
              })}
            </FieldGroup>
          </McpSettingsCard>
          <McpSettingsCard
            title={t('settings.mcp.connectionTitle', 'Connection')}
            description={t(
              'settings.mcp.connectionEditDescription',
              'Local process, HTTP, or Socket MCP server configuration.'
            )}
            icon={CableIcon}
          >
            <FieldGroup>
              {selectField('transport', t('settings.mcp.transportLabel', 'Transport'), [
                { value: 'stdio', label: t('settings.mcp.transportStdio', 'stdio (local process)') },
                { value: 'http', label: 'HTTP' },
                { value: 'socket', label: 'Socket' },
              ])}
              {textField('target', t('settings.mcp.targetLabel', 'Command or address'))}
              <form.Subscribe selector={(state) => mcpTargetChanged(state.values, server)}>
                {(changed) =>
                  changed && (
                    <Alert>
                      <AlertDescription>
                        {t(
                          'settings.mcp.targetSecretWarning',
                          'Changing the target clears existing credentials and bindings. Enter new values to use them at the new target.'
                        )}
                      </AlertDescription>
                    </Alert>
                  )
                }
              </form.Subscribe>
              <form.Subscribe selector={(state) => state.values.transport}>
                {(transport) => (
                  <>
                    {transport === 'stdio' && (
                      <>
                        {textField('args', t('settings.mcp.argsLabel', 'Arguments (one per line)'), {
                          multiline: true,
                        })}
                        {textField('cwd', t('settings.mcp.cwdLabel', 'Working directory'))}
                      </>
                    )}
                    {transport === 'http' && (
                      <>
                        {selectField(
                          'httpTransport',
                          t('settings.mcp.httpTransportLabel', 'HTTP transport'),
                          [
                            { value: 'auto', label: t('settings.mcp.auto', 'Automatic') },
                            { value: 'streamable-http', label: 'Streamable HTTP' },
                            { value: 'sse', label: 'SSE' },
                          ]
                        )}
                      </>
                    )}
                  </>
                )}
              </form.Subscribe>
            </FieldGroup>
          </McpSettingsCard>
          <form.Subscribe selector={(state) => state.values.transport}>
            {(transport) => (
              <>
                {transport === 'stdio' && (
                  <McpSettingsCard
                    title={t('settings.mcp.environmentLabel', 'Process environment variables')}
                    icon={VariableIcon}
                  >
                    <FieldGroup>
                      {toggleField(
                        'inheritEnv',
                        t('settings.mcp.inheritEnvLabel', 'Inherit Server environment')
                      )}
                      {bindingFields(
                        'environment',
                        t('settings.mcp.environmentLabel', 'Process environment variables')
                      )}
                    </FieldGroup>
                  </McpSettingsCard>
                )}
                {transport === 'http' && (
                  <>
                    <McpSettingsCard
                      title={t('settings.mcp.authLabel', 'Authentication')}
                      icon={FingerprintIcon}
                    >
                      <FieldGroup>
                        {selectField('authType', t('settings.mcp.authLabel', 'Authentication'), [
                          { value: 'auto', label: t('settings.mcp.auto', 'Automatic') },
                          { value: 'none', label: t('settings.mcp.noAuth', 'No authentication') },
                          { value: 'bearer', label: 'Bearer token' },
                          { value: 'oauth', label: 'OAuth' },
                        ])}
                        <form.Subscribe selector={(state) => state.values.authType}>
                          {(auth) => (
                            <>
                              {auth === 'bearer' && (
                                <>
                                  {selectField(
                                    'bearerSource',
                                    t('settings.mcp.bearerSource', 'Token source'),
                                    [
                                      {
                                        value: 'token',
                                        label: t('settings.mcp.manualSecret', 'Enter token'),
                                      },
                                      {
                                        value: 'environment',
                                        label: t(
                                          'settings.mcp.environmentSecret',
                                          'Server environment variable'
                                        ),
                                      },
                                      ...(server?.auth.bearerTokenStored
                                        ? [
                                            {
                                              value: 'store',
                                              label: t(
                                                'settings.mcp.storedSecret',
                                                'Existing credential store'
                                              ),
                                            },
                                          ]
                                        : []),
                                    ]
                                  )}
                                  <form.Subscribe selector={(state) => state.values.bearerSource}>
                                    {(source) => (
                                      <>
                                        {source === 'token' &&
                                          secretField(
                                            'bearerToken',
                                            'clearBearer',
                                            t('settings.mcp.bearerToken', 'Access token'),
                                            server?.auth.bearerTokenConfigured === true
                                          )}
                                        {source === 'environment' &&
                                          textField(
                                            'bearerTokenEnv',
                                            t('settings.mcp.bearerEnv', 'Environment variable name')
                                          )}
                                      </>
                                    )}
                                  </form.Subscribe>
                                </>
                              )}
                              {auth === 'oauth' && (
                                <>
                                  {textField(
                                    'oauthClientId',
                                    t('settings.mcp.oauthClientId', 'OAuth client ID')
                                  )}
                                  {textField('oauthScope', t('settings.mcp.oauthScope', 'OAuth scope'))}
                                  {secretField(
                                    'oauthClientSecret',
                                    'clearOAuth',
                                    t('settings.mcp.oauthClientSecret', 'OAuth client secret'),
                                    server?.auth.oauthClientSecretConfigured === true
                                  )}
                                  <FieldDescription>
                                    {t(
                                      'settings.mcp.oauthFlowHint',
                                      'Authorization is completed by the Agent when connecting. This page saves the client configuration only.'
                                    )}
                                  </FieldDescription>
                                </>
                              )}
                            </>
                          )}
                        </form.Subscribe>
                      </FieldGroup>
                    </McpSettingsCard>
                    <McpSettingsCard
                      title={t('settings.mcp.headersLabel', 'HTTP headers')}
                      icon={ListFilterIcon}
                    >
                      {bindingFields('headers', t('settings.mcp.customHeaders', 'Custom request headers'))}
                    </McpSettingsCard>
                  </>
                )}
              </>
            )}
          </form.Subscribe>
          <McpSettingsCard title={t('settings.mcp.toolsTitle', 'Tools and resources')} icon={WrenchIcon}>
            <FieldGroup>
              {selectField('directMode', t('settings.mcp.directToolsLabel', 'Register tools'), [
                { value: 'off', label: t('settings.mcp.directOff', 'Use MCP proxy') },
                { value: 'all', label: t('settings.mcp.directAll', 'Register all tools') },
                { value: 'search', label: t('settings.mcp.directSearch', 'Register after search') },
                { value: 'patterns', label: t('settings.mcp.directPatterns', 'Register matching tools') },
              ])}
              <form.Subscribe selector={(state) => state.values.directMode}>
                {(mode) =>
                  mode === 'patterns' &&
                  textField(
                    'directPatterns',
                    t('settings.mcp.directPatternLabel', 'Direct tool patterns (one per line)'),
                    { multiline: true }
                  )
                }
              </form.Subscribe>
              {toggleField(
                'exposeResources',
                t('settings.mcp.exposeResourcesLabel', 'Expose MCP resources as tools')
              )}
              {selectField(
                'toolPrefix',
                t('settings.mcp.toolPrefixLabel', 'Tool name prefix'),
                ['server', 'short', 'none', 'mcp'].map((value) => ({ value, label: value }))
              )}
              <div className="grid min-w-0 gap-4 @lg:grid-cols-2">
                {textField('includeTools', t('settings.mcp.includeToolsLabel', 'Include tools'), {
                  multiline: true,
                })}
                {textField('excludeTools', t('settings.mcp.excludeToolsLabel', 'Exclude tools'), {
                  multiline: true,
                })}
              </div>
            </FieldGroup>
          </McpSettingsCard>
          <McpSettingsCard
            title={t('settings.mcp.runtimeTitle', 'Connection behavior')}
            icon={SlidersHorizontalIcon}
          >
            <FieldGroup>
              {selectField(
                'lifecycle',
                t('settings.mcp.lifecycleLabel', 'Connection lifecycle'),
                ['lazy', 'eager', 'keep-alive', 'lazy-keep-alive'].map((value) => ({ value, label: value }))
              )}
              {textField('idleTimeoutMinutes', t('settings.mcp.idleTimeoutLabel', 'Idle timeout (minutes)'), {
                number: true,
              })}
              {textField(
                'requestTimeoutMs',
                t('settings.mcp.requestTimeoutLabel', 'Request timeout (milliseconds)'),
                { number: true }
              )}
              <FieldDescription>
                {t(
                  'settings.mcp.timeoutHint',
                  'Blank inherits the default. Idle timeout 0 disables idle cleanup; request timeout 0 uses the SDK default.'
                )}
              </FieldDescription>
              {selectField(
                'protocolVersion',
                t('settings.mcp.protocolLabel', 'Protocol negotiation'),
                ['legacy', 'auto', '2026-07-28'].map((value) => ({ value, label: value }))
              )}
            </FieldGroup>
          </McpSettingsCard>
          <McpSettingsCard
            title={t('settings.mcp.diagnosticsTitle', 'Advanced and diagnostics')}
            icon={BugIcon}
          >
            <details className="group/advanced">
              <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden text-sm text-muted-foreground">
                <ChevronRightIcon aria-hidden className="size-4 shrink-0 group-open/advanced:rotate-90" />
                {t('settings.mcp.advanced', 'Advanced configuration')}
              </summary>
              <FieldGroup className="mt-4">
                {textField(
                  'searchKeywords',
                  t(
                    'settings.mcp.searchKeywordsLabel',
                    'Tool search keywords (JSON: pattern to keyword array)'
                  ),
                  { multiline: true }
                )}
                {toggleField('debug', t('settings.mcp.debugLabel', 'Show server stderr in Agent logs'))}
                {toggleField('trace', t('settings.mcp.traceLabel', 'Trace protocol metadata'))}
              </FieldGroup>
            </details>
          </McpSettingsCard>
          {!!server?.externalFields?.length && (
            <Alert>
              <AlertDescription>
                {t(
                  'settings.mcp.externalFields',
                  'Additional settings are managed outside this page: {{fields}}',
                  { fields: server.externalFields.join(', ') }
                )}
              </AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="sticky bottom-0 flex items-center justify-between gap-3 bg-background/95 py-3 backdrop-blur-sm border-t ring-1 ring-background">
            <p className="text-xs text-muted-foreground">
              {t(
                'settings.mcp.connectionSaveHint',
                'Connection tested after saving. Restart the Agent if changes do not apply.'
              )}
            </p>
            <Button type="submit" className="shrink-0" disabled={pending}>
              {pending && <Spinner data-icon="inline-start" />}
              {server
                ? t('settings.mcp.saveChanges', 'Save changes')
                : t('settings.mcp.createServer', 'Create server')}
            </Button>
          </div>
        </FieldGroup>
      </fieldset>
    </form>
  );
}
