const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const searchUrl = (base, query) => `${base}${encodeURIComponent(query)}`;

function imageHash(source) {
  const canvas = document.createElement('canvas'); canvas.width = 9; canvas.height = 8;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(source, 0, 0, 9, 8);
  const pixels = context.getImageData(0, 0, 9, 8).data; let hash = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const left = (y * 9 + x) * 4, right = left + 4;
    const l = pixels[left] * .299 + pixels[left + 1] * .587 + pixels[left + 2] * .114;
    const r = pixels[right] * .299 + pixels[right + 1] * .587 + pixels[right + 2] * .114;
    hash += l > r ? '1' : '0';
  }
  return hash;
}
function distance(left, right) { let count = 0; for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) count++; return count; }
function videoAt(video, time) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Video seek timed out.')), 8000);
    const done = () => { clearTimeout(timer); video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done, { once: true }); video.currentTime = time;
  });
}

export function mountMediaStudio({ onInsert = () => {} } = {}) {
  document.querySelector('#mediaStudio')?.remove();
  const root = document.createElement('section'); root.id = 'mediaStudio'; root.className = 'utility-studio-backdrop';
  root.innerHTML = `<div class="utility-studio media-studio" role="dialog" aria-modal="true" aria-labelledby="mediaTitle"><header><div><div class="eyebrow">FIND · RESEARCH · ORGANIZE</div><h2 id="mediaTitle">Media & web search</h2></div><button data-close aria-label="Close">×</button></header><p class="studio-note">Search the open web, find official movie information and licensed viewing options, or compare a screenshot against your own video files locally. Salt does not bypass paywalls, DRM, or copyright restrictions.</p><div class="media-search-block"><form id="webSearchForm"><label>Search the web<input name="query" required maxlength="300" placeholder="What resource are you looking for?"></label><button class="studio-primary">Search</button></form><div class="media-shortcuts"><button data-search="movie">Find a movie & legal viewing options</button><button data-search="public">Public-domain films & videos</button><button data-search="image">Search the web for this topic</button></div></div><section class="media-match"><h3>Find a moment in my videos</h3><p>Choose a screenshot and local video files. Salt samples video frames in this browser and ranks visually similar moments; files are not uploaded.</p><div class="media-file-fields"><label>Screenshot<input id="matchImage" type="file" accept="image/*"></label><label>Video files<input id="matchVideos" type="file" accept="video/*,.mp4,.webm,.mov,.m4v" multiple></label><button id="matchStart" class="studio-primary" disabled>Find matching scenes</button></div><progress id="matchProgress" max="100" value="0" hidden></progress><div id="matchStatus" class="studio-status" aria-live="polite"></div><div id="matchResults" class="studio-results"></div></section><section class="media-download"><h3>Make an authorized video smaller</h3><p>Transcode a local video in this browser to WebM. This uses your device, can take as long as the video, and may not preserve subtitles or every audio track.</p><form id="compressForm"><label>Video file<input type="file" name="video" accept="video/*,.mp4,.webm,.mov,.m4v" required></label><label>Output size<select name="size"><option value="720">720p · clearer · larger file</option><option value="480">480p · smaller file</option></select></label><button class="studio-primary">Create smaller copy</button></form><progress id="compressProgress" max="100" value="0" hidden></progress><div id="compressStatus" class="studio-status" aria-live="polite"></div></section><section class="media-download"><h3>Download a resource you’re allowed to save</h3><p>Paste a direct downloadable URL from its creator or an explicitly licensed/public-domain source. Check the source’s license before saving.</p><form id="downloadForm"><label>Direct file URL<input type="url" name="url" required maxlength="2000" placeholder="https://…"></label><label class="license-check"><input name="authorized" type="checkbox" required> I have permission to download this file or it is clearly licensed for download.</label><button class="studio-primary">Open download</button></form></section><footer>Web search opens a search provider. Search results are not verified by Salt; confirm licensing, source trust, and the destination before downloading.</footer></div>`;
  document.body.append(root);
  let closed = false;
  root.querySelector('[data-close]').onclick = () => { closed = true; root.remove(); };
  root.onclick = event => { if (event.target === root) { closed = true; root.remove(); } };
  const search = query => window.open(searchUrl('https://www.google.com/search?q=', query), '_blank', 'noopener,noreferrer');
  root.querySelector('#webSearchForm').onsubmit = event => { event.preventDefault(); const query = String(new FormData(event.currentTarget).get('query') || '').trim(); if (query) search(query); };
  root.querySelectorAll('[data-search]').forEach(button => button.onclick = () => {
    const input = root.querySelector('#webSearchForm [name=query]');
    if (button.dataset.search === 'image') { const query = input.value.trim(); if (!query) { input.focus(); return; } search(query); }
    else if (button.dataset.search === 'movie') { const query = input.value.trim(); if (!query) { input.placeholder = 'Enter the movie title above first'; input.focus(); return; } search(`${query} official streaming rent buy watch options`); }
    else search(`${input.value.trim()} public domain films downloadable Creative Commons`.trim());
  });
  root.querySelector('#downloadForm').onsubmit = event => {
    event.preventDefault(); const data = new FormData(event.currentTarget); if (!data.get('authorized')) return;
    const url = new URL(String(data.get('url'))); if (url.protocol !== 'https:' && url.protocol !== 'http:') { window.alert('Use a direct HTTPS or HTTP download link.'); return; }
    const link = document.createElement('a'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.download = ''; link.click();
  };
  root.querySelector('#compressForm').onsubmit = async event => {
    event.preventDefault(); const data = new FormData(event.currentTarget), file = data.get('video'), targetHeight = Number(data.get('size'));
    const status = root.querySelector('#compressStatus'), progress = root.querySelector('#compressProgress'), submit = event.currentTarget.querySelector('button[type=submit]');
    if (!(file instanceof File) || !file.size) return;
    if (!('MediaRecorder' in window) || !HTMLCanvasElement.prototype.captureStream) { status.textContent = 'This browser does not support local video transcoding. Try current Chrome or Edge.'; return; }
    submit.disabled = true; progress.hidden = false; progress.value = 0; status.textContent = 'Preparing local video…';
    const video = document.createElement('video'), sourceUrl = URL.createObjectURL(file), canvas = document.createElement('canvas'); video.src = sourceUrl; video.preload = 'metadata'; video.muted = true;
    try {
      await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('Could not read this video.')); setTimeout(() => reject(new Error('Video metadata timed out.')), 10000); });
      if (!Number.isFinite(video.duration) || video.duration <= 0 || file.size > 2_000_000_000) throw new Error('Choose a readable video under 2 GB.');
      const scale = Math.min(1, targetHeight / video.videoHeight); canvas.width = Math.max(2, Math.round(video.videoWidth * scale / 2) * 2); canvas.height = Math.max(2, Math.round(video.videoHeight * scale / 2) * 2);
      const context = canvas.getContext('2d'); const output = canvas.captureStream(24); let audioStream;
      const sourceStream = video.captureStream?.() || video.mozCaptureStream?.(); audioStream = sourceStream?.getAudioTracks?.() || []; for (const track of audioStream) output.addTrack(track);
      const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('This browser has no supported WebM encoder.');
      const recorder = new MediaRecorder(output, { mimeType, videoBitsPerSecond: targetHeight === 720 ? 1_400_000 : 700_000, audioBitsPerSecond: 96_000 }); const chunks = [];
      const draw = () => { if (!video.paused && !video.ended) { context.drawImage(video, 0, 0, canvas.width, canvas.height); requestAnimationFrame(draw); } };
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      const finished = new Promise((resolve, reject) => { recorder.onstop = resolve; recorder.onerror = () => reject(new Error('Video encoding failed.')); });
      video.ontimeupdate = () => { progress.value = Math.min(99, Math.round(video.currentTime / video.duration * 100)); status.textContent = `Encoding ${Math.round(progress.value)}%… keep this tab open.`; };
      recorder.start(1000); video.currentTime = 0; await video.play(); draw();
      await new Promise(resolve => { video.onended = resolve; }); recorder.stop(); await finished;
      const outputBlob = new Blob(chunks, { type: mimeType });
      if (outputBlob.size >= file.size) status.textContent = `Finished, but the new file is not smaller (${(outputBlob.size / 1024 / 1024).toFixed(1)} MB). You can still save it below.`;
      else status.textContent = `Done · ${(file.size / 1024 / 1024).toFixed(1)} MB → ${(outputBlob.size / 1024 / 1024).toFixed(1)} MB (${Math.round((1 - outputBlob.size / file.size) * 100)}% smaller).`;
      const download = document.createElement('a'); download.href = URL.createObjectURL(outputBlob); download.download = `${file.name.replace(/\.[^.]+$/, '')}-${targetHeight}p.webm`; download.textContent = 'Save smaller video'; download.className = 'media-save-link'; status.append(' ', download);
      progress.value = 100;
    } catch (error) { status.textContent = `Could not transcode video: ${error.message}`; }
    finally { video.pause(); URL.revokeObjectURL(sourceUrl); progress.hidden = true; submit.disabled = false; }
  };
  const imageInput = root.querySelector('#matchImage'), videosInput = root.querySelector('#matchVideos'), startButton = root.querySelector('#matchStart');
  const canStart = () => { startButton.disabled = !imageInput.files?.[0] || !videosInput.files?.length; };
  imageInput.onchange = videosInput.onchange = canStart;
  startButton.onclick = async () => {
    const screenshot = imageInput.files[0], files = [...videosInput.files].slice(0, 30), status = root.querySelector('#matchStatus'), progress = root.querySelector('#matchProgress'), results = root.querySelector('#matchResults');
    results.replaceChildren(); progress.hidden = false; progress.value = 0; startButton.disabled = true;
    try {
      const image = new Image(); const imageUrl = URL.createObjectURL(screenshot);
      try { image.src = imageUrl; await image.decode(); } finally { /* keep URL until decode completes */ }
      const target = imageHash(image); URL.revokeObjectURL(imageUrl);
      const matches = []; let completed = 0;
      for (const file of files) {
        if (file.size > 2_000_000_000) { completed++; continue; }
        const video = document.createElement('video'); const objectUrl = URL.createObjectURL(file); video.preload = 'metadata'; video.muted = true; video.src = objectUrl;
        try {
          await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('Could not read video metadata.')); setTimeout(() => reject(new Error('Video metadata timed out.')), 10000); });
          const duration = video.duration; if (!Number.isFinite(duration) || duration <= 0) throw new Error('Video has no readable duration.');
          let best = { score: 65, time: 0 };
          const sampleCount = Math.min(36, Math.max(6, Math.ceil(duration / 20)));
          for (let sample = 0; sample < sampleCount; sample++) {
            if (closed) return;
            const time = Math.min(Math.max(.1, duration * ((sample + .5) / sampleCount)), Math.max(.1, duration - .1));
            await videoAt(video, time);
            try { const score = distance(imageHash(video), target); if (score < best.score) best = { score, time }; } catch { /* frame may be protected or unsupported */ }
          }
          if (best.score < 55) matches.push({ name: file.name, time: best.time, similarity: Math.round((1 - best.score / 64) * 100), url: objectUrl });
          else URL.revokeObjectURL(objectUrl);
        } catch { URL.revokeObjectURL(objectUrl); }
        completed++; progress.value = Math.round(completed / files.length * 100); status.textContent = `Checking video ${completed} of ${files.length}…`;
      }
      matches.sort((a, b) => b.similarity - a.similarity);
      if (!matches.length) status.textContent = 'No close visual match found. Try a tighter screenshot crop or add more video files.';
      else { status.textContent = `Found ${matches.length} possible match${matches.length === 1 ? '' : 'es'}; scores are approximate.`;
        for (const match of matches.slice(0, 8)) {
          const item = document.createElement('article'); item.className = 'media-match-result';
          const video = document.createElement('video'); video.src = match.url; video.controls = true; video.preload = 'metadata'; video.currentTime = match.time;
          const details = document.createElement('div'); const title = document.createElement('strong'); title.textContent = match.name; const info = document.createElement('span'); info.textContent = `${match.similarity}% visual similarity · around ${Math.floor(match.time / 60)}:${String(Math.floor(match.time % 60)).padStart(2, '0')}`;
          details.append(title, info); item.append(video, details); results.append(item);
        }
      }
      onInsert(matches.length ? `Possible video matches for “${screenshot.name}”: ${matches.slice(0, 5).map(match => `${match.name} around ${Math.floor(match.time)}s (${match.similarity}% similarity)`).join('; ')}` : `No local video match was found for “${screenshot.name}”.`);
    } catch (error) { status.textContent = `Could not compare these files: ${error.message}`; }
    finally { startButton.disabled = false; progress.hidden = true; }
  };
  return root;
}
