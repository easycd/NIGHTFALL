import type { Server } from 'socket.io';
import type { IncomingMessage, ServerResponse } from 'node:http';
export function createNightfall(io: Server): { rooms: Map<string, unknown>; close(): void };
export function handleNightfallRequest(req: IncomingMessage, res: ServerResponse, base?: string): Promise<boolean>;
