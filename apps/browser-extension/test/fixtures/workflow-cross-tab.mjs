/**
 * @author Codex
 * @description Supplies deterministic three-tab recording facts with causal tab relationships without customer data.
 */
export function crossTabWorkflow() {
  const sessionId = '10000000-0000-4000-8000-000000000001';
  const urls = [
    'https://orders.example.com/search',
    'https://orders.example.com/detail',
    'https://audit.example.com/check',
  ];
  const actions = ['input', 'click', 'tab_open', 'input', 'click', 'tab_open', 'click'];
  const refs = ['tab-1', 'tab-1', 'tab-2', 'tab-2', 'tab-2', 'tab-3', 'tab-3'];
  const labels = ['订单号', '打开详情', '详情页', '核对编号', '打开核对页', '核对页', '确认核对'];
  const events = actions.map((action, index) => ({
    id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    sessionId,
    seq: index + 1,
    at: index * 100,
    action,
    tabRef: refs[index],
    label: labels[index],
    url: urls[Number(refs[index].slice(-1)) - 1],
    documentId: 'document-' + refs[index],
    source: action === 'tab_open' ? 'browser' : 'dom',
  }));
  events[1].targetUrl = urls[1];
  events[2].causationId = events[1].id;
  events[4].targetUrl = urls[2];
  events[5].causationId = events[4].id;
  const session = {
    id: sessionId,
    name: '跨页订单核对',
    count: events.length,
    status: 'stopped',
    gaps: [],
    origins: ['https://orders.example.com', 'https://audit.example.com'],
    pages: urls.map((url, index) => ({
      tabId: index + 1,
      tabRef: 'tab-' + (index + 1),
      origin: new URL(url).origin,
    })),
  };
  return { session, events };
}
