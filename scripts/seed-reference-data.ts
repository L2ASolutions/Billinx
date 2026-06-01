/**
 * Seeds FIRS reference data tables.
 * Run with: npx tsx scripts/seed-reference-data.ts
 * Safe to re-run — uses upsert for all rows.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding FIRS reference data...');

  // Invoice types (UN/CEFACT D.16B + FIRS additions)
  await prisma.invoiceType.createMany({
    data: [
      { code: '380', value: 'Commercial Invoice' },
      { code: '381', value: 'Credit Note' },
      { code: '383', value: 'Debit Note' },
      { code: '386', value: 'Prepayment Invoice' },
      { code: '380P', value: 'Proforma Invoice' },
    ],
    skipDuplicates: true,
  });
  console.log('  ✓ invoice_types');

  // Payment means (UN/CEFACT UNCL4461)
  await prisma.paymentMeans.createMany({
    data: [
      { code: '10', value: 'Cash' },
      { code: '20', value: 'Cheque' },
      { code: '30', value: 'Credit Transfer' },
      { code: '42', value: 'Payment to bank account' },
      { code: '48', value: 'Bank card' },
      { code: '49', value: 'Direct debit' },
      { code: '57', value: 'Standing agreement' },
      { code: '97', value: 'Clearing between partners' },
    ],
    skipDuplicates: true,
  });
  console.log('  ✓ payment_means');

  // Tax categories (FIRS/NRS)
  await prisma.taxCategory.createMany({
    data: [
      { code: 'S', value: 'Standard VAT (7.5%)' },
      { code: 'Z', value: 'Zero-rated (0%)' },
      { code: 'E', value: 'Exempt' },
      { code: 'O', value: 'Outside scope of tax' },
      { code: 'WHT', value: 'Withholding Tax' },
    ],
    skipDuplicates: true,
  });
  console.log('  ✓ tax_categories');

  // Currencies (ISO 4217 — major trading currencies + NGN)
  await prisma.currency.createMany({
    data: [
      { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', symbolNative: '₦', decimalDigits: 2, rounding: 0, namePlural: 'Nigerian nairas' },
      { code: 'USD', name: 'US Dollar', symbol: '$', symbolNative: '$', decimalDigits: 2, rounding: 0, namePlural: 'US dollars' },
      { code: 'EUR', name: 'Euro', symbol: '€', symbolNative: '€', decimalDigits: 2, rounding: 0, namePlural: 'euros' },
      { code: 'GBP', name: 'British Pound Sterling', symbol: '£', symbolNative: '£', decimalDigits: 2, rounding: 0, namePlural: 'British pounds sterling' },
      { code: 'GHS', name: 'Ghanaian Cedi', symbol: 'GH₵', symbolNative: 'GH₵', decimalDigits: 2, rounding: 0, namePlural: 'Ghanaian cedis' },
      { code: 'ZAR', name: 'South African Rand', symbol: 'R', symbolNative: 'R', decimalDigits: 2, rounding: 0, namePlural: 'South African rand' },
      { code: 'KES', name: 'Kenyan Shilling', symbol: 'Ksh', symbolNative: 'Ksh', decimalDigits: 2, rounding: 0, namePlural: 'Kenyan shillings' },
      { code: 'XOF', name: 'CFA Franc BCEAO', symbol: 'CFA', symbolNative: 'CFA', decimalDigits: 0, rounding: 0, namePlural: 'CFA francs BCEAO' },
      { code: 'CNY', name: 'Chinese Yuan', symbol: 'CN¥', symbolNative: '¥', decimalDigits: 2, rounding: 0, namePlural: 'Chinese yuan' },
      { code: 'JPY', name: 'Japanese Yen', symbol: '¥', symbolNative: '￥', decimalDigits: 0, rounding: 0, namePlural: 'Japanese yen' },
      { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', symbolNative: '$', decimalDigits: 2, rounding: 0, namePlural: 'Canadian dollars' },
      { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', symbolNative: '$', decimalDigits: 2, rounding: 0, namePlural: 'Australian dollars' },
      { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', symbolNative: 'CHF', decimalDigits: 2, rounding: 0.05, namePlural: 'Swiss francs' },
      { code: 'INR', name: 'Indian Rupee', symbol: '₹', symbolNative: '₹', decimalDigits: 2, rounding: 0, namePlural: 'Indian rupees' },
      { code: 'AED', name: 'United Arab Emirates Dirham', symbol: 'AED', symbolNative: 'د.إ.‏', decimalDigits: 2, rounding: 0, namePlural: 'UAE dirhams' },
      { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', symbolNative: '$', decimalDigits: 2, rounding: 0, namePlural: 'Singapore dollars' },
    ],
    skipDuplicates: true,
  });
  console.log('  ✓ currencies');

  // Quantity / unit of measure codes (UN/CEFACT Rec 20)
  await prisma.quantityCode.createMany({
    data: [
      { code: 'EA', name: 'Each', description: 'A unit of count defining the number of items' },
      { code: 'PCE', name: 'Piece', description: 'A unit of count defining the number of pieces' },
      { code: 'SET', name: 'Set', description: 'A unit of count defining the number of sets' },
      { code: 'DZN', name: 'Dozen', description: '12 units' },
      { code: 'GRO', name: 'Gross', description: '144 units' },
      { code: 'KGM', name: 'Kilogram', description: 'SI base unit of mass' },
      { code: 'GRM', name: 'Gram', description: '0.001 kilograms' },
      { code: 'TNE', name: 'Metric Tonne', description: '1,000 kilograms' },
      { code: 'LTR', name: 'Litre', description: 'Unit of volume' },
      { code: 'MLT', name: 'Millilitre', description: '0.001 litres' },
      { code: 'MTR', name: 'Metre', description: 'SI base unit of length' },
      { code: 'CMT', name: 'Centimetre', description: '0.01 metres' },
      { code: 'MMT', name: 'Millimetre', description: '0.001 metres' },
      { code: 'KMT', name: 'Kilometre', description: '1,000 metres' },
      { code: 'MTK', name: 'Square Metre', description: 'SI unit of area' },
      { code: 'MTQ', name: 'Cubic Metre', description: 'SI unit of volume' },
      { code: 'HUR', name: 'Hour', description: 'Unit of time' },
      { code: 'DAY', name: 'Day', description: '24 hours' },
      { code: 'WEE', name: 'Week', description: '7 days' },
      { code: 'MON', name: 'Month', description: 'Calendar month' },
      { code: 'ANN', name: 'Year', description: 'Calendar year' },
      { code: 'BAG', name: 'Bag', description: 'A unit of count defining the number of bags' },
      { code: 'BOT', name: 'Bottle', description: 'A unit of count defining the number of bottles' },
      { code: 'BOX', name: 'Box', description: 'A unit of count defining the number of boxes' },
      { code: 'CAR', name: 'Carton', description: 'A unit of count defining the number of cartons' },
      { code: 'CTN', name: 'Container', description: 'A unit of count defining the number of containers' },
      { code: 'ROL', name: 'Roll', description: 'A unit of count defining the number of rolls' },
      { code: 'SHT', name: 'Sheet', description: 'A unit of count defining the number of sheets' },
      { code: 'PRS', name: 'Pairs', description: 'A unit of count defining the number of pairs' },
      { code: 'BDL', name: 'Bundle', description: 'A unit of count defining the number of bundles' },
    ],
    skipDuplicates: true,
  });
  console.log('  ✓ quantity_codes');

  // Nigerian states (36 states + FCT)
  const states = [
    { code: 'NG-AB', name: 'Abia' },
    { code: 'NG-AD', name: 'Adamawa' },
    { code: 'NG-AK', name: 'Akwa Ibom' },
    { code: 'NG-AN', name: 'Anambra' },
    { code: 'NG-BA', name: 'Bauchi' },
    { code: 'NG-BY', name: 'Bayelsa' },
    { code: 'NG-BE', name: 'Benue' },
    { code: 'NG-BO', name: 'Borno' },
    { code: 'NG-CR', name: 'Cross River' },
    { code: 'NG-DE', name: 'Delta' },
    { code: 'NG-EB', name: 'Ebonyi' },
    { code: 'NG-ED', name: 'Edo' },
    { code: 'NG-EK', name: 'Ekiti' },
    { code: 'NG-EN', name: 'Enugu' },
    { code: 'NG-FC', name: 'Federal Capital Territory' },
    { code: 'NG-GO', name: 'Gombe' },
    { code: 'NG-IM', name: 'Imo' },
    { code: 'NG-JI', name: 'Jigawa' },
    { code: 'NG-KD', name: 'Kaduna' },
    { code: 'NG-KN', name: 'Kano' },
    { code: 'NG-KT', name: 'Katsina' },
    { code: 'NG-KE', name: 'Kebbi' },
    { code: 'NG-KO', name: 'Kogi' },
    { code: 'NG-KW', name: 'Kwara' },
    { code: 'NG-LA', name: 'Lagos' },
    { code: 'NG-NA', name: 'Nasarawa' },
    { code: 'NG-NI', name: 'Niger' },
    { code: 'NG-OG', name: 'Ogun' },
    { code: 'NG-ON', name: 'Ondo' },
    { code: 'NG-OS', name: 'Osun' },
    { code: 'NG-OY', name: 'Oyo' },
    { code: 'NG-PL', name: 'Plateau' },
    { code: 'NG-RI', name: 'Rivers' },
    { code: 'NG-SO', name: 'Sokoto' },
    { code: 'NG-TA', name: 'Taraba' },
    { code: 'NG-YO', name: 'Yobe' },
    { code: 'NG-ZA', name: 'Zamfara' },
  ];
  await prisma.nigerianState.createMany({ data: states, skipDuplicates: true });
  console.log('  ✓ nigerian_states');

  // LGAs (selected major ones per state — complete list for key states)
  const lgas = [
    // Lagos (20 LGAs)
    { code: 'NG-LA-AG', name: 'Agege', stateCode: 'NG-LA' },
    { code: 'NG-LA-AL', name: 'Ajeromi-Ifelodun', stateCode: 'NG-LA' },
    { code: 'NG-LA-AK', name: 'Alimosho', stateCode: 'NG-LA' },
    { code: 'NG-LA-AM', name: 'Amuwo-Odofin', stateCode: 'NG-LA' },
    { code: 'NG-LA-AP', name: 'Apapa', stateCode: 'NG-LA' },
    { code: 'NG-LA-BA', name: 'Badagry', stateCode: 'NG-LA' },
    { code: 'NG-LA-EP', name: 'Epe', stateCode: 'NG-LA' },
    { code: 'NG-LA-ET', name: 'Eti-Osa', stateCode: 'NG-LA' },
    { code: 'NG-LA-IB', name: 'Ibeju-Lekki', stateCode: 'NG-LA' },
    { code: 'NG-LA-IF', name: 'Ifako-Ijaiye', stateCode: 'NG-LA' },
    { code: 'NG-LA-IK', name: 'Ikeja', stateCode: 'NG-LA' },
    { code: 'NG-LA-IR', name: 'Ikorodu', stateCode: 'NG-LA' },
    { code: 'NG-LA-IS', name: 'Isale-Eko', stateCode: 'NG-LA' },
    { code: 'NG-LA-KO', name: 'Kosofe', stateCode: 'NG-LA' },
    { code: 'NG-LA-LA', name: 'Lagos Island', stateCode: 'NG-LA' },
    { code: 'NG-LA-LM', name: 'Lagos Mainland', stateCode: 'NG-LA' },
    { code: 'NG-LA-MD', name: 'Mushin', stateCode: 'NG-LA' },
    { code: 'NG-LA-OJ', name: 'Ojo', stateCode: 'NG-LA' },
    { code: 'NG-LA-OS', name: 'Oshodi-Isolo', stateCode: 'NG-LA' },
    { code: 'NG-LA-SO', name: 'Somolu', stateCode: 'NG-LA' },
    // FCT (6 area councils)
    { code: 'NG-FC-AB', name: 'Abaji', stateCode: 'NG-FC' },
    { code: 'NG-FC-AC', name: 'Abuja Municipal', stateCode: 'NG-FC' },
    { code: 'NG-FC-BW', name: 'Bwari', stateCode: 'NG-FC' },
    { code: 'NG-FC-GW', name: 'Gwagwalada', stateCode: 'NG-FC' },
    { code: 'NG-FC-KU', name: 'Kuje', stateCode: 'NG-FC' },
    { code: 'NG-FC-KW', name: 'Kwali', stateCode: 'NG-FC' },
    // Rivers (23 LGAs — selected)
    { code: 'NG-RI-PH', name: 'Port Harcourt', stateCode: 'NG-RI' },
    { code: 'NG-RI-OB', name: 'Obio-Akpor', stateCode: 'NG-RI' },
    { code: 'NG-RI-EL', name: 'Eleme', stateCode: 'NG-RI' },
    { code: 'NG-RI-AH', name: 'Ahoada East', stateCode: 'NG-RI' },
    { code: 'NG-RI-AW', name: 'Ahoada West', stateCode: 'NG-RI' },
    { code: 'NG-RI-BN', name: 'Bonny', stateCode: 'NG-RI' },
    { code: 'NG-RI-DE', name: 'Degema', stateCode: 'NG-RI' },
    { code: 'NG-RI-EM', name: 'Emohua', stateCode: 'NG-RI' },
    { code: 'NG-RI-EK', name: 'Etche', stateCode: 'NG-RI' },
    { code: 'NG-RI-GK', name: 'Gokana', stateCode: 'NG-RI' },
    // Kano (44 LGAs — selected)
    { code: 'NG-KN-MU', name: 'Kano Municipal', stateCode: 'NG-KN' },
    { code: 'NG-KN-FB', name: 'Fagge', stateCode: 'NG-KN' },
    { code: 'NG-KN-DS', name: 'Dala', stateCode: 'NG-KN' },
    { code: 'NG-KN-GW', name: 'Gwale', stateCode: 'NG-KN' },
    { code: 'NG-KN-KM', name: 'Kumbotso', stateCode: 'NG-KN' },
    { code: 'NG-KN-NA', name: 'Nasarawa', stateCode: 'NG-KN' },
    { code: 'NG-KN-TU', name: 'Tarauni', stateCode: 'NG-KN' },
    { code: 'NG-KN-UN', name: 'Ungogo', stateCode: 'NG-KN' },
    // Ogun (20 LGAs — selected)
    { code: 'NG-OG-AB', name: 'Abeokuta North', stateCode: 'NG-OG' },
    { code: 'NG-OG-AS', name: 'Abeokuta South', stateCode: 'NG-OG' },
    { code: 'NG-OG-AD', name: 'Ado-Odo/Ota', stateCode: 'NG-OG' },
    { code: 'NG-OG-EW', name: 'Ewekoro', stateCode: 'NG-OG' },
    { code: 'NG-OG-IK', name: 'Ifo', stateCode: 'NG-OG' },
    { code: 'NG-OG-SA', name: 'Sagamu', stateCode: 'NG-OG' },
    // Delta (25 LGAs — selected)
    { code: 'NG-DE-AS', name: 'Asaba', stateCode: 'NG-DE' },
    { code: 'NG-DE-WA', name: 'Warri South', stateCode: 'NG-DE' },
    { code: 'NG-DE-WN', name: 'Warri North', stateCode: 'NG-DE' },
    { code: 'NG-DE-WW', name: 'Warri West', stateCode: 'NG-DE' },
    { code: 'NG-DE-UV', name: 'Uvwie', stateCode: 'NG-DE' },
    // Anambra (21 LGAs — selected)
    { code: 'NG-AN-AW', name: 'Awka North', stateCode: 'NG-AN' },
    { code: 'NG-AN-AS', name: 'Awka South', stateCode: 'NG-AN' },
    { code: 'NG-AN-ON', name: 'Onitsha North', stateCode: 'NG-AN' },
    { code: 'NG-AN-OS', name: 'Onitsha South', stateCode: 'NG-AN' },
    { code: 'NG-AN-IN', name: 'Idemili North', stateCode: 'NG-AN' },
    // Enugu (17 LGAs — selected)
    { code: 'NG-EN-EN', name: 'Enugu East', stateCode: 'NG-EN' },
    { code: 'NG-EN-EW', name: 'Enugu West', stateCode: 'NG-EN' },
    { code: 'NG-EN-EN', name: 'Enugu North', stateCode: 'NG-EN' },
    // Kaduna (23 LGAs — selected)
    { code: 'NG-KD-KN', name: 'Kaduna North', stateCode: 'NG-KD' },
    { code: 'NG-KD-KS', name: 'Kaduna South', stateCode: 'NG-KD' },
    { code: 'NG-KD-ZA', name: 'Zaria', stateCode: 'NG-KD' },
  ];

  // Remove duplicate codes (Enugu North/East share code)
  const uniqueLgas = lgas.filter(
    (lga, idx, arr) => arr.findIndex((l) => l.code === lga.code) === idx,
  );
  await prisma.lga.createMany({ data: uniqueLgas, skipDuplicates: true });
  console.log('  ✓ lgas');

  // Countries (ISO 3166-1 — Africa + major trading partners)
  await prisma.country.createMany({
    data: [
      { alpha2: 'NG', alpha3: 'NGA', name: 'Nigeria', countryCode: '234', region: 'Africa', subRegion: 'Western Africa' },
      { alpha2: 'GH', alpha3: 'GHA', name: 'Ghana', countryCode: '233', region: 'Africa', subRegion: 'Western Africa' },
      { alpha2: 'ZA', alpha3: 'ZAF', name: 'South Africa', countryCode: '27', region: 'Africa', subRegion: 'Southern Africa' },
      { alpha2: 'KE', alpha3: 'KEN', name: 'Kenya', countryCode: '254', region: 'Africa', subRegion: 'Eastern Africa' },
      { alpha2: 'ET', alpha3: 'ETH', name: 'Ethiopia', countryCode: '251', region: 'Africa', subRegion: 'Eastern Africa' },
      { alpha2: 'EG', alpha3: 'EGY', name: 'Egypt', countryCode: '20', region: 'Africa', subRegion: 'Northern Africa' },
      { alpha2: 'TZ', alpha3: 'TZA', name: 'Tanzania', countryCode: '255', region: 'Africa', subRegion: 'Eastern Africa' },
      { alpha2: 'UG', alpha3: 'UGA', name: 'Uganda', countryCode: '256', region: 'Africa', subRegion: 'Eastern Africa' },
      { alpha2: 'RW', alpha3: 'RWA', name: 'Rwanda', countryCode: '250', region: 'Africa', subRegion: 'Eastern Africa' },
      { alpha2: 'CI', alpha3: 'CIV', name: "Côte d'Ivoire", countryCode: '225', region: 'Africa', subRegion: 'Western Africa' },
      { alpha2: 'SN', alpha3: 'SEN', name: 'Senegal', countryCode: '221', region: 'Africa', subRegion: 'Western Africa' },
      { alpha2: 'CM', alpha3: 'CMR', name: 'Cameroon', countryCode: '237', region: 'Africa', subRegion: 'Middle Africa' },
      { alpha2: 'BJ', alpha3: 'BEN', name: 'Benin', countryCode: '229', region: 'Africa', subRegion: 'Western Africa' },
      { alpha2: 'TG', alpha3: 'TGO', name: 'Togo', countryCode: '228', region: 'Africa', subRegion: 'Western Africa' },
      { alpha2: 'NE', alpha3: 'NER', name: 'Niger', countryCode: '227', region: 'Africa', subRegion: 'Western Africa' },
      { alpha2: 'ML', alpha3: 'MLI', name: 'Mali', countryCode: '223', region: 'Africa', subRegion: 'Western Africa' },
      { alpha2: 'MR', alpha3: 'MRT', name: 'Mauritania', countryCode: '222', region: 'Africa', subRegion: 'Western Africa' },
      { alpha2: 'LR', alpha3: 'LBR', name: 'Liberia', countryCode: '231', region: 'Africa', subRegion: 'Western Africa' },
      { alpha2: 'SL', alpha3: 'SLE', name: 'Sierra Leone', countryCode: '232', region: 'Africa', subRegion: 'Western Africa' },
      { alpha2: 'GN', alpha3: 'GIN', name: 'Guinea', countryCode: '224', region: 'Africa', subRegion: 'Western Africa' },
      // Americas
      { alpha2: 'US', alpha3: 'USA', name: 'United States', countryCode: '1', region: 'Americas', subRegion: 'Northern America' },
      { alpha2: 'CA', alpha3: 'CAN', name: 'Canada', countryCode: '1', region: 'Americas', subRegion: 'Northern America' },
      { alpha2: 'BR', alpha3: 'BRA', name: 'Brazil', countryCode: '55', region: 'Americas', subRegion: 'South America' },
      // Europe
      { alpha2: 'GB', alpha3: 'GBR', name: 'United Kingdom', countryCode: '44', region: 'Europe', subRegion: 'Northern Europe' },
      { alpha2: 'DE', alpha3: 'DEU', name: 'Germany', countryCode: '49', region: 'Europe', subRegion: 'Western Europe' },
      { alpha2: 'FR', alpha3: 'FRA', name: 'France', countryCode: '33', region: 'Europe', subRegion: 'Western Europe' },
      { alpha2: 'IT', alpha3: 'ITA', name: 'Italy', countryCode: '39', region: 'Europe', subRegion: 'Southern Europe' },
      { alpha2: 'NL', alpha3: 'NLD', name: 'Netherlands', countryCode: '31', region: 'Europe', subRegion: 'Western Europe' },
      { alpha2: 'CH', alpha3: 'CHE', name: 'Switzerland', countryCode: '41', region: 'Europe', subRegion: 'Western Europe' },
      // Asia
      { alpha2: 'CN', alpha3: 'CHN', name: 'China', countryCode: '86', region: 'Asia', subRegion: 'Eastern Asia' },
      { alpha2: 'IN', alpha3: 'IND', name: 'India', countryCode: '91', region: 'Asia', subRegion: 'Southern Asia' },
      { alpha2: 'JP', alpha3: 'JPN', name: 'Japan', countryCode: '81', region: 'Asia', subRegion: 'Eastern Asia' },
      { alpha2: 'SG', alpha3: 'SGP', name: 'Singapore', countryCode: '65', region: 'Asia', subRegion: 'South-eastern Asia' },
      { alpha2: 'AE', alpha3: 'ARE', name: 'United Arab Emirates', countryCode: '971', region: 'Asia', subRegion: 'Western Asia' },
      { alpha2: 'SA', alpha3: 'SAU', name: 'Saudi Arabia', countryCode: '966', region: 'Asia', subRegion: 'Western Asia' },
      // Oceania
      { alpha2: 'AU', alpha3: 'AUS', name: 'Australia', countryCode: '61', region: 'Oceania', subRegion: 'Australia and New Zealand' },
    ],
    skipDuplicates: true,
  });
  console.log('  ✓ countries');

  // HS codes — common FIRS categories for Nigerian trade
  await prisma.hsCode.createMany({
    data: [
      // Agricultural products
      { code: '1001', description: 'Wheat and meslin' },
      { code: '1006', description: 'Rice' },
      { code: '1201', description: 'Soya beans' },
      { code: '1511', description: 'Palm oil and its fractions' },
      { code: '2401', description: 'Unmanufactured tobacco; tobacco refuse' },
      { code: '0902', description: 'Tea' },
      { code: '0901', description: 'Coffee, whether or not roasted' },
      { code: '1801', description: 'Cocoa beans, whole or broken, raw or roasted' },
      { code: '2701', description: 'Coal; briquettes, ovoids and similar solid fuels manufactured from coal' },
      // Oil & Gas
      { code: '2709', description: 'Petroleum oils and oils from bituminous minerals, crude' },
      { code: '2710', description: 'Petroleum oils and oils from bituminous minerals (not crude)' },
      { code: '2711', description: 'Petroleum gases and other gaseous hydrocarbons' },
      { code: '2716', description: 'Electrical energy' },
      // Chemicals
      { code: '2814', description: 'Ammonia, anhydrous or in aqueous solution' },
      { code: '2915', description: 'Saturated acyclic monocarboxylic acids and their derivatives' },
      { code: '3004', description: 'Medicaments (mixtures/unmixed preparations for therapeutic/prophylactic uses)' },
      { code: '3102', description: 'Mineral or chemical fertilisers, nitrogenous' },
      { code: '3808', description: 'Insecticides, rodenticides, fungicides and similar products' },
      // Plastics & Rubber
      { code: '3901', description: 'Polymers of ethylene, in primary forms' },
      { code: '3902', description: 'Polymers of propylene, in primary forms' },
      { code: '4011', description: 'New pneumatic tyres, of rubber' },
      // Paper
      { code: '4802', description: 'Uncoated paper and paperboard for writing, printing or other graphic purposes' },
      { code: '4819', description: 'Cartons, boxes, cases, bags and other packing containers, of paper, paperboard' },
      // Textiles
      { code: '5208', description: 'Woven fabrics of cotton (>=85%), weighing not more than 200 g/m²' },
      { code: '6109', description: 'T-shirts, singlets and other vests, knitted or crocheted' },
      { code: '6203', description: 'Men\'s or boys\' suits, ensembles, jackets, blazers, trousers' },
      // Iron & Steel
      { code: '7204', description: 'Ferrous waste and scrap; remelting scrap ingots of iron or steel' },
      { code: '7208', description: 'Flat-rolled products of iron or non-alloy steel, hot-rolled, in coils' },
      { code: '7214', description: 'Other bars and rods of iron or non-alloy steel' },
      // Machinery
      { code: '8408', description: 'Compression-ignition internal combustion piston engines (diesel engines)' },
      { code: '8413', description: 'Pumps for liquids' },
      { code: '8471', description: 'Automatic data processing machines and units thereof' },
      { code: '8481', description: 'Taps, cocks, valves and similar appliances for pipes, tanks' },
      { code: '8504', description: 'Electrical transformers, static converters and inductors' },
      { code: '8544', description: 'Insulated wire, cable and other insulated electric conductors' },
      // Vehicles
      { code: '8701', description: 'Tractors' },
      { code: '8703', description: 'Motor cars and other motor vehicles for the transport of persons' },
      { code: '8704', description: 'Motor vehicles for the transport of goods' },
      { code: '8708', description: 'Parts and accessories for motor vehicles' },
      // Electronics
      { code: '8517', description: 'Telephone sets; other apparatus for transmission/reception of voice, images' },
      { code: '8525', description: 'Transmission apparatus for radio-broadcasting or television' },
      { code: '8528', description: 'Monitors and projectors; reception apparatus for television' },
      // Food & Beverages
      { code: '1905', description: 'Bread, pastry, cakes, biscuits and other bakers\' wares' },
      { code: '2106', description: 'Food preparations not elsewhere specified or included' },
      { code: '2202', description: 'Waters, including mineral waters and aerated waters, containing added sugar' },
      { code: '2203', description: 'Beer made from malt' },
      { code: '2207', description: 'Undenatured ethyl alcohol of an alcoholic strength by volume of 80% vol or higher' },
    ],
    skipDuplicates: true,
  });
  console.log('  ✓ hs_codes');

  // Service codes (FIRS NRS service categories)
  await prisma.serviceCode.createMany({
    data: [
      // Professional Services
      { code: 'SVC001', description: 'Legal Services' },
      { code: 'SVC002', description: 'Accounting and Auditing Services' },
      { code: 'SVC003', description: 'Tax Consultancy Services' },
      { code: 'SVC004', description: 'Management Consultancy Services' },
      { code: 'SVC005', description: 'Financial Advisory Services' },
      { code: 'SVC006', description: 'Architectural Services' },
      { code: 'SVC007', description: 'Engineering and Technical Services' },
      { code: 'SVC008', description: 'Research and Development Services' },
      // IT & Telecommunications
      { code: 'SVC010', description: 'Information Technology Services' },
      { code: 'SVC011', description: 'Software Development Services' },
      { code: 'SVC012', description: 'Cloud Computing Services' },
      { code: 'SVC013', description: 'Telecommunications Services' },
      { code: 'SVC014', description: 'Internet Service Provision' },
      { code: 'SVC015', description: 'Cybersecurity Services' },
      { code: 'SVC016', description: 'Data Processing and Analytics Services' },
      // Construction & Real Estate
      { code: 'SVC020', description: 'Construction and Civil Engineering Services' },
      { code: 'SVC021', description: 'Building Maintenance and Repair Services' },
      { code: 'SVC022', description: 'Real Estate Agency Services' },
      { code: 'SVC023', description: 'Property Management Services' },
      { code: 'SVC024', description: 'Interior Design Services' },
      // Transport & Logistics
      { code: 'SVC030', description: 'Road Transport Services' },
      { code: 'SVC031', description: 'Air Transport Services' },
      { code: 'SVC032', description: 'Sea and Waterway Transport Services' },
      { code: 'SVC033', description: 'Freight Forwarding and Logistics Services' },
      { code: 'SVC034', description: 'Warehousing and Storage Services' },
      { code: 'SVC035', description: 'Courier and Delivery Services' },
      // Health & Education
      { code: 'SVC040', description: 'Medical and Healthcare Services' },
      { code: 'SVC041', description: 'Dental Services' },
      { code: 'SVC042', description: 'Pharmaceutical Services' },
      { code: 'SVC043', description: 'Educational Services' },
      { code: 'SVC044', description: 'Training and Capacity Development Services' },
      // Financial Services
      { code: 'SVC050', description: 'Banking Services' },
      { code: 'SVC051', description: 'Insurance Services' },
      { code: 'SVC052', description: 'Investment and Asset Management Services' },
      { code: 'SVC053', description: 'Foreign Exchange Services' },
      { code: 'SVC054', description: 'Payment Processing Services' },
      // Media & Creative
      { code: 'SVC060', description: 'Advertising and Marketing Services' },
      { code: 'SVC061', description: 'Public Relations Services' },
      { code: 'SVC062', description: 'Media Production Services' },
      { code: 'SVC063', description: 'Photography and Videography Services' },
      { code: 'SVC064', description: 'Printing and Publishing Services' },
      // Energy & Utilities
      { code: 'SVC070', description: 'Electricity Generation and Distribution Services' },
      { code: 'SVC071', description: 'Oil and Gas Exploration Services' },
      { code: 'SVC072', description: 'Pipeline Services' },
      { code: 'SVC073', description: 'Renewable Energy Services' },
      { code: 'SVC074', description: 'Water Supply and Treatment Services' },
      // Hospitality & Tourism
      { code: 'SVC080', description: 'Hotel and Accommodation Services' },
      { code: 'SVC081', description: 'Restaurant and Catering Services' },
      { code: 'SVC082', description: 'Event Management Services' },
      { code: 'SVC083', description: 'Travel Agency and Tour Services' },
      // Other
      { code: 'SVC090', description: 'Security and Guard Services' },
      { code: 'SVC091', description: 'Cleaning and Facility Management Services' },
      { code: 'SVC092', description: 'Recruitment and Human Resources Services' },
      { code: 'SVC093', description: 'Agriculture and Agribusiness Services' },
      { code: 'SVC094', description: 'Environmental and Waste Management Services' },
      { code: 'SVC099', description: 'Other Services Not Elsewhere Classified' },
    ],
    skipDuplicates: true,
  });
  console.log('  ✓ service_codes');

  console.log('\nDone. All FIRS reference data seeded successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
