import { useState, useEffect } from 'react';
import { fetchFaqs, type OpenChannelFaq } from '../utils/sessionApi';
import { useLang } from '../i18n/LangContext';
import { t } from '../i18n';

export default function OpenChannel() {
  const { lang } = useLang();
  const [items, setItems] = useState<OpenChannelFaq[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFaqs(lang).then((list) => {
      if (!cancelled) setItems(list);
    });
    return () => {
      cancelled = true;
    };
  }, [lang]);

  if (items === null) {
    return <div className="channel-status">{t('channel.loading', lang)}</div>;
  }
  if (items.length === 0) {
    return <div className="channel-status">{t('channel.empty', lang)}</div>;
  }

  return (
    <div className="channel-list" role="list">
      {items.map((faq) => {
        const expanded = openId === faq.id;
        return (
          <div key={faq.id} className={`channel-item ${expanded ? 'expanded' : ''}`} role="listitem">
            <button
              type="button"
              className="channel-q"
              aria-expanded={expanded}
              onClick={() => setOpenId(expanded ? null : faq.id)}
            >
              <span className="channel-q-marker">{expanded ? '▼' : '▸'}</span>
              <span className="channel-q-text">{faq.question}</span>
            </button>
            {expanded && (
              <div className="channel-a">
                <span className="channel-a-prefix">Rocky:</span>
                <span className="channel-a-text">{faq.answer}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
