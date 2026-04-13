interface Props {
  suggestions: string[];
  onSelect: (question: string) => void;
  visible: boolean;
}

export default function SuggestedQuestions({ suggestions, onSelect, visible }: Props) {
  if (!visible) return null;

  return (
    <div className="suggested-questions">
      {suggestions.map((q) => (
        <button key={q} className="suggested-btn" onClick={() => onSelect(q)}>
          {q}
        </button>
      ))}
    </div>
  );
}
