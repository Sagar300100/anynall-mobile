// Buy Now confirmation sheet — mobile port of the web BuyNowSheet. Shows the
// product, the same total the backend will charge (price + seller shipping),
// and the saved delivery address as a compact card. The backend prices the
// order from the product doc; nothing here is trusted.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { FormError, PrimaryButton, useBrandColors } from '@/components/ui/form';
import { IN_STATES } from '@/constants/in-states';
import { Fonts, Spacing } from '@/constants/theme';
import {
  createBuyNowOrder,
  formatPaise,
  type BuyNowOrder,
  type ShippingAddress,
} from '@/lib/commerce';
import type { ProductDoc } from '@/lib/realtime';

interface Props {
  visible: boolean;
  product: ProductDoc;
  address: ShippingAddress | null;
  /** Open the address/setup sheet (GetReadySheet) to add or change address. */
  onEditAddress: () => void;
  /** Order created — parent opens the Razorpay checkout with it. */
  onOrderCreated: (order: BuyNowOrder) => void;
  onClose: () => void;
}

export function BuyNowSheet({
  visible,
  product,
  address,
  onEditAddress,
  onOrderCreated,
  onClose,
}: Props) {
  const c = useBrandColors();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const shippingFee = product.shippingFee || 0;
  const total = (product.price || 0) + shippingFee;
  const stateName = address ? IN_STATES.find((s) => s.code === address.stateCode)?.name : '';

  async function pay() {
    if (!address) {
      onEditAddress();
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const order = await createBuyNowOrder(product.id, address);
      onOrderCreated(order);
    } catch (e: any) {
      const text = String(e?.message || '');
      const m = text.match(/"message"\s*:\s*"([^"]+)"/);
      setErr(
        m?.[1] ||
          (text.includes('SOLD_OUT')
            ? 'This item just sold out.'
            : 'Could not start the purchase. Please try again.')
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={[styles.sheet, { backgroundColor: c.backgroundElement, borderColor: c.border }]}>
          <View style={styles.head}>
            <Text style={[styles.title, { color: c.text }]}>Buy now</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={20} color={c.textSecondary} />
            </Pressable>
          </View>

          {/* Product row */}
          <View style={styles.productRow}>
            {product.thumbnail_url ? (
              <Image source={{ uri: product.thumbnail_url }} style={styles.thumb} contentFit="cover" />
            ) : (
              <View style={[styles.thumb, { backgroundColor: c.backgroundSelected }]}>
                <Ionicons name="cube-outline" size={22} color={c.textSecondary} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text numberOfLines={2} style={[styles.productTitle, { color: c.text }]}>
                {product.title}
              </Text>
              <Text style={[styles.priceLine, { color: c.textSecondary }]}>
                {formatPaise(product.price || 0)}
                {shippingFee > 0 ? ` + ${formatPaise(shippingFee)} shipping` : ' · Free shipping'}
              </Text>
            </View>
          </View>

          {/* Address card */}
          <Pressable
            onPress={onEditAddress}
            style={[styles.addressCard, { backgroundColor: c.background, borderColor: c.border }]}
          >
            <Ionicons name="location-outline" size={18} color={c.primary} />
            {address ? (
              <View style={{ flex: 1 }}>
                <Text style={[styles.addrName, { color: c.text }]}>Deliver to {address.name}</Text>
                <Text numberOfLines={1} style={[styles.addrLine, { color: c.textSecondary }]}>
                  {address.line1}
                  {address.line2 ? `, ${address.line2}` : ''}, {address.city}, {stateName}{' '}
                  {address.pincode}
                </Text>
              </View>
            ) : (
              <Text style={[styles.addrName, { color: c.text, flex: 1 }]}>Add delivery address</Text>
            )}
            <Text style={{ color: c.primary, fontFamily: Fonts.sansMedium, fontSize: 13 }}>
              {address ? 'Change' : 'Add'}
            </Text>
          </Pressable>

          <FormError message={err} />
          <PrimaryButton
            title={address ? `Pay ${formatPaise(total)}` : 'Add address to continue'}
            onPress={pay}
            loading={busy}
          />
          <Text style={[styles.note, { color: c.textFaint }]}>
            One unit is reserved for you while you pay. The final amount is charged by Razorpay
            exactly as shown.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(2,6,16,0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    padding: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 20, fontFamily: Fonts.sansSemiBold },
  productRow: { flexDirection: 'row', gap: Spacing.three, alignItems: 'center' },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productTitle: { fontSize: 15, fontFamily: Fonts.sansMedium, lineHeight: 20 },
  priceLine: { fontSize: 13, fontFamily: Fonts.sans, marginTop: 2 },
  addressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 10,
    padding: Spacing.three,
  },
  addrName: { fontSize: 14, fontFamily: Fonts.sansMedium },
  addrLine: { fontSize: 12, fontFamily: Fonts.sans, marginTop: 1 },
  note: { fontSize: 11, fontFamily: Fonts.sans, lineHeight: 15, textAlign: 'center' },
});
