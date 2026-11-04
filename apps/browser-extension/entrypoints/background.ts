/**
 * @author Codex
 * @description Composes the Native bridge, recording and skill services while retaining independent business lifecycle ownership.
 */
import { RecordingService } from '../src/lib/recording/recording-service';
import { ModelSettingsRepository } from '../src/lib/model-settings/model-settings-repository';
import { ModelSettingsService } from '../src/lib/model-settings/model-settings-service';
import { BrowserRouter } from '../src/browser-router';
import { SkillFileClient } from '../src/lib/skill-library/skill-file-client';
import { BuiltinAgentService } from '../src/lib/builtin-agent/builtin-service';
import { deleteRetiredWorkflowDatabase } from '../src/lib/builtin-agent/skill-session-repository';
import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { createNativeBridge } from '../src/lib/native-bridge';

export default defineBackground({
  type: 'module',
  /**
   * Registers synchronous lifecycle listeners before starting asynchronous initialization.
   */
  main() {
    const router = new BrowserRouter();
    const modelSettingsRepository = new ModelSettingsRepository();
    const modelSettingsService = new ModelSettingsService(modelSettingsRepository);
    browser.runtime.onConnect.addListener((port) => modelSettingsService.connect(port));
    let ownershipReady = false;
    const recording = new RecordingService(() => !ownershipReady || router.busy());
    browser.tabs.onActivated.addListener(({ tabId }) => recording.observe(tabId, 'tab_activate'));
    browser.tabs.onRemoved.addListener((tabId) => recording.observe(tabId, 'tab_close'));
    browser.permissions.onRemoved.addListener(() => recording.availabilityChanged());
    browser.tabs.onUpdated.addListener((_id, changes) => {
      if (changes.frozen === true || changes.discarded === true) {
        recording.availabilityChanged();
      }
    });
    browser.tabs.onMoved.addListener((tabId) => recording.observe(tabId, 'tab_move'));
    browser.tabs.onDetached.addListener((tabId) => recording.observe(tabId, 'tab_move', '', true));
    browser.tabs.onReplaced.addListener((_added, removed) => recording.observe(removed, 'tab_close'));
    browser.webNavigation.onCommitted.addListener((event) => {
      if (event.frameId === 0) {
        recording.observe(event.tabId, 'navigate', event.url);
      }
    });
    browser.webNavigation.onHistoryStateUpdated.addListener((event) => {
      if (event.frameId === 0) {
        recording.observe(event.tabId, 'navigate', event.url);
      }
    });
    const bridge = createNativeBridge(router);
    const skillFiles = new SkillFileClient(bridge.getSession);
    const skills = new BuiltinAgentService(router, skillFiles, modelSettingsRepository);
    browser.runtime.onMessage.addListener((message: unknown, sender) => {
      if (
        sender.id === browser.runtime.id &&
        message &&
        typeof message === 'object' &&
        'type' in message &&
        ['recorder.start', 'recorder.resume'].includes(String(message.type))
      ) {
        return skills.ready().then(
          () => {
            ownershipReady = true;
            return recording.receive(message, sender);
          },
          () => ({ ok: false, error: 'RECORDING_BUSY' })
        );
      }
      return recording.receive(message, sender);
    });
    void skills.ready().then(
      () => {
        ownershipReady = true;
      },
      () => {
        ownershipReady = false;
      }
    );
    router.setRecordingAdmission(async (method) => {
      await skills.ready();
      ownershipReady = true;
      await recording.admitBridge(method);
    });
    browser.runtime.onMessage.addListener((message, sender) => skills.receive(message, sender));
    browser.runtime.onConnect.addListener((port) => skills.connect(port));
    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'octopus-skills-watchdog') {
        skills.check();
      }
    });
    browser.runtime.onInstalled.addListener(() => {
      void Promise.all([
        browser.storage.local.remove(['workflowJob', 'workflowHistory']),
        deleteRetiredWorkflowDatabase(),
      ]).catch(() =>
        console.warn('Retired workflow data cleanup failed; reload after closing old extension pages.')
      );
    });
    bridge.start(skillFiles);
  },
});
