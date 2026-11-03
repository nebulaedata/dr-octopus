/**
 * @author Codex
 * @description Composes a searchable free-text model field with explicit, page-scoped provider discovery.
 */
import { useEffect, useRef, useState } from 'react';
import { RefreshCwIcon, LoaderCircleIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from '@octopus/ui/components/combobox';
import { Empty, EmptyHeader, EmptyDescription } from '@octopus/ui/components/empty';
import { ScrollArea } from '@octopus/ui/components/scroll-area';
import { modelSettingsRequest } from '../../lib/model-settings/model-settings-client';
import { modelSettingsSchema } from '../../lib/model-settings/model-settings-messages';

/**
 * Keeps candidates transient and aborts obsolete requests on credential/address changes or unmount.
 * The form remains the sole owner of the editable model value.
 */
export function ModelPicker({
  active = true,
  baseUrl,
  apiKey,
  value,
  onChange,
  onBlur,
  invalid,
  disabled,
}: {
  active?: boolean;
  baseUrl: string;
  apiKey: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  invalid: boolean;
  disabled: boolean;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    request.current?.abort();
    request.current = null;
    setModels([]);
    setLoading(false);
    setError(false);
    setLoaded(false);
    return () => {
      request.current?.abort();
    };
  }, [baseUrl, apiKey, active]);

  /**
   * Only the still-current request may publish candidates or feedback; retries require another click.
   */
  async function pull() {
    if (request.current || disabled) {
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(false);
    try {
      const result = await modelSettingsRequest<string[]>(
        { type: 'models', baseUrl, apiKey: apiKey || undefined },
        controller.signal
      );
      if (!controller.signal.aborted && request.current === controller) {
        setModels(result);
        setLoaded(true);
      }
    } catch {
      if (!controller.signal.aborted && request.current === controller) {
        setError(true);
      }
    } finally {
      if (!controller.signal.aborted && request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }

  return (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <Combobox
          items={models}
          autoHighlight
          inputValue={value}
          value={value || null}
          onInputValueChange={(next, details) => {
            if (details.reason === 'input-change') {
              onChange(next);
            }
          }}
          onValueChange={(next) => {
            if (next !== null) {
              onChange(next);
            }
          }}
          disabled={disabled}
        >
          <ComboboxInput
            id="model-name"
            name="model"
            className="min-w-0 flex-1"
            placeholder="输入或选择模型"
            onBlur={onBlur}
            onKeyDown={(event) => {
              // Enter selects a candidate or retains custom text; it must not submit a paid task.
              if (event.key === 'Enter') {
                event.preventDefault();
              }
            }}
            aria-invalid={invalid}
          />
          <ComboboxContent side="top" className="min-w-0">
            <ComboboxEmpty>
              <Empty className="gap-1 p-3">
                <EmptyHeader>
                  <EmptyDescription>
                    {error
                      ? '拉取失败，可手动填写模型 ID'
                      : loaded
                        ? '没有匹配模型，可直接输入模型 ID'
                        : '可先拉取列表，或直接输入模型 ID'}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </ComboboxEmpty>
            <ScrollArea className="max-h-[min(200px,var(--available-height))] [&_[data-slot=scroll-area-viewport]]:max-h-[min(200px,var(--available-height))]">
              <ComboboxList className="max-h-none overflow-visible">
                {(model: string) => (
                  <ComboboxItem key={model} value={model}>
                    <span className="truncate" title={model}>
                      {model}
                    </span>
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ScrollArea>
          </ComboboxContent>
        </Combobox>
        <Button
          type="button"
          className="shrink-0"
          disabled={disabled || loading || !modelSettingsSchema.shape.baseUrl.safeParse(baseUrl).success}
          onClick={() => {
            void pull();
          }}
        >
          {loading ? (
            <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
          ) : (
            <RefreshCwIcon className="size-4" />
          )}
          {loading ? '拉取中' : '拉取'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          拉取失败，请重试或手动填写模型 ID。
        </p>
      )}
      <span className="sr-only" role="status">
        {loading ? '正在拉取模型列表' : loaded && !error ? `已获取 ${models.length} 个模型` : ''}
      </span>
    </>
  );
}
