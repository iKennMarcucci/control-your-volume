import type { ChainStats, OffscreenRequest, OffscreenResult } from './lib/messages.ts';
import { isBoosted, volumeToGain } from './lib/volume.ts';

/**
 * One audio graph per captured tab:
 *   MediaStreamSource → GainNode → (DynamicsCompressor as limiter, only above 100%) → speakers
 */
interface Chain {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  limiter: DynamicsCompressorNode;
  limiterOn: boolean;
  analyser: AnalyserNode | null;
}

const chains = new Map<number, Chain>();
let context: AudioContext | null = null;

function audioContext(): AudioContext {
  context ??= new AudioContext({ latencyHint: 'interactive' });
  if (context.state === 'suspended') void context.resume();
  return context;
}

function output(chain: Chain): AudioNode {
  return chain.limiterOn ? chain.limiter : chain.gain;
}

function wire(chain: Chain, limiterOn: boolean): void {
  const ctx = audioContext();
  chain.gain.disconnect();
  chain.limiter.disconnect();
  chain.limiterOn = limiterOn;
  if (limiterOn) chain.gain.connect(chain.limiter);
  output(chain).connect(ctx.destination);
  if (chain.analyser) output(chain).connect(chain.analyser);
}

function applyVolume(chain: Chain, volume: number): void {
  const ctx = audioContext();
  // Short ramp avoids clicks ("zipper noise") while dragging the slider.
  chain.gain.gain.setTargetAtTime(volumeToGain(volume), ctx.currentTime, 0.015);
  const boosted = isBoosted(volume);
  if (boosted !== chain.limiterOn) wire(chain, boosted);
}

async function start(tabId: number, streamId: string, volume: number): Promise<void> {
  stop(tabId);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false,
  } as unknown as MediaStreamConstraints);

  const ctx = audioContext();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 3;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.2;

  const chain: Chain = {
    stream,
    source: ctx.createMediaStreamSource(stream),
    gain: ctx.createGain(),
    limiter,
    limiterOn: false,
    analyser: null,
  };
  chain.gain.gain.value = volumeToGain(volume);
  chain.source.connect(chain.gain);
  wire(chain, isBoosted(volume));
  chains.set(tabId, chain);

  for (const track of stream.getAudioTracks()) {
    track.addEventListener('ended', () => {
      if (chains.get(tabId) !== chain) return;
      stop(tabId);
      void chrome.runtime.sendMessage({ target: 'background', type: 'capture-ended', tabId });
    });
  }
}

function stop(tabId: number): void {
  const chain = chains.get(tabId);
  if (!chain) return;
  chains.delete(tabId);
  for (const track of chain.stream.getTracks()) track.stop();
  chain.source.disconnect();
  chain.gain.disconnect();
  chain.limiter.disconnect();
  chain.analyser?.disconnect();
}

function stats(): ChainStats[] {
  return [...chains].map(([tabId, chain]) => {
    if (!chain.analyser) {
      chain.analyser = audioContext().createAnalyser();
      chain.analyser.fftSize = 2048;
      output(chain).connect(chain.analyser);
    }
    const samples = new Float32Array(chain.analyser.fftSize);
    chain.analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const s of samples) sum += s * s;
    return {
      tabId,
      gain: chain.gain.gain.value,
      limiter: chain.limiterOn,
      rms: Math.sqrt(sum / samples.length),
      context: audioContext().state,
    };
  });
}

async function handle(message: OffscreenRequest): Promise<OffscreenResult | ChainStats[]> {
  switch (message.type) {
    case 'start':
      await start(message.tabId, message.streamId, message.volume);
      return { ok: true };
    case 'set': {
      const chain = chains.get(message.tabId);
      if (!chain) return { ok: false, error: 'not-captured' };
      applyVolume(chain, message.volume);
      return { ok: true };
    }
    case 'stop':
      stop(message.tabId);
      return { ok: true };
    case 'stats':
      return stats();
  }
}

chrome.runtime.onMessage.addListener((message: OffscreenRequest, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return false;
  handle(message).then(sendResponse, (error: unknown) =>
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
  return true;
});
