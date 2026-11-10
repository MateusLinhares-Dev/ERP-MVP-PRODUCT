import { useCallback, useRef, useState } from 'react';
import { useLatest } from '../../../shared/ui/use-latest.js';

interface RecognitionResultList {
  readonly length: number;
  readonly [index: number]:
    | { readonly [index: number]: { readonly transcript: string } | undefined }
    | undefined;
}

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: RecognitionResultList }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionConstructor = new () => Recognition;

interface SpeechScope {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
}

export interface SpeechHandlers {
  onText(text: string): void;
  onFinished(text: string): void;
  onError(message: string): void;
}

export interface SpeechControls {
  supported: boolean;
  listening: boolean;
  toggle(baseText: string): void;
}

const SPEECH_ERRORS: Readonly<Record<string, string>> = Object.freeze({
  'not-allowed':
    'O microfone está bloqueado. Toque no cadeado ao lado do endereço do site e permita o microfone.',
  'service-not-allowed': 'O microfone está bloqueado. Permita o microfone nas configurações do navegador.',
  'no-speech': 'Não ouvi nada. Toque e fale de novo, perto do celular.',
  'audio-capture': 'Não encontrei o microfone do celular.',
  network: 'Sem internet para reconhecer a voz. Use o microfone do teclado.',
});

function recognitionConstructor(): RecognitionConstructor | null {
  const scope = globalThis as unknown as SpeechScope;
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

const joinSpeech = (base: string, heard: string): string => (base ? `${base} ${heard}` : heard);

export function useSpeechRecognition(handlers: SpeechHandlers): SpeechControls {
  const latest = useLatest(handlers);
  const active = useRef<Recognition | null>(null);
  const [listening, setListening] = useState(false);
  const [supported] = useState(() => recognitionConstructor() !== null);

  const toggle = useCallback(
    (baseText: string) => {
      const running = active.current;
      if (running) {
        try {
          running.stop();
        } catch (error) {
          console.warn('[rapido] microfone', error);
        }
        return;
      }
      const Constructor = recognitionConstructor();
      if (!Constructor) return;
      const base = baseText.trim();
      const recognition = new Constructor();
      recognition.lang = 'pt-BR';
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.maxAlternatives = 1;
      let heard = '';
      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) transcript += event.results[i]?.[0]?.transcript ?? '';
        heard = transcript.trim();
        latest.current.onText(joinSpeech(base, heard));
      };
      recognition.onerror = (event) => {
        if (event.error === 'aborted') return;
        latest.current.onError(SPEECH_ERRORS[event.error] ?? 'Não consegui ouvir. Tente de novo.');
      };
      recognition.onend = () => {
        active.current = null;
        setListening(false);
        if (heard) latest.current.onFinished(joinSpeech(base, heard));
      };
      try {
        recognition.start();
        active.current = recognition;
        setListening(true);
      } catch {
        active.current = null;
        setListening(false);
        latest.current.onError('Não consegui ligar o microfone. Tente de novo.');
      }
    },
    [latest],
  );

  return { supported, listening, toggle };
}
