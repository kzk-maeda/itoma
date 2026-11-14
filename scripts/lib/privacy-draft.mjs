const escapeHtml = text => text.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const ids = ['operator','data','storage','deletion','backup','site-contact','apple','contact','changes'];

// Deliberately bounded Markdown renderer for the reviewed policy source.
// Text is escaped; only explicit HTTPS source links become anchors.
function inline(text) {
  return text.split(/(\[[^\]]+\]\(https:\/\/[^)]+\))/g).map(part => {
    const link = part.match(/^\[([^\]]+)\]\((https:\/\/[^)]+)\)$/);
    return link ? `<a href="${escapeHtml(link[2])}">${escapeHtml(link[1])}</a>` : escapeHtml(part);
  }).join('').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
    .replace(/［要確定[^］]*］/g, '<span class="policy-placeholder">$&</span>');
}

function blocks(markdown) {
  const lines = markdown.trim().split('\n'); let html = '', n = 0;
  while (n < lines.length) {
    if (!lines[n].trim()) { n++; continue; }
    if (lines[n].startsWith('|')) {
      const table = [];
      while (n < lines.length && lines[n].startsWith('|')) table.push(lines[n++].split('|').slice(1,-1).map(s=>s.trim()));
      const [headers,, ...rows] = table;
      html += `<div class="data-list">${rows.map(row=>`<article class="data-item"><h3>${inline(row[0])}</h3><dl>${row.slice(1).map((value,index)=>`<div class="definition"><dt>${inline(headers[index+1])}</dt><dd>${inline(value)}</dd></div>`).join('')}</dl></article>`).join('')}</div>`;
      continue;
    }
    if (lines[n].startsWith('- ')) {
      const items = []; while (n < lines.length && lines[n].startsWith('- ')) items.push(lines[n++].slice(2));
      html += `<ul>${items.map(text=>`<li>${inline(text)}</li>`).join('')}</ul>`; continue;
    }
    if (lines[n] === '**要点**') { html += '<h2>要点</h2>'; n++; continue; }
    const paragraph = [];
    while (n < lines.length && lines[n].trim() && !lines[n].startsWith('|') && !lines[n].startsWith('- ')) paragraph.push(lines[n++]);
    html += `<p>${paragraph.map(inline).join('<br>')}</p>`;
  }
  return html;
}

export function renderPrivacyDraft(markdown) {
  const source = markdown.replace(/^# いとま プライバシーポリシー\s*\n/, '');
  const parts = source.split(/^\*\*(\d+\. .+?)\*\*\s*$/m);
  if (parts.length !== 19) throw Error('Policy draft must contain the nine source chapters.');
  const sections = ids.map((id,index)=>({id, title:parts[index*2+1], content:parts[index*2+2]}));
  return {
    toc: sections.map(({id,title})=>`<li><a href="#${id}">${inline(title)}</a></li>`).join(''),
    html: `<div class="policy-summary">${blocks(parts[0])}</div>` + sections.map(({id,title,content})=>`<section id="${id}"><h2>${inline(title)}</h2>${blocks(content)}</section>`).join(''),
  };
}
