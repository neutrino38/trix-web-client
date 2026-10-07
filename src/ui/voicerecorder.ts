/**
 * Recording a voice message (ADR 0012, D10), the way the design for a web
 * client asks (elixip, DESIGN-CHAT-MEDIA §9.2):
 *
 * - `MediaRecorder` in `audio/webm; codecs=opus` where the browser has it —
 *   WebM is the Matroska subset whose signature Linphone's player opens by —
 *   else Ogg/Opus, else whatever the browser records;
 * - named `vocal_<date>.mka`, as Linphone names its own, and sent with
 *   Linphone's voice type `audio/wav;voice-recording=yes`, whatever the
 *   container: Linphone recognises a voice message by that type alone;
 * - its length measured here, in milliseconds, and written in the XML.
 *
 * Whether Linphone's player reads a browser's WebM is a measurement (ADR
 * 0012, §4). If it does not, the fallback is a WAV PCM 16 kHz mono encoder
 * here, built on that measurement and not before.
 */

/** A recording stops by itself past this: a voice message, not a dictation. */
export const MAX_VOICE_MS = 5 * 60_000;

/** The containers tried, best first. */
const CANDIDATES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"] as const;

/** The recorder type this browser takes; undefined: its default. */
export function voiceMimeType(isSupported: (type: string) => boolean): string | undefined {
  return CANDIDATES.find((type) => isSupported(type));
}

/** `vocal_2026-10-07-18-30-05.mka`, in local time, as Linphone writes it. */
export function voiceName(at: number): string {
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, "0");
  return `vocal_${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}.mka`;
}

/** What a stopped recording gives. */
export interface VoiceClip {
  name: string;
  blob: Blob;
  durationMs: number;
}

export interface VoiceRecording {
  startedAt: number;
  /** Stops and answers the clip; null when nothing was recorded. */
  stop(): Promise<VoiceClip | null>;
  /** Stops and keeps nothing. */
  cancel(): void;
}

/** Can this page record at all? */
export function canRecordVoice(): boolean {
  return typeof MediaRecorder !== "undefined" && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * Starts recording from the microphone. Rejects when the person or the
 * browser refuses it — the caller says so.
 */
export async function startVoice(now: () => number = Date.now): Promise<VoiceRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const type = voiceMimeType((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : {});
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const release = () => stream.getTracks().forEach((track) => track.stop());
  const startedAt = now();
  recorder.start();
  return {
    startedAt,
    stop: () =>
      new Promise((resolve) => {
        recorder.onstop = () => {
          release();
          const blob = new Blob(chunks, { type: recorder.mimeType || type || "audio/webm" });
          resolve(blob.size > 0 ? { name: voiceName(startedAt), blob, durationMs: now() - startedAt } : null);
        };
        recorder.stop();
      }),
    cancel: () => {
      recorder.onstop = release;
      if (recorder.state !== "inactive") recorder.stop();
      else release();
    },
  };
}
