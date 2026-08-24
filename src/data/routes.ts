/**
 * Every route the site will have, in one place.
 *
 * The header and footer render from this list, and they render only the routes
 * marked built. That is deliberate on both counts.
 *
 * Linking a route that does not exist yet fails `check:site`, which is correct —
 * a 404 in the footer is worse than an absent link. But deleting the unbuilt
 * ones from the navigation until they exist is how a page ends up with no
 * inbound links at all, and `check:site` cannot catch THAT: every link it
 * checks resolves by definition. So the full list lives here from the start and
 * the flag is the only thing that moves.
 *
 * Adding a route means flipping `built` here in the same change. Nothing else
 * needs to know.
 */

export interface SiteRoute {
  label: string;
  path: string;
  built: boolean;
  /** Shown in the four-item primary nav rather than only in the footer. */
  primary?: boolean;
  /** Carries the My Bar inventory count once there is one. */
  count?: boolean;
}

export const ROUTES: SiteRoute[] = [
  { label: 'Drinks', path: '/', built: true, primary: true },
  { label: 'Ingredients', path: '/ingredients/', built: true, primary: true },
  { label: 'Techniques', path: '/techniques/', built: true, primary: true },
  { label: 'My Bar', path: '/my-bar/', built: true, primary: true, count: true },
  { label: 'Preparations', path: '/preparations/', built: true },
  { label: 'Families', path: '/families/', built: true },
  { label: 'Glassware', path: '/glassware/', built: true },
  { label: 'Categories', path: '/categories/', built: true },
  { label: 'Origins', path: '/origins/', built: true },
  { label: 'Methods', path: '/methods/', built: true },
  { label: 'Spirits', path: '/spirits/', built: true },
  { label: 'Plan', path: '/plan/', built: true },
  { label: 'Attributions', path: '/attributions/', built: true },
  { label: 'About', path: '/about/', built: true },
];

export const builtRoutes = (): SiteRoute[] => ROUTES.filter((r) => r.built);

/** Four is the ceiling for the primary nav; anything further goes in the footer. */
export const primaryRoutes = (): SiteRoute[] =>
  ROUTES.filter((r) => r.built && r.primary).slice(0, 4);
