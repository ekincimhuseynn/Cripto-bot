import { Global, Module } from '@nestjs/common';
import { MarketService } from './market.service';
import { BinanceFuturesProvider } from './providers/binance-futures.provider';
import { BinanceVisionProvider } from './providers/binance-vision.provider';
import { BybitProvider } from './providers/bybit.provider';
import { FearGreedProvider } from './providers/fear-greed.provider';
import { OkxProvider } from './providers/okx.provider';

@Global()
@Module({
  providers: [MarketService, BinanceFuturesProvider, OkxProvider, BybitProvider, BinanceVisionProvider, FearGreedProvider],
  exports: [MarketService],
})
export class MarketModule {}
