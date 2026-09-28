/**
 * @author Codex
 * @description Visualizes the borrowed recording stream without owning microphone tracks or triggering React renders per frame.
 */
import { useEffect, useRef } from 'react';

/**
 * Connects a microphone analyser only while recording; releases the audio graph and frame loop on every exit.
 * Reduced motion and unavailable Web Audio leave the decorative waveform static.
 */
export function useSpeechWaveform(stream: MediaStream | null) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!stream || !element || typeof AudioContext === 'undefined') {
      return;
    }
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const bars = Array.from(element.children) as HTMLElement[];
    const initialTransforms = bars.map((bar) => bar.style.transform);
    let context: AudioContext | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let frame = 0;
    let disposed = false;
    /**
     * Stops visual work without stopping the recorder's borrowed tracks.
     */
    const stop = () => {
      cancelAnimationFrame(frame);
      source?.disconnect();
      source = undefined;
      if (context) {
        void context.close().catch(() => undefined);
        context = undefined;
      }
      bars.forEach((bar, index) => {
        bar.style.transform = initialTransforms[index] ?? '';
      });
    };
    /**
     * Restarts the optional visualization when the user's motion preference changes.
     */
    const start = () => {
      stop();
      if (disposed || preference.matches) {
        return;
      }
      try {
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        source = context.createMediaStreamSource(stream);
        source.connect(analyser);
        // Never connect the microphone to the audio destination: avoid speaker feedback.
        const bins = new Uint8Array(analyser.frequencyBinCount);
        /**
         * Mirrors speech frequencies around the center, changing only bar transforms.
         */
        const draw = () => {
          analyser.getByteFrequencyData(bins);
          bars.forEach((bar, index) => {
            const distance = Math.abs(index - (bars.length - 1) / 2);
            const bin = Math.min(bins.length - 1, 2 + Math.floor(distance * 2));
            const strength = (bins[bin] ?? 0) / 255;
            bar.style.transform = `scaleY(${0.08 + strength * (0.92 - distance / bars.length)})`;
          });
          frame = requestAnimationFrame(draw);
        };
        const currentContext = context;
        void currentContext.resume().catch(() => {
          if (context === currentContext) {
            stop();
          }
        });
        draw();
      } catch {
        // Visualization is optional; recording remains available if Web Audio fails.
        stop();
      }
    };
    start();
    preference.addEventListener('change', start);
    return () => {
      disposed = true;
      preference.removeEventListener('change', start);
      stop();
    };
  }, [stream]);
  return ref;
}
