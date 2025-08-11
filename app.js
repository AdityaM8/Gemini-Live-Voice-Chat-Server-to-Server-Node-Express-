const youEl = document.getElementById('you');
const revEl = document.getElementById('rev');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const interruptBtn = document.getElementById('interruptBtn');
const ttsEl = document.getElementById('tts');
const langSel = document.getElementById('lang');

let mediaStream, mediaRecorder;
let ws;
let speaking = false;
let pendingAudioChunks = [];

function addBubble(target, text, who) {
  const b = document.createElement('div');
  b.className = `bubble ${who}`;
  b.textContent = text;
  target.appendChild(b);
  target.scrollTop = target.scrollHeight;
}

function setSpeaking(on) {
  speaking = on;
  interruptBtn.disabled = !on;
}

function playPCM16(buffer, sampleRate = 16000) {
  // Server forwards base64 PCM chunks; assemble into a single Blob for quick start
  pendingAudioChunks.push(new Uint8Array(buffer));
  const blob = new Blob(pendingAudioChunks, { type: 'audio/pcm' });
  // Use MediaSource/AudioWorklet for gapless playback in production; for simplicity here we use a Blob URL
  ttsEl.src = URL.createObjectURL(blob);
}

async function start() {
  // Connect WS first to minimize post-speech latency
  ws = new WebSocket(`${location.origin.replace('http', 'ws')}/ws`);

  ws.onopen = async () => {
    startBtn.disabled = true;
    stopBtn.disabled = false;
    interruptBtn.disabled = true;

    // Start mic capture
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 48000 } });
    mediaRecorder = new MediaRecorder(mediaStream, { mimeType: 'audio/webm;codecs=opus' });

    mediaRecorder.ondataavailable = (e) => {
      // Send binary audio to server as base64; you can stream raw ArrayBuffer if you implement binary frames end‑to‑end
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = btoa(String.fromCharCode(...new Uint8Array(reader.result)));
        ws.send(JSON.stringify({ input: { audio: { mimeType: 'audio/webm;codecs=opus', data: base64 } } }));
      };
      reader.readAsArrayBuffer(e.data);
    };

    mediaRecorder.start(200); // 200ms opus chunks improves latency

    // Kick off the dialog with a tiny silence marker so model can greet if desired
    ws.send(JSON.stringify({ input: { event: 'start', language: langSel.value } }));
  };

  ws.onmessage = (ev) => {
    // Server proxies Gemini Live frames. Expect JSON control + base64 audio.
    let msg;
    try { msg = JSON.parse(ev.data); } catch {
      // If binary, assume PCM chunk
      playPCM16(ev.data);
      setSpeaking(true);
      return;
    }

    if (msg.partialTranscript) {
      // Live ASR partials from model
      // (rendering optional)
    }

    if (msg.transcript) {
      addBubble(youEl, msg.transcript, 'you');
    }

    if (msg.responseText) {
      addBubble(revEl, msg.responseText, 'rev');
    }

    if (msg.audioChunk) {
      const buf = Uint8Array.from(atob(msg.audioChunk), c => c.charCodeAt(0));
      playPCM16(buf.buffer);
      setSpeaking(true);
    }

    if (msg.event === 'response.end') {
      // Model finished speaking; allow barge‑in again
      setSpeaking(false);
      pendingAudioChunks = [];
    }

    if (msg.error) {
      addBubble(revEl, `Error: ${msg.error}`, 'rev');
    }
  };

  ws.onclose = () => stop();
}

function stop() {
  startBtn.disabled = false;
  stopBtn.disabled = true;
  interruptBtn.disabled = true;
  try { mediaRecorder?.stop(); } catch {}
  mediaStream?.getTracks().forEach(t => t.stop());
  if (ws && ws.readyState === WebSocket.OPEN) ws.close();
}

function interrupt() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  // Tell model to stop speaking and listen now
  ws.send(JSON.stringify({ control: { event: 'interrupt' } }));
  // Immediately halt local playback for snappy feel
  ttsEl.pause();
  ttsEl.currentTime = 0;
  pendingAudioChunks = [];
  setSpeaking(false);
}

startBtn.addEventListener('click', start);
stopBtn.addEventListener('click', stop);
interruptBtn.addEventListener('click', interrupt);