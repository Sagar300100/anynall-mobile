// src/data/help-faqs.ts — copied from the website's data/helpFaqs.ts.
// ──────────────────────────────────────────────────────────────────
// Help Center content — sourced verbatim (lightly compressed) from the
// founder-supplied "FAQ's Any&All.docx" (04 July 2026 policy set).
//
// Answers are STRUCTURED segments, not HTML: plain text pieces plus typed
// link tokens each surface renders as real controls — no HTML strings, so
// this data drops straight into React Native <Text> without a parser.
// `nav` values map to the app's legal routes (terms/privacy/refund/contact
// → /legal/terms /legal/privacy /legal/refund /legal/contact) and `hash`
// scrolls to that section within the document; `mailto` values are the
// official addresses from the Contact Us document. Keep the language
// legally cautious ("may", "subject to", "depending on") — do not add
// promises the policies don't make.
// ──────────────────────────────────────────────────────────────────

export type HelpCategoryKey =
  | 'buying'
  | 'selling'
  | 'account'
  | 'safety'
  | 'payments'
  | 'support';

export const HELP_CATEGORIES: { key: HelpCategoryKey; label: string }[] = [
  { key: 'buying', label: 'Buying' },
  { key: 'selling', label: 'Selling' },
  { key: 'account', label: 'Account' },
  { key: 'safety', label: 'Safety & Policies' },
  { key: 'payments', label: 'Payments & Refunds' },
  { key: 'support', label: 'Contact & Support' },
];

export type FaqSegment =
  | { t: string }
  | { nav: 'terms' | 'privacy' | 'refund' | 'contact'; label: string; hash?: string }
  | { mailto: string };

export interface HelpFaq {
  id: string;
  category: HelpCategoryKey;
  q: string;
  a: FaqSegment[];
}

export const HELP_FAQS: HelpFaq[] = [
  // ── Buying ──────────────────────────────────────────────────────
  {
    id: 'what-is-anynall',
    category: 'buying',
    q: 'What is Any&All?',
    a: [
      { t: 'Any&All is a live shopping marketplace where you can discover products, watch sellers live, ask questions, place bids, and buy items directly through the platform. Use of Any & All is subject to our ' },
      { nav: 'terms', label: 'Terms & Conditions', hash: 'nature-of-any-all' },
      { t: '.' },
    ],
  },
  {
    id: 'how-live-shopping-works',
    category: 'buying',
    q: 'How does live shopping work?',
    a: [
      { t: 'Sellers showcase products in real time through livestreams. You can watch, ask questions, bid in auctions, or purchase products while the seller is live. Auctions and live purchases are governed by our ' },
      { nav: 'terms', label: 'Terms & Conditions', hash: 'live-stream-sales-auctions-bids-and-offers' },
      { t: '.' },
    ],
  },
  {
    id: 'sold-directly',
    category: 'buying',
    q: 'Are products sold by Any&All directly?',
    a: [
      { t: 'No. Any&All is a marketplace platform. Products are listed and sold by independent sellers, while Any&All provides the platform, payment flow, livestream features, and support systems. The platform’s role is described in our ' },
      { nav: 'terms', label: 'Terms & Conditions', hash: 'marketplace-role-and-legal-position' },
      { t: '.' },
    ],
  },
  {
    id: 'how-auctions-work',
    category: 'buying',
    q: 'How do auctions work?',
    a: [
      { t: 'Sellers may run live auctions with a starting price and time limit. Buyers can place bids, and the highest valid bid at the end of the auction wins. Bidding rules are set out in our ' },
      { nav: 'terms', label: 'Terms & Conditions', hash: 'live-stream-sales-auctions-bids-and-offers' },
      { t: '.' },
    ],
  },
  {
    id: 'who-handles-delivery',
    category: 'buying',
    q: 'Who handles delivery?',
    a: [
      { t: 'Delivery may be handled through Any&All’s logistics partners, seller-arranged shipping, or other available delivery methods depending on the order and location, as per our ' },
      { nav: 'terms', label: 'Terms & Conditions', hash: 'shipping-and-delivery' },
      { t: '. For delivery problems with an order, see our ' },
      { nav: 'refund', label: 'Refund Policy', hash: 'lost-delayed-or-failed-delivery' },
      { t: '.' },
    ],
  },
  {
    id: 'available-across-india',
    category: 'buying',
    q: 'Is Any&All available across India?',
    a: [
      { t: 'Any&All aims to serve buyers and sellers across India, subject to logistics availability, seller eligibility, tax rules, product category restrictions, and platform policies. See our ' },
      { nav: 'terms', label: 'Terms & Conditions', hash: 'nature-of-any-all' },
      { t: ' for details.' },
    ],
  },

  // ── Account ─────────────────────────────────────────────────────
  {
    id: 'need-account',
    category: 'account',
    q: 'Do I need an account to buy?',
    a: [
      { t: 'Yes. You need an Any&All account to place bids, buy products, make payments, track orders, and contact support. Account use is subject to our ' },
      { nav: 'terms', label: 'Terms & Conditions', hash: 'account-registration-and-security' },
      { t: '. To understand how we collect and use account information, read our ' },
      { nav: 'privacy', label: 'Privacy Policy', hash: 'personal-data-we-collect' },
      { t: '.' },
    ],
  },

  // ── Safety & Policies ───────────────────────────────────────────
  {
    id: 'minors-buying',
    category: 'safety',
    q: 'Can users below 18 buy on Any&All?',
    a: [
      { t: 'No. Buying, bidding, payments, auctions, and marketplace transactions are allowed only for users who meet the eligibility requirements in our ' },
      { nav: 'terms', label: 'Terms & Conditions', hash: 'eligibility' },
      { t: ' — users must be 18 years of age or older. For how minors’ data is handled, see our ' },
      { nav: 'privacy', label: 'Privacy Policy', hash: 'children-and-minors' },
      { t: '.' },
    ],
  },
  {
    id: 'minors-selling',
    category: 'safety',
    q: 'Can users below 18 sell on Any&All?',
    a: [
      { t: 'No. Users below 18 cannot sell, list products, livestream as sellers, receive payouts, complete KYC, or enter into marketplace transactions, as per the eligibility rules in our ' },
      { nav: 'terms', label: 'Terms & Conditions', hash: 'restrictions-on-minors' },
      { t: '.' },
    ],
  },
  {
    id: 'branded-products',
    category: 'safety',
    q: 'Can I sell branded products?',
    a: [
      { t: 'Yes, but only genuine and legally allowed products may be sold. Counterfeit, fake, replica, stolen, or misleading branded products are not allowed and are treated under the restricted-products rules in our ' },
      { nav: 'terms', label: 'Terms & Conditions', hash: 'authenticity-counterfeits-and-high-risk-products' },
      { t: '.' },
    ],
  },
  {
    id: 'products-not-allowed',
    category: 'safety',
    q: 'What products are not allowed?',
    a: [
      { t: 'Illegal, counterfeit, stolen, unsafe, hazardous, restricted, adult, or policy-violating products are not allowed on Any&All. The full restrictions are in our ' },
      { nav: 'terms', label: 'Terms & Conditions', hash: 'prohibited-and-restricted-items' },
      { t: '.' },
    ],
  },

  // ── Selling ─────────────────────────────────────────────────────
  {
    id: 'who-can-sell',
    category: 'selling',
    q: 'Who can sell on Any&All?',
    a: [
      { t: 'Eligible users who are 18 years of age or older may apply to sell on Any&All, subject to seller onboarding, verification, KYC, and the seller rules in our ' },
      { nav: 'terms', label: 'Terms & Conditions', hash: 'seller-onboarding' },
      { t: '.' },
    ],
  },
  {
    id: 'become-seller',
    category: 'selling',
    q: 'How do I become a seller?',
    a: [
      { t: 'Create an account, complete seller onboarding, provide the required details, complete verification/KYC where required, and agree to Any&All’s seller policies under our ' },
      { nav: 'terms', label: 'Terms & Conditions', hash: 'seller-onboarding' },
      { t: '. If you get stuck during onboarding, ' },
      { nav: 'contact', label: 'contact support', hash: 'seller-support' },
      { t: '.' },
    ],
  },
  {
    id: 'gst-required',
    category: 'selling',
    q: 'Do I need GST registration to sell?',
    a: [
      { t: 'GST requirements depend on your business type, turnover, product category, location, and whether you sell within your state or outside it. Sellers are responsible for complying with applicable tax laws, as per our ' },
      { nav: 'terms', label: 'Terms & Conditions', hash: 'taxes-gst-status-invoicing-and-statutory-deductions' },
      { t: '.' },
    ],
  },
  {
    id: 'no-gst',
    category: 'selling',
    q: 'Can sellers without GST registration sell?',
    a: [
      { t: 'Any&All may allow eligible sellers without GST registration where legally permitted. Such sellers may face restrictions based on tax rules, product type, location, and the platform rules in our ' },
      { nav: 'terms', label: 'Terms & Conditions', hash: 'taxes-gst-status-invoicing-and-statutory-deductions' },
      { t: '.' },
    ],
  },
  {
    id: 'seller-commission',
    category: 'selling',
    q: 'Does Any&All charge seller commission?',
    a: [
      { t: 'At the current introductory stage, Any&All may not charge sellers a platform commission. However, payment gateway fees, logistics charges, taxes, refunds, penalties, or other transaction-related deductions may still apply — see the fee terms in our ' },
      { nav: 'terms', label: 'Terms & Conditions', hash: 'pricing-fees-and-charges' },
      { t: '.' },
    ],
  },
  {
    id: 'seller-payouts',
    category: 'selling',
    q: 'When will sellers receive payouts?',
    a: [
      { t: 'Seller payouts may be released after payment confirmation, delivery, buyer confirmation, completion of the return/dispute window, or according to Any&All’s payout policy and payment partner timelines, as set out in our ' },
      { nav: 'terms', label: 'Terms & Conditions', hash: 'seller-payouts' },
      { t: '.' },
    ],
  },
  {
    id: 'used-thrift',
    category: 'selling',
    q: 'Can I sell used or thrift products?',
    a: [
      { t: 'Yes, subject to Any&All’s policies. Sellers must clearly disclose whether the item is used, thrifted, refurbished, open-box, damaged, or has any defect, as required by our ' },
      { nav: 'terms', label: 'Terms & Conditions', hash: 'product-listings-and-disclosures' },
      { t: '.' },
    ],
  },
  {
    id: 'livestream-disclosure',
    category: 'selling',
    q: 'What should I mention during a livestream?',
    a: [
      { t: 'Clearly explain the product condition, price, size, brand, defects, authenticity, return eligibility, shipping details, and any other important buyer information. Disclosure obligations are covered in our ' },
      { nav: 'terms', label: 'Terms & Conditions', hash: 'product-listings-and-disclosures' },
      { t: '.' },
    ],
  },

  // ── Payments & Refunds ──────────────────────────────────────────
  {
    id: 'buyer-charges',
    category: 'payments',
    q: 'What charges do buyers pay?',
    a: [
      { t: 'Buyers may pay the product price, applicable taxes, payment gateway charges, delivery/logistics fees, and any other charges shown at checkout before payment, as per our ' },
      { nav: 'terms', label: 'Terms & Conditions', hash: 'buyer-charges' },
      { t: '.' },
    ],
  },
  {
    id: 'returns-refunds',
    category: 'payments',
    q: 'Can I return or refund a product?',
    a: [
      { t: 'Returns and refunds depend on the product category, seller policy, product condition, and Any & All’s ' },
      { nav: 'refund', label: 'Refund Policy', hash: 'when-a-buyer-may-get-a-refund' },
      { t: '. If there is an issue, you can raise a support request for review.' },
    ],
  },
  {
    id: 'damaged-or-different',
    category: 'payments',
    q: 'What if the product is damaged or different from what was shown?',
    a: [
      { t: 'Contact Any&All support with your order details, photos, videos, and a clear explanation — the issue will be reviewed under our ' },
      { nav: 'refund', label: 'Refund Policy', hash: 'when-a-buyer-may-get-a-refund' },
      { t: ' and dispute process. You can reach the team via the ' },
      { nav: 'contact', label: 'Contact Us', hash: 'buyer-support' },
      { t: ' page.' },
    ],
  },
  {
    id: 'disputes',
    category: 'payments',
    q: 'How are disputes handled?',
    a: [
      { t: 'Any&All may review order details, product information, livestream records, chats, photos, videos, payment records, delivery records, and responses from both buyer and seller before making a decision, as per our ' },
      { nav: 'refund', label: 'Refund Policy', hash: 'seller-response-and-any-all-review' },
      { t: ' and ' },
      { nav: 'terms', label: 'Terms & Conditions', hash: 'dispute-resolution' },
      { t: '. To raise a dispute, ' },
      { nav: 'contact', label: 'contact support', hash: 'buyer-support' },
      { t: '.' },
    ],
  },

  // ── Contact & Support ───────────────────────────────────────────
  {
    id: 'contact-support',
    category: 'support',
    q: 'How can I contact support?',
    a: [
      { t: 'You can contact Any&All support through the platform, via the ' },
      { nav: 'contact', label: 'Contact Us', hash: 'buyer-support' },
      { t: ' page, or by emailing ' },
      { mailto: 'support@anynall.com' },
      { t: '.' },
    ],
  },
  {
    id: 'full-policies',
    category: 'support',
    q: 'Where can I read the full policies?',
    a: [
      { t: 'Full details are available in our ' },
      { nav: 'terms', label: 'Terms & Conditions' },
      { t: ', ' },
      { nav: 'privacy', label: 'Privacy Policy' },
      { t: ' and ' },
      { nav: 'refund', label: 'Refund Policy' },
      { t: '. For anything else, see the ' },
      { nav: 'contact', label: 'Contact Us' },
      { t: ' page.' },
    ],
  },
];
