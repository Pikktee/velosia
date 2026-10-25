// Kleinanzeigen price types ("Preisart"). The account holds the preset
// (default_price_type), a draft may override it (price_type); the backend
// resolves both into price_type_effective, which the autofill engine sets.
// Vinted has no such field — offers are always possible there.
export const PRICE_TYPES = [
  { value: 'FIXED', label: 'Festpreis' },
  { value: 'NEGOTIABLE', label: 'VB' },
];
