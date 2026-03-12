import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { IngestionJobProgress } from './ingestion.queue';

export interface IngestionProgressEvent {
  jobId: string;
  repoId: string;
  progress: IngestionJobProgress;
}

@WebSocketGateway({
  cors: {
    origin: [
      'http://localhost:4000', // Next.js dev server
      'http://localhost:3000', // Alternative dev port
    ],
    credentials: true,
  },
  namespace: '/ingestion',
})
export class IngestionGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(IngestionGateway.name);

  @WebSocketServer()
  server: Server;

  afterInit() {
    this.logger.log('IngestionGateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  // Subscribe client to updates for a specific job
  subscribeToJob(client: Socket, jobId: string) {
    client.join(`job:${jobId}`);
    this.logger.log(`Client ${client.id} subscribed to job ${jobId}`);
  }

  // Unsubscribe client from job updates
  unsubscribeFromJob(client: Socket, jobId: string) {
    client.leave(`job:${jobId}`);
    this.logger.log(`Client ${client.id} unsubscribed from job ${jobId}`);
  }

  // Emit progress update to all clients subscribed to this job
  emitProgress(event: IngestionProgressEvent) {
    this.server.to(`job:${event.jobId}`).emit('ingestionProgress', event);
  }

  // Emit job completion to all clients subscribed to this job
  emitComplete(jobId: string, repoId: string) {
    this.server.to(`job:${jobId}`).emit('ingestionComplete', { jobId, repoId });
  }

  // Emit job failure to all clients subscribed to this job
  emitError(jobId: string, repoId: string, error: string) {
    this.server
      .to(`job:${jobId}`)
      .emit('ingestionError', { jobId, repoId, error });
  }
}
