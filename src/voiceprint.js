const SAMPLE_MS = 3200;
const PHRASE = 'Salt, open my private voice space.';

/** Capture and reduce speech to a compact MFCC profile entirely in this tab. */
export async function captureVoiceprint(onProgress = () => {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture is unavailable in this browser. Use localhost or HTTPS.');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
  });
  let context;
  try {
    const AudioContextType = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextType) throw new Error('Audio analysis is unavailable in this browser.');
    context = new AudioContextType();
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);
    const spectrum = new Float32Array(analyser.frequencyBinCount);
    const waveform = new Float32Array(analyser.fftSize);
    const frames = [];
    const started = performance.now();
    while (performance.now() - started < SAMPLE_MS) {
      analyser.getFloatTimeDomainData(waveform);
      let energy = 0;
      for (const sample of waveform) energy += sample * sample;
      if (Math.sqrt(energy / waveform.length) > 0.008) {
        analyser.getFloatFrequencyData(spectrum);
        frames.push(mfcc(spectrum, context.sampleRate, analyser.fftSize));
      }
      const elapsed = performance.now() - started;
      onProgress(Math.min(100, Math.round(elapsed / SAMPLE_MS * 100)));
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    if (frames.length < 12) throw new Error('I could not hear enough speech. Check your microphone and try again.');
    return summarize(frames);
  } finally {
    stream.getTracks().forEach(track => track.stop());
    await context?.close();
  }
}

export const voiceChallenge = PHRASE;

export function voiceSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || left.length < 10) return 0;
  let dot = 0, normLeft = 0, normRight = 0;
  for (let i = 0; i < left.length; i++) {
    dot += left[i] * right[i];
    normLeft += left[i] * left[i];
    normRight += right[i] * right[i];
  }
  if (!normLeft || !normRight) return 0;
  return dot / Math.sqrt(normLeft * normRight);
}

function mfcc(dbBins, sampleRate, fftSize) {
  const melCount = 26, coefficientCount = 14;
  const minMel = hzToMel(100), maxMel = hzToMel(Math.min(7600, sampleRate / 2));
  const points = Array.from({ length: melCount + 2 }, (_, index) => melToHz(minMel + (maxMel - minMel) * index / (melCount + 1)));
  const melEnergies = [];
  for (let band = 0; band < melCount; band++) {
    const low = points[band], center = points[band + 1], high = points[band + 2];
    let energy = 0;
    for (let bin = 1; bin < dbBins.length; bin++) {
      const hz = bin * sampleRate / fftSize;
      if (hz < low || hz > high) continue;
      const weight = hz <= center ? (hz - low) / (center - low) : (high - hz) / (high - center);
      const power = Number.isFinite(dbBins[bin]) ? 10 ** (dbBins[bin] / 10) : 0;
      energy += power * Math.max(0, weight);
    }
    melEnergies.push(Math.log(Math.max(energy, 1e-10)));
  }
  const result = [];
  for (let coefficient = 0; coefficient < coefficientCount; coefficient++) {
    let total = 0;
    for (let band = 0; band < melCount; band++) total += melEnergies[band] * Math.cos(Math.PI * coefficient * (band + 0.5) / melCount);
    result.push(total / melCount);
  }
  return result;
}

function summarize(frames) {
  const dimensions = frames[0].length;
  const mean = Array(dimensions).fill(0), deviation = Array(dimensions).fill(0);
  for (const frame of frames) for (let i = 0; i < dimensions; i++) mean[i] += frame[i] / frames.length;
  for (const frame of frames) for (let i = 0; i < dimensions; i++) deviation[i] += Math.abs(frame[i] - mean[i]) / frames.length;
  const vector = [...mean, ...deviation];
  const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map(value => value / length);
}
function hzToMel(hz) { return 2595 * Math.log10(1 + hz / 700); }
function melToHz(mel) { return 700 * (10 ** (mel / 2595) - 1); }
