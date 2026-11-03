/**
 * @author Codex
 * @description Offers browser-copy export and explicit, idempotent local-directory publication without invoking an agent.
 */
import { useState } from 'react';
import { DownloadIcon, FolderIcon, ChevronDownIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { Alert } from '@octopus/custom-ui/components/alert';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from '@octopus/ui/components/dropdown-menu';
import { skillRequest } from '../../lib/builtin-agent/skill-client';
import { skillError } from '../../lib/builtin-agent/skill-messages';
import type { RecordingSkillBinding } from '../../lib/builtin-agent/skill-session-repository';
import { skillArchive } from '../../lib/skill-library/skill-export';

/**
 * Keeps file actions distinct from organization, replay and browser persistence.
 */
export function SkillFiles({
  binding,
  recordingId,
  connected,
  status,
}: {
  binding?: RecordingSkillBinding;
  recordingId: string;
  connected: boolean;
  status: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canOpen = binding?.storage === 'executor' && connected;
  /**
   * Acts only on the skill shown when the user clicked; Worker rejects changed associations.
   */
  async function act(kind: 'export' | 'save' | 'open') {
    if (!binding || busy) {
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (kind === 'export') {
        const cache = await skillRequest({ type: 'skill.export', recordingId, skillId: binding.skillId });
        const bytes = new Uint8Array(skillArchive(cache));
        const url = URL.createObjectURL(new Blob([bytes.buffer], { type: 'application/zip' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'skill-' + binding.skillId + '.zip';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        setNotice('已发起技能副本下载。');
      } else if (kind === 'save') {
        await skillRequest({ type: 'skill.save-to-executor', recordingId, skillId: binding.skillId });
        setNotice('已保存到本地目录。');
      } else {
        await skillRequest({ type: 'skill.open-directory', recordingId });
      }
    } catch (failure) {
      setError(skillError(failure instanceof Error ? failure.message : ''));
    } finally {
      setBusy(false);
    }
  }
  let primary = '导出技能';
  if (canOpen) {
    primary = '查看 SKILLS';
  } else if (binding?.storage === 'executor') {
    primary = '导出浏览器副本';
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{status}</span>
        <div className="flex shrink-0 gap-1">
          <Button
            variant="outline"
            disabled={busy || !binding || (!canOpen && !binding.cache)}
            onClick={() => void act(canOpen ? 'open' : 'export')}
          >
            {canOpen ? <FolderIcon data-icon="inline-start" /> : <DownloadIcon data-icon="inline-start" />}
            {primary}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="技能文件操作"
                  title="技能文件操作"
                  disabled={busy || !binding}
                />
              }
            >
              <ChevronDownIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem disabled={!binding?.cache} onClick={() => void act('export')}>
                  导出浏览器副本
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!connected || binding?.storage === 'executor'}
                  onClick={() => void act('save')}
                >
                  {binding?.diskSave ? '重试保存到本地目录' : '保存到本地目录'}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!canOpen} onClick={() => void act('open')}>
                  打开本地目录
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {error && <Alert variant="danger" description={error} />}
      {notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      )}
    </div>
  );
}
