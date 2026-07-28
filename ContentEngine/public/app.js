const form = document.querySelector('#generate-form');
const jobsEl = document.querySelector('#jobs');
const message = document.querySelector('#form-message');
const openPrompts = new Set();

async function refresh() {
  const [health, jobs] = await Promise.all([fetch('/health').then(r => r.json()), fetch('/jobs').then(r => r.json())]);
  document.querySelector('#storage').textContent = health.storage === 'postgresql' ? 'PostgreSQL connected' : 'Demo storage mode';
  render(jobs);
}
function completedSteps(status) {
  if (status === 'completed') return 5;
  if (status === 'processing' || status === 'failed') return 3;
  return 2;
}
function render(jobs) {
  jobsEl.replaceChildren();
  if (!jobs.length) { jobsEl.innerHTML = '<p class="empty">No jobs yet. Create your first creative above.</p>'; return; }
  const tpl = document.querySelector('#job-template');
  jobs.forEach(job => {
    const node = tpl.content.cloneNode(true); const card = node.querySelector('.job');
    card.querySelector('h3').textContent = job.productName;
    const status = card.querySelector('.status'); status.textContent = job.status; status.classList.add(job.status);
    card.querySelector('.description').textContent = job.description;
    card.querySelector('time').textContent = new Date(job.createdAt).toLocaleString();
    const steps = completedSteps(job.status);
    card.querySelectorAll('.pipeline li').forEach((step, index) => {
      if (index < steps) step.classList.add('done');
      if (index === steps - 1 && job.status !== 'completed') step.classList.add('current');
    });
    const details = card.querySelector('details'); details.open = openPrompts.has(job.id);
    details.addEventListener('toggle', () => { if (details.open) openPrompts.add(job.id); else openPrompts.delete(job.id); });
    card.querySelector('.prompt').textContent = job.prompt || 'Prompt is being prepared...';
    const result = card.querySelector('.result'); if (job.resultUrl) result.src = job.resultUrl; else result.remove();
    card.querySelector('.error').textContent = job.error || ''; jobsEl.append(node);
  });
}
form.addEventListener('submit', async event => {
  event.preventDefault(); message.textContent = 'Creating job...';
  const response = await fetch('/generate', { method: 'POST', body: new FormData(form) }); const data = await response.json();
  if (!response.ok) { message.textContent = data.error || 'Could not create job.'; return; }
  message.textContent = `Job ${data.id.slice(0, 8)} created.`; form.reset(); await refresh();
});
refresh(); setInterval(refresh, 2000);
