import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useBot } from './useBot.js';
import { DetailsCard, ProgressCard, ResultCard, SelectCard } from './Cards.jsx';
import { PDF_TYPES, PROPERTY_TYPES } from './constants.js';
import { answer, question, startState, withPlaces } from './chatFlow.js';

let nextId = 1;
const msg = (role, kind, data = {}) => ({ id: nextId++, role, kind, ...data });

// Select, Chat and Type each keep their own conversation ("thread"); only the open one is shown.
const WELCOME = msg('bot', 'text', {
  thread: 'all',
  text: 'Welcome. Choose Select, Chat or Type below to find a Jantri rate.',
});

const TYPE_EXAMPLES = [
  'Moje Kosad, TPS No. 66, FP No. 327, Flat No. 1404, Tal. Surat City, Dist. Surat',
  'Moje Sayan, RS No. 398, Plot No. 25/B, Tal. Olpad, Dist. Surat',
];

const MIN_CHAT = 340;
const MIN_LIVE = 380;
const savedWidth = () => {
  try {
    return Number(localStorage.getItem('chatWidth')) || 440;
  } catch {
    return 440;
  }
};

// One line describing a selection, shown as the user's chat message.
function describe(f) {
  return [
    f.village && `Village ${f.village}`,
    f.tps && `TPS No. ${f.tps}`,
    f.fp && `FP No. ${f.fp}`,
    f.rsNo && `Survey No. ${f.rsNo}`,
    f.blNo && `BL No. ${f.blNo}`,
    PROPERTY_TYPES[f.propertyType],
    f.taluka && `Taluka ${f.taluka}`,
    f.district && `District ${f.district}`,
    PDF_TYPES[f.pdfType],
  ].filter(Boolean).join(', ');
}

export default function App() {
  const [messages, setMessages] = useState([WELCOME]);
  const [mode, setMode] = useState(null); // 'select' | 'chat' | 'type'
  const [chat, setChat] = useState(null); // question-and-answer state while in chat mode
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [url, setUrl] = useState('');
  const [hasFrame, setHasFrame] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState(null);
  const [zoom, setZoom] = useState(null);
  const [districts, setDistricts] = useState([]);
  const [chatWidth, setChatWidth] = useState(savedWidth);
  const [dragging, setDragging] = useState(false);

  const frameRef = useRef(null);
  const lastBlob = useRef(null);
  const listRef = useRef(null);
  const runningRef = useRef(false);
  const modeRef = useRef(null);
  const answerRef = useRef(null);
  const restartChat = useRef(() => {});
  const runThread = useRef(null); // the conversation that started the search in progress
  modeRef.current = mode;

  const push = (m, thread = modeRef.current || 'all') => setMessages((all) => [...all, { ...m, thread }]);
  const patchLast = (kind, fn) => setMessages((all) => {
    const i = all.map((m) => m.kind).lastIndexOf(kind);
    if (i < 0) return all;
    const copy = [...all];
    copy[i] = fn(copy[i]);
    return copy;
  });
  // there is only ever one selection form: it is moved below the newest message, keeping what was filled in
  const formToEnd = (all) => {
    const form = all.find((m) => m.kind === 'select');
    return form ? [...all.filter((m) => m !== form), form] : all;
  };
  const finish = (ok) => {
    runningRef.current = false;
    setRunning(false);
    patchLast('progress', (m) => ({ ...m, done: true, failed: !ok }));
  };

  const onMessage = useCallback((m) => {
    if (m.type === 'step') {
      patchLast('progress', (p) => {
        const steps = [...p.steps];
        const i = m.key ? steps.findIndex((s) => s.key === m.key) : -1;
        if (i >= 0) steps[i] = m;
        else steps.push(m);
        return { ...p, steps };
      });
    } else if (m.type === 'url') {
      setUrl(m.url);
    } else if (m.type === 'result') {
      finish(true);
      setMessages((all) => formToEnd([...all, msg('bot', 'result', { result: m.result, screenshots: m.screenshots, thread: runThread.current })]));
      if (runThread.current === 'chat') restartChat.current();
    } else if (m.type === 'error') {
      finish(false);
      setMessages((all) => formToEnd([...all, msg('bot', 'text', { text: m.message, tone: 'bad', thread: runThread.current })]));
      if (runThread.current === 'chat') restartChat.current();
    } else if (m.type === 'disconnected' && runningRef.current) {
      finish(false);
      push(msg('bot', 'text', { text: 'Lost the connection to the server while searching. Please try again.', tone: 'bad' }), runThread.current);
    }
  }, []);

  const onFrame = useCallback((blob) => {
    const img = frameRef.current;
    if (!img) return;
    const next = URL.createObjectURL(blob);
    img.src = next;
    if (lastBlob.current) URL.revokeObjectURL(lastBlob.current);
    lastBlob.current = next;
    setHasFrame(true);
  }, []);

  const { connected, run } = useBot({ onMessage, onFrame });

  useEffect(() => {
    fetch('/api/options').then((r) => r.json()).then((o) => setDistricts(o.districts || [])).catch(() => {});
  }, []);

  // in chat mode the cursor is always in the answer box, ready for the next reply
  useEffect(() => {
    if (mode === 'chat' && !running) answerRef.current?.focus();
  }, [mode, chat, running]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, mode]);

  // drag the divider between the chat and the live browser
  const startDrag = (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onDrag = (e) => {
    if (!dragging) return;
    setChatWidth(Math.max(MIN_CHAT, Math.min(e.clientX, window.innerWidth - MIN_LIVE)));
  };
  const endDrag = () => {
    if (!dragging) return;
    setDragging(false);
    try {
      localStorage.setItem('chatWidth', String(chatWidth));
    } catch { /* width is simply not remembered */ }
  };

  // chat mode: show the next question (with a short lead-in when there is one)
  const ask = (state, lead = '') => {
    setChat(state);
    push(msg('bot', 'text', { text: [lead, state.note, question(state).text].filter(Boolean).join(' ') }), 'chat');
  };
  restartChat.current = () => ask(startState(districts), 'To check another property, tell me:');

  const chooseMode = (next) => {
    if (next === mode) return;
    setMode(next);
    setInput('');
    // each option starts its own conversation the first time it is opened, and keeps it afterwards
    if (next === 'select') setMessages((all) => (all.some((m) => m.kind === 'select') ? all : [...all, msg('bot', 'select', { thread: 'select' })]));
    if (next === 'chat' && !chat) ask(startState(districts), 'I will ask a few questions.');
  };

  const submitChat = async (text, picked) => {
    const value = text.trim();
    if (!value || running || !chat) return;
    setInput('');
    push(msg('user', 'text', { text: value }), 'chat');
    const res = answer(chat, value, picked);
    if (res.error) {
      setChat(res.state);
      push(msg('bot', 'text', { text: res.error }), 'chat');
      return;
    }
    let state = res.state;
    if (state.step === 'places') {
      let kinds = [];
      try {
        kinds = await (await fetch(`/api/places?district=${encodeURIComponent(state.f.district)}`)).json();
      } catch { /* handled as "nothing available" below */ }
      if (!kinds.length) {
        ask(startState(districts), `I have no readable Jantri PDF for ${state.f.district}.`);
        return;
      }
      state = withPlaces(state, kinds);
    }
    if (state.step === 'done') {
      setChat(state);
      push(msg('bot', 'text', { text: 'Thank you. Searching now - watch the browser on the right.' }), 'chat');
      startSearch(state.f, describe(state.f));
      return;
    }
    ask(state);
  };

  // quick answers under the question: the matches the bot asked about, or the whole list when it is short
  const chatOptions = mode === 'chat' && chat && chat.step !== 'done'
    ? chat.choices || (question(chat).options.length <= 30 ? question(chat).options : [])
    : [];

  const submitAddress = async (text) => {
    const address = text.trim();
    if (!address || running) return;
    setInput('');
    push(msg('user', 'text', { text: address }), 'type');
    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      if (!res.ok) throw new Error(`server answered ${res.status}`);
      const fields = await res.json();
      const found = ['district', 'village', 'tps', 'fp', 'rsNo', 'blNo'].filter((k) => fields[k]).length;
      push(msg('bot', 'text', {
        text: found >= 2
          ? 'Here is what I read from the address. Check it, fix anything that is wrong, then start the search.'
          : 'I could not read much from that. Fill in the details below and start the search.',
      }), 'type');
      push(msg('bot', 'details', { fields, address }), 'type');
    } catch (err) {
      push(msg('bot', 'text', { text: `Could not reach the server (${err.message}). Is it running?`, tone: 'bad' }), 'type');
    }
  };

  const startSearch = (fields, address, echo) => {
    if (running) return;
    if (!run(fields, address)) {
      push(msg('bot', 'text', { text: 'Not connected to the server yet. Try again in a second.', tone: 'bad' }));
      return;
    }
    if (echo) push(msg('user', 'text', { text: address }));
    runningRef.current = true;
    runThread.current = modeRef.current;
    setRunning(true);
    setUrl('');
    push(msg('bot', 'progress', { steps: [], done: false }));
  };

  const openHistory = async () => {
    setHistory([]);
    try {
      setHistory(await (await fetch('/api/history')).json());
    } catch {
      setHistory([]);
    }
  };

  const showPast = (item) => {
    setHistory(null);
    push(msg('bot', 'text', { text: `Earlier search: ${item.address || `${item.query.village}, ${item.query.district}`}` }));
    push(msg('bot', 'result', { result: item.result, screenshots: item.screenshots }));
  };

  const columns = expanded ? '0 0 minmax(0, 1fr)' : `${chatWidth}px 8px minmax(0, 1fr)`;

  return (
    <div className={`page ${dragging ? 'dragging' : ''}`}>
      <header className="masthead">
        <h1>Jantri Rate Lookup</h1>
        <p>Gujarat &middot; ASR 2011 &middot; unofficial tool</p>
        <span className={`status ${connected ? 'online' : 'offline'}`}>{connected ? 'Online' : 'Connecting...'}</span>
        <button className="nav-btn" onClick={openHistory}>History</button>
      </header>
      <div className="tricolor"><i /><i /><i /></div>

      <main className="workspace" style={{ gridTemplateColumns: columns }}>
        <section className="chat">
          <div className="messages" ref={listRef}>
            {messages.map((m) => (
              <div key={m.id} className={`row ${m.role}`} hidden={m.thread !== 'all' && m.thread !== mode}>
                {m.kind === 'text' && <div className={`bubble ${m.tone || ''}`}>{m.text}</div>}
                {m.kind === 'select' && <SelectCard districts={districts} disabled={running} onSearch={(f) => startSearch(f, describe(f), true)} />}
                {m.kind === 'details' && <DetailsCard initial={m.fields} disabled={running} districts={districts} onSearch={(f) => startSearch(f, m.address)} />}
                {m.kind === 'progress' && <ProgressCard steps={m.steps} done={m.done} failed={m.failed} />}
                {m.kind === 'result' && <ResultCard result={m.result} screenshots={m.screenshots} onZoom={setZoom} />}
              </div>
            ))}
            {/* answers to pick from, directly under the bot's question */}
            {chatOptions.length > 0 && !running && (
              <div className="chips">
                {chatOptions.map((o) => <button key={o.label} onClick={() => submitChat(o.label, o)}>{o.label}</button>)}
              </div>
            )}
          </div>

          <div className="composer">
            <div className="modes" role="tablist">
              <button role="tab" aria-selected={mode === 'select'} className={mode === 'select' ? 'on' : ''} onClick={() => chooseMode('select')}>
                Select details
              </button>
              <button role="tab" aria-selected={mode === 'chat'} className={mode === 'chat' ? 'on' : ''} onClick={() => chooseMode('chat')}>
                Chat
              </button>
              <button role="tab" aria-selected={mode === 'type'} className={mode === 'type' ? 'on' : ''} onClick={() => chooseMode('type')}>
                Type address
              </button>
            </div>

            {mode === 'chat' && (
              <>
                <form className="typebox" onSubmit={(e) => { e.preventDefault(); submitChat(input); }}>
                  <input ref={answerRef} value={input} disabled={running} onChange={(e) => setInput(e.target.value)} aria-label="Your answer" />
                  <button type="submit" disabled={running || !input.trim()}>Send</button>
                </form>
              </>
            )}
            {mode === 'type' && (
              <>
                <form className="typebox" onSubmit={(e) => { e.preventDefault(); submitAddress(input); }}>
                  <textarea
                    value={input}
                    rows={2}
                    autoFocus
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitAddress(input); } }}
                  />
                  <button type="submit" disabled={running || !input.trim()}>Send</button>
                </form>
                <div className="examples">
                  <span>Examples:</span>
                  {TYPE_EXAMPLES.map((text) => <button key={text} onClick={() => setInput(text)}>{text}</button>)}
                </div>
              </>
            )}
          </div>
        </section>

        <div
          className="divider"
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize"
          onPointerDown={startDrag}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={() => setChatWidth(440)}
        ><i /></div>

        <section className="live">
          <div className="browser-bar">
            <div className="address">{url || 'Browser is idle'}</div>
            {running && <span className="live-badge">LIVE</span>}
            <button onClick={() => setExpanded((v) => !v)}>{expanded ? 'Show chat' : 'Full window'}</button>
          </div>
          <div className="screen">
            <img ref={frameRef} alt="Live browser view" style={{ display: hasFrame ? 'block' : 'none' }} />
            {!hasFrame && (
              <div className="idle">
                <h2>Live browser view</h2>
                <p>When a search starts, the bot&apos;s browser appears here. You will see it open the website, pick the PDF, search the number and take the screenshot.</p>
              </div>
            )}
          </div>
        </section>
      </main>

      {history && (
        <div className="overlay" onClick={() => setHistory(null)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <header><h2>Search history</h2><button className="nav-btn plain" onClick={() => setHistory(null)}>Close</button></header>
            {history.length === 0 && <p className="empty">Nothing here yet.</p>}
            {history.map((h) => (
              <button key={h._id} className="history-item" onClick={() => showPast(h)}>
                <strong>{h.query.village || '-'}, {h.query.district}</strong>
                <span>{h.result.message}</span>
                <small>{new Date(h.createdAt).toLocaleString()}</small>
              </button>
            ))}
          </aside>
        </div>
      )}

      {zoom && (
        <div className="overlay center" onClick={() => setZoom(null)}>
          <img className="zoomed" src={zoom} alt="Screenshot" />
        </div>
      )}
    </div>
  );
}
