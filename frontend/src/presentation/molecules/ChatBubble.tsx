import type { ChatMessageVM } from '@bff/viewmodels';
import { Chip } from '@presentation/atoms/Chip';
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
      <div
        className={[
          styles.chatBubble,
          isUser ? styles.chatBubbleUser : styles.chatBubbleAssistant,
        ].join(' ')}
      >
        {message.text}
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
