import { useMemo, useState } from 'react';
import { IPA_GROUPS, displaySymbol } from '../../ipa/symbols';
import { t } from '../../i18n';

interface Props {
  onInsert: (text: string) => void;
}

export function IpaKeyboard({ onInsert }: Props) {
  const [group, setGroup] = useState(IPA_GROUPS[0].id);
  const [query, setQuery] = useState('');

  const symbols = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return IPA_GROUPS.find((g) => g.id === group)!.symbols;
    return IPA_GROUPS.flatMap((g) => g.symbols).filter((s) => s.name.includes(q) || s.char === q);
  }, [group, query]);

  return (
    <div className="ipa-kb" role="group" aria-label={t('IPA keyboard')}>
      <div className="ipa-kb-head">
        <div className="ipa-tabs" role="tablist">
          {IPA_GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={!query && g.id === group}
              onClick={() => {
                setGroup(g.id);
                setQuery('');
              }}
            >
              {t(g.title)}
            </button>
          ))}
        </div>
        <input
          className="ipa-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('Find by name, e.g. “retroflex”')}
          aria-label={t('Find a symbol by name')}
        />
      </div>
      <div className="ipa-grid">
        {symbols.map((s) => (
          <button
            key={s.char + s.name}
            type="button"
            className="ipa-key ipa"
            title={s.name}
            aria-label={s.name}
            // Keep focus in the label field so the caret position survives.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onInsert(s.char)}
          >
            {displaySymbol(s)}
          </button>
        ))}
        {symbols.length === 0 && <p className="muted">{t('No symbol matches this name.')}</p>}
      </div>
    </div>
  );
}
