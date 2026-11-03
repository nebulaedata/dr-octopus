/**
 * @author Codex
 * @description Owns settings edits, endpoint-bound credential UI and independent in-place model connection feedback.
 */
import { useForm, useStore } from '@tanstack/react-form';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LockKeyholeIcon, LoaderCircleIcon } from 'lucide-react';
import { browser } from 'wxt/browser';
import { Alert } from '@octopus/custom-ui/components/alert';
import { Button } from '@octopus/ui/components/button';
import { Input } from '@octopus/ui/components/input';
import { Field, FieldGroup, FieldLabel, FieldDescription, FieldError } from '@octopus/ui/components/field';
import { Checkbox } from '@octopus/ui/components/checkbox';
import { PopupPage } from '../../components/PopupPage';
import { NavigationBar } from '../../components/NavigationBar';
import { Separator } from '@octopus/ui/components/separator';
import { skillBudgetDefaults, skillBudgetSchema } from '../../lib/builtin-agent/skill-budget';
import { ModelPicker } from './ModelPicker';
import { ModelKeyInput } from './ModelKeyInput';
import { SettingsToast, type SettingsNotice } from './SettingsToast';
import { modelSettingsRequest } from '../../lib/model-settings/model-settings-client';
import {
  modelSettingsSchema,
  modelSettingsError,
  type ModelSettings as Settings,
  type ModelSettingsSnapshot,
} from '../../lib/model-settings/model-settings-messages';

/**
 * Keeps connection feedback local; only explicit saves persist credentials through the background repository.
 */
export function ModelSettings({
  visible = true,
  settings,
  busy,
  back,
  failure,
}: {
  visible?: boolean;
  settings: Settings | null;
  busy: boolean;
  back: () => void;
  failure?: string;
}) {
  const [conflict, setConflict] = useState<ModelSettingsSnapshot>();
  const revision = useRef('initial');
  const initialized = useRef(false);
  const writing = useRef(false);
  const snapshotGeneration = useRef(0);
  const [notice, setNotice] = useState<SettingsNotice | null>(null);
  const [testing, setTesting] = useState(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [credentialVersion, setCredentialVersion] = useState(0);
  const probe = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const noticeId = useRef(0);
  const consentEndpoint = useRef<string | null>(settings?.baseUrl ?? null);
  const closeNotice = useCallback(() => setNotice(null), []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      probe.current?.abort();
      mutation.current?.abort();
    };
  }, []);
  /**
   * Invalidates only feedback for the edited configuration, without affecting saved skills.
   */
  function invalidateProbe() {
    probe.current?.abort();
    probe.current = null;
    setTesting(false);
    setNotice(null);
  }
  useEffect(() => {
    if (!visible) {
      invalidateProbe();
    }
  }, [visible]);
  /**
   * Presents a fresh, accessible result without changing routes or form values.
   */
  function notify(kind: SettingsNotice['kind'], message: string) {
    if (mounted.current) {
      setNotice({ kind, message, id: ++noticeId.current });
    }
  }
  const [defaults, setDefaults] = useState({
    baseUrl: settings?.baseUrl ?? '',
    model: settings?.model ?? '',
    apiKey: '',
    consent: false,
    ...skillBudgetDefaults,
  });
  const baseline = useRef(defaults);
  /**
   * Maps metadata schema failures to the corresponding shadcn Field feedback.
   */
  function validate({ value }: { value: typeof defaults }) {
    const fields: Partial<
      Record<
        'baseUrl' | 'model' | 'apiKey' | 'organize' | 'replay' | 'pageWaitSeconds' | 'pageWaitAttempts',
        string
      >
    > = {};
    if (!modelSettingsSchema.shape.baseUrl.safeParse(value.baseUrl).success) {
      fields.baseUrl = '请输入有效的 HTTP 或 HTTPS 地址。';
    }
    if (!modelSettingsSchema.shape.model.safeParse(value.model).success) {
      fields.model = '请填写模型名称。';
    }
    if (value.apiKey.length > 4096) {
      fields.apiKey = 'API Key 不能超过 4096 个字符。';
    }
    for (const mode of ['organize', 'replay'] as const) {
      if (!skillBudgetSchema.shape[mode].safeParse(value[mode]).success) {
        fields[mode] = '请输入1至500之间的整数。';
      }
    }
    if (!skillBudgetSchema.shape.pageWaitSeconds.safeParse(value.pageWaitSeconds).success) {
      fields.pageWaitSeconds = '请输入1至60之间的整数。';
    }
    if (!skillBudgetSchema.shape.pageWaitAttempts.safeParse(value.pageWaitAttempts).success) {
      fields.pageWaitAttempts = '请输入1至5之间的整数。';
    }
    return Object.keys(fields).length ? { fields } : undefined;
  }
  const form = useForm({
    defaultValues: defaults,
    onSubmitMeta: { mode: 'save' as 'save' | 'test' },
    validators: { onChange: validate, onSubmit: validate },
    onSubmit: async ({ value, meta }) => {
      if (busy || conflict || !initialized.current) {
        return;
      }
      const parsed = modelSettingsSchema.safeParse({
        provider: 'openai-compatible',
        baseUrl: value.baseUrl,
        model: value.model,
      });
      if (!parsed.success) {
        return;
      }
      if (meta.mode === 'test') {
        const controller = new AbortController();
        probe.current?.abort();
        probe.current = controller;
        setTesting(true);
        setNotice(null);
        try {
          const result = await modelSettingsRequest<{ elapsedMs: number }>(
            { type: 'test', settings: parsed.data, apiKey: value.apiKey || undefined },
            controller.signal
          );
          if (!controller.signal.aborted && probe.current === controller) {
            const duration =
              result.elapsedMs < 1000
                ? `${result.elapsedMs} ms`
                : `${(result.elapsedMs / 1000).toFixed(1)} 秒`;
            notify('success', `连接成功 · ${duration}`);
          }
        } catch (error) {
          if (!controller.signal.aborted && probe.current === controller) {
            notify('error', modelSettingsError(error instanceof Error ? error.message : ''));
          }
        } finally {
          if (probe.current === controller && mounted.current) {
            probe.current = null;
            setTesting(false);
          }
        }
        return;
      }
      invalidateProbe();
      writing.current = true;
      try {
        await modelSettingsRequest(
          {
            type: 'settings-save',
            settings: parsed.data,
            apiKey: value.apiKey || undefined,
            consent: value.consent,
            limits: {
              organize: value.organize,
              replay: value.replay,
              pageWaitSeconds: value.pageWaitSeconds,
              pageWaitAttempts: value.pageWaitAttempts,
            },
            expectedRevision: revision.current,
          },
          new AbortController().signal
        );
        if (!mounted.current) {
          return;
        }
        await refreshSnapshot(true);
        notify('success', '配置已保存');
      } catch (error) {
        notify('error', modelSettingsError(error instanceof Error ? error.message : ''));
        if (error instanceof Error && error.message === 'SETTINGS_CONFLICT') {
          await refreshSnapshot();
        }
      } finally {
        writing.current = false;
      }
    },
  });
  /**
   * Applies a public snapshot without ever retrieving or refilling a stored API key.
   */
  function applySnapshot(snapshot: ModelSettingsSnapshot) {
    invalidateProbe();
    const next = {
      baseUrl: snapshot.settings?.baseUrl ?? '',
      model: snapshot.settings?.model ?? '',
      apiKey: '',
      consent: snapshot.canSend,
      ...skillBudgetSchema.parse(snapshot.limits),
    };
    baseline.current = next;
    revision.current = snapshot.revision;
    initialized.current = true;
    consentEndpoint.current = next.baseUrl;
    setDefaults(next);
    form.reset(next);
    setHasKey(snapshot.hasKey);
    setReplacing(false);
    setConflict(undefined);
  }
  /**
   * Synchronizes clean forms and retains local drafts when another window saves.
   */
  async function refreshSnapshot(force = false) {
    const attempt = ++snapshotGeneration.current;
    try {
      const snapshot = await modelSettingsRequest<ModelSettingsSnapshot>(
        { type: 'settings-snapshot' },
        new AbortController().signal
      );
      if (!mounted.current || attempt !== snapshotGeneration.current) {
        return;
      }
      if (
        !force &&
        (snapshot.revision !== revision.current || !initialized.current) &&
        JSON.stringify(form.state.values) !== JSON.stringify(baseline.current)
      ) {
        setConflict(snapshot);
        invalidateProbe();
        return;
      }
      if (force || !initialized.current || snapshot.revision !== revision.current) {
        applySnapshot(snapshot);
      }
    } catch (error) {
      if (mounted.current && attempt === snapshotGeneration.current) {
        notify('error', modelSettingsError(error instanceof Error ? error.message : ''));
      }
    }
  }
  useEffect(() => {
    void refreshSnapshot();
    const changed = (changes: Record<string, unknown>, area: string) => {
      if (
        area === 'local' &&
        (changes.workflowSettings ||
          changes.workflowCredentials ||
          changes.workflowConsents ||
          changes.workflowSettingsRevision ||
          changes.skillExecutionLimits) &&
        !writing.current
      ) {
        void refreshSnapshot();
      }
    };
    browser.storage.onChanged.addListener(changed);
    return () => {
      snapshotGeneration.current++;
      browser.storage.onChanged.removeListener(changed);
    };
  }, []);
  useEffect(() => {
    if (failure) {
      notify('error', modelSettingsError(failure));
    }
  }, [failure]);
  const endpoint = useStore(form.store, (state) => state.values.baseUrl);
  useEffect(() => {
    const controller = new AbortController();
    setHasKey(null);
    if (!modelSettingsSchema.shape.baseUrl.safeParse(endpoint).success) {
      setHasKey(false);
      return;
    }
    void modelSettingsRequest<{ hasKey: boolean; canSend: boolean }>(
      { type: 'credential-status', baseUrl: endpoint },
      controller.signal
    ).then(
      (result) => {
        if (!controller.signal.aborted) {
          setHasKey(result.hasKey);
          if (consentEndpoint.current !== endpoint) {
            form.setFieldValue('consent', result.canSend);
            consentEndpoint.current = endpoint;
          }
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setHasKey(false);
          notify('error', modelSettingsError(error instanceof Error ? error.message : ''));
        }
      }
    );
    return () => controller.abort();
  }, [endpoint, credentialVersion]);
  /**
   * Clears the selected endpoint only and waits for storage acknowledgement before changing its saved state.
   */
  async function clearKey() {
    if (conflict) {
      return;
    }
    invalidateProbe();
    const controller = new AbortController();
    mutation.current = controller;
    setClearing(true);
    writing.current = true;
    try {
      await modelSettingsRequest(
        { type: 'credential-clear', baseUrl: endpoint, expectedRevision: revision.current },
        controller.signal
      );
      if (!controller.signal.aborted) {
        form.setFieldValue('apiKey', '');
        setHasKey(false);
        setReplacing(false);
        setCredentialVersion((version) => version + 1);
        const snapshot = await modelSettingsRequest<ModelSettingsSnapshot>(
          { type: 'settings-snapshot' },
          controller.signal
        );
        revision.current = snapshot.revision;
        notify('success', '密钥已清除');
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        notify('error', modelSettingsError(error instanceof Error ? error.message : ''));
        if (error instanceof Error && error.message === 'SETTINGS_CONFLICT') {
          await refreshSnapshot();
        }
      }
    } finally {
      writing.current = false;
      if (mounted.current && mutation.current === controller) {
        mutation.current = null;
        setClearing(false);
      }
    }
  }
  return (
    <form.Subscribe
      selector={(state) => ({
        values: state.values,
        canSubmit: state.canSubmit,
        isSubmitting: state.isSubmitting,
      })}
    >
      {({ values, canSubmit, isSubmitting }) => (
        <PopupPage
          scrollLabel="模型设置内容"
          header={
            <div className="relative z-20">
              <NavigationBar title="模型设置" onBack={back} />
              {notice && (
                <div className="pointer-events-none absolute inset-x-0 top-full pt-2">
                  <SettingsToast notice={notice} close={closeNotice} />
                </div>
              )}
            </div>
          }
          footer={
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                disabled={
                  busy ||
                  isSubmitting ||
                  clearing ||
                  hasKey === null ||
                  !initialized.current ||
                  !canSubmit ||
                  Boolean(conflict)
                }
                onClick={() => {
                  void form.handleSubmit({ mode: 'test' });
                }}
              >
                {testing && <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />}
                {testing ? '测试中' : '测试连接'}
              </Button>
              <Button
                className="flex-1"
                disabled={
                  busy ||
                  isSubmitting ||
                  clearing ||
                  hasKey === null ||
                  !initialized.current ||
                  !canSubmit ||
                  Boolean(conflict)
                }
                onClick={() => {
                  void form.handleSubmit({ mode: 'save' });
                }}
              >
                保存配置
              </Button>
            </div>
          }
        >
          {conflict && (
            <Alert
              variant="warning"
              description="配置已在其他窗口更新，当前输入已保留。"
              details={
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void refreshSnapshot(true)}
                  >
                    加载最新配置
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      revision.current = conflict.revision;
                      setConflict(undefined);
                      setCredentialVersion((version) => version + 1);
                    }}
                  >
                    保留当前编辑
                  </Button>
                </div>
              }
            />
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit({ mode: 'save' });
            }}
          >
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel>提供商</FieldLabel>
                <Input value="OpenAI 兼容" readOnly aria-label="提供商" />
              </Field>
              <form.Field name="baseUrl">
                {(field) => (
                  <Field data-invalid={field.state.meta.isTouched && !field.state.meta.isValid}>
                    <FieldLabel htmlFor="model-endpoint">接口地址</FieldLabel>
                    <Input
                      id="model-endpoint"
                      disabled={busy || (isSubmitting && !testing) || clearing}
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => {
                        invalidateProbe();
                        mutation.current?.abort();
                        setClearing(false);
                        setReplacing(false);
                        form.setFieldValue('apiKey', '');
                        form.setFieldValue('consent', false);
                        consentEndpoint.current = null;
                        field.handleChange(event.target.value);
                      }}
                      placeholder="https://api.example.com/v1"
                      aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid}
                    />
                    <FieldError
                      errors={
                        field.state.meta.isTouched
                          ? field.state.meta.errors.map((error) => ({ message: String(error) }))
                          : []
                      }
                    />
                  </Field>
                )}
              </form.Field>
              <form.Field name="apiKey">
                {(field) => (
                  <Field data-invalid={field.state.meta.isTouched && !field.state.meta.isValid}>
                    <FieldLabel htmlFor={hasKey && !replacing ? undefined : 'model-key'}>API Key</FieldLabel>
                    {hasKey && !replacing ? (
                      <div
                        className="flex h-8 items-center gap-2 rounded-lg border px-2.5"
                        role="group"
                        aria-label="API Key 已保存"
                      >
                        <LockKeyholeIcon className="size-4 text-muted-foreground" />
                        <span className="flex-1 text-sm">已保存</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busy || (isSubmitting && !testing) || clearing}
                          onClick={() => {
                            invalidateProbe();
                            setReplacing(true);
                          }}
                        >
                          更换
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busy || (isSubmitting && !testing) || clearing}
                          onClick={() => {
                            void clearKey();
                          }}
                        >
                          {clearing ? '清除中' : '清除'}
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <ModelKeyInput
                          key={endpoint}
                          visible={visible}
                          disabled={busy || (isSubmitting && !testing) || clearing}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          invalid={field.state.meta.isTouched && !field.state.meta.isValid}
                          onChange={(value) => {
                            invalidateProbe();
                            setReplacing(true);
                            field.handleChange(value);
                          }}
                        />
                        {hasKey && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              invalidateProbe();
                              field.handleChange('');
                              setReplacing(false);
                            }}
                          >
                            取消更换
                          </Button>
                        )}
                      </div>
                    )}
                    <FieldDescription>
                      {hasKey && !replacing ? '保存到此浏览器。' : '保存配置后保留在此浏览器。'}
                    </FieldDescription>
                    <FieldError
                      errors={
                        field.state.meta.isTouched
                          ? field.state.meta.errors.map((error) => ({ message: String(error) }))
                          : []
                      }
                    />
                  </Field>
                )}
              </form.Field>
              <form.Field name="model">
                {(field) => (
                  <Field data-invalid={field.state.meta.isTouched && !field.state.meta.isValid}>
                    <FieldLabel htmlFor="model-name">模型</FieldLabel>
                    <ModelPicker
                      active={visible}
                      key={credentialVersion}
                      baseUrl={values.baseUrl}
                      apiKey={values.apiKey}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(value) => {
                        invalidateProbe();
                        field.handleChange(value);
                      }}
                      invalid={field.state.meta.isTouched && !field.state.meta.isValid}
                      disabled={busy || (isSubmitting && !testing) || clearing}
                    />
                    <FieldError
                      errors={
                        field.state.meta.isTouched
                          ? field.state.meta.errors.map((error) => ({ message: String(error) }))
                          : []
                      }
                    />
                  </Field>
                )}
              </form.Field>
              <form.Field name="consent">
                {(field) => (
                  <Field orientation="horizontal">
                    <Checkbox
                      id="model-consent"
                      disabled={hasKey === null || busy || isSubmitting}
                      name={field.name}
                      checked={field.state.value}
                      onBlur={field.handleBlur}
                      onCheckedChange={(value) => field.handleChange(value === true)}
                    />
                    <FieldLabel htmlFor="model-consent">允许向此接口发送脱敏录制与整理回答</FieldLabel>
                  </Field>
                )}
              </form.Field>
              <Separator />
              <section className="flex flex-col gap-3" aria-label="执行限制">
                <h3 className="text-sm font-semibold">执行限制</h3>
                <p className="text-xs text-muted-foreground">
                  每轮指一次模型请求。提高上限可能增加费用；保存仅影响新任务。
                </p>
                {(['organize', 'replay'] as const).map((mode) => (
                  <form.Field key={mode} name={mode}>
                    {(field) => (
                      <Field data-invalid={field.state.meta.errors.length > 0}>
                        <FieldLabel htmlFor={'limit-' + mode}>
                          {mode === 'organize' ? '整理最大轮数' : '重放最大轮数'}
                          <span className="text-xs text-muted-foreground">(1–500)</span>
                        </FieldLabel>
                        <Input
                          id={'limit-' + mode}
                          type="number"
                          min={1}
                          max={500}
                          step={1}
                          disabled={busy || isSubmitting || clearing}
                          value={Number.isNaN(field.state.value) ? '' : field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(event) => field.handleChange(event.target.valueAsNumber)}
                          aria-invalid={field.state.meta.errors.length > 0}
                        />
                        <FieldError
                          errors={field.state.meta.errors.map((message) => ({ message: String(message) }))}
                        />
                      </Field>
                    )}
                  </form.Field>
                ))}
              </section>
              <section className="flex flex-col gap-3" aria-label="页面等待">
                <h3 className="text-sm font-semibold">页面等待</h3>
                <p className="text-xs text-muted-foreground">
                  打开或导航后等待主文档就绪。连续等待期间不调用模型、不重复打开页面；达到次数后报错。保存仅影响新任务。
                </p>
                {(
                  [
                    { name: 'pageWaitSeconds', label: '每次等待时长（秒）', max: 60 },
                    { name: 'pageWaitAttempts', label: '连续超时次数', max: 5 },
                  ] as const
                ).map((item) => (
                  <form.Field key={item.name} name={item.name}>
                    {(field) => (
                      <Field data-invalid={field.state.meta.errors.length > 0}>
                        <FieldLabel htmlFor={item.name}>
                          {item.label}
                          <span className="text-xs text-muted-foreground">(1–{item.max})</span>
                        </FieldLabel>
                        <Input
                          id={item.name}
                          type="number"
                          min={1}
                          max={item.max}
                          step={1}
                          disabled={busy || isSubmitting || clearing}
                          value={Number.isNaN(field.state.value) ? '' : field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(event) => field.handleChange(event.target.valueAsNumber)}
                          aria-invalid={field.state.meta.errors.length > 0}
                        />
                        <FieldError
                          errors={field.state.meta.errors.map((message) => ({ message: String(message) }))}
                        />
                      </Field>
                    )}
                  </form.Field>
                ))}
              </section>
            </FieldGroup>
          </form>
          <p className="text-xs text-muted-foreground">测试连接会发送一条简短请求，可能产生费用。</p>
        </PopupPage>
      )}
    </form.Subscribe>
  );
}
