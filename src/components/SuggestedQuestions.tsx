const SUGGESTIONS = [
  'Grace 最近怎么样？',
  '你们 Eridian 怎么表达开心？',
  'Erid 上的生活是什么样的？',
  '你和 Grace 平时都做什么？',
  '你想念太空旅行吗？',
  '人类的"音乐"你能理解吗？',
];

interface Props {
  onSelect: (question: string) => void;
  visible: boolean;
}

export default function SuggestedQuestions({ onSelect, visible }: Props) {
  if (!visible) return null;

  return (
    <div className="suggested-questions">
      {SUGGESTIONS.map((q) => (
        <button key={q} className="suggested-btn" onClick={() => onSelect(q)}>
          {q}
        </button>
      ))}
    </div>
  );
}
