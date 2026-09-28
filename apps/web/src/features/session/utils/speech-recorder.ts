/**
 * @author Codex
 * @description Owns one bounded microphone capture, including late permissions, final chunks and cancellation.
 */
import { speechMaxAudioBytes, speechMaxRecordingMs } from '@octopus/shared/protocol';

export class SpeechRecorder {
  private cancelled = false;
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private timer?: ReturnType<typeof setTimeout>;
  private settle?: (audio: Blob | null) => void;
  /**
   * Requests microphone permission and resolves only after stop delivers the final audio chunk.
   */
  async record(onRecording: (stream: MediaStream) => void): Promise<Blob | null> {
    if (
      !globalThis.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      throw new Error('unsupported');
    }
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((type) =>
      MediaRecorder.isTypeSupported(type)
    );
    if (!mimeType) {
      throw new Error('unsupported');
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.stream = stream;
    if (this.cancelled) {
      this.release();
      return null;
    }
    try {
      const recorder = new MediaRecorder(stream, { mimeType });
      this.recorder = recorder;
      return await new Promise<Blob | null>((resolve, reject) => {
        this.settle = resolve;
        const chunks: Blob[] = [];
        let bytes = 0;
        recorder.ondataavailable = (event) => {
          if (this.cancelled) {
            return;
          }
          bytes += event.data.size;
          if (bytes > speechMaxAudioBytes) {
            this.release();
            reject(new Error('too-large'));
            return;
          }
          if (event.data.size) {
            chunks.push(event.data);
          }
        };
        recorder.onerror = () => {
          this.release();
          reject(new Error('recording-failed'));
        };
        recorder.onstop = () => {
          const audio = new Blob(chunks, { type: recorder.mimeType || mimeType });
          this.release();
          if (!audio.size) {
            reject(new Error('empty'));
            return;
          }
          resolve(audio);
        };
        recorder.start(1000);
        this.timer = setTimeout(() => this.stop(), speechMaxRecordingMs);
        onRecording(stream);
      });
    } finally {
      this.release();
    }
  }
  /**
   * Ends recording while retaining final data for transcription.
   */
  stop() {
    if (this.recorder?.state === 'recording') {
      this.recorder.stop();
    }
    this.stream?.getTracks().forEach((track) => track.stop());
  }
  /**
   * Discards audio and invalidates a pending permission result; safe to repeat on unmount.
   */
  cancel() {
    this.cancelled = true;
    this.release();
    this.settle?.(null);
  }
  /**
   * Removes browser callbacks before stopping resources so cancellation cannot trigger an upload.
   */
  private release() {
    clearTimeout(this.timer);
    if (this.recorder) {
      this.recorder.onstop = null;
      this.recorder.ondataavailable = null;
      this.recorder.onerror = null;
      if (this.recorder.state !== 'inactive') {
        this.recorder.stop();
      }
    }
    this.stream?.getTracks().forEach((track) => track.stop());
  }
}
