/**
 * @author Codex
 * @description Explains permission JSON fields, inheritance and session scopes beside the settings editors.
 */
import { ChevronRightIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
import { Button } from '@octopus/ui/components/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@octopus/ui/components/collapsible';
import { useI18n } from '@/i18n/use-i18n';
import type { PermissionConfig, PermissionToolRule } from '@octopus/shared/protocol';

const toolExample = {
  kind: 'write',
  pathFields: ['arguments.sourcePath'],
  commandFields: [],
  sessionApproval: {
    fields: ['collectionId'],
    pathParents: ['arguments.sourcePath'],
  },
} satisfies PermissionToolRule;

const configExample = {
  version: 2,
  toolRules: { custom_document_import: toolExample },
  policy: { tools: { custom_document_import: 'ask' } },
  modes: { auto: { kinds: { shell: 'ask' }, external: 'ask' } },
  permissionReviewLog: true,
  reviewLogFieldMaxWidth: 1000,
} satisfies PermissionConfig;

/**
 * Describe the single descriptor accepted by the tool editor without wrapping it in a full configuration.
 */
export function PermissionToolJsonHelp() {
  const { t } = useI18n();
  return (
    <Alert role="note">
      <AlertTitle className="text-center font-semibold mb-2">
        {t('settings.permissions.toolHelp.title', 'How to fill this in')}
      </AlertTitle>
      <AlertDescription className="flex min-w-0 flex-col gap-3 text-xs leading-relaxed">
        <div>
          {t(
            'settings.permissions.toolHelp.introPrefix',
            "Describe only this tool's descriptor here; do not wrap it in a tool name or "
          )}
          <code>{'toolRules'}</code>
          {t('settings.permissions.toolHelp.introMiddle', '. The minimal form is ')}
          <code>{'{"kind":"custom"}'}</code>
          {t(
            'settings.permissions.toolHelp.introSuffix',
            '; whether execution is allowed is decided by the policy option above.'
          )}
        </div>
        <dl className="flex flex-col gap-3 [&_dt]:font-medium [&_dt]:text-foreground">
          <div>
            <dt>
              <code>{'kind'}</code>
              {' · '}
              {t('settings.permissions.toolHelp.kindRequired', 'required')}
            </dt>
            <dd>
              {t('settings.permissions.toolHelp.kindDescriptionPrefix', 'Tool category: ')}
              <code>{'read'}</code>
              {t('settings.permissions.toolHelp.kindGloss.read', ' (read), ')}
              <code>{'write'}</code>
              {t('settings.permissions.toolHelp.kindGloss.write', ' (write), ')}
              <code>{'shell'}</code>
              {t('settings.permissions.toolHelp.kindGloss.shell', ' (command), ')}
              <code>{'custom'}</code>
              {t(
                'settings.permissions.toolHelp.kindGloss.custom',
                " (other). Used to match the run mode's per-kind default action."
              )}
            </dd>
          </div>
          <div>
            <dt>
              <code>{'pathFields'}</code> / <code>{'commandFields'}</code>
              {' · '}
              {t('settings.permissions.toolHelp.optional', 'optional')}
            </dt>
            <dd>
              {t(
                'settings.permissions.toolHelp.pathFieldsPrefix',
                'String arrays specifying which tool argument fields provide file paths or commands, e.g. '
              )}
              <code>{'["arguments.sourcePath"]'}</code>
              {t('settings.permissions.toolHelp.pathFieldsMiddle', ', ')}
              <code>{'["command"]'}</code>
              {t(
                'settings.permissions.toolHelp.pathFieldsSuffix1',
                '. Fill in argument field names, not actual file paths or commands; values may be strings or string arrays. When omitted, '
              )}
              <code>{'requestDefaults'}</code>
              {t('settings.permissions.toolHelp.pathFieldsSuffix2', ' is used; providing ')}
              <code>{'[]'}</code>
              {t('settings.permissions.toolHelp.pathFieldsSuffix3', ' means no values are extracted from that list.')}
            </dd>
          </div>
          <div>
            <dt>
              <code>{'sessionApproval.fields'}</code>
              {' · '}
              {t('settings.permissions.toolHelp.fieldsScope', 'approval scope')}
            </dt>
            <dd>
              {t('settings.permissions.toolHelp.fieldsPrefix', 'This array is required when configuring ')}
              <code>{'sessionApproval'}</code>
              {t('settings.permissions.toolHelp.fieldsRequired', ', e.g. ')}
              <code>{'["collectionId"]'}</code>
              {t(
                'settings.permissions.toolHelp.fieldsMatch',
                '. After choosing "allow for this session", approvals are reused only within the same workspace, the same tool, and identical scope-field values; extracted path parents and full commands also participate in matching.'
              )}
              {t(
                'settings.permissions.toolHelp.fieldsNonEmpty',
                ' Scope fields must resolve to non-empty strings, otherwise only a one-time approval is granted.'
              )}
              {t(
                'settings.permissions.toolHelp.fieldsEmpty',
                ' An empty array adds no field restriction; with no path or command scope either, it becomes a workspace-wide session approval for that tool.'
              )}
            </dd>
          </div>
          <div>
            <dt>
              <code>{'sessionApproval.fieldDefaults'}</code>
              {' · '}
              {t('settings.permissions.toolHelp.optional', 'optional')}
            </dt>
            <dd>
              {t('settings.permissions.toolHelp.fieldDefaultsPrefix', 'Provides default strings for arguments missing from ')}
              <code>{'fields'}</code>
              {t('settings.permissions.toolHelp.fieldDefaultsMiddle', ' or valued ')}
              <code>{'null'}</code>
              {t('settings.permissions.toolHelp.fieldDefaultsExample', ', e.g. ')}
              <code>{'{"scope":"workspace"}'}</code>
              {t(
                'settings.permissions.toolHelp.fieldDefaultsSuffix',
                '; each default is at most 200 characters. This only affects the approval scope: it neither fills tool arguments nor replaces empty strings.'
              )}
            </dd>
          </div>
          <div>
            <dt>
              <code>{'sessionApproval.pathParents'}</code>
              {' · '}
              {t('settings.permissions.toolHelp.optional', 'optional')}
            </dt>
            <dd>
              {t('settings.permissions.toolHelp.pathParentsPrefix', 'Array of argument field names, e.g. ')}
              <code>{'["arguments.sourcePath"]'}</code>
              {t(
                'settings.permissions.toolHelp.pathParentsBody',
                '. Adds the parent directories of these paths to the approval scope; relative paths resolve against the workspace, and the corresponding arguments must be non-empty strings.'
              )}
              {t(
                'settings.permissions.toolHelp.pathParentsMissing',
                ' If a specified argument is missing, only a one-time approval is granted. This does not replace the path extraction of '
              )}
              <code>{'pathFields'}</code>
              {t('settings.permissions.toolHelp.pathParentsSuffix', '.')}
            </dd>
          </div>
        </dl>
        <div>
          {t('settings.permissions.toolHelp.fieldPathPrefix', 'Argument fields support dot-separated nested paths such as ')}
          <code>{'arguments.sourcePath'}</code>
          {t('settings.permissions.toolHelp.fieldPathBody', '; wildcards, brackets and array indices are not supported.')}
          {t(
            'settings.permissions.toolHelp.fieldPathNaming',
            ' Each segment must start with a letter or underscore and may then contain digits; '
          )}
          <code>{'__proto__'}</code>
          {t('settings.permissions.toolHelp.fieldPathSep1', ', ')}
          <code>{'prototype'}</code>
          {t('settings.permissions.toolHelp.fieldPathSep2', ' and ')}
          <code>{'constructor'}</code>
          {t('settings.permissions.toolHelp.fieldPathSuffix', ' are not allowed. Each field list holds at most 16 entries.')}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <span className="font-medium text-foreground">
            {t('settings.permissions.toolHelp.exampleTitle', 'Example: import tool scoped by collection and source directory')}
          </span>
          <pre
            className="overflow-x-auto rounded-md bg-muted p-3 text-xs"
            tabIndex={0}
            aria-label="Tool descriptor JSON example"
          >
            <code>{JSON.stringify(toolExample, null, 2)}</code>
          </pre>
          <span>
            {t('settings.permissions.toolHelp.examplePrefix', 'Assuming the tool arguments include ')}
            <code>{'collectionId'}</code>
            {t('settings.permissions.toolHelp.exampleMiddle', ' and ')}
            <code>{'arguments.sourcePath'}</code>
            {t(
              'settings.permissions.toolHelp.exampleSuffix1',
              ". Adjust the field names to your tool's real arguments; command tools extracting only the "
            )}
            <code>{'command'}</code>
            {t('settings.permissions.toolHelp.exampleSuffix2', ' argument can use ')}
            <code className="break-all">
              {'{"kind":"shell","pathFields":[],"commandFields":["command"]}'}
            </code>
            {t('settings.permissions.toolHelp.exampleSuffix3', '.')}
          </span>
        </div>
        <div>
          {t('settings.permissions.toolHelp.blankPrefix', 'Leaving the field empty restores the inherited descriptor; entering ')}
          <code>{'null'}</code>
          {t('settings.permissions.toolHelp.blankMiddle', ' removes the inherited descriptor: the tool falls under ')}
          <code>{'custom'}</code>
          {t(
            'settings.permissions.toolHelp.blankSuffix',
            ' with default argument fields, and is not disabled. An object replaces the descriptor wholesale rather than merging field by field.'
          )}
          <code>{'{}'}</code>
          {t('settings.permissions.toolHelp.blankKind', ' lacks the required ')}
          <code>{'kind'}</code>
          {t('settings.permissions.toolHelp.blankKindSuffix', ' and is not a valid tool descriptor.')}
        </div>
        <div>
          {t(
            'settings.permissions.toolHelp.jsonNote',
            'Use standard JSON: field names and strings use double quotes; comments, trailing commas and unlisted fields are not supported.'
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}

/**
 * Keep the complete overlay reference expandable so the JSON draft remains the primary editing surface.
 */
export function PermissionConfigJsonHelp() {
  const { t } = useI18n();
  return (
    <Collapsible className="flex min-w-0 flex-col gap-2">
      <CollapsibleTrigger
        render={<Button type="button" variant="ghost" />}
        className="w-full justify-start px-0 data-panel-open:[&>svg]:rotate-90"
      >
        <ChevronRightIcon aria-hidden="true" />
        {t('settings.permissions.configHelp.trigger', 'JSON field reference and examples')}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Alert role="note">
          <AlertTitle>
            {t('settings.permissions.configHelp.title', 'Only fill in the configuration this scope needs to override')}
          </AlertTitle>
          <AlertDescription className="flex min-w-0 flex-col gap-3">
            <div>
              {t(
                'settings.permissions.configHelp.inheritanceBody',
                'Configuration inherits in order: system presets → global → workspace. Workspace configuration participates only while the workspace is trusted.'
              )}
              {t(
                'settings.permissions.configHelp.inheritanceSave',
                ' Saving replaces the entire configuration of the current scope; keep the local fields still in use, and delete fields to restore inheritance. Saving '
              )}
              <code>{'{}'}</code>
              {t(
                'settings.permissions.configHelp.inheritanceSuffix',
                ' restores every default in this scope, including audit options; the field cannot be left empty.'
              )}
            </div>
            <dl className="flex flex-col gap-3 [&_dt]:font-medium [&_dt]:text-foreground">
              <div>
                <dt>
                  <code>{'version'}</code>
                </dt>
                <dd>
                  {t('settings.permissions.configHelp.versionDescription', 'Version number; only the number ')}
                  <code>{'2'}</code>
                  {t('settings.permissions.configHelp.versionSuffix', ' is supported; may be omitted and is written automatically on save.')}
                </dd>
              </div>
              <div>
                <dt>
                  <code>{'toolRules'}</code>
                </dt>
                <dd>
                  {t('settings.permissions.configHelp.toolRulesPrefix', 'Map of tool names to descriptors containing ')}
                  <code>{'kind'}</code>, <code>{'pathFields'}</code>, <code>{'commandFields'}</code>
                  {t('settings.permissions.configHelp.toolRulesMiddle', ' and ')}
                  <code>{'sessionApproval'}</code>
                  {t(
                    'settings.permissions.configHelp.toolRulesBody',
                    '. A single descriptor replaces its inherited value wholesale; setting it to '
                  )}
                  <code>{'null'}</code>
                  {t('settings.permissions.configHelp.toolRulesSuffix', ' removes the kind and treats the tool as ')}
                  <code>{'custom'}</code>
                  {t(
                    'settings.permissions.configHelp.toolRulesSuffix2',
                    ', which does not mean denied. See "Edit tool rule → Advanced configuration" for detailed field usage.'
                  )}
                </dd>
              </div>
              <div>
                <dt>
                  <code>{'requestDefaults'}</code>
                </dt>
                <dd>
                  {t('settings.permissions.configHelp.requestDefaultsPrefix', 'Specifies default argument field lists via ')}
                  <code>{'pathFields'}</code>
                  {t('settings.permissions.configHelp.requestDefaultsMiddle', ' and ')}
                  <code>{'commandFields'}</code>
                  {t(
                    'settings.permissions.configHelp.requestDefaultsSuffix',
                    '. Used when a tool descriptor does not declare the corresponding list; arrays replace wholesale, and '
                  )}
                  <code>{'[]'}</code>
                  {t('settings.permissions.configHelp.requestDefaultsSuffix2', ' clears that list.')}
                </dd>
              </div>
              <div>
                <dt>
                  <code>{'policy.tools'}</code>
                </dt>
                <dd>
                  {t('settings.permissions.configHelp.policyPrefix', 'Fixed tool actions, e.g. ')}
                  <code>{'{"custom_document_import":"ask"}'}</code>
                  {t(
                    'settings.permissions.configHelp.policyBody',
                    '. Tool names match exactly; wildcards are not supported. Actions are limited to '
                  )}
                  <code>{'allow'}</code>
                  {t('settings.permissions.configHelp.policyAllow', ' (allow), ')}
                  <code>{'ask'}</code>
                  {t('settings.permissions.configHelp.policyAsk', ' (ask), ')}
                  <code>{'deny'}</code>
                  {t('settings.permissions.configHelp.policyDeny', ' (deny); to inherit, delete the key instead of entering ')}
                  <code>{'inherit'}</code>
                  {t('settings.permissions.configHelp.policySuffix', '.')}
                </dd>
              </div>
              <div>
                <dt>
                  <code>{'modes.ask'}</code> / <code>{'modes.auto'}</code> / <code>{'modes.full'}</code>
                </dt>
                <dd>
                  {t('settings.permissions.configHelp.modesPrefix', 'Each mode can configure ')}
                  <code>{'tools'}</code>
                  {t('settings.permissions.configHelp.modesTools', ' (tool actions), ')}
                  <code>{'kinds'}</code>
                  {t('settings.permissions.configHelp.modesKindsMiddle', ' (default actions for ')}
                  <code>{'read'}</code> / <code>{'write'}</code> / <code>{'shell'}</code> / <code>{'custom'}</code>
                  {t('settings.permissions.configHelp.modesKindsSuffix', ') and ')}
                  <code>{'external'}</code>
                  {t('settings.permissions.configHelp.modesExternal', ' (actions for paths outside the workspace). Values are likewise ')}
                  <code>{'allow'}</code> / <code>{'ask'}</code> / <code>{'deny'}</code>
                  {t(
                    'settings.permissions.configHelp.modesSuffix',
                    ". Saving these rules does not switch the current session's run mode."
                  )}
                </dd>
              </div>
              <div>
                <dt>
                  <code>{'permissionReviewLog'}</code> / <code>{'reviewLogFieldMaxWidth'}</code>
                </dt>
                <dd>
                  {t('settings.permissions.configHelp.auditPrefix', 'The former toggles the audit log; enter ')}
                  <code>{'true'}</code>
                  {t('settings.permissions.configHelp.auditMiddle', ' or ')}
                  <code>{'false'}</code>
                  {t(
                    'settings.permissions.configHelp.auditSuffix',
                    '; the latter is the number of characters kept per log text field, an integer from 1 to 100000.'
                  )}
                </dd>
              </div>
            </dl>
            <div>
              {t('settings.permissions.configHelp.precedencePrefix', 'Any ')}
              <code>{'deny'}</code>
              {t(
                'settings.permissions.configHelp.precedenceBody',
                ' in the fixed policy or the current mode\'s tool rules denies. Otherwise the rule is chosen in the order "fixed tool action → mode tool action → kind default action"; paths outside the workspace must also satisfy '
              )}
              <code>{'external'}</code>
              {t(
                'settings.permissions.configHelp.precedenceSuffix',
                '. Valid session approvals reuse confirmation results but cannot bypass denial or hard security checks.'
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <span className="font-medium text-foreground">
                {t(
                  'settings.permissions.configHelp.exampleTitle',
                  'Complete structure example (merge into your existing configuration as needed)'
                )}
              </span>
              <pre
                className="overflow-x-auto rounded-md bg-muted p-3 text-xs"
                tabIndex={0}
                aria-label="Permission configuration JSON example"
              >
                <code>{JSON.stringify(configExample, null, 2)}</code>
              </pre>
            </div>
            <div>
              {t(
                'settings.permissions.configHelp.closingPrefix',
                'All top-level fields are optional. Use standard JSON double quotes; comments, trailing commas and unknown fields are not supported. Except for tool descriptors inside '
              )}
              <code>{'toolRules'}</code>
              {t('settings.permissions.configHelp.closingMiddle', ', ')}
              <code>{'null'}</code>
              {t(
                'settings.permissions.configHelp.closingSuffix',
                ' cannot be used to mean default. Action maps merge key by key; an empty object does not clear inherited actions.'
              )}
            </div>
          </AlertDescription>
        </Alert>
      </CollapsibleContent>
    </Collapsible>
  );
}
