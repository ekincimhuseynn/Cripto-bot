import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Kalıcı kullanıcı talimatları ("bundan sonra kaldıracı 5x geçme" gibi).
 * Her kararda sistem promptuna enjekte edilir ve makine-okunur kısıtlar
 * (constraintType/Value) risk motorunda ZORUNLU olarak uygulanır.
 */
@Entity('instructions')
export class Instruction {
  @PrimaryGeneratedColumn()
  id: number;

  /** Kullanıcının söylediği/normalize edilmiş kural metni (Türkçe) */
  @Column({ type: 'text' })
  text: string;

  /** max_leverage | max_margin_pct | min_confidence | avoid_symbols | prefer_symbols | other */
  @Column({ type: 'varchar', length: 32, nullable: true })
  constraintType: string | null;

  @Column({ type: 'float', nullable: true })
  constraintValue: number | null;

  /** JSON dizi: ["DOGEUSDT","SHIBUSDT"] */
  @Column({ type: 'text', nullable: true })
  constraintSymbols: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
