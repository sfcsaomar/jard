// Small SVG bar charts for the dashboards (no library, works offline).
//   barChart(el, rows, {label: r => '10-07', value: r => 12, format: v => '12', highlightLast: true})
// Bars run oldest → newest in reading direction (right to left in Arabic).
function barChart(el, rows, opt = {}){
  const value = opt.value || ((r)=> r.value);
  const label = opt.label || ((r)=> r.label);
  const fmt = opt.format || ((v)=> num(v));
  if(!rows || !rows.length || rows.every(r=> !value(r))){
    el.innerHTML = `<div class="chart-empty">${esc(opt.empty || t('common.noData'))}</div>`;
    return;
  }
  const W = 640, H = opt.height || 190, padT = 18, padB = 24, padX = 6;
  const max = Math.max(...rows.map(value)) || 1;
  const step = (W - padX * 2) / rows.length;
  const bw = Math.max(2, Math.min(28, step * 0.68));
  const rtl = document.documentElement.dir === 'rtl';
  const every = Math.ceil(rows.length / (opt.ticks || 8));
  let bars = '', ticks = '';
  rows.forEach((r, i)=>{
    const v = value(r);
    const h = Math.round((v / max) * (H - padT - padB));
    const slot = rtl ? rows.length - 1 - i : i;
    const x = padX + slot * step + (step - bw) / 2;
    const y = H - padB - h;
    const cls = opt.highlightLast && i === rows.length - 1 ? 'cbar today' : 'cbar';
    bars += `<rect class="${cls}" x="${x.toFixed(1)}" y="${y}" width="${bw.toFixed(1)}" height="${Math.max(h, v ? 2 : 0)}" rx="3"><title>${esc(label(r))}: ${esc(fmt(v))}</title></rect>`;
    // Label every few bars, plus the last one; skip a label that would touch the last.
    if(i === rows.length - 1 || (i % every === 0 && rows.length - 1 - i >= Math.ceil(every * 0.6))){
      ticks += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(label(r))}</text>`;
    }
  });
  // A middle line only when its label is meaningful (small whole counts would repeat the top value).
  const grid = (opt.format || max >= 4 ? [0.5, 1] : [1]).map(f=>{
    const y = H - padB - Math.round(f * (H - padT - padB));
    return `<line class="grid" x1="0" x2="${W}" y1="${y}" y2="${y}"/><text x="${rtl ? W - 2 : 2}" y="${y - 4}" text-anchor="${rtl ? 'end' : 'start'}">${esc(fmt(max * f))}</text>`;
  }).join('');
  el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.title || '')}">${grid}<line class="grid" x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}"/>${bars}${ticks}</svg>`;
}
const shortDay = (iso)=> String(iso || '').slice(5, 10);
