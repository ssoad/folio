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

// The plugin names every voice after its language ("English United
// States"), but Android has several per language (speakers, offline and
// online), and the app picks voices by name. Each gets a unique name from
// its engine id, e.g. "en-us-x-iob-local" -> "English United States IOB",
// marked when it needs the internet; offline voices come first.
const nameVoices = (voices: NativeVoice[]) => {
  const used = new Set<string>();
  return voices
    .map((voice, index) => {
      const base = (voice.name || voice.lang).trim();
      const id = voice.voiceURI.match(/-x-([a-z0-9]+)/i)?.[1];
      let name = id ? `${base} ${id.toUpperCase()}` : base;
      if (!voice.localService) name += " (online)";
      for (let n = 2; used.has(name); n++) name = `${base} ${n}`;
      used.add(name);
      // The plugin selects voices by their place in its own list
      return { voice: { ...voice, name }, index };
    })
    .sort(
      (a, b) =>
        Number(b.voice.localService) - Number(a.voice.localService) ||
        a.voice.name.localeCompare(b.voice.name)
    );
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
  // voiceURI -> index in the plugin's list
  private pluginIndex = new Map<string, number>();
  private current: NativeUtterance | null = null;
  // Each speak() gets a number, so a stopped utterance's late "done"
  // doesn't end the one that replaced it
  private run = 0;

  constructor() {
    TextToSpeech.getSupportedVoices()
      .then(({ voices }) => {
        const named = nameVoices(voices || []);
        this.voices = named.map((item) => item.voice);
        this.pluginIndex = new Map(
          named.map((item) => [item.voice.voiceURI, item.index])
        );
        this.onvoiceschanged && this.onvoiceschanged();
      })
      .catch(() => {});
  }
  getVoices() {
    return this.voices;
  }
  private findVoice(voice: NativeVoice | null) {
    if (!voice) return undefined;
    const known = this.voices.find(
      (item) => item.voiceURI === voice.voiceURI || item.name === voice.name
    );
    return known ? this.pluginIndex.get(known.voiceURI) : undefined;
  }
  speak(utterance: NativeUtterance) {
    const run = ++this.run;
    this.current = utterance;
    this.speaking = true;
    this.paused = false;
    utterance.onstart && utterance.onstart({ utterance });
    const lang = utterance.lang || utterance.voice?.lang || undefined;
    const say = (voice: number | undefined) =>
      TextToSpeech.speak({
        text: utterance.text,
        lang,
        rate: utterance.rate || 1,
        pitch: utterance.pitch || 1,
        volume: utterance.volume ?? 1,
        voice,
      });
    const voice = this.findVoice(utterance.voice);
    say(voice)
      // A voice that isn't installed, or an online one without internet,
      // fails: the sentence is read with the language's default voice
      .catch((error: unknown) => {
        if (voice === undefined || run !== this.run || this.paused) {
          throw error;
        }
        return say(undefined);
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
