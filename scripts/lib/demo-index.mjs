import { demoTarget, DEMO_HOST, DEMO_ZONE } from './demo-target.mjs';

// These deployed design studies live alongside the original Expo index.html.
// Key by deployment identity so the link survives a deleted Git branch, too.
const entryPages = new Map([
  ['feat/design-three-demos', 'design-lab.html'],
  ['demo/b-reason-unlock', 'design-b.html'],
  ['demo/b-native-motion', 'design-motion.html'],
  ['demo/color-variations', 'design-colors.html'],
  ['demo/hourglass-experience', 'hourglass.html'],
].map(([branch, page]) => [demoTarget(branch).key, page]));

export function demoEntryPath(environment) {
  return `${environment.basePath}/${entryPages.get(environment.key) ?? ''}`;
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function summaryFor(pr, branch) {
  const paragraph = pr?.body?.split(/\n\s*\n/).map(p => p.trim()).find(p => p && !p.startsWith('#') && !p.startsWith('<!--') && !p.startsWith('|'));
  return (paragraph || branch?.commit?.commit?.message?.split('\n')[0] || 'ブランチごとに配信された検証用のデモです。').slice(0, 300);
}

/** Cloudflare routes define what is deployed; branch existence alone never does. */
export async function collectEnvironments({ accountId, cloudflareToken, githubToken, repository, fetchImpl = fetch }) {
  if (!/^[a-f0-9]{32}$/.test(accountId ?? '') || !cloudflareToken || !githubToken || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('Demo index credentials/account/repository are required.');
  async function request(url, token, missing = false) {
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
    if (missing && response.status === 404) return null;
    if (!response.ok) throw new Error(`Index source request failed: HTTP ${response.status}`);
    return response.json();
  }
  async function cf(path, missing = false) {
    const data = await request(`https://api.cloudflare.com/client/v4${path}`, cloudflareToken, missing);
    if (data === null) return null;
    if (data.success !== true) throw new Error('Cloudflare index source failed.');
    return data.result;
  }
  async function githubPages(path) {
    const result = [];
    for (let page = 1; ; page++) {
      const data = await request(`https://api.github.com/repos/${repository}/${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, githubToken);
      if (!Array.isArray(data)) throw new Error('Invalid GitHub list response.');
      result.push(...data);
      if (data.length < 100) return result;
    }
  }
  const zones = await cf(`/zones?name=${DEMO_ZONE}&account.id=${accountId}`);
  if (!Array.isArray(zones) || zones.length !== 1 || zones[0].name !== DEMO_ZONE || zones[0].account?.id !== accountId || !/^[a-f0-9]{32}$/.test(zones[0].id)) throw new Error('Expected the demo zone in the configured account.');
  const routes = await cf(`/zones/${zones[0].id}/workers/routes`);
  if (!Array.isArray(routes)) throw new Error('Invalid Cloudflare routes.');
  const branches = await githubPages('branches');
  const prs = await githubPages('pulls?state=all&sort=updated&direction=desc');
  const byKey = new Map(branches.map(branch => [demoTarget(branch.name).key, branch]));
  const candidates = new Map();
  for (const route of routes) {
    const match = route.pattern?.match(new RegExp(`^${DEMO_HOST.replaceAll('.', '\\.')}\\/demos\\/([a-z0-9-]+-[a-f0-9]{12})/\\*$`));
    if (!match || route.script !== `itoma-demo-${match[1]}`) continue;
    const basePath = `/demos/${match[1]}`;
    if (!routes.some(r => r.pattern === `${DEMO_HOST}${basePath}` && r.script === route.script)) continue;
    candidates.set(match[1], { key: match[1], basePath, workerName: route.script });
  }
  const environments = [];
  // Sequential bounded API calls; no account-wide Worker listing or unrelated resources.
  for (const candidate of candidates.values()) {
    const worker = await cf(`/accounts/${accountId}/workers/workers/${candidate.workerName}`, true);
    if (worker === null) continue;
    if (worker.name !== candidate.workerName || !/^[a-f0-9]{32}$/.test(worker.id ?? '')) throw new Error('Unexpected demo Worker identity.');
    const branch = byKey.get(candidate.key);
    const pr = branch && prs.find(p => p.head?.ref === branch.name && p.head?.repo?.full_name === repository);
    let source = branch;
    if (!pr && /^[a-f0-9]{40}$/.test(branch?.commit?.sha ?? '')) {
      const commit = await request(`https://api.github.com/repos/${repository}/commits/${branch.commit.sha}`, githubToken);
      source = { ...branch, commit };
    }
    environments.push({ ...candidate, branch: branch?.name ?? null, title: pr?.title || branch?.name || candidate.key, summary: summaryFor(pr, source), prNumber: pr?.number ?? null, updatedAt: worker.updated_on ?? null });
  }
  return environments.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')) || a.key.localeCompare(b.key));
}

function displayTime(value) {
  if (!value) return '不明';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(date) : String(value);
}

export function renderIndex(environments, checkedAt) {
  const e = escapeHtml;
  const cards = environments.map(item => `<article><div class="meta">配信先あり${item.branch ? '' : ' · Gitブランチ情報なし'}</div><h2><a href="${e(demoEntryPath(item))}">${e(item.title)}</a></h2><p class="summary">${e(item.summary)}</p><dl><dt>ブランチ</dt><dd>${e(item.branch || '不明・削除済み・ローカル配信')}</dd><dt>Worker更新</dt><dd>${e(displayTime(item.updatedAt))}</dd></dl><div class="links"><a class="open" href="${e(demoEntryPath(item))}">デモを開く <span aria-hidden="true">↗</span></a>${item.prNumber ? `<a href="https://github.com/kzk-maeda/itoma/pull/${Number(item.prNumber)}">PR #${Number(item.prNumber)}</a>` : ''}<a href="${e(item.basePath)}/demo-build.json">配信情報</a></div></article>`).join('');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="color-scheme" content="light dark"><title>デモ環境一覧 | ITOMA</title><style>
:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#263d33;background:#f6f5f0;--surface:#fff;--muted:#626b63;--line:#dbe1d8;--accent:#355c49}*{box-sizing:border-box}body{margin:0}main{max-width:920px;margin:auto;padding:40px 24px 64px}.brand{font-weight:650;letter-spacing:.16em}h1{font-size:clamp(1.7rem,5vw,2.3rem);margin:36px 0 12px}p{line-height:1.8}.intro,.meta,dt,.checked{color:var(--muted)}.checked{font-size:.85rem}.grid{display:grid;gap:16px;margin-top:28px}article{background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:24px;min-width:0}h2{font-size:1.15rem;margin:10px 0}a{color:var(--accent);overflow-wrap:anywhere;text-underline-offset:.2em}h2 a{text-decoration:none}.summary{white-space:pre-wrap;overflow-wrap:anywhere}dl{display:grid;grid-template-columns:7rem 1fr;gap:8px;font-size:.85rem;line-height:1.7}dd{margin:0;overflow-wrap:anywhere}.links{display:flex;flex-wrap:wrap;align-items:center;gap:8px 20px;margin-top:20px}.links a{display:inline-flex;align-items:center;min-height:44px}.open{font-weight:650}a:focus-visible{outline:3px solid var(--accent);outline-offset:5px}.empty{padding:24px;border:1px solid var(--line);border-radius:16px}.notice{margin-top:32px;font-size:.9rem;color:var(--muted)}@media(prefers-color-scheme:dark){:root{color:#edf1e7;background:#171e1a;--surface:#242e27;--muted:#b5c0b4;--line:#465347;--accent:#bed1b8}}@media(max-width:400px){main{padding:24px 16px 40px}article{padding:20px}dl{grid-template-columns:1fr;gap:4px}dd{margin-bottom:8px}}
</style></head><body><main><div class="brand">いとま ITOMA</div><h1>デモ環境一覧</h1><p class="intro">試したい変更を選んで、デモを開けます。各環境の選択内容は、それぞれの画面で操作してください。</p><p class="checked">確認時点の配信環境：${environments.length}件 · 更新確認 ${e(displayTime(checkedAt))}</p><section class="grid" aria-label="配信中のデモ環境">${cards || '<p class="empty">現在、配信中のブランチデモはありません。</p>'}</section><p class="notice">一覧は配信・撤去後と定期実行で更新します。概要は現在のPRまたはブランチ情報です。実際に配信されたコミットは各環境の「配信情報」で確認できます。OS制限・実課金はデモでは行いません。</p></main></body></html>`;
}
