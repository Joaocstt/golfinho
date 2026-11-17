import React, { useState } from "react";
import { Check } from "lucide-react";
import type { ChatQuestion } from "../shared/contracts";

// Resposta de uma pergunta: opções marcadas e o texto de "Outro".
interface Choice {
  picked: string[];
  other: string;
}
const EMPTY: Choice = { picked: [], other: "" };
function answerText(choice: Choice | undefined): string {
  if (!choice) return "";
  return [...choice.picked, choice.other.trim()].filter(Boolean).join(", ");
}

// Pergunta de múltipla escolha do Claude, como no app dele: opções para marcar, "Outro" para
// escrever e, com uma pergunta só de escolha única, o clique já responde.
export function QuestionCard({
  questions,
  answered,
  onAnswer,
  onSkip,
}: {
  questions: ChatQuestion[];
  /** Respostas já dadas; null quando a pergunta foi pulada. Ausente enquanto espera. */
  answered?: Record<string, string> | null;
  onAnswer: (answers: Record<string, string>) => void;
  onSkip: () => void;
}) {
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const waiting = answered === undefined;
  const instant = questions.length === 1 && !questions[0].multiSelect;
  const update = (q: ChatQuestion, next: Partial<Choice>) =>
    setChoices((current) => ({ ...current, [q.question]: { ...EMPTY, ...current[q.question], ...next } }));
  function pick(q: ChatQuestion, label: string) {
    const current = choices[q.question]?.picked ?? [];
    if (q.multiSelect) {
      update(q, { picked: current.includes(label) ? current.filter((l) => l !== label) : [...current, label] });
      return;
    }
    if (instant) {
      onAnswer({ [q.question]: label });
      return;
    }
    update(q, { picked: [label], other: "" });
  }
  const answers = Object.fromEntries(questions.map((q) => [q.question, answerText(choices[q.question])]));
  const complete = questions.every((q) => answers[q.question]);
  return (
    <div className="chat-question" role="group" aria-label="Pergunta do Claude">
      {questions.map((q) => {
        const choice = choices[q.question];
        const given = answered?.[q.question];
        return (
          <div key={q.question} className="chat-question-item">
            {q.header && <span className="chat-question-header">{q.header}</span>}
            <p className="chat-question-text">{q.question}</p>
            {waiting ? (
              <div className="chat-question-options" role={q.multiSelect ? "group" : "radiogroup"}>
                {q.options.map((o, i) => {
                  const on = choice?.picked.includes(o.label) ?? false;
                  return (
                    <button
                      key={o.label}
                      type="button"
                      role={q.multiSelect ? "checkbox" : "radio"}
                      aria-checked={on}
                      className={`chat-question-option${on ? " on" : ""}`}
                      onClick={() => pick(q, o.label)}
                    >
                      <span className={`chat-question-mark${q.multiSelect ? " square" : ""}`}>
                        {on ? <Check size={12} /> : i + 1}
                      </span>
                      <span className="chat-question-label">
                        <span>{o.label}</span>
                        {o.description && <small>{o.description}</small>}
                      </span>
                    </button>
                  );
                })}
                <input
                  className="chat-question-other"
                  placeholder="Outro… (escreva sua resposta)"
                  aria-label={`Outra resposta: ${q.question}`}
                  value={choice?.other ?? ""}
                  onChange={(e) => update(q, q.multiSelect ? { other: e.target.value } : { other: e.target.value, picked: [] })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && complete) {
                      e.preventDefault();
                      onAnswer(answers);
                    }
                  }}
                />
              </div>
            ) : (
              <p className="chat-question-answer">{given ? `→ ${given}` : "Sem resposta."}</p>
            )}
          </div>
        );
      })}
      {waiting && (
        <div className="chat-question-actions">
          {(!instant || choices[questions[0].question]?.other) && (
            <button type="button" disabled={!complete} onClick={() => onAnswer(answers)}>
              Responder
            </button>
          )}
          <button type="button" className="secondary" onClick={onSkip}>
            Pular
          </button>
        </div>
      )}
    </div>
  );
}
