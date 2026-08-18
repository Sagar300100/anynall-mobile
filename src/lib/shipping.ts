// src/lib/shipping.ts — mobile port of the website's shipping client
// (services/api.ts shipping section) against functions/shippingRouter.js,
// which wraps Shiprocket. Same contracts, same field names.
//
// Model: the seller registers ONE pickup address (nickname derived from the
// uid server-side, quoted on every booking). Shipping an order is a resumable
// 3-step pipeline — create order → assign courier/AWB → generate label — the
// server persists each step, so "Resume booking" after a failure picks up
// where it stopped rather than double-booking. Tracking is readable by both
// sides of the trade; everything here is seller-side except trackOrder.
import { j } from './api';

// ── Types (mirror the server responses exactly) ────────────────────────────

export interface PickupAddress {
  nickname?: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  address2?: string;
  city: string;
  state: string;
  pincode: string;
  registeredAt?: number | null;
}

export interface Shipment {
  shiprocketOrderId?: number | string | null;
  shipmentId?: number | string | null;
  awbCode?: string | null;
  courierName?: string | null;
  courierId?: number | string | null;
  labelUrl?: string | null;
  // created | awb_assigned | label_ready | pickup_requested
  status?: string | null;
  pickupScheduledDate?: string | null;
  pickupTokenNumber?: string | null;
}

/** Human labels for the shipment pipeline stages. */
export const SHIP_STAGE: Record<string, string> = {
  created: 'Booking started',
  awb_assigned: 'Courier assigned',
  label_ready: 'Label ready',
  pickup_requested: 'Pickup requested',
};

export interface CourierRate {
  courierId: number | string;
  name: string;
  rateRupees: number;
  etdDays: number | string | null;
  rating: number | null;
}

export interface TrackingInfo {
  status: string | null;
  deliveredDate: string | null;
  etd: string | null;
  trackUrl: string | null;
  activities: { date: string; status: string; activity: string; location: string }[];
}

// ── Settings ───────────────────────────────────────────────────────────────

/** Is Shiprocket configured platform-side, and has THIS seller registered a
 *  pickup address? Drives the setup checklist on the shipping screen. */
export function getShippingStatus() {
  return j<{ configured: boolean; pickupRegistered: boolean; pickupNickname: string | null }>(
    '/api/shipping/status',
    undefined,
    true
  );
}

export function getPickupAddress() {
  return j<{ pickup: PickupAddress | null }>('/api/shipping/pickup', undefined, true);
}

/** Register/update the pickup address with Shiprocket. Re-saving reuses the
 *  same nickname, so fixing a typo never mints a duplicate location. */
export function savePickupAddress(p: PickupAddress) {
  return j<{ ok: boolean; nickname: string }>(
    '/api/shipping/pickup',
    { method: 'POST', body: JSON.stringify(p) },
    true
  );
}

/** Courier quotes for a destination PIN. Prepaid-only (cod always 0) —
 *  payment clears before anything ships. Weight in grams. */
export function getShippingRates(deliveryPincode: string, weightGrams: number) {
  return j<{ couriers: CourierRate[] }>(
    `/api/shipping/rates?delivery=${encodeURIComponent(deliveryPincode)}&weight=${encodeURIComponent(
      String(weightGrams)
    )}`,
    undefined,
    true
  );
}

// ── Per-order workflow ─────────────────────────────────────────────────────

/** Book the courier for a paid order (resumable 3-step pipeline). */
export function shipOrder(orderId: string) {
  return j<{ ok: boolean; shipment: Shipment }>(
    `/api/shipping/orders/${encodeURIComponent(orderId)}/ship`,
    { method: 'POST', body: JSON.stringify({}) },
    true
  );
}

/** Ask the courier to come collect the booked shipment. */
export function requestPickup(orderId: string) {
  return j<{ ok: boolean; shipment: Shipment }>(
    `/api/shipping/orders/${encodeURIComponent(orderId)}/pickup`,
    { method: 'POST', body: JSON.stringify({}) },
    true
  );
}

/** Live tracking — readable by the order's seller AND buyer, nobody else. */
export function trackOrder(orderId: string) {
  return j<{ shipment: Shipment | null; tracking: TrackingInfo | null }>(
    `/api/shipping/orders/${encodeURIComponent(orderId)}/track`,
    undefined,
    true
  );
}
