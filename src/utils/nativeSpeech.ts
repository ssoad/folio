import { TextToSpeech } from "@capacitor-community/text-to-speech";
import { isNativeApp } from "./platform";

// Android's WebView has no Web Speech API, so the reader's system voices
// (components/textToSpeech, the selection menu's Speak) had nothing to talk
// to. This puts a small window.speechSynthesis / SpeechSynthesisUtterance in
// its place, backed by the phone's own text-to-speech engine. Only what the
// app uses is implemented; Android can't pause, so pause stops and resume
// starts the current sentence again.
declare var window: any;

type NativeVoice = {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
  default: boolean;
};

class NativeUtterance {
  text = "";
  lang = "";
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: NativeVoice | null = null;
  onstart: ((event: any) => void) | null = null;
  onend: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onboundary: ((event: any) => void) | null = null;
  onpause: ((event: any) => void) | null = null;
  onresume: ((event: any) => void) | null = null;
  constructor(text?: string) {
    if (text) this.text = text;
  }
}

class NativeSpeechSynthesis {
  speaking = false;
  paused = false;
  pending = false;
  onvoiceschanged: (() => void) | null = null;
  private voices: NativeVoice[] = [];
  private current: NativeUtterance | null = null;
  // Each speak() gets a number, so a stopped utterance's late "done"
  // doesn't end the one that replaced it
  private run = 0;

  constructor() {
    TextToSpeech.getSupportedVoices()
      .then(({ voices }) => {
        this.voices = voices || [];
        this.onvoiceschanged && this.onvoiceschanged();
      })
      .catch(() => {});
  }
  getVoices() {
    return this.voices;
  }
  speak(utterance: NativeUtterance) {
    const run = ++this.run;
    this.current = utterance;
    this.speaking = true;
    this.paused = false;
    const voiceIndex = utterance.voice
      ? this.voices.findIndex((voice) => voice.name === utterance.voice!.name)
      : -1;
    utterance.onstart && utterance.onstart({ utterance });
    TextToSpeech.speak({
      text: utterance.text,
      lang: utterance.lang || utterance.voice?.lang || undefined,
      rate: utterance.rate || 1,
      pitch: utterance.pitch || 1,
      volume: utterance.volume ?? 1,
      voice: voiceIndex >= 0 ? voiceIndex : undefined,
    })
      .then(() => {
        if (run !== this.run || this.paused) return;
        this.speaking = false;
        utterance.onend && utterance.onend({ utterance });
      })
      .catch((error: unknown) => {
        if (run !== this.run || this.paused) return;
        this.speaking = false;
        utterance.onerror && utterance.onerror({ utterance, error });
      });
  }
  cancel() {
    this.run++;
    this.speaking = false;
    this.paused = false;
    this.current = null;
    TextToSpeech.stop().catch(() => {});
  }
  pause() {
    if (!this.speaking) return;
    this.paused = true;
    this.run++;
    TextToSpeech.stop().catch(() => {});
    this.current?.onpause && this.current.onpause({ utterance: this.current });
  }
  resume() {
    if (!this.paused || !this.current) return;
    const utterance = this.current;
    utterance.onresume && utterance.onresume({ utterance });
    this.speak(utterance);
  }
}

export const installNativeSpeechSynthesis = () => {
  if (!isNativeApp() || "speechSynthesis" in window) return;
  window.speechSynthesis = new NativeSpeechSynthesis();
  window.SpeechSynthesisUtterance = NativeUtterance;
};
