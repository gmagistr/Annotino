import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { PublicProfile } from '../../backend/types';
import { t } from '../../i18n';

interface Props {
  members: PublicProfile[];
  me: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  label: string;
  autoFocus?: boolean;
}

/** User ids mentioned in a text as "@Display Name". */
export function mentionsIn(text: string, members: PublicProfile[]): string[] {
  return members.filter((m) => text.includes(`@${m.display_name}`)).map((m) => m.id);
}

/** A textarea that completes "@name" with the team's members. Ctrl/⌘+Enter submits. */
export function MentionInput({ members, me, value, onChange, onSubmit, placeholder, label, autoFocus }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ start: number; text: string } | null>(null);
  const [active, setActive] = useState(0);
  const caretAfter = useRef<number | null>(null);

  // Place the caret after an inserted mention once React has rendered the new value.
  useLayoutEffect(() => {
    if (caretAfter.current !== null && ref.current) {
      ref.current.setSelectionRange(caretAfter.current, caretAfter.current);
      caretAfter.current = null;
    }
  }, [value]);

  const complete = query && members.some((m) => query.text.startsWith(m.display_name));
  const candidates =
    query && !complete
      ? members.filter((m) => m.id !== me && m.display_name.toLowerCase().includes(query.text.toLowerCase())).slice(0, 6)
      : [];

  const update = (v: string, caret: number) => {
    onChange(v);
    const before = v.slice(0, caret);
    const at = before.lastIndexOf('@');
    if (at >= 0 && (at === 0 || /\s/.test(before[at - 1])) && !/\n/.test(before.slice(at)) && before.length - at <= 30) {
      setQuery({ start: at, text: before.slice(at + 1) });
      setActive(0);
    } else setQuery(null);
  };

  const pick = (m: PublicProfile) => {
    if (!query) return;
    const el = ref.current!;
    const caret = el.selectionStart ?? value.length;
    const next = `${value.slice(0, query.start)}@${m.display_name} ${value.slice(caret)}`;
    caretAfter.current = query.start + m.display_name.length + 2;
    setQuery(null);
    onChange(next);
    el.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (candidates.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => (a + 1) % candidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (a - 1 + candidates.length) % candidates.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(candidates[active]);
        return;
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        setQuery(null);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="mention-input">
      <textarea
        ref={ref}
        rows={3}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        autoFocus={autoFocus}
        onChange={(e) => update(e.target.value, e.target.selectionStart)}
        onKeyDown={onKey}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
      />
      {candidates.length > 0 && (
        <ul className="mention-list" role="listbox" aria-label={t('Mention a colleague')}>
          {candidates.map((m, i) => (
            <li key={m.id} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(m)}>
                <span>{m.display_name}</span>
                <span className="muted">{m.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Render a message with mentions highlighted. */
export function MessageText({ text, members }: { text: string; members: PublicProfile[] }) {
  const names = members.map((m) => `@${m.display_name}`).sort((a, b) => b.length - a.length);
  if (!names.length) return <>{text}</>;
  const re = new RegExp(`(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  return (
    <>
      {text.split(re).map((part, i) =>
        names.includes(part) ? (
          <span key={i} className="mention">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
