import { useState, useRef } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';
import { Music, Languages, Sparkles, Loader2, Mic, Square, Upload, FileAudio, Volume2 } from 'lucide-react';
import { motion } from 'motion/react';
import ReactMarkdown from 'react-markdown';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const LANGUAGES = [
  { code: 'rw', name: 'Kinyarwanda' },
  { code: 'sw', name: 'Swahili' },
  { code: 'fr', name: 'French' },
  { code: 'es', name: 'Spanish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'de', name: 'German' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
];

const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function createWavBlob(pcmBytes: Uint8Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmBytes.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const pcmData = new Uint8Array(buffer, 44);
  pcmData.set(pcmBytes);

  return new Blob([buffer], { type: 'audio/wav' });
}

export default function App() {
  // Audio state
  const [isRecording, setIsRecording] = useState(false);
  const [audioBase64, setAudioBase64] = useState('');
  const [audioMimeType, setAudioMimeType] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [audioFileName, setAudioFileName] = useState('');
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Shared state
  const [targetLanguage, setTargetLanguage] = useState('Kinyarwanda');
  const [result, setResult] = useState('');
  const [outputAudioUrl, setOutputAudioUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const startRecording = async () => {
    try {
      setError('');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
        setAudioFileName('Recorded Audio');
        
        const base64DataUrl = await blobToBase64(audioBlob);
        const base64 = base64DataUrl.split(',')[1];
        setAudioBase64(base64);
        setAudioMimeType(mediaRecorder.mimeType);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone", err);
      setError("Could not access microphone. Please ensure you have granted permission.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setError('');
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    setAudioFileName(file.name);
    
    try {
      const base64DataUrl = await blobToBase64(file);
      const base64 = base64DataUrl.split(',')[1];
      setAudioBase64(base64);
      setAudioMimeType(file.type);
    } catch (err) {
      setError("Failed to read the audio file.");
    }
  };

  const clearAudio = () => {
    setAudioBase64('');
    setAudioMimeType('');
    setAudioUrl('');
    setAudioFileName('');
  };

  const handleInterpret = async () => {
    if (!audioBase64) {
      setError('Please record or upload an audio file.');
      return;
    }

    setIsLoading(true);
    setError('');
    setResult('');
    setOutputAudioUrl('');

    try {
      // Step 1: Transcribe and Translate
      const contents = {
        parts: [
          {
            inlineData: {
              data: audioBase64,
              mimeType: audioMimeType,
            }
          },
          {
            text: `You are an expert audio translator.
Listen to this audio track.
Task:
1. Transcribe the speech or vocals in the audio.
2. Translate the transcription into ${targetLanguage}.

Format the output using Markdown exactly like this:
### Transcription
[Original transcribed text here]

### Translation
[Translated text here]`
          }
        ]
      };

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: contents,
      });

      const textResult = response.text;
      if (!textResult) {
        throw new Error('Failed to generate translation.');
      }
      
      setResult(textResult);

      // Extract translation for TTS
      const translationMatch = textResult.match(/### Translation\n([\s\S]*)/);
      const textToSpeak = translationMatch ? translationMatch[1].trim() : textResult;

      // Step 2: Generate Speech (TTS)
      const ttsResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: textToSpeak }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64AudioOut = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64AudioOut) {
        const binary = atob(base64AudioOut);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        
        // Convert raw PCM to WAV
        const wavBlob = createWavBlob(bytes, 24000);
        const wavUrl = URL.createObjectURL(wavBlob);
        setOutputAudioUrl(wavUrl);
      }

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred while translating.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans selection:bg-indigo-500/30">
      <header className="bg-neutral-900 border-b border-neutral-800 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-500 rounded-xl flex items-center justify-center text-white shadow-sm">
            <Volume2 className="w-5 h-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-white">Voice Translator AI</h1>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Input Section */}
        <div className="space-y-6">
          <div className="bg-neutral-900 rounded-2xl p-6 shadow-sm border border-neutral-800">
            
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
              <h2 className="text-lg font-medium flex items-center gap-2 text-white">
                <Mic className="w-5 h-5 text-indigo-400" />
                Audio Input
              </h2>

              <div className="flex items-center gap-2">
                <label htmlFor="language" className="text-sm text-neutral-400 font-medium">
                  Translate to:
                </label>
                <select
                  id="language"
                  value={targetLanguage}
                  onChange={(e) => setTargetLanguage(e.target.value)}
                  className="text-sm border border-neutral-700 rounded-lg px-3 py-1.5 bg-neutral-800 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  {LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.name}>
                      {lang.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            
            <div className="w-full h-[320px] p-6 bg-neutral-950 border border-neutral-800 rounded-xl flex flex-col items-center justify-center gap-6">
              {!audioBase64 ? (
                <>
                  <div className="flex flex-col items-center gap-4">
                    <button
                      onClick={isRecording ? stopRecording : startRecording}
                      className={`flex items-center gap-2 px-6 py-3 rounded-full font-medium text-white transition-all ${
                        isRecording 
                          ? 'bg-red-500 hover:bg-red-600 animate-pulse' 
                          : 'bg-indigo-600 hover:bg-indigo-700 shadow-md hover:shadow-lg'
                      }`}
                    >
                      {isRecording ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                      {isRecording ? 'Stop Recording' : 'Record Audio'}
                    </button>
                    
                    <div className="flex items-center gap-4 w-full max-w-xs">
                      <div className="h-px bg-neutral-800 flex-1"></div>
                      <span className="text-xs text-neutral-500 font-medium uppercase tracking-wider">OR</span>
                      <div className="h-px bg-neutral-800 flex-1"></div>
                    </div>

                    <label className="flex items-center gap-2 px-6 py-3 rounded-full font-medium text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20 transition-colors cursor-pointer border border-indigo-500/20">
                      <Upload className="w-5 h-5" />
                      Upload Audio File
                      <input 
                        type="file" 
                        accept="audio/*" 
                        onChange={handleFileUpload} 
                        className="hidden" 
                      />
                    </label>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center gap-6 w-full max-w-md">
                  <div className="w-16 h-16 bg-indigo-500/20 text-indigo-400 rounded-full flex items-center justify-center mb-2">
                    <FileAudio className="w-8 h-8" />
                  </div>
                  <div className="text-center">
                    <p className="font-medium text-neutral-200 truncate max-w-[250px]">{audioFileName}</p>
                    <p className="text-sm text-neutral-400">Audio ready for translation</p>
                  </div>
                  
                  <audio controls src={audioUrl} className="w-full grayscale opacity-90" />
                  
                  <button 
                    onClick={clearAudio}
                    className="text-sm text-red-400 hover:text-red-300 font-medium"
                  >
                    Remove Audio
                  </button>
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={handleInterpret}
                disabled={isLoading || !audioBase64}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Sparkles className="w-5 h-5" />
                )}
                {isLoading ? 'Translating...' : 'Translate Audio'}
              </button>
            </div>
            
            {error && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 p-4 bg-red-900/20 text-red-400 rounded-xl text-sm border border-red-900/50"
              >
                {error}
              </motion.div>
            )}
          </div>
        </div>

        {/* Output Section */}
        <div className="bg-neutral-900 rounded-2xl p-6 shadow-sm border border-neutral-800 flex flex-col h-[600px] lg:h-auto">
          <h2 className="text-lg font-medium flex items-center gap-2 mb-4 pb-4 border-b border-neutral-800 text-white">
            <Volume2 className="w-5 h-5 text-indigo-400" />
            Translation & Voice
          </h2>
          
          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar flex flex-col">
            {isLoading ? (
              <div className="h-full flex flex-col items-center justify-center text-neutral-500 space-y-4">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                <p>Translating audio and generating voice in {targetLanguage}...</p>
              </div>
            ) : result ? (
              <div className="flex flex-col gap-6">
                {outputAudioUrl && (
                  <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-800">
                    <p className="text-sm font-medium text-neutral-400 mb-3">Spoken Translation</p>
                    <audio controls src={outputAudioUrl} className="w-full grayscale opacity-90" autoPlay />
                  </div>
                )}
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="prose prose-invert prose-indigo max-w-none prose-headings:font-medium prose-h3:text-lg prose-p:text-neutral-300 prose-p:leading-relaxed"
                >
                  <div className="markdown-body">
                    <ReactMarkdown>{result}</ReactMarkdown>
                  </div>
                </motion.div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-neutral-500 space-y-4">
                <div className="w-16 h-16 bg-neutral-950 rounded-full flex items-center justify-center">
                  <Languages className="w-8 h-8 text-neutral-700" />
                </div>
                <p>Your translation and voice output will appear here.</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
