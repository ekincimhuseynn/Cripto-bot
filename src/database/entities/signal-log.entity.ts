import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Gönderilen işlem kartları ve uyarıların kaydı.
 * Otomatik nöbette AYNI FIRSATI TEKRAR GÖNDERMEMEK (spam önleme) için kullanılır.
 */
@Entity('signal_log')
@Index(['type', 'symbol', 'createdAt'])
export class SignalLog {
  @PrimaryGeneratedColumn()
  id: number;

  /** TRADE | ALERT | MANUAL_TRADE | NO_TRADE */
  @Column({ type: 'varchar', length: 16 })
  type: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  symbol: string | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  direction: string | null;

  @Column({ type: 'float', nullable: true })
  entryPrice: number | null;

  @Column({ type: 'float', nullable: true })
  confidence: number | null;

  /** Kart içeriğinin kısa özeti (log/debug için) */
  @Column({ type: 'text', nullable: true })
  summary: string | null;

  /** patrol | manual | photo | test */
  @Column({ type: 'varchar', length: 16, default: 'patrol' })
  source: string;

  @CreateDateColumn()
  createdAt: Date;
}
