// #03 Teaching mode topic chips. Rendered above the chat input only
// when teachingMode is on. Tapping a chip fills the input box (does NOT
// auto-send) so the user can type more context before sending.
//
// Topics are intentionally aligned with the science-keyword regex in
// server/src/index.ts /api/chat — clicking a chip then sending will
// reliably trip the Grace bias (graceCue: dormant → invited).
//
// Six chips covers most "tutor-me" entry points without overwhelming
// mobile width. Adjust TEACHING_TOPICS to add/remove later.

import { useLang } from '../i18n/LangContext';
import { t, type TranslationKey } from '../i18n';

interface Topic {
  id: string;
  /** i18n key for the visible chip label. */
  labelKey: TranslationKey;
  /** What gets filled into the input on tap. Pre-localized per Lang
   * because the server-side science detection regex matches both
   * Chinese and English keywords — picking the right phrasing for
   * the user's current language gives Rocky/Grace better context. */
  prompt: { zh: string; en: string; ja: string };
}

const TEACHING_TOPICS: Topic[] = [
  {
    id: 'ai',
    labelKey: 'teaching.topic.ai',
    prompt: {
      zh: '解释一下 AI 的工作原理，',
      en: 'Explain how AI works, ',
      ja: 'AIの仕組みを教えて、',
    },
  },
  {
    id: 'blackhole',
    labelKey: 'teaching.topic.blackhole',
    prompt: {
      zh: '黑洞是什么？',
      en: 'What is a black hole?',
      ja: 'ブラックホールって何？',
    },
  },
  {
    id: 'dna',
    labelKey: 'teaching.topic.dna',
    prompt: {
      zh: 'DNA 怎么决定生物特征？',
      en: 'How does DNA determine traits?',
      ja: 'DNAはどうやって特徴を決めるの？',
    },
  },
  {
    id: 'ocean',
    labelKey: 'teaching.topic.ocean',
    prompt: {
      zh: '海洋为什么是蓝色的？',
      en: 'Why is the ocean blue?',
      ja: '海はなぜ青いの？',
    },
  },
  {
    id: 'quantum',
    labelKey: 'teaching.topic.quantum',
    prompt: {
      zh: '量子力学到底在讲什么？',
      en: 'What is quantum mechanics, really?',
      ja: '量子力学って何の話？',
    },
  },
  {
    id: 'evolution',
    labelKey: 'teaching.topic.evolution',
    prompt: {
      zh: '进化论是怎么解释新物种的？',
      en: 'How does evolution explain new species?',
      ja: '進化論はどうやって新種を説明する？',
    },
  },
];

interface Props {
  /** Called with the topic prompt when a chip is tapped. Caller is
   * responsible for setting the input value AND focusing the textarea. */
  onPick: (prompt: string) => void;
}

export default function TeachingTopicChips({ onPick }: Props) {
  const { lang } = useLang();
  return (
    <div className="teaching-topic-chips" role="toolbar" aria-label={t('teaching.topicsLabel', lang)}>
      {TEACHING_TOPICS.map((topic) => (
        <button
          key={topic.id}
          type="button"
          className="teaching-topic-chip"
          onClick={() => onPick(topic.prompt[lang])}
        >
          {t(topic.labelKey, lang)}
        </button>
      ))}
    </div>
  );
}
