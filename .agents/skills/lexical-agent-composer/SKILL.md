---
name: lexical-agent-composer
description: |
  Guide for building a generic agent Composer with @lexical/react, covering @ file mentions,
  / slash commands, and lexical-beautiful-mentions. 当用户想用 Lexical 构建智能体输入框、
  为 Composer 添加 @ 文件选择或 / 命令面板、或者在核心 Lexical 与 lexical-beautiful-mentions
  之间做选型时，务必使用此 skill。
compatibility:
  - React 18+
  - lexical / @lexical/react
  - optional: lexical-beautiful-mentions
---

# Lexical Agent Composer 开发指南

本 skill 用于指导基于 Lexical 与 `@lexical/react` 构建智能体通用 Composer 组件，
支持 `@` 文件选择、`/` 命令选择，并说明何时使用 `lexical-beautiful-mentions`。

## 输出模板

当本 skill 被触发时，按以下结构组织回答：

1. **技术选型建议**：核心 `LexicalTypeaheadMenuPlugin` 方案 vs `lexical-beautiful-mentions`
2. **核心数据模型**：自定义 Node 设计（`FileMentionNode`、`CommandTokenNode` 等）
3. **Composer 组件结构**：插件挂载顺序与上下文
4. **@ 文件选择实现**：触发、搜索、去抖、缓存、菜单渲染、选中插入
5. **/ 命令选择实现**：静态命令注册表与动态命令合成
6. **触发器互斥与边界处理**：`@` 与 `/` 不冲突、entity boundary、IME
7. **序列化与提交策略**：如何将 mention 节点还原为文件路径/ID，如何生成提交 payload
8. **常见陷阱与调试建议**
9. **下一步可执行清单**

如果用户只需要快速代码骨架，仍然先给出上面的结构摘要，再给出最小可运行示例。

## 一、技术选型建议

### 1.1 核心方案：`LexicalTypeaheadMenuPlugin`

Lexical 官方在 `@lexical/react` 中提供了通用的自动补全插件：

- `packages/lexical-react/src/LexicalTypeaheadMenuPlugin.tsx`
- `packages/lexical-react/src/shared/LexicalMenu.tsx`

它同时驱动官方 Playground 中的 Mentions 与 ComponentPicker（slash commands）。

**适合核心方案的场景**：
- 你需要完全控制菜单 UI、选中语义和命令副作用
- `/` 命令需要执行“插入块级节点、调起弹窗、切换列表”等非 mention 行为
- 需要动态合成选项（例如输入 `3x4` 生成“插入 3x4 表格”选项）

### 1.2 `lexical-beautiful-mentions`

第三方封装插件：`github.com/sodenn/lexical-beautiful-mentions`。

**适合 beautiful-mentions 的场景**：
- 需要多个触发字符（`@`、`#`、`due:`）甚至多字符触发
- 需要异步远程搜索（文件搜索、用户搜索）并自带 `searchDelay` 去抖与 `loading` 状态
- 需要 `creatable` 选项或每条 mention 携带额外 metadata
- 不需要 `/` 命令那种“执行动作”的语义

### 1.3 推荐组合

在一个智能体 Composer 中，通常同时需要：

- `@`：插入一个代表文件/用户的 token（mention 语义）
- `/`：执行一个命令（command 语义，不保留 token）

**推荐组合**：

- `@` 侧使用 `lexical-beautiful-mentions`（快速获得远程搜索、多触发、metadata）
- `/` 侧使用核心 `LexicalTypeaheadMenuPlugin`（完全控制命令执行）

如果项目不想引入第三方依赖，也可以把 `@` 和 `/` 都基于 `LexicalTypeaheadMenuPlugin`
自己实现，代码量更大但可控性最高。

## 二、核心数据模型

### 2.1 Node 继承关系

```
LexicalNode
├── TextNode
│   └── FileMentionNode
├── DecoratorNode
│   └── RichFilePreviewNode
└── ElementNode
```

### 2.2 FileMentionNode 要点

参考 `packages/lexical-playground/src/nodes/MentionNode.ts`：

```ts
export class FileMentionNode extends TextNode {
  __fileId: string;
  __filePath: string;

  static getType(): string { return 'file-mention'; }
  static clone(node: FileMentionNode): FileMentionNode {
    return new FileMentionNode(node.__fileId, node.__filePath, node.__text, node.__key);
  }

  constructor(fileId: string, filePath: string, text?: string, key?: NodeKey) {
    super(text ?? filePath, key);
    this.__fileId = fileId;
    this.__filePath = filePath;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    dom.classList.add('file-mention');
    dom.setAttribute('spellcheck', 'false');
    dom.setAttribute('data-file-id', this.__fileId);
    return dom;
  }

  static importJSON(serializedNode: SerializedFileMentionNode): FileMentionNode {
    return $createFileMentionNode(serializedNode.fileId, serializedNode.filePath, serializedNode.text);
  }

  exportJSON(): SerializedFileMentionNode {
    return {
      ...super.exportJSON(),
      type: 'file-mention',
      fileId: this.__fileId,
      filePath: this.__filePath,
      version: 1,
    };
  }

  isTextEntity(): true { return true; }
  canInsertTextBefore(): false { return false; }
  canInsertTextAfter(): false { return false; }
}

export function $createFileMentionNode(fileId: string, filePath: string, text?: string): FileMentionNode {
  const node = new FileMentionNode(fileId, filePath, text);
  node.setMode('segmented');
  return $applyNodeReplacement(node);
}

export function $isFileMentionNode(node: LexicalNode | null | undefined): node is FileMentionNode {
  return node instanceof FileMentionNode;
}
```

关键规则：

- 必须注册到 `LexicalComposer.initialConfig.nodes`
- 必须实现 `clone`、`importJSON`/`exportJSON`
- `setMode('segmented')` + `isTextEntity() => true` + `canInsertTextBefore/After() => false`
  让 mention 像一个原子 token，退格一次删除整个 pill
- `$applyNodeReplacement` 不可省略，否则复制粘贴/JSON 加载会丢失节点

## 三、Composer 组件结构

最小骨架：

```tsx
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';

import { FileMentionNode } from './nodes/FileMentionNode';
import { FileMentionsPlugin } from './plugins/FileMentionsPlugin';
import { SlashCommandsPlugin } from './plugins/SlashCommandsPlugin';

const initialConfig = {
  namespace: 'AgentComposer',
  nodes: [FileMentionNode],
  theme: {
    paragraph: 'composer-paragraph',
    fileMention: 'file-mention',
  },
  onError: (error: Error) => console.error(error),
};
export function AgentComposer({ onSubmit }: { onSubmit: (payload: ComposerPayload) => void }) {
  return (
    <LexicalComposer initialConfig={initialConfig}>
      <RichTextPlugin
        contentEditable={<ContentEditable className="composer-editable" />}
        placeholder={<div className="composer-placeholder">输入 / 查看命令，@ 引用文件…</div>}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <OnChangePlugin onChange={(editorState) => { /* 可在这里做提交前校验 */ }} />
      <FileMentionsPlugin />
      <SlashCommandsPlugin />
    </LexicalComposer>
  );
}
```

要点：

- 所有 plugin 必须作为 `LexicalComposer` 的子孙组件
- `useLexicalComposerContext()` 只能在 plugin 内部调用
- 先挂载 `RichTextPlugin`/`HistoryPlugin`，再挂载自定义 plugin

## 四、@ 文件选择实现

### 4.1 使用核心 `LexicalTypeaheadMenuPlugin`

```tsx
import { LexicalTypeaheadMenuPlugin, MenuOption, useBasicTypeaheadTriggerMatch } from '@lexical/react/LexicalTypeaheadMenuPlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $createFileMentionNode } from '../nodes/FileMentionNode';
import { useFileSearch } from '../hooks/useFileSearch';

class FileOption extends MenuOption {
  constructor(
    public readonly fileId: string,
    public readonly filePath: string,
    public readonly displayText: string,
  ) {
    super(fileId);
  }
}

function FileMentionsTypeahead() {
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState<string | null>(null);
  const options = useFileSearch(query); // 远程搜索 + 去抖 + 缓存

  const triggerFn = useBasicTypeaheadTriggerMatch('@', {
    minLength: 1,
    maxLength: 75,
  });

  const onSelectOption = useCallback(
    (option: FileOption, textNodeContainingQuery: TextNode | null, closeMenu: () => void, matchingString: string) => {
      editor.update(() => {
        const mentionNode = $createFileMentionNode(option.fileId, option.filePath, option.displayText);
        if (textNodeContainingQuery) {
          textNodeContainingQuery.replace(mentionNode);
        }
        mentionNode.selectEnd();
        closeMenu();
      });
    },
    [editor],
  );

  return (
    <LexicalTypeaheadMenuPlugin
      triggerFn={triggerFn}
      options={options}
      onQueryChange={setQuery}
      onSelectOption={onSelectOption}
      menuRenderFn={(
        anchorElementRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
        matchingString,
      ) =>
        anchorElementRef.current && options.length
          ? createPortal(
              <div className="mentions-menu" role="listbox">
                {options.map((option, i) => (
                  <div
                    key={option.key}
                    role="option"
                    aria-selected={i === selectedIndex}
                    className={i === selectedIndex ? 'selected' : ''}
                    ref={option.setRefElement}
                    onMouseEnter={() => setHighlightedIndex(i)}
                    onClick={() => selectOptionAndCleanUp(option)}
                  >
                    {option.displayText}
                  </div>
                ))}
              </div>,
              anchorElementRef.current,
            )
          : null
      }
    />
  );
}
```

### 4.2 使用 `lexical-beautiful-mentions`

```tsx
import { BeautifulMentionsPlugin, BeautifulMentionNode } from 'lexical-beautiful-mentions';

const initialConfig = {
  namespace: 'AgentComposer',
  nodes: [BeautifulMentionNode],
  // ...
};

function FileMentionsPlugin() {
  return (
    <BeautifulMentionsPlugin
      triggers={['@']}
      onSearch={async (trigger, query) => {
        const files = await searchFiles(query);
        return files.map(f => ({ value: f.path, data: { id: f.id } }));
      }}
      searchDelay={250}
    />
  );
}
```

如需自定义菜单 UI，使用 `menuComponent`、`menuItemComponent` 和 `emptyComponent` 插槽。

### 4.3 搜索与缓存

参考 `packages/lexical-playground/src/plugins/MentionsExtension/index.tsx`：

- 使用 `useMemo` 根据 `query` 过滤本地数据
- 远程搜索使用去抖（`searchDelay` 或自定义 `useDebounce`）
- 用 `Map` 缓存已查询结果，避免重复请求
- 限制列表长度（例如最多 5–8 条）

## 五、/ 命令选择实现

参考 `packages/lexical-playground/src/plugins/ComponentPickerPlugin/index.tsx`。

```tsx
import { LexicalTypeaheadMenuPlugin, MenuOption, useBasicTypeaheadTriggerMatch } from '@lexical/react/LexicalTypeaheadMenuPlugin';
import { $createParagraphNode, $getSelection, $isRangeSelection } from 'lexical';

class CommandOption extends MenuOption {
  constructor(
    public readonly title: string,
    public readonly keywords: string[],
    public readonly icon: React.ReactNode,
    public readonly onSelect: (query: string) => void,
  ) {
    super(title);
  }
}

function SlashCommandsPlugin() {
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState<string | null>(null);

  const triggerFn = useBasicTypeaheadTriggerMatch('/', {
    minLength: 0,
    allowWhitespace: true,
  });

  const options = useMemo(() => {
    const base = [
      new CommandOption('清空', ['clear', 'clean'], <ClearIcon />, () => {
        editor.update(() => {
          const root = $getRoot();
          root.clear();
          root.append($createParagraphNode());
        });
      }),
      new CommandOption('插入代码块', ['code', 'codeblock'], <CodeIcon />, () => {
        editor.dispatchCommand(INSERT_CODE_COMMAND, undefined);
      }),
      // ... 更多命令
    ];
    if (!query) return base;
    const regex = new RegExp(query, 'i');
    return base.filter(o => regex.test(o.title) || o.keywords.some(k => regex.test(k)));
  }, [editor, query]);

  return (
    <LexicalTypeaheadMenuPlugin
      triggerFn={triggerFn}
      options={options}
      onQueryChange={setQuery}
      onSelectOption={(option, nodeToRemove, closeMenu) => {
        editor.update(() => {
          nodeToRemove?.remove();
          option.onSelect(query ?? '');
          closeMenu();
        });
      }}
      menuRenderFn={/* 同 @ 菜单 */}
    />
  );
}
```

动态命令合成示例：

```ts
const tableMatch = query?.match(/^([1-9]\d?)(?:x([1-9]\d?)?)?$/);
if (tableMatch) {
  const rows = tableMatch[1];
  const cols = tableMatch[2] ?? rows;
  options.unshift(new CommandOption(
    `插入 ${rows}x${cols} 表格`,
    ['table'],
    <TableIcon />,
    () => editor.dispatchCommand(INSERT_TABLE_COMMAND, { columns: cols, rows }),
  ));
}
```

## 六、触发器互斥与边界处理

### 6.1 互斥

如果同时挂载 `@` 和 `/` 两个 `LexicalTypeaheadMenuPlugin`，必须避免同时打开。
官方 Playground 的 `MentionsExtension` 做法：在 `@` 的 `triggerFn` 内部先检测 `/`，
若匹配则返回 `null`。

```ts
const checkForSlashCommandMatch = useBasicTypeaheadTriggerMatch('/', { minLength: 0 });

const checkForMentionMatch = useCallback((text: string) => {
  // 如果当前是 / 命令，不打开 mention 菜单
  const slashMatch = checkForSlashCommandMatch(text, null);
  if (slashMatch !== null) return null;

  // 否则执行 @ 匹配
  return mentionTriggerMatch(text, null);
}, [checkForSlashCommandMatch, mentionTriggerMatch]);
```

同理，`/` 的 `triggerFn` 可以检测是否处于 `@` 匹配范围内（虽然通常输入顺序决定不会冲突）。

### 6.2 Entity boundary

`LexicalTypeaheadMenuPlugin` 默认会在 selection 位于 entity boundary 时拒绝打开菜单
（`isSelectionOnEntityBoundary`）。不要擅自传 `ignoreEntityBoundary`  unless 你清楚原因。

### 6.3 IME / 输入法

菜单打开逻辑已经内建了对 `compositionstart`/`compositionend` 的处理，
不要额外在 `keydown` 里自己打开菜单。

### 6.4 命令优先级

- `LexicalTypeaheadMenuPlugin` 默认优先级是 `COMMAND_PRIORITY_LOW`
- 如果你自己注册 `KEY_ENTER_COMMAND`，必须判断菜单是否打开：打开时返回 `false`，
  让 typeahead 插件消费；关闭时再处理你的提交逻辑

## 七、序列化与提交策略

### 7.1 编辑器状态导出

```ts
editor.getEditorState().toJSON();
```

自定义 Node 的 `exportJSON` 决定了这里出现的字段。确保 `fileId` / `filePath`
被持久化，否则 mention 无法被后端解析。

### 7.2 生成提交 payload

通常需要两种消费形态：

1. **结构化 payload**：遍历 `editorState.read(() => $getRoot().getChildren())`，
   把 `FileMentionNode` 替换为 `{ type: 'file', id, path }`，普通文本为 `{ type: 'text', value }`
2. **纯文本 fallback**：`editorState.read(() => $getRoot().getTextContent())`。
   这会得到 `@/path/to/file` 这样的字符串，可用于简单模型输入

示例：

```ts
function buildPayload(editorState: EditorState): ComposerPayload {
  return editorState.read(() => {
    const segments: Segment[] = [];
    const root = $getRoot();
    root.getChildren().forEach(node => {
      if ($isParagraphNode(node)) {
        node.getChildren().forEach(child => {
          if ($isFileMentionNode(child)) {
            segments.push({ type: 'file', id: child.__fileId, path: child.__filePath });
          } else if ($isTextNode(child)) {
            segments.push({ type: 'text', value: child.getTextContent() });
          }
        });
      }
    });
    return { segments, text: root.getTextContent() };
  });
}
```

## 八、常见陷阱与调试建议

1. **忘记注册节点**：`initialConfig.nodes` 必须包含所有自定义 Node，否则会被静默丢弃
2. **没有 `$applyNodeReplacement`**：复制粘贴、撤销重做、JSON 加载会失效
3. **`triggerFn` 没有 memo**：每次渲染都新建函数会导致性能问题和意外关闭
4. **两个菜单同时打开**：实现互斥 guard
5. **`onSelectOption` 里没清理 query 文本节点**：要记得 `nodeToRemove?.remove()` 或 `replace`
6. **命令优先级冲突**：自己的 `KEY_ENTER_COMMAND` 在菜单打开时返回 `false`
7. **搜索没限流**：远程文件搜索必须去抖 + 限制列表长度
8. **Mention 没设 `canInsertTextBefore/After`**：用户可以在 pill 中间打字，破坏原子性
9. **序列化字段丢失**：JSON 里只存了 `text` 没存 `fileId`，后端无法回查文件
10. **直接使用 Playground 的 hardcoded 数据源**：把 `useMentionLookupService` 换成你的文件索引/命令注册表

## 九、源码映射与可执行清单

完整的源码位置映射和落地检查清单请读取 `references/lexical-source-map.md`。
在回答末尾输出“下一步可执行清单”时，先读取该参考文件，再按其中的顺序给出。
