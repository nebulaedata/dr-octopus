/**
 * @author Codex
 * @description 提供 Workspace 文件 mutation 的单进程异步互斥
 */
export class MutationMutex {
  #tail: Promise<void> = Promise.resolve();

  /**
   * @description 在前一个 mutation 结束后执行任务，并保证失败不会阻塞后续任务。
   */
  public async run<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.#tail;
    let release: () => void = () => undefined;
    this.#tail = new Promise<void>((resolveTail) => {
      release = resolveTail;
    });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }
}
