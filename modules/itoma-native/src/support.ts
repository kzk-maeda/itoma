import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type SupportPrice = { id: string; display: string; amount: string; currency: string; storefront: string };
export type SupportAction = 'load' | 'status' | 'buy' | 'retry' | 'ack' | 'leavePending';
export type SupportState = 'idle' | 'empty' | 'changed' | 'buying' | 'cancelled' | 'pending' | 'unknown' | 'verified' | 'unavailable';
export type SupportReply = { state: SupportState; products?: SupportPrice[]; receipt?: string; canLeavePending?: boolean };

interface SupportPort {
  addListener(event: 'supportChanged', listener: () => void): { remove(): void };
  request(action: string, value: string): Promise<string>;
}
const native = () => Platform.OS === 'ios' ? requireOptionalNativeModule<SupportPort>('ItomaSupport') : null;
export function observeSupport(listener: () => void) {
  return native()?.addListener('supportChanged', listener);
}

export async function supportRequest(action: SupportAction, value = ''): Promise<SupportReply> {
  const port = native();
  if (!port) return { state: 'empty', products: [] };
  const reply = JSON.parse(await port.request(action, value)) as SupportReply;
  if (!['idle', 'empty', 'changed', 'buying', 'cancelled', 'pending', 'unknown', 'verified', 'unavailable'].includes(reply?.state)
    || (reply.state === 'verified' && !reply.receipt)) throw new Error('Support response unavailable');
  return reply;
}
