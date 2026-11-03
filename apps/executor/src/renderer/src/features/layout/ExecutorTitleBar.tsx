/**
 * @author Codex
 * @description Composes the draggable app title and page navigation while reserving the native window controls.
 */
import { TabsList, TabsTrigger } from '@octopus/ui/components/tabs';
import appIcon from '../../../../../assets/brand/app.ico';

/**
 * Leaves native minimize, maximize and close behavior in the Electron window owner.
 */
export function ExecutorTitleBar() {
  return (
    <header className="executor-titlebar shrink-0 bg-background">
      <div className="executor-titlebar-content flex items-center px-5">
        <div className="hidden shrink-0 items-center gap-2 select-none sm:flex">
          <img src={appIcon} className="size-5 object-contain" alt="" aria-hidden="true" draggable={false} />
          <span className="hidden text-sm font-semibold sm:inline">Executor</span>
        </div>
      </div>
      <TabsList aria-label="执行器页面" className="executor-titlebar-tabs executor-no-drag w-32 sm:w-48">
        <TabsTrigger value="status">状态</TabsTrigger>
        <TabsTrigger value="connections">连接</TabsTrigger>
        <TabsTrigger value="settings">设置</TabsTrigger>
      </TabsList>
    </header>
  );
}
