import type { ChatMessageVM } from '@bff/viewmodels';
import { Chip } from '@presentation/atoms/Chip';
import { ThinkingTrace } from '@presentation/molecules/ThinkingTrace';
import styles from '@presentation/molecules/molecules.module.css';

export function ChatBubble({ message }: { message: ChatMessageVM }) {
  const isUser = message.role === 'user';

  return (
    <div
      className={[styles.chatTurn, isUser ? styles.chatTurnUser : styles.chatTurnAssistant].join(
        ' ',
      )}
    >
      <span className={styles.chatWho}>{message.who}</span>

      {/* Above the bubble, and collapsed: the reasoning led to the answer, so
          it reads in that order without competing with it. */}
      {message.thoughts.length > 0 ? (
        <ThinkingTrace thoughts={message.thoughts} isLive={false} />
      ) : null}

      <div
        className={[
          styles.chatBubble,
          isUser ? styles.chatBubbleUser : styles.chatBubbleAssistant,
        ].join(' ')}
      >
        {renderBody(message.text)}
      </div>
      {message.citations.length > 0 ? (
        <div className={styles.chatCites}>
          {message.citations.map((citation) => (
            <Chip key={citation} title="Tool called during this run">
              {citation}
            </Chip>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Lay the answer out the way the supervisor wrote it.
 *
 * The prompt asks for one item per line when a reply carries a list
 * (app/agents/prompts.py, employee mode). A single text node would collapse
 * those newlines back into one run-on paragraph, so the lines are grouped here:
 * a run of "- " lines becomes a list, everything else stays prose. This is
 * line structure only, not markdown — no inline syntax is interpreted, so
 * anything else the model writes shows up as the literal text it sent.
 */
function renderBody(text: string) {
  const lines = text.split('\n').map((line) => line.trim());
  const blocks: Array<{ kind: 'prose'; text: string } | { kind: 'list'; items: string[] }> = [];

  for (const line of lines) {
    if (line === '') continue;

    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const last = blocks[blocks.length - 1];

    if (bullet) {
      const item = bullet[1] ?? '';
      if (last?.kind === 'list') last.items.push(item);
      else blocks.push({ kind: 'list', items: [item] });
    } else {
      blocks.push({ kind: 'prose', text: line });
    }
  }

  return blocks.map((block, index) =>
    block.kind === 'list' ? (
      <ul key={index} className={styles.chatList}>
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex}>{item}</li>
        ))}
      </ul>
    ) : (
      <p key={index} className={styles.chatProse}>
        {block.text}
      </p>
    ),
  );
}
