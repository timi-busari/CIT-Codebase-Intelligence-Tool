import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SharedModule } from './shared/shared.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { QueryModule } from './query/query.module';
import { ReposModule } from './repos/repos.module';
import { HistoryModule } from './history/history.module';
import { ArchDocModule } from './archdoc/archdoc.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SharedModule,
    IngestionModule,
    QueryModule,
    ReposModule,
    HistoryModule,
    ArchDocModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
