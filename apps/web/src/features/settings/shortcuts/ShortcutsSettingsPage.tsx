/**
 * @author Claude
 * @description Keyboard shortcuts settings page: searchable command/binding table with per-row edit, clear, reset, and a guarded reset-all action.
 */

import { useState } from 'react';
import { EraserIcon, PencilIcon, RotateCcwIcon, SearchIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { Badge } from '@octopus/ui/components/badge';
import { Button } from '@octopus/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@octopus/ui/components/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@octopus/ui/components/dialog';
import { Input } from '@octopus/ui/components/input';
import { Kbd } from '@octopus/ui/components/kbd';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@octopus/ui/components/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@octopus/ui/components/tooltip';
import { useI18n } from '@/i18n/use-i18n';
import { useShortcutsStore } from '@/stores/shortcuts';
import { resolveEffectiveBinding, SHORTCUT_CATALOG } from '@/lib/shortcuts';
import { SettingContainer } from '../Layout/SettingContainer';
import { ShortcutRecorder } from './ShortcutRecorder';
import { matchesShortcutQuery } from '@/features/settings/utils/shortcut-search';
import { useShortcutCommandLabels } from '@/features/settings/hooks/use-shortcut-command-labels';
import type { ShortcutCommandId } from '@/lib/shortcuts';

const CHROME_SHORTCUTS_URL = 'chrome://extensions/shortcuts';

/**
 * Renders the shortcut catalog with search and binding management inside the shared Settings frame.
 */
export function ShortcutsSettingsPage() {
  const { t } = useI18n();
  const commandLabels = useShortcutCommandLabels();
  const [query, setQuery] = useState('');
  const [recordingId, setRecordingId] = useState<ShortcutCommandId | null>(null);
  const [resetAllOpen, setResetAllOpen] = useState(false);
  const overrides = useShortcutsStore((state) => state.overrides);
  const clearBinding = useShortcutsStore((state) => state.clearBinding);
  const resetBinding = useShortcutsStore((state) => state.resetBinding);
  const resetAll = useShortcutsStore((state) => state.resetAll);

  const rows = SHORTCUT_CATALOG.map((definition) => ({
    definition,
    label: commandLabels[definition.id],
    binding: resolveEffectiveBinding(overrides, definition.id),
    hasOverride: definition.id in overrides,
  })).filter((row) => matchesShortcutQuery({ label: row.label, combo: row.binding }, query));

  return (
    <SettingContainer>
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.shortcuts.title', 'Keyboard shortcuts')}</CardTitle>
          <CardDescription>
            {t(
              'settings.shortcuts.description',
              'View and customize keyboard shortcuts. Changes apply immediately and are stored on this device.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Alert role="note">
            <AlertDescription>
              <p>
                {t(
                  'settings.shortcuts.externalConflictHint',
                  'Shortcut not responding? Your browser, extensions, or operating system may use the same keys. Try a different combination.'
                )}
              </p>
              <p>
                {t(
                  'settings.shortcuts.chromeShortcutsHint',
                  'In Chrome, paste this address into the address bar to check extension shortcuts:'
                )}{' '}
                <code className="break-all" translate="no">
                  {CHROME_SHORTCUTS_URL}
                </code>
              </p>
            </AlertDescription>
          </Alert>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('settings.shortcuts.searchPlaceholder', 'Search shortcuts')}
                className="pl-8"
              />
            </div>
            <Button variant="outline" onClick={() => setResetAllOpen(true)}>
              {t('settings.shortcuts.resetAll', 'Reset all to defaults')}
            </Button>
          </div>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="font-bold">
                  {t('settings.shortcuts.columnCommand', 'Command')}
                </TableHead>
                <TableHead className="w-64 font-bold">
                  {t('settings.shortcuts.columnBinding', 'Key binding')}
                </TableHead>
                <TableHead className="w-28 font-bold">
                  {t('settings.shortcuts.columnActions', 'Actions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    {t('settings.shortcuts.empty', 'No shortcuts match your search.')}
                  </TableCell>
                </TableRow>
              )}
              {rows.map((row) => (
                <TableRow key={row.definition.id}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      {row.label}
                      {row.definition.status === 'placeholder' && (
                        <Badge variant="secondary">{t('settings.shortcuts.comingSoon', 'Coming soon')}</Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    {recordingId === row.definition.id ? (
                      <ShortcutRecorder
                        commandId={row.definition.id}
                        onFinished={() => setRecordingId(null)}
                      />
                    ) : (
                      <span className="flex h-8 items-center">
                        {row.binding === null ? (
                          <span className="text-muted-foreground">
                            {t('settings.shortcuts.notSet', 'Not set')}
                          </span>
                        ) : (
                          <Kbd className="font-geist tracking-widest">{row.binding}</Kbd>
                        )}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.definition.status === 'active' && recordingId !== row.definition.id && (
                      <span className="inline-flex items-center gap-1">
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label="Edit shortcut"
                                onClick={() => setRecordingId(row.definition.id)}
                              >
                                <PencilIcon />
                              </Button>
                            }
                          />
                          <TooltipContent>{t('settings.shortcuts.edit', 'Edit shortcut')}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label="Clear shortcut"
                                disabled={row.binding === null}
                                onClick={() => clearBinding(row.definition.id)}
                              >
                                <EraserIcon />
                              </Button>
                            }
                          />
                          <TooltipContent>{t('settings.shortcuts.clear', 'Clear shortcut')}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label="Reset shortcut to default"
                                disabled={!row.hasOverride}
                                onClick={() => resetBinding(row.definition.id)}
                              >
                                <RotateCcwIcon />
                              </Button>
                            }
                          />
                          <TooltipContent>{t('settings.shortcuts.reset', 'Reset to default')}</TooltipContent>
                        </Tooltip>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Dialog open={resetAllOpen} onOpenChange={setResetAllOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.shortcuts.resetAllTitle', 'Reset all shortcuts?')}</DialogTitle>
            <DialogDescription>
              {t(
                'settings.shortcuts.resetAllDescription',
                'All custom bindings will be removed and every command returns to its default shortcut.'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetAllOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              onClick={() => {
                resetAll();
                setResetAllOpen(false);
              }}
            >
              {t('common.confirm', 'Confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingContainer>
  );
}
