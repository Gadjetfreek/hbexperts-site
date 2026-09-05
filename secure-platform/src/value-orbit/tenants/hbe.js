/** HBE tenant config — geography lives here, not in the generic renderer. */
export default {
  brokerage_id: 'hbe',
  display_name: 'HomeBuyer Experts',
  center: { lat: 41.0814, lng: -81.519 },
  service_area_mode: 'drive_time',
  service_area: {
    minutes: 60,
    hub_label: 'Akron'
  },
  public_label: 'Northeast Ohio · Akron-centered service region',
  fallback_region: 'Northeast Ohio',
  approx_disclaimer:
    'Service area shown is approximate (about one hour from Akron). It is not a precise drive-time guarantee.',
  stages: {
    orbit_label: 'Earth',
    region_label: 'Northeast Ohio',
    local_label: 'Akron-centered service region'
  }
};
