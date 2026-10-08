/* A locally synthesized music-box arrangement. Render once, then loop a buffer;
   the animation never schedules or synthesizes audio in its drawing loop. */
(() => {
  const button = document.getElementById('music');
  const AudioEngine = window.AudioContext || window.webkitAudioContext;
  let context, output, capture, buffer, source, rendering, enabled = false, wanted = true;
  const beat = 60 / 94;
  const melody = [
    [79,.75],[79,.25],[81,1],[79,1],[84,1],[83,2],
    [79,.75],[79,.25],[81,1],[79,1],[86,1],[84,2],
    [79,.75],[79,.25],[91,1],[88,1],[84,1],[83,1],[81,1],
    [89,.75],[89,.25],[88,1],[84,1],[86,1],[84,2]
  ];
  const totalBeats = melody.reduce((sum, note) => sum + note[1], 0);

  async function renderMusicBox() {
    const rate = 32000, duration = totalBeats * beat + 4.5;
    const offline = new OfflineAudioContext(2, Math.ceil(duration * rate), rate);
    const dry = offline.createGain();
    dry.gain.value = .8;
    dry.connect(offline.destination);
    // A quiet stereo echo leaves room around the metal-tine notes.
    for (const [delayTime, pan] of [[.19,-.45],[.31,.45]]) {
      const delay = offline.createDelay(1), wet = offline.createGain();
      const position = offline.createStereoPanner();
      delay.delayTime.value = delayTime; wet.gain.value = .13; position.pan.value = pan;
      dry.connect(delay); delay.connect(wet); wet.connect(position); position.connect(offline.destination);
    }
    function chime(midi, at, volume, bass = false) {
      const pitch = 440 * Math.pow(2, (midi - 69) / 12);
      const pan = offline.createStereoPanner();
      pan.pan.value = Math.sin(midi * .8) * .16;
      pan.connect(dry);
      // Fast, gentle strike; inharmonic overtones decay before the fundamental.
      for (const [ratio, strength, decay] of [[1,1,1.05],[2.76,.14,.30],[5.4,.035,.16]]) {
        const oscillator = offline.createOscillator(), envelope = offline.createGain();
        oscillator.type = 'sine'; oscillator.frequency.value = pitch * ratio;
        const peak = volume * strength, end = at + (bass ? 2.3 : 3.2);
        envelope.gain.setValueAtTime(0, at);
        envelope.gain.linearRampToValueAtTime(peak, at + .007);
        envelope.gain.setTargetAtTime(0, at + .007, decay * (bass ? .7 : 1));
        envelope.gain.setValueAtTime(0, end);
        oscillator.connect(envelope); envelope.connect(pan);
        oscillator.start(at); oscillator.stop(end + .01);
      }
    }
    let cursor = .12;
    for (const [note, beats] of melody) {
      chime(note, cursor, .23);
      cursor += beats * beat;
    }
    // Sparse C-major broken chords underneath the familiar birthday melody.
    const chords = [[48,55,64],[55,62,65],[55,62,65],[48,55,64],
                    [48,55,64],[53,60,65],[55,62,65],[48,55,64]];
    chords.forEach((chord, bar) => chord.forEach((note, i) => {
      chime(note + 12, .12 + (bar * 3 + i) * beat, i === 0 ? .065 : .045, true);
    }));
    const rendered = await offline.startRendering();
    // Leave only a short breath between verses. Fold the remaining chime tails
    // into the next cycle so shortening the gap never cuts a ringing note off.
    const loopFrames = Math.round((totalBeats * beat + .55) * rate);
    const loop = offline.createBuffer(2, loopFrames, rate);
    for (let channel = 0; channel < 2; channel++) {
      const input = rendered.getChannelData(channel), output = loop.getChannelData(channel);
      for (let i = 0; i < input.length; i++) output[i % loopFrames] += input[i];
    }
    return loop;
  }

  async function startMusic() {
    if (!wanted || !AudioEngine || !window.OfflineAudioContext) return;
    try {
      if (!context) {
        context = new AudioEngine(); output = context.createGain();
        capture = context.createMediaStreamDestination();
        output.connect(context.destination); output.connect(capture);
      }
      // Attempt autoplay, and repeat resume synchronously inside any user gesture.
      // Do not await a policy-blocked resume: prepare the loop while it is suspended.
      if (context.state !== 'running') context.resume().catch(() => {});
      if (!buffer) buffer = await (rendering || (rendering = renderMusicBox().catch(error => {
        rendering = null; throw error;
      })));
      if (!wanted || source) return;
      source = context.createBufferSource(); source.buffer = buffer; source.loop = true;
      source.connect(output);
      output.gain.cancelScheduledValues(context.currentTime);
      output.gain.setValueAtTime(0, context.currentTime);
      output.gain.linearRampToValueAtTime(.65, context.currentTime + .45);
      source.start(); enabled = true;
      if (button) { button.textContent = '♫ 音乐：开'; button.setAttribute('aria-pressed', 'true'); }
    } catch (error) {
      // A subsequent gesture can retry without introducing visible page controls.
      enabled = false;
    }
  }
  function stopMusic() {
    wanted = false; enabled = false;
    if (source) {
      output.gain.cancelScheduledValues(context.currentTime);
      output.gain.setValueAtTime(output.gain.value, context.currentTime);
      output.gain.linearRampToValueAtTime(0, context.currentTime + .12);
      const endingSource = source; source = null;
      endingSource.stop(context.currentTime + .13);
      endingSource.onended = () => endingSource.disconnect();
    }
    if (button) { button.textContent = '♫ 开启音乐'; button.setAttribute('aria-pressed', 'false'); }
  }
  button?.addEventListener('click', () => {
    if (wanted) stopMusic(); else { wanted = true; startMusic(); }
  });
  const unlock = () => {
    if (wanted && (!source || context?.state !== 'running')) startMusic();
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
  window.addEventListener('pageshow', unlock);
  window.rayMusic = {
    recordingTrack() { return enabled && context?.state === 'running' ? capture.stream.getAudioTracks()[0].clone() : null; }
  };
  startMusic();
})();
