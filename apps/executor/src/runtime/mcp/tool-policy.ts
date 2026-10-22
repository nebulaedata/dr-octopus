/**
 * @author Codex
 * @description Owns the explicit read-only preset and presentation metadata for the finite Executor tool catalog.
 */
import {
  policyToolNameSchema,
  type PolicyTool,
  type PolicyToolName,
  type ToolPolicySettings,
} from '../../contracts/tool-policy';

const definitions: Record<PolicyToolName, [string, PolicyTool['group'], boolean, string]> = {
  read: ['读取文件', 'basic', true, '读取本地文本与工具输出'],
  grep: ['搜索内容', 'basic', true, '在文件中搜索文本'],
  find: ['查找文件', 'basic', true, '按名称与路径查找文件'],
  ls: ['列出目录', 'basic', true, '查看目录下的文件与文件夹'],
  write: ['写入文件', 'basic', false, '创建或完整写入文件'],
  edit: ['编辑文件', 'basic', false, '精确替换文件中的内容'],
  powershell: ['执行命令', 'basic', false, '运行 Windows PowerShell 命令'],
  runtime_status: ['执行器状态', 'control', true, '读取设备与授权状态'],
  task_start: ['开始任务', 'control', true, '创建任务执行上下文'],
  task_status: ['任务状态', 'control', true, '读取当前任务与操作结果'],
  task_end: ['结束任务', 'control', true, '结束空闲任务并释放资源'],
  task_stop: ['停止任务', 'control', true, '停止派发并收束当前任务'],
  file_upload_prepare: ['准备上传', 'transfer', false, '将客户端文件上传到执行器'],
  file_download_prepare: ['准备下载', 'transfer', true, '准备本地文件的下载快照'],
  file_transfer_status: ['传输状态', 'transfer', true, '读取任务所属传输状态'],
  file_transfer_cancel: ['取消传输', 'transfer', true, '停止传输并收束资源'],
  browser_list: ['浏览器列表', 'browser', true, '列出已授权浏览器连接'],
  browser_tabs: ['标签页列表', 'browser', true, '列出可访问的标签页'],
  browser_snapshot: ['页面快照', 'browser', true, '观察页面；截图时可能激活标签页'],
  browser_read_snapshot: ['读取页面快照', 'browser', true, '继续读取已有快照'],
  browser_open_tab: ['新建标签页', 'browser', false, '创建任务所属标签页'],
  browser_navigate: ['导航页面', 'browser', false, '打开新的页面地址'],
  browser_close_tab: ['关闭标签页', 'browser', false, '关闭任务创建的标签页'],
  browser_click: ['点击页面', 'browser', false, '点击页面元素'],
  browser_fill: ['填写页面', 'browser', false, '向页面输入文字'],
  browser_select: ['选择页面选项', 'browser', false, '选择下拉框选项'],
  browser_scroll: ['滚动页面', 'browser', false, '滚动浏览器页面'],
  'computer.screenshot': ['桌面截图', 'computer', true, '观察桌面；上游可能取得输入控制权'],
  'computer.snapshot': ['桌面快照', 'computer', true, '观察窗口结构与截图'],
  'computer.display.list': ['显示器列表', 'computer', true, '读取显示器信息；上游可能取得输入控制权'],
  'computer.control.status': ['桌面控制状态', 'computer', true, '读取当前输入控制状态'],
  'computer.click': ['点击桌面', 'computer', false, '点击指定桌面坐标'],
  'computer.type': ['输入文字', 'computer', false, '在桌面应用中输入文字'],
  'computer.scroll': ['滚动桌面', 'computer', false, '滚动桌面应用内容'],
  'computer.shortcut': ['发送快捷键', 'computer', false, '向前台应用发送组合键'],
  'computer.app.switch': ['切换应用', 'computer', false, '切换到指定应用窗口'],
};
export const policyTools: PolicyTool[] = Object.entries(definitions).map(
  ([name, [label, group, readOnly, description]]) => ({
    name: policyToolNameSchema.parse(name),
    label,
    group,
    readOnly,
    description,
  })
);

/**
 * Resolves only explicit tool switches; presets never grant device capabilities or change tool arguments.
 */
export function selectedPolicyTools(settings: ToolPolicySettings): PolicyToolName[] {
  if (settings.selectedId === 'all') {
    return policyTools.map((tool) => tool.name);
  }
  if (settings.selectedId === 'readonly') {
    return policyTools.filter((tool) => tool.readOnly).map((tool) => tool.name);
  }
  const policy = settings.custom.find((item) => item.id === settings.selectedId);
  if (!policy) {
    throw new Error('Selected tool policy does not exist.');
  }
  return [...policy.enabledTools];
}
