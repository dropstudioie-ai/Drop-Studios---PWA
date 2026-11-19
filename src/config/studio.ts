// Studio contact details for the header, footer and home page.
// Empty values are simply hidden.
// Opens Drop Studio on Google Maps at the reviews ("Write a review" button).
export const GOOGLE_REVIEW_URL = 'https://www.google.com/maps/place/Drop+Studio/@53.3489436,-6.2613626,17z/data=!4m8!3m7!1s0x48670fcbbf4ec893:0x48e488ca98f2aa44!8m2!3d53.3489404!4d-6.2587823!9m1!1b1';

export const STUDIO = {
  name: 'Drop Studios',
  // Registered business name (and CRO number, if a company) for the legal pages.
  legalName: 'Drop Studios Limited',
  tagline: 'Dance & Fitness Studio',
  city: 'Dublin, Ireland',
  address: '13 Sackville Place, Dublin 1, D01',
  contactName: 'Jorge dos Santos',
  phone: '083 890 4489',
  phoneHref: 'tel:+353838904489',
  email: 'dropstudioie@gmail.com',
  instagram: '',
  website: 'https://dropstudios.ie',
  mapsUrl: 'https://www.google.com/maps/search/?api=1&query=13+Sackville+Place%2C+Dublin+1%2C+Ireland',
} as const;

/** Date shown on the Terms and Privacy pages. Update it whenever they change. */
export const POLICIES_UPDATED = '2026-11-10';

/**
 * Third parties that process customer data, as listed in the Privacy Policy.
 * Keep this in line with the services you actually deploy (docs/DEPLOYMENT.md).
 */
export const DATA_PROCESSORS = [
  { name: 'Supabase', purpose: 'Database, accounts, login and profile photos', location: 'EU (Ireland region)' },
  { name: 'Square', purpose: 'Card payments (online and in the studio)', location: 'EU and USA' },
  { name: 'Vercel', purpose: 'Hosting the app', location: 'EU and USA' },
  { name: 'Resend', purpose: 'Sending emails (reminders, class changes)', location: 'USA' },
] as const;
