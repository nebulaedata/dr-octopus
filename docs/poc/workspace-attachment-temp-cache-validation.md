# workspace-attachment-temp-cache：概念验证与验收

架构设计：[原设计](../architecture/workspace-attachment-temp-cache.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 9. 验收标准

1. 普通、General 和受管 Workspace 均把非图片附件物化到固定 `temp/attachments` 路径。
2. 同一工件跨 Session 重复提交时复用同一内容寻址文件，进程重启后仍命中。
3. Session 结束、Server 重启和附件删除后缓存文件保持存在。
4. `temp/.gitignore` 使用 `*` 忽略整个目录及自身，普通 `git status` 不出现新缓存文件。
5. 普通 `read` 不再因路径 external 弹出审批；`ctx_execute_file` 仍按当前工具策略决定是否审批。
6. 篡改缓存后再次提交附件会检测哈希不一致并恢复正确字节，权威 Blob 不受影响。
7. symlink/junction、已跟踪路径、只读 Workspace 和冲突 `.gitignore` 均不会导致越界覆盖，并能进入回退路径。
8. 大文件通过流式复制和流式哈希发布，不把完整字节读入 Server 堆。
9. 图片继续走受限 Pi image 输入时不创建不必要的 Workspace 缓存；只有文件工具需要路径时才物化。
