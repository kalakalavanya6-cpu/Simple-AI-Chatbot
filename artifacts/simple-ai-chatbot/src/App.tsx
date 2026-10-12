import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowUp, Feather, Leaf, MessageCircle, RotateCcw, Sparkles } from 'lucide-react';
import type { ChatInput, ChatMessage } from '@workspace/api-client-react';
import { getStreamChatUrl } from '@workspace/api-client-react';

type ChatFailure = { message: string; retryWith: ChatMessage[] } | null;

const suggestions = [
  { title: 'Explain something', prompt: 'Can you explain how rainbows form, in a simple way?' },
  { title: 'Find a fresh idea', prompt: 'What is a small creative project I could try this weekend?' },
  { title: 'Make a plan', prompt: 'Help me plan a relaxed, delicious weeknight dinner.' },
];

function readServerError(text: string, fallback: string) {
  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    return parsed.error || parsed.message || fallback;
  } catch {
    return text.trim() || fallback;
  }
}

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [failure, setFailure] = useState<ChatFailure>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streamingText, failure, isStreaming]);

  const runChat = useCallback(async (history: ChatMessage[]) => {
    const payload: ChatInput = { messages: history };
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsStreaming(true);
    setStreamingText('');
    setFailure(null);

    try {
      const response = await fetch(getStreamChatUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        credentials: 'include',
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(readServerError(body, `The server returned an error (${response.status}).`));
      }
      if (!response.body) throw new Error('The response stream was unavailable. Please try again.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let answer = '';
      let finished = false;

      const processEvent = (rawEvent: string) => {
        const data = rawEvent.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
        if (!data) return;
        let event: { content?: string; done?: boolean; error?: string };
        try {
          event = JSON.parse(data) as { content?: string; done?: boolean; error?: string };
        } catch {
          throw new Error('The server sent an unreadable response. Please try again.');
        }
        if (event.error) throw new Error(event.error);
        if (event.content) {
          answer += event.content;
          setStreamingText(answer);
        }
        if (event.done) finished = true;
      };

      while (!finished) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? '';
        for (const block of blocks) processEvent(block);
        if (done) break;
      }
      if (buffer.trim()) processEvent(buffer);
      if (!answer.trim()) throw new Error('No answer came back from the server. Please try again.');
      setMessages([...history, { role: 'assistant', content: answer }]);
      setStreamingText('');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const message = error instanceof Error ? error.message : 'Something went wrong. Please try again.';
      setFailure({ message, retryWith: history });
    } finally {
      setIsStreaming(false);
      controllerRef.current = null;
    }
  }, []);

  const submitMessage = (value = draft) => {
    const content = value.trim();
    if (!content || isStreaming || messages.length >= 30) return;
    const history = [...messages, { role: 'user' as const, content }];
    setMessages(history);
    setDraft('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    void runChat(history);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitMessage();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitMessage();
    }
  };

  const handleDraft = (value: string) => {
    setDraft(value.slice(0, 12000));
    const area = textareaRef.current;
    if (area) {
      area.style.height = 'auto';
      area.style.height = `${Math.min(area.scrollHeight, 180)}px`;
    }
  };

  return (
    <main className="app-shell flex min-h-[100dvh] flex-col">
      <div className="paper-grain" aria-hidden="true" />
      <header className="relative z-10 flex h-[76px] shrink-0 items-center justify-between border-b border-[hsl(var(--border)/.62)] px-5 sm:px-9">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-[15px] bg-[#dce9dd] text-[#477963]">
            <Feather size={20} strokeWidth={1.8} />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="brand-word text-[23px] font-extrabold leading-none">morrow</span>
            <span className="hidden text-[11px] font-medium tracking-[.12em] text-muted-foreground sm:inline">A LITTLE HELP, ANYTIME</span>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-[hsl(var(--border)/.8)] bg-[hsl(var(--card)/.55)] px-3 py-1.5 text-xs font-medium text-[#557565]">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full rounded-full bg-[#73a889] opacity-35" />
            <span className="relative inline-flex size-2 rounded-full bg-[#73a889]" />
          </span>
          New conversation
        </div>
      </header>

      <section className="relative z-10 mx-auto flex w-full max-w-[920px] flex-1 flex-col px-4 sm:px-8">
        <div ref={scrollRef} className="chat-scroll flex-1 overflow-y-auto pb-6 pt-8 sm:pt-12" aria-live="polite">
          {messages.length === 0 && !isStreaming ? (
            <div className="bubble-enter mx-auto flex min-h-[min(62vh,600px)] max-w-[690px] flex-col justify-center pb-8">
              <div className="mb-6 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[.16em] text-[#6e9881]">
                <Sparkles size={15} strokeWidth={1.8} />
                A calmer corner of the internet
              </div>
              <h1 className="brand-word max-w-[650px] text-[clamp(42px,8vw,74px)] font-semibold leading-[1.04] tracking-[-.075em] text-[#293d3a]">
                What’s on<br className="hidden sm:block" /> your mind<span className="text-[#de9277]">?</span>
              </h1>
              <p className="mt-5 max-w-[440px] text-[16px] leading-7 text-[#78827d]">
                Big question, tiny curiosity, half-formed thought. Start anywhere — I’m listening.
              </p>
              <div className="mt-10 grid gap-2 sm:grid-cols-3">
                {suggestions.map((suggestion, index) => (
                  <button
                    key={suggestion.title}
                    type="button"
                    onClick={() => submitMessage(suggestion.prompt)}
                    disabled={isStreaming}
                    data-testid={`button-suggestion-${index}`}
                    className="group min-h-[88px] rounded-[18px] border border-[#e7e3d9] bg-[rgba(255,254,249,.58)] px-4 py-3 text-left transition-transform duration-200 hover:-translate-y-1 hover:border-[#bfd1c2] hover:bg-[rgba(255,254,249,.92)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="mb-2 block text-[12px] font-semibold text-[#48695b]">{suggestion.title}</span>
                    <span className="block text-[12px] leading-[1.55] text-[#828983]">{suggestion.prompt}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-[690px] flex-col gap-7 pb-5">
              {messages.map((message, index) => (
                <article key={`${message.role}-${index}`} className={`bubble-enter flex gap-3.5 ${message.role === 'user' ? 'flex-row-reverse' : ''}`} data-testid={`message-${message.role}-${index}`}>
                  {message.role === 'assistant' ? (
                    <div className="mt-1 grid size-8 shrink-0 place-items-center rounded-[12px] bg-[#dce9dd] text-[#477963]">
                      <Feather size={16} strokeWidth={1.8} />
                    </div>
                  ) : null}
                  <div className={`max-w-[min(84%,560px)] whitespace-pre-wrap break-words text-[15px] leading-[1.75] ${message.role === 'user' ? 'rounded-[20px] rounded-tr-[7px] bg-[#e6eee4] px-5 py-3.5 text-[#334b41]' : 'pt-1 text-[#354642]'}`}>
                    {message.content}
                  </div>
                </article>
              ))}
              {isStreaming && (
                <article className="bubble-enter flex gap-3.5" data-testid="status-streaming">
                  <div className="mt-1 grid size-8 shrink-0 place-items-center rounded-[12px] bg-[#dce9dd] text-[#477963]">
                    <Feather size={16} strokeWidth={1.8} />
                  </div>
                  {streamingText ? (
                    <div className="whitespace-pre-wrap break-words pt-1 text-[15px] leading-[1.75] text-[#354642]">
                      {streamingText}<span className="ml-0.5 inline-block h-[17px] w-[2px] translate-y-[3px] animate-pulse bg-[#6b987f]" />
                    </div>
                  ) : (
                    <div className="flex h-9 items-center gap-1.5 rounded-2xl bg-[#f3f0e7] px-4" aria-label="Thinking">
                      <span className="typing-dot size-1.5 rounded-full bg-[#71937d]" />
                      <span className="typing-dot size-1.5 rounded-full bg-[#71937d]" />
                      <span className="typing-dot size-1.5 rounded-full bg-[#71937d]" />
                    </div>
                  )}
                </article>
              )}
              {failure && (
                <div role="alert" className="bubble-enter ml-11 max-w-[560px] rounded-[18px] border border-[#e9c5b6] bg-[#fff4ee] px-4 py-3.5 text-sm text-[#804f40]" data-testid="status-error">
                  <div className="font-semibold">I couldn’t get an answer just now.</div>
                  <p className="mt-1 leading-6">{failure.message}</p>
                  <button
                    type="button"
                    onClick={() => void runChat(failure.retryWith)}
                    className="mt-3 inline-flex items-center gap-2 rounded-full border border-[#e6c2b2] bg-[#fffaf6] px-3.5 py-2 text-xs font-semibold text-[#815441] transition-colors hover:bg-[#fbe9de]"
                    data-testid="button-retry"
                  >
                    <RotateCcw size={13} />
                    Try again
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="relative z-10 mx-auto w-full max-w-[690px] pb-[max(18px,env(safe-area-inset-bottom))] pt-3">
          {messages.length >= 30 && <p className="mb-2 text-center text-xs text-muted-foreground" data-testid="status-message-limit">This conversation has reached its 30 message limit.</p>}
          <form onSubmit={handleSubmit} className="rounded-[24px] border border-[#e3dfd4] bg-[rgba(255,254,250,.91)] p-2 shadow-[0_12px_40px_rgba(57,71,63,.09)] backdrop-blur-sm">
            <div className="flex items-end gap-2">
              <div className="grid size-10 shrink-0 place-items-center self-end rounded-[15px] text-[#89a08e]">
                <MessageCircle size={19} strokeWidth={1.8} />
              </div>
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(event) => handleDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask me anything…"
                rows={1}
                maxLength={12000}
                disabled={isStreaming || messages.length >= 30}
                aria-label="Your message"
                data-testid="input-message"
                className="max-h-[180px] min-h-[42px] flex-1 resize-none bg-transparent px-1 py-[10px] text-[15px] leading-[22px] text-[#354642] outline-none placeholder:text-[#9b9d94] disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={!draft.trim() || isStreaming || messages.length >= 30}
                aria-label="Send message"
                data-testid="button-send"
                className="mb-0.5 grid size-[42px] shrink-0 place-items-center rounded-[16px] bg-[#58836e] text-[#fffdf6] transition-transform duration-200 hover:scale-[1.04] hover:bg-[#456e5a] disabled:cursor-not-allowed disabled:bg-[#e5e7de] disabled:text-[#a5aaa0] disabled:hover:scale-100"
              >
                <ArrowUp size={20} strokeWidth={2.2} />
              </button>
            </div>
            <div className="flex items-center justify-between px-3 pb-1 pt-1 text-[10px] font-medium tracking-[.025em] text-[#a0a198]">
              <span className="flex items-center gap-1.5"><Leaf size={11} /> A good place to wonder out loud</span>
              <span>{draft.length > 0 ? `${draft.length.toLocaleString()} / 12,000` : 'Enter to send · Shift + Enter for a new line'}</span>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}

export default App;
