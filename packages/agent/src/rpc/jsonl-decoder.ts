/**
 * @author Codex
 * @description 严格按 LF 分帧的增量 UTF-8 JSONL 解码器
 */

import { StringDecoder } from 'node:string_decoder';

/**
 * 增量解码 stdout，避免 readline 将合法 JSON 字符误判为行分隔符。
 */
export class JsonlDecoder {
  private readonly decoder = new StringDecoder('utf8');
  private buffered = '';

  /**
   * @param maxFrameBytes 单条 JSONL 帧允许占用的最大 UTF-8 字节数
   */
  public constructor(private readonly maxFrameBytes: number) {}

  /**
   * 接收字节块并返回其中已经完整结束的 JSON 行。
   *
   * @param chunk stdout 字节块
   * @returns 严格按 LF 切分的完整行
   * @throws 当尚未完成的帧超过资源上限时抛出异常
   */
  public push(chunk: Buffer): string[] {
    this.buffered += this.decoder.write(chunk);
    const lines: string[] = [];
    let lineEnd = this.buffered.indexOf('\n');

    while (lineEnd >= 0) {
      let line = this.buffered.slice(0, lineEnd);
      this.buffered = this.buffered.slice(lineEnd + 1);
      if (line.endsWith('\r')) {
        line = line.slice(0, -1);
      }
      lines.push(line);
      lineEnd = this.buffered.indexOf('\n');
    }

    this.assertWithinLimit(this.buffered);
    return lines;
  }

  /**
   * 完成 UTF-8 解码并返回 EOF 前未以 LF 结束的残帧。
   */
  public finish(): string {
    this.buffered += this.decoder.end();
    this.assertWithinLimit(this.buffered);
    return this.buffered;
  }

  /**
   * 对缓冲帧实施字节级资源限制。
   *
   * @param frame 当前未完成的帧
   * @throws 当帧超过配置上限时抛出异常
   */
  private assertWithinLimit(frame: string): void {
    if (Buffer.byteLength(frame, 'utf8') > this.maxFrameBytes) {
      throw new Error(`Agent RPC JSONL frame exceeds ${String(this.maxFrameBytes)} bytes`);
    }
  }
}
