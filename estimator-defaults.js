/*
 * Repository fallback for the ASP Manager estimator. Supabase is the live
 * source of truth once the estimator migration has been applied. Keeping a
 * versioned copy here means a new account or an unavailable database never
 * leaves the app without the agreed business principles.
 */
const ASP_ESTIMATOR_DEFAULTS = {
  version: 1,
  business_positioning: 'Adam Stapley Plumbing is a premium independent plumbing and heating company based in Epsom, Surrey. Gas engineer first, plumber second. 25+ years’ experience. Gas Safe Registered and G3 Qualified. Never compete on being the cheapest.',
  pricing_philosophy: 'Use value-based pricing. Historic invoices and estimates are reference only for scope, wording, likely labour and materials, not future selling prices. Recommend a fair, professional target price. Do not underprice quick work where responsibility, travel, risk, access, testing or guarantee justify more. Do not increase prices merely for the sake of it.',
  quoting_rules: 'Consider experience, responsibility, urgency, travel, parking, access, materials, van stock, collection time, testing, commissioning, guarantees, administration, insurance, overheads, waste and profit. Use a fixed price only when the scope is sufficiently clear; otherwise state assumptions and exclusions clearly.',
  wording_style: 'Use plain British English. Be professional and friendly. Describe a clear scope of works, quality materials, testing and commissioning, tidy completion and sensible exclusions. Never expose internal minimum-charge or profit reasoning to customers.',
  minimum_charge_ex_vat: 95,
  target_pricing_guidance: 'Recommend a fair professional target price. Treat the minimum charge as a floor for normal call-outs, not an automatic price for every job. Flag uncertain scope for review rather than inventing a figure.',
  boiler_pricing_guidance: 'For boiler work, allow for diagnosis, safe isolation, specialist responsibility, commissioning, testing, registration where applicable, materials, warranty and customer handover. Do not use historic selling prices as the future price.',
  plumbing_pricing_guidance: 'For plumbing work, account for access, investigation, responsibility for leaks or water damage, materials, travel, parking, collection time, testing and making good where included.',
  recurring_service_behaviour: 'Use clear annual-service wording. Default to a fixed-price service where the appliance and scope are known. Record exclusions for repairs, parts and additional appliances unless specifically included.',
  standard_templates: {
    fixed_price_quote: 'We will complete the works described using suitable quality materials, test the completed work and leave the work area tidy. This is a fixed-price quotation based on the scope shown. Any additional work outside that scope will be discussed and agreed before proceeding.',
    service_quote: 'Carry out the agreed service, complete the relevant safety and operational checks, and provide clear findings. Repairs, replacement parts and work outside the agreed service scope are excluded unless specifically stated.'
  },
  default_inclusions: 'Labour for the stated scope; suitable quality materials where listed; testing and commissioning where applicable; tidy completion; sensible administration and guarantee responsibility.',
  default_exclusions: 'Unforeseen defects, concealed damage, additional work outside the stated scope, specialist access equipment, parking charges, making good and replacement parts unless specifically included.',
  vat_rate: 20,
  vat_behaviour: 'Store prices ex VAT. Show VAT separately where required. Apply the configured VAT rate unless a legitimate manual override is recorded.',
  manual_override_rules: 'The final approved price can be changed by Adam after review. Preserve the original estimator recommendation, source price and reason for any manual override for internal review only.'
};

if (typeof window !== 'undefined') window.ASP_ESTIMATOR_DEFAULTS = ASP_ESTIMATOR_DEFAULTS;
if (typeof module !== 'undefined') module.exports = ASP_ESTIMATOR_DEFAULTS;
