import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({
  cors: { origin: '*' },
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private businessRooms = new Map<string, Set<string>>();

  handleConnection(client: { id: string }) {
    // Client will join room via subscribe
  }

  handleDisconnect(client: { id: string }) {
    this.businessRooms.forEach((sockets, businessId) => {
      sockets.delete(client.id);
      if (sockets.size === 0) this.businessRooms.delete(businessId);
    });
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(
    client: { id: string; join: (room: string) => void },
    payload: { businessId: string },
  ) {
    if (payload?.businessId) {
      client.join(`business:${payload.businessId}`);
      let set = this.businessRooms.get(payload.businessId);
      if (!set) {
        set = new Set();
        this.businessRooms.set(payload.businessId, set);
      }
      set.add(client.id);
    }
  }

  emitToBusiness(businessId: string, event: string, data: unknown) {
    this.server.to(`business:${businessId}`).emit(event, data);
  }
}
