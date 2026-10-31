// Rule 10: the story is data with {{cast}} tokens and three vertical packs. Fictional names only.
export const VERTICALS = {
  airline: { label: 'Airline', cast: { member: 'Alex Rivera', portalApp: 'Miles portal', sensitiveApp: 'Miles redemption app', embeddedApp: 'Booking widget' } },
  health: { label: 'Health plan', cast: { member: 'Alex Rivera', portalApp: 'Member portal', sensitiveApp: 'Claims payments app', embeddedApp: 'Find-a-doctor widget' } },
  bank: { label: 'Bank', cast: { member: 'Alex Rivera', portalApp: 'Online banking', sensitiveApp: 'Payments app', embeddedApp: 'Card activation widget' } },
};
export const DEFAULT_VERTICAL = 'airline';
export const verticalFrom = (v) => (typeof v === 'string' && Object.hasOwn(VERTICALS, v) ? v : DEFAULT_VERTICAL);
