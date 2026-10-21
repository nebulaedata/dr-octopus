/**
 * @author Codex
 * @description Separates immediately effective theme and window preferences from next-start MCP listener settings.
 */
import { deviceNameSchema } from '../../../../contracts/device-identity';
import { useEffect, useState } from 'react';
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@octopus/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@octopus/ui/components/tooltip';
import { Badge } from '@octopus/ui/components/badge';
import { toast } from '@octopus/ui/components/toast';
import { Input } from '@octopus/ui/components/input';
import { Card, CardHeader, CardTitle, CardContent } from '@octopus/ui/components/card';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldContent,
  FieldError,
} from '@octopus/ui/components/field';
import { Switch } from '@octopus/ui/components/switch';
import { Separator } from '@octopus/ui/components/separator';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@octopus/ui/components/select';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { CheckCircle2Icon, CircleAlertIcon, ClockIcon, CircleIcon, RefreshCwIcon } from 'lucide-react';
import { connectionSettingsQuery, networkAddressesQuery } from '@/queries/connection-settings-queries';
import { saveConnectionSettings } from '@/api/connection-settings';
import type { SettingsInput } from '../../../../contracts/connection-settings';
import {
  defaultTransferSettings,
  transferSettingsSchema,
  type TransferSettings,
} from '../../../../contracts/transfer-settings';

const transferFields = [
  {
    key: 'uploadLimitMiB',
    label: '上传单文件上限（MiB）',
    description: '智能体传入本机的单个文件，最大 2048 MiB（2 GiB）。',
    min: 1,
    max: 2048,
  },
  {
    key: 'downloadLimitMiB',
    label: '下载单文件上限（MiB）',
    description: '本机传给智能体的单个文件，最大 2048 MiB（2 GiB）。',
    min: 1,
    max: 2048,
  },
  {
    key: 'temporaryQuotaMiB',
    label: '临时存储总额度（MiB）',
    description: '含快照与残留，不低于单文件上限。',
    min: 1,
    max: 1048576,
  },
  {
    key: 'minimumFreeSpaceMiB',
    label: '最低剩余磁盘空间（MiB）',
    description: '分配传输空间后，在实际写入的磁盘上额外保留的可用空间。',
    min: 0,
    max: 1048576,
  },
] as const;

/**
 * Keeps numeric drafts as strings so empty and intermediate edits remain visible for validation.
 */
function transferDraft(settings: TransferSettings): Record<keyof TransferSettings, string> {
  return {
    uploadLimitMiB: String(settings.uploadLimitMiB),
    downloadLimitMiB: String(settings.downloadLimitMiB),
    temporaryQuotaMiB: String(settings.temporaryQuotaMiB),
    minimumFreeSpaceMiB: String(settings.minimumFreeSpaceMiB),
  };
}

/**
 * Saves only dirty valid values and leaves current tasks and listeners running until the next application start.
 */
export function ConnectionSettings({
  onDirtyChange,
  focusService = false,
}: { onDirtyChange?: (dirty: boolean) => void; focusService?: boolean } = {}) {
  const restarting = useMutationState({
    filters: { mutationKey: ['executor', 'restart'] },
    select: (mutation) => mutation.state.status === 'pending' || mutation.state.status === 'success',
  }).some(Boolean);
  const query = useQuery(connectionSettingsQuery);
  useEffect(() => {
    if (focusService && query.isSuccess) {
      const heading = document.getElementById('service-settings-heading');
      heading?.scrollIntoView({ block: 'start' });
      heading?.focus({ preventScroll: true });
    }
  }, [focusService, query.isSuccess]);
  const cache = useQueryClient();
  const [draft, setDraft] = useState<{
    deviceName: string;
    port: string;
    enabled: boolean;
    address: string;
    closeBehavior: SettingsInput['closeBehavior'];
    themeSource: SettingsInput['themeSource'];
    transfer: Record<keyof TransferSettings, string>;
  } | null>(null);
  const mutation = useMutation({
    mutationKey: connectionSettingsQuery.queryKey,
    mutationFn: saveConnectionSettings,
    networkMode: 'always',
    retry: false,
    onSuccess: (settings) => {
      cache.setQueryData(connectionSettingsQuery.queryKey, settings);
      setDraft(null);
      toast.add({
        id: 'save-settings',
        type: 'success',
        title: '设置已保存。',
        description: settings.pendingRestart
          ? '设备、服务或文件传输设置将在完整重启执行器后生效。'
          : undefined,
      });
    },
    onError: (error) => {
      void cache.invalidateQueries({ queryKey: connectionSettingsQuery.queryKey });
      toast.add({ id: 'save-settings', type: 'error', title: error.message });
    },
  });
  const values = draft ?? {
    deviceName: query.data?.deviceName ?? '',
    closeBehavior: query.data?.closeBehavior ?? 'tray',
    themeSource: query.data?.themeSource ?? 'system',
    port: String(query.data?.port ?? 19876),
    enabled: !!query.data?.networkAddress,
    address: query.data?.networkAddress ?? '',
    transfer: transferDraft(query.data?.transfer ?? defaultTransferSettings),
  };
  const networkAddresses = useQuery({ ...networkAddressesQuery, enabled: values.enabled });
  const availableAddresses = networkAddresses.data ?? [];
  const selectedAvailable = availableAddresses.some((item) => item.address === values.address);
  const pendingNetwork = values.enabled && networkAddresses.isFetching;
  const networkSelectionValid =
    !values.enabled || (networkAddresses.isSuccess && !networkAddresses.isFetching && selectedAvailable);
  let networkAddressError: string | null = null;
  if (values.enabled && networkAddresses.isError) {
    networkAddressError = '无法读取本机网络地址，请刷新重试；也可关闭内网访问，仅在本机使用。';
  } else if (values.enabled && networkAddresses.isSuccess && !selectedAvailable) {
    if (availableAddresses.length === 0) {
      networkAddressError = '未检测到可用的内网 / VPN IPv4 地址。请连接网络或 VPN 后刷新，或关闭内网访问。';
    } else if (values.address) {
      networkAddressError = `地址 ${values.address} 当前不在本机。请重新选择，或关闭内网访问。`;
    } else {
      networkAddressError = '请选择本机内网 / VPN IPv4 地址。';
    }
  }
  const addressOptions = availableAddresses.map((item) => ({
    value: item.address,
    label: `${item.interfaceName} · ${item.address}`,
    disabled: false,
  }));
  if (values.address && !selectedAvailable) {
    let label = `${values.address}（当前不可用）`;
    if (pendingNetwork) {
      label = `${values.address}（正在检测）`;
    } else if (networkAddresses.isError) {
      label = `${values.address}（可用性未知）`;
    }
    addressOptions.unshift({ value: values.address, label, disabled: true });
  }
  const transfer = Object.fromEntries(
    transferFields.map(({ key }) => [
      key,
      values.transfer[key].trim() ? Number(values.transfer[key]) : Number.NaN,
    ])
  );
  const transferValidation = transferSettingsSchema.safeParse(transfer);
  const transferErrors = transferValidation.success ? [] : transferValidation.error.issues;
  const invalidName = !deviceNameSchema.safeParse(values.deviceName).success;
  const invalidAddress = !!networkAddressError;
  const port = Number(values.port);
  const invalidPort = !values.port || !Number.isInteger(port) || port < 1 || port > 65535;
  const dirty =
    !!query.data &&
    (transferFields.some(({ key }) => transfer[key] !== query.data!.transfer[key]) ||
      values.deviceName.trim() !== query.data.deviceName ||
      values.themeSource !== query.data.themeSource ||
      values.closeBehavior !== query.data.closeBehavior ||
      port !== query.data.port ||
      (values.enabled ? values.address : null) !== query.data.networkAddress);
  const error = query.error;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const disabled = !query.data || mutation.isPending || restarting;
  return (
    <section aria-label="应用设置" className="flex flex-col gap-7">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-3xl font-semibold tracking-tight">应用设置</h1>
        <p className="text-sm text-muted-foreground">管理界面主题、窗口行为与客户端接入方式。</p>
      </div>
      <form
        className="flex flex-col gap-8"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            !transferValidation.success ||
            invalidName ||
            invalidAddress ||
            invalidPort ||
            !networkSelectionValid
          ) {
            return;
          }
          mutation.mutate({
            transfer: transferValidation.data,
            deviceName: values.deviceName,
            closeBehavior: values.closeBehavior,
            themeSource: values.themeSource,
            port,
            networkAddress: values.enabled ? values.address : null,
          });
        }}
      >
        <section className="flex flex-col gap-5" aria-labelledby="window-settings-heading">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="window-settings-heading" className="text-xl font-semibold">
              界面与窗口
            </h2>
            <Badge variant="secondary">
              <CheckCircle2Icon />
              保存后立即生效
            </Badge>
          </div>
          <FieldGroup>
            <Field
              className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
              data-disabled={disabled}
            >
              <FieldContent>
                <FieldLabel htmlFor="theme-source">界面主题</FieldLabel>
                <FieldDescription>跟随系统时，系统主题变化会立即同步到界面。</FieldDescription>
              </FieldContent>
              <Select
                value={values.themeSource}
                items={[
                  { value: 'system', label: '跟随系统' },
                  { value: 'light', label: '明亮' },
                  { value: 'dark', label: '暗黑' },
                ]}
                disabled={disabled}
                onValueChange={(value) => {
                  if (value === 'system' || value === 'light' || value === 'dark') {
                    mutation.reset();
                    setDraft({ ...values, themeSource: value });
                  }
                }}
              >
                <SelectTrigger id="theme-source" className="w-full max-w-60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="system">跟随系统</SelectItem>
                    <SelectItem value="light">明亮</SelectItem>
                    <SelectItem value="dark">暗黑</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field
              className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
              data-disabled={disabled}
            >
              <FieldContent>
                <FieldLabel htmlFor="close-behavior">关闭窗口时</FieldLabel>
                <FieldDescription>
                  {values.closeBehavior === 'exit'
                    ? '关闭窗口并退出执行器，后台服务也会停止。'
                    : '关闭窗口后，执行器继续在后台运行。'}
                </FieldDescription>
              </FieldContent>
              <div className="flex min-w-0 w-full flex-col gap-2">
                <Select
                  value={values.closeBehavior}
                  items={[
                    { value: 'exit', label: '关闭窗口和服务' },
                    { value: 'taskbar', label: '最小化到任务栏' },
                    { value: 'tray', label: '最小化到系统托盘' },
                  ]}
                  disabled={disabled}
                  onValueChange={(value) => {
                    if (value === 'exit' || value === 'taskbar' || value === 'tray') {
                      mutation.reset();
                      setDraft({ ...values, closeBehavior: value });
                    }
                  }}
                >
                  <SelectTrigger id="close-behavior" className="w-full max-w-60">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="exit">关闭窗口和服务</SelectItem>
                      <SelectItem value="taskbar">最小化到任务栏</SelectItem>
                      <SelectItem value="tray">最小化到系统托盘</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {values.closeBehavior === 'exit'
                    ? '再次打开执行器时，后台服务会重新启动。'
                    : '完全退出请使用系统托盘菜单。'}
                </FieldDescription>
              </div>
            </Field>
          </FieldGroup>
        </section>
        <section className="flex flex-col gap-5" aria-labelledby="device-settings-heading">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="device-settings-heading" className="text-xl font-semibold">
              设备身份
            </h2>
            <Badge id="device-name-effect" variant="secondary">
              <ClockIcon />
              保存并重启后生效
            </Badge>
          </div>
          <FieldGroup>
            <Field
              className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
              data-disabled={disabled}
              data-invalid={invalidName}
            >
              <FieldContent>
                <FieldLabel htmlFor="device-name">设备名称</FieldLabel>
                <FieldDescription>智能体使用此名称说明操作对象。</FieldDescription>
              </FieldContent>
              <div className="flex min-w-0 w-full flex-col gap-2">
                <Input
                  id="device-name"
                  name="device-name"
                  value={values.deviceName}
                  className="w-full max-w-60"
                  disabled={disabled}
                  required
                  aria-invalid={invalidName}
                  aria-describedby={
                    invalidName ? 'device-name-effect device-name-error' : 'device-name-effect'
                  }
                  onChange={(event) => {
                    mutation.reset();
                    setDraft({ ...values, deviceName: event.target.value });
                  }}
                />
                {invalidName ? (
                  <FieldError id="device-name-error">请输入 1–64 个字符，不包含换行或控制字符。</FieldError>
                ) : null}
              </div>
            </Field>
          </FieldGroup>
          {query.data ? (
            <Card size="sm" aria-labelledby="active-device-heading">
              <CardHeader>
                <CardTitle id="active-device-heading">当前设备信息</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p>
                  <span className="text-muted-foreground">当前生效名称：</span>
                  {query.data.device.deviceName}
                </p>
                <p className="break-all">
                  <span className="text-muted-foreground">设备 ID：</span>
                  <span className="font-mono">{query.data.device.deviceId}</span>
                </p>
                {query.data.deviceName !== query.data.device.deviceName ? (
                  <p role="status" className="text-muted-foreground">
                    待重启生效名称：{query.data.deviceName}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </section>
        <section className="flex flex-col gap-5" aria-labelledby="service-settings-heading">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="service-settings-heading" tabIndex={-1} className="text-xl font-semibold">
                服务接入
              </h2>
              <Badge variant="secondary">
                <ClockIcon />
                保存并重启后生效
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">修改端口或网络设置后，需保存并重启执行器。</p>
          </div>
          <FieldGroup>
            <Field
              className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
              data-disabled={disabled}
              data-invalid={!!invalidPort}
            >
              <FieldContent>
                <FieldLabel htmlFor="next-port">MCP 服务端口</FieldLabel>
                <FieldDescription>修改后需更新客户端中的连接地址。</FieldDescription>
              </FieldContent>
              <div className="flex min-w-0 w-full flex-col gap-2">
                <Input
                  id="next-port"
                  name="mcp-port"
                  type="number"
                  min={1}
                  max={65535}
                  step={1}
                  required
                  value={values.port}
                  className="w-full max-w-60"
                  disabled={disabled}
                  aria-invalid={!!invalidPort}
                  aria-describedby={invalidPort ? 'port-error' : undefined}
                  onChange={(event) => {
                    mutation.reset();
                    setDraft({ ...values, port: event.target.value });
                  }}
                />
                {invalidPort ? (
                  <FieldError id="port-error">请输入 1–65535 之间的整数端口。</FieldError>
                ) : null}
              </div>
            </Field>
            <Field
              className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
              data-disabled={disabled}
            >
              <FieldContent>
                <FieldLabel htmlFor="network-enabled">允许内网 / VPN 客户端连接</FieldLabel>
                <FieldDescription>开启后选择本机网卡地址，客户端仍需访问授权。</FieldDescription>
              </FieldContent>
              <Switch
                id="network-enabled"
                checked={values.enabled}
                disabled={disabled}
                onCheckedChange={(enabled) => {
                  mutation.reset();
                  setDraft({ ...values, enabled });
                }}
              />
            </Field>
            {values.enabled ? (
              <Field
                className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
                data-invalid={invalidAddress}
                data-disabled={disabled}
              >
                <FieldContent>
                  <FieldLabel htmlFor="network-address">本机内网 / VPN IPv4 地址</FieldLabel>
                  <FieldDescription>
                    选择其他电脑可访问的网卡地址。切换网络或连接 VPN 后，可刷新列表。
                  </FieldDescription>
                </FieldContent>
                <div className="flex min-w-0 w-full flex-col gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Select
                      value={values.address || null}
                      items={addressOptions}
                      disabled={
                        disabled ||
                        pendingNetwork ||
                        !networkAddresses.isSuccess ||
                        availableAddresses.length === 0
                      }
                      onValueChange={(address) => {
                        if (address && availableAddresses.some((item) => item.address === address)) {
                          mutation.reset();
                          setDraft({ ...values, address });
                        }
                      }}
                    >
                      <SelectTrigger
                        id="network-address"
                        className="w-full max-w-60"
                        aria-invalid={invalidAddress}
                        aria-describedby={invalidAddress ? 'network-address-error' : 'network-address-status'}
                      >
                        <SelectValue className="min-w-0 truncate" placeholder="选择本机网卡地址" />
                      </SelectTrigger>
                      <SelectContent className="max-w-[calc(100vw-2rem)]">
                        <SelectGroup>
                          {addressOptions.map((item) => (
                            <SelectItem key={item.value} value={item.value} disabled={item.disabled}>
                              <span className="truncate" title={item.label}>
                                {item.label}
                              </span>
                            </SelectItem>
                          ))}
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
                            disabled={disabled || pendingNetwork}
                            aria-label="刷新本机网络地址"
                            onClick={async () => {
                              await networkAddresses.refetch({ throwOnError: false });
                            }}
                          />
                        }
                      >
                        <RefreshCwIcon />
                      </TooltipTrigger>
                      <TooltipContent role="tooltip">刷新本机网络地址</TooltipContent>
                    </Tooltip>
                  </div>
                  <FieldDescription id="network-address-status" role="status">
                    {pendingNetwork
                      ? '正在检测本机网络地址…'
                      : '仅列出本机内网 / VPN IPv4 地址；选择后需保存并重启应用。'}
                  </FieldDescription>
                  {networkAddressError ? (
                    <FieldError id="network-address-error">{networkAddressError}</FieldError>
                  ) : null}
                </div>
              </Field>
            ) : null}
          </FieldGroup>
        </section>
        <section className="flex flex-col gap-5" aria-labelledby="transfer-settings-heading">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="transfer-settings-heading" className="text-xl font-semibold">
                文件传输
              </h2>
              <Badge variant="secondary">
                <ClockIcon />
                保存并重启后生效
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              这些额度只管理执行体本机；智能体环境的磁盘额度由其客户端独立管理。
            </p>
          </div>
          <FieldGroup>
            {transferFields.map((field) => {
              const invalid = transferErrors.some((issue) => issue.path[0] === field.key);
              const id = `transfer-${field.key}`;
              return (
                <Field
                  key={field.key}
                  className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
                  data-disabled={disabled}
                  data-invalid={invalid}
                >
                  <FieldContent>
                    <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
                    <FieldDescription id={`${id}-description`}>{field.description}</FieldDescription>
                  </FieldContent>
                  <div className="flex min-w-0 w-full flex-col gap-2">
                    <Input
                      id={id}
                      name={id}
                      type="number"
                      min={field.min}
                      max={field.max}
                      step={1}
                      required
                      className="w-full max-w-60"
                      disabled={disabled}
                      value={values.transfer[field.key]}
                      aria-invalid={invalid}
                      aria-describedby={`${id}-description${invalid ? ` ${id}-error` : ''}`}
                      onChange={(event) => {
                        mutation.reset();
                        setDraft({
                          ...values,
                          transfer: { ...values.transfer, [field.key]: event.target.value },
                        });
                      }}
                    />
                    {invalid ? (
                      <FieldError id={`${id}-error`}>
                        {field.key === 'temporaryQuotaMiB'
                          ? '请输入范围内的整数，且不能小于上传或下载单文件上限。'
                          : `请输入 ${field.min}–${field.max} 之间的整数。`}
                      </FieldError>
                    ) : null}
                  </div>
                </Field>
              );
            })}
          </FieldGroup>
        </section>
        <div className="flex flex-col gap-5">
          <Separator />
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {dirty ? (
              <p className="flex items-center gap-2 text-sm" role="status">
                <CircleIcon className="size-2 fill-current text-amber-600" aria-hidden="true" />
                有未保存的更改
              </p>
            ) : null}
            <Button
              className="self-end sm:ml-auto"
              disabled={
                disabled ||
                !dirty ||
                invalidName ||
                !!invalidPort ||
                invalidAddress ||
                !networkSelectionValid ||
                !transferValidation.success
              }
              type="submit"
            >
              {mutation.isPending ? '保存中…' : '保存设置'}
            </Button>
          </div>
        </div>
      </form>
      {error ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
