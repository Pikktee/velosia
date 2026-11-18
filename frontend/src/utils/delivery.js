// Versand oder Abholung (V2.8.23). The account holds the preset
// (default_delivery), a draft may override it (delivery); the backend resolves
// both into delivery_effective, which the autofill engine sets on Kleinanzeigen
// ("Versand möglich" / "Nur Abholung") and eBay ("Lieferung"). Vinted always ships.
export const DELIVERY_OPTIONS = [
  { value: 'BOTH', label: 'Beides' },
  { value: 'SHIP', label: 'Versand' },
  { value: 'PICKUP', label: 'Abholung' },
];
