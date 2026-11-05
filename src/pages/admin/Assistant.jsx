import React, { useEffect, useRef, useState } from 'react';
import { Bot, Database, Send, ShieldCheck, Sparkles, User } from 'lucide-react';
import { post } from '../../lib/api';
import { useToast } from '../../lib/store';
import { Badge, Loading, PageHeader, SectionCard } from '../../components/ui';
import { inr, num } from '../../lib/format';

const SUGGESTIONS = [
  'How is revenue looking today?',
  'Which items are selling best this month?',
  'What stock needs reordering?',
  'How many orders are waiting for the kitchen?',
  'What is our repeat customer rate?',
  'Summarise the last 30 days for me.',
];

function Markdown({ text }) {
  return (
    <div>
      {String(text || '').split('\n').map((line, i) => {
        if (!line.trim()) return <div key={i} style={{ height: 6 }} />;
        const bullet = line.startsWith('•') || line.startsWith('- ');
        const numbered = /^\d+\.\s/.test(line);
        const content = bullet ? line.replace(/^[•-]\s*/, '') : numbered ? line.replace(/^\d+\.\s*/, '') : line;
        const parts = content.split(/(\*\*[^*]+\*\*)/g);
        const body = parts.map((part, j) => (
          part.startsWith('**') && part.endsWith('**')
            ? <strong key={j}>{part.slice(2, -2)}</strong>
            : <React.Fragment key={j}>{part}</React.Fragment>
        ));
        if (bullet) return <div key={i} style={{ display: 'flex', gap: 7, marginBottom: 3 }}><span style={{ color: 'var(--accent)' }}>•</span><span>{body}</span></div>;
        if (numbered) return <div key={i} style={{ display: 'flex', gap: 7, marginBottom: 3 }}><span style={{ color: 'var(--accent)', fontWeight: 600 }}>{line.match(/^\d+/)[0]}.</span><span>{body}</span></div>;
        return <p key={i} style={{ marginBottom: 4 }}>{body}</p>;
      })}
    </div>
  );
}

export default function Assistant() {
  const toast = useToast();
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const [lastFacts, setLastFacts] = useState(null);
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, sending]);

  const ask = async (text) => {
    const q = String(text || '').trim();
    if (!q || sending) return;
    setMessages((prev) => [...prev, { role: 'user', text: q }]);
    setQuestion('');
    setSending(true);
    try {
      const res = await post('/admin/ai', { question: q });
      setMessages((prev) => [...prev, { role: 'assistant', text: res.answer, mode: res.mode, note: res.note }]);
      if (res.facts) setLastFacts(res.facts);
    } catch (err) {
      toast.error(err.message);
      setMessages((prev) => [...prev, { role: 'assistant', text: `I could not answer that: ${err.message}`, mode: 'error', note: 'No figures are shown when the query fails.' }]);
    } finally { setSending(false); }
  };

  const f = lastFacts;

  return (
    <>
      <PageHeader title="AI Assistant" description="Ask operational questions. Answers are grounded in live D1 queries — business figures are never invented.">
        <Badge tone="accent"><Sparkles size={12} /> Hybrid: Workers AI + database rules</Badge>
      </PageHeader>

      <div className="chat-shell">
        <div className="chat-card">
          <div className="chat-log" ref={logRef}>
            {!messages.length && (
              <div style={{ margin: 'auto', textAlign: 'center', maxWidth: 460, padding: '30px 0' }}>
                <div className="empty-icon" style={{ margin: '0 auto 12px', color: 'var(--accent)', background: 'var(--accent-soft)' }}><Bot size={22} /></div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 24 }}>What would you like to know?</div>
                <p className="small muted" style={{ marginTop: 7, lineHeight: 1.6 }}>
                  I can summarise revenue, active orders, reservations, low stock, best sellers and retention.
                  Every number comes from your database — if Workers AI is unavailable I answer with deterministic queries.
                </p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role === 'user' ? 'user' : ''}`}>
                <div className="msg-avatar">{m.role === 'user' ? <User size={14} /> : <Bot size={14} />}</div>
                <div>
                  <div className="msg-bubble"><Markdown text={m.text} /></div>
                  {m.role === 'assistant' && (
                    <div className="msg-mode">
                      {m.mode === 'ai' ? <Sparkles size={10} /> : <Database size={10} />}
                      {m.mode === 'ai' ? 'AI narration over database facts' : m.mode === 'error' ? 'Query failed' : 'Database answer'}
                      {m.note ? ` · ${m.note}` : ''}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {sending && (
              <div className="msg">
                <div className="msg-avatar"><Bot size={14} /></div>
                <div className="msg-bubble"><span className="flex items-center gap-8 small muted"><span className="spinner" /> Checking the database…</span></div>
              </div>
            )}
          </div>
          <form className="chat-input" onSubmit={(e) => { e.preventDefault(); ask(question); }}>
            <input className="input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about revenue, stock, orders, retention…" maxLength={500} disabled={sending} />
            <button className="btn btn-primary" type="submit" disabled={sending || !question.trim()}><Send size={14} /> Ask</button>
          </form>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SectionCard title="Try asking" subtitle="Prompts use only live data">
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="suggestion" onClick={() => ask(s)} disabled={sending}>{s}</button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Facts behind the last answer" subtitle="Calculated from D1, not generated text">
            {f ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div className="kv"><dt>Revenue today</dt><dd>{inr(f.revenue?.today)}</dd></div>
                <div className="kv"><dt>Last 7 days</dt><dd>{inr(f.revenue?.last_7_days)}</dd></div>
                <div className="kv"><dt>Last 30 days</dt><dd>{inr(f.revenue?.last_30_days)}</dd></div>
                <div className="kv"><dt>Average order (30d)</dt><dd>{inr(f.average_order_value_30d)}</dd></div>
                <div className="kv"><dt>Active orders</dt><dd>{num(f.orders?.active)}</dd></div>
                <div className="kv"><dt>Awaiting kitchen</dt><dd>{num(f.orders?.awaiting_kitchen)}</dd></div>
                <div className="kv"><dt>Reservations today</dt><dd>{num(f.reservations?.today)}</dd></div>
                <div className="kv"><dt>Low-stock items</dt><dd>{num((f.low_stock || []).length)}</dd></div>
                <div className="kv"><dt>Repeat customers</dt><dd>{num(f.repeat_customers)}</dd></div>
                <div className="kv"><dt>Known customers</dt><dd>{num(f.known_customers)}</dd></div>
                <div className="tiny muted" style={{ marginTop: 4 }}>Snapshot for {f.date}. Refresh by asking another question.</div>
              </div>
            ) : (
              <div className="small muted" style={{ lineHeight: 1.6 }}>Ask a question and the exact figures used to answer it will be listed here.</div>
            )}
          </SectionCard>

          <div className="notice info">
            <ShieldCheck size={15} />
            <span>AI text is labelled separately from calculated facts. It will never claim a payment succeeded or invent stock levels.</span>
          </div>
        </div>
      </div>
    </>
  );
}
