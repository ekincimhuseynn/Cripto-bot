import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Sohbet geçmişi (serbest sohbet modunda bağlam için kullanılır) */
@Entity('chat_messages')
@Index(['chatId', 'createdAt'])
export class ChatMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'bigint' })
  chatId: number;

  /** 'user' | 'bot' */
  @Column({ type: 'varchar', length: 16 })
  role: string;

  @Column({ type: 'text' })
  content: string;

  /** Mesaj tipi: text | photo | command */
  @Column({ type: 'varchar', length: 16, default: 'text' })
  kind: string;

  @CreateDateColumn()
  createdAt: Date;
}
