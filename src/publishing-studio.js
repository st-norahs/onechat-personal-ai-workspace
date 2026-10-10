const key = 'salt.publishing.drafts';
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const load = () => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } };
const save = items => { localStorage.setItem(key, JSON.stringify(items)); window.dispatchEvent(new Event('salt:resources-changed')); };

function card(item) {
  const date = item.scheduledAt ? new Date(item.scheduledAt).toLocaleString() : 'Draft';
  return `<article class="studio-card" data-id="${esc(item.id)}"><div class="studio-card-top"><strong>${esc(item.title || 'Untitled draft')}</strong><span>${esc(item.status || date)} · ${esc(date)}</span></div><p>${esc(item.body)}</p><div class="studio-card-actions"><button data-studio="edit">Edit</button><button data-studio="copy">Copy</button><button data-studio="email">Email</button><button data-studio="linkedin">Open LinkedIn</button><button data-studio="delete">Delete</button></div></article>`;
}

export function mountPublishingStudio(initialText = '') {
  document.querySelector('#publishingStudio')?.remove();
  const node = document.createElement('section');
  node.id = 'publishingStudio';
  node.className = 'utility-studio-backdrop';
  node.innerHTML = `<div class="utility-studio" role="dialog" aria-modal="true" aria-labelledby="publishingTitle"><header><div><div class="eyebrow">WRITE · REVIEW · SCHEDULE</div><h2 id="publishingTitle">Publishing studio</h2></div><button data-close aria-label="Close">×</button></header><p class="studio-note">Drafts and schedules are saved in this browser. At the scheduled time Salt will mark the draft ready when the app is open; it will not silently post. Email and LinkedIn open their own compose screens for your review. Connect a trusted publishing provider through MCP for direct publishing.</p><form id="studioComposer"><label>Title<input name="title" maxlength="140" placeholder="A short label for this draft"></label><label>Email recipient (optional)<input name="to" maxlength="500" placeholder="name@example.com"></label><label>Post or email<textarea name="body" required maxlength="10000" rows="7" placeholder="Write or paste your message…">${esc(initialText)}</textarea></label><div class="studio-compose-row"><label>Send to<select name="channel"><option value="linkedin">LinkedIn post</option><option value="email">Email draft</option><option value="both">LinkedIn + email</option></select></label><label>Schedule time<input name="scheduledAt" type="datetime-local"></label><button class="studio-primary" type="submit">Save draft</button></div></form><div class="studio-list-heading"><strong>Drafts & scheduled posts</strong><span>Review before sending</span></div><div class="studio-list">${load().map(card).join('') || '<p class="studio-empty">No drafts yet. Create one above.</p>'}</div><footer>Publishing limits are set by each connected service. Salt does not bypass provider limits or post without your approval.</footer></div>`;
  document.body.append(node);
  const list = node.querySelector('.studio-list');
  let editingId = null;
  const refresh = () => { const items = load(); list.innerHTML = items.map(card).join('') || '<p class="studio-empty">No drafts yet. Create one above.</p>'; };
  const timer = window.setInterval(() => {
    const now = Date.now(); let changed = false;
    const items = load().map(item => { if (item.scheduledAt && item.status === 'scheduled' && Date.parse(item.scheduledAt) <= now) { item.status = 'ready for review'; changed = true; } return item; });
    if (changed) { save(items); refresh(); }
  }, 30_000);
  const close = () => { window.clearInterval(timer); node.remove(); };
  node.querySelector('[data-close]').onclick = close;
  node.onclick = event => { if (event.target === node) close(); };
  node.querySelector('#studioComposer').onsubmit = event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = String(data.get('body') || '').trim();
    if (!body) return;
    const scheduled = String(data.get('scheduledAt') || '');
    const scheduledAt = scheduled ? new Date(scheduled).toISOString() : null;
    if (scheduledAt && new Date(scheduledAt).getTime() <= Date.now()) { window.alert('Choose a future schedule time.'); return; }
    const to = String(data.get('to') || '').trim();
    if (to && !to.split(/[;,\s]+/).filter(Boolean).every(address => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address))) { window.alert('Check the recipient email address.'); return; }
    const items = load();
    const draft = { id: editingId || crypto.randomUUID(), title: String(data.get('title') || '').trim(), to, body, channel: String(data.get('channel')), scheduledAt, createdAt: items.find(item => item.id === editingId)?.createdAt || new Date().toISOString(), status: scheduledAt ? 'scheduled' : 'draft' };
    const existing = items.findIndex(item => item.id === editingId);
    if (existing >= 0) items[existing] = draft; else items.unshift(draft);
    editingId = null;
    save(items); event.currentTarget.reset(); event.currentTarget.querySelector('button[type=submit]').textContent = 'Save draft'; refresh();
  };
  node.addEventListener('click', async event => {
    const button = event.target.closest('[data-studio]'); if (!button) return;
    const article = button.closest('[data-id]'); const items = load(); const item = items.find(entry => entry.id === article?.dataset.id); if (!item) return;
    if (button.dataset.studio === 'edit') {
      editingId = item.id;
      const form = node.querySelector('#studioComposer'); form.elements.title.value = item.title || ''; form.elements.to.value = item.to || ''; form.elements.body.value = item.body; form.elements.channel.value = item.channel || 'linkedin';
      form.elements.scheduledAt.value = item.scheduledAt ? new Date(new Date(item.scheduledAt).getTime() - new Date(item.scheduledAt).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '';
      form.querySelector('button[type=submit]').textContent = 'Save changes'; form.scrollIntoView({ behavior: 'smooth', block: 'start' }); return;
    }
    if (button.dataset.studio === 'delete') { save(items.filter(entry => entry.id !== item.id)); refresh(); return; }
    if (button.dataset.studio === 'copy') { await navigator.clipboard?.writeText(item.body); button.textContent = 'Copied'; return; }
    if (button.dataset.studio === 'email') {
      const subject = encodeURIComponent(item.title || ''); const body = encodeURIComponent(item.body); const to = encodeURIComponent(String(item.to || '').split(/[;,\s]+/).filter(Boolean).join(','));
      window.location.href = `mailto:${to}?subject=${subject}&body=${body}`; return;
    }
    if (button.dataset.studio === 'linkedin') {
      await navigator.clipboard?.writeText(item.body).catch(() => {});
      window.open('https://www.linkedin.com/feed/?shareActive=true', '_blank', 'noopener,noreferrer');
      window.alert('Your post text was copied. Review it in LinkedIn, paste it into the composer, and publish there.');
    }
  });
}
