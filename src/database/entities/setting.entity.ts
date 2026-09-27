import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Anahtar-değer şeklinde kalıcı ayarlar (bakiye, kill switch, nöbet durumu...) */
@Entity('settings')
export class Setting {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key: string;

  @Column({ type: 'text', nullable: true })
  value: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
