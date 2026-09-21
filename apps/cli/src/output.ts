/**
 * @author Codex
 * @description Keeps machine-readable command output separate from interactive progress and errors.
 */

export interface OutputOptions {
  json?: boolean;
}

/**
 * Emits one stable service/action envelope, setting failure exit status for automation.
 */
export function report(
  service: string,
  action: string,
  result: unknown,
  options: OutputOptions,
  error?: unknown
): void {
  const failure = error
    ? {
        code: (error as { code?: string }).code ?? 'COMMAND_FAILED',
        message: error instanceof Error ? error.message : JSON.stringify(error),
      }
    : undefined;
  const envelope = { service, action, ok: !failure, ...(failure ? { error: failure } : { result }) };
  if (options.json) {
    console.log(JSON.stringify(envelope));
  } else if (failure) {
    console.error(`${failure.code}: ${failure.message}`);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
  if (failure) {
    process.exitCode = 1;
  }
}

/**
 * Writes complete, deduplicated progress lines without owning stdin or process cancellation.
 * Child-process logs can share stderr without colliding with an animated cursor.
 */
export function progress(options: OutputOptions, message: string) {
  let previous: string | undefined;
  let stopped = false;
  /**
   * Reports each phase transition once and leaves JSON command output untouched.
   */
  function write(value: string): void {
    if (!stopped && !options.json && value !== previous) {
      console.error(value);
      previous = value;
    }
  }
  write(message);
  return {
    message: write,
    /**
     * Reports completion once and ignores subsequent cleanup or phase updates.
     */
    stop(value: string): void {
      write(value);
      stopped = true;
    },
  };
}
