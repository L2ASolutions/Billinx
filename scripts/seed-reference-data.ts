/**
 * Seeds FIRS reference data tables.
 * Run with: npx tsx scripts/seed-reference-data.ts
 * Safe to re-run — uses upsert for all rows.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding FIRS reference data...');

  // Invoice types (FIRS NRS codes)
  await prisma.invoiceType.createMany({
    data: [
      { code: '380', value: 'Credit Note' },
      { code: '381', value: 'Commercial Invoice' },
      { code: '384', value: 'Debit Note' },
      { code: '385', value: 'Self Billed Invoice' },
      { code: '386', value: 'Factored Invoice' },
      { code: '388', value: 'Statement of Account' },
      { code: '389', value: 'Purchase Order' },
      { code: '390', value: 'Proforma Invoice' },
      { code: '392', value: 'Consignment Invoice' },
      { code: '393', value: 'Self-billed Credit Note' },
      { code: '394', value: 'Self-billed Invoice' },
      { code: '395', value: 'Credit Note Request' },
      { code: '396', value: 'Invoice Request' },
      { code: '397', value: 'Final Settlement' },
      { code: '399', value: 'Bill of Lading' },
      { code: '400', value: 'Waybill' },
      { code: '402', value: 'Shipping Instructions' },
      { code: '404', value: 'Certificate of Origin' },
      { code: '406', value: 'Customs Declaration' },
      { code: '408', value: 'Packing List' },
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
      { code: 'STAMP_DUTY', value: 'Stamp Duty' },
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

  // LGAs — complete official list, all 774 LGAs across 36 states + FCT
  function lgasFor(stateCode: string, names: string[]) {
    const seen = new Set<string>();
    return names.map((name) => {
      const base = name
        .replace(/[^A-Za-z]/g, '')
        .toUpperCase()
        .slice(0, 2) || 'XX';
      let code = base;
      let n = 1;
      while (seen.has(code)) {
        code = `${base[0]}${n}`;
        n++;
      }
      seen.add(code);
      return { code: `${stateCode}-${code}`, name, stateCode };
    });
  }

  const lgas = [
    ...lgasFor('NG-AB', ['Aba North', 'Aba South', 'Arochukwu', 'Bende', 'Ikwuano', 'Isiala Ngwa North', 'Isiala Ngwa South', 'Isuikwuato', 'Obi Ngwa', 'Ohafia', 'Osisioma', 'Ugwunagbo', 'Ukwa East', 'Ukwa West', 'Umuahia North', 'Umuahia South', 'Umu Nneochi']),
    ...lgasFor('NG-AD', ['Demsa', 'Fufure', 'Ganye', 'Girei', 'Gombi', 'Guyuk', 'Hong', 'Jada', 'Lamurde', 'Madagali', 'Maiha', 'Mayo-Belwa', 'Michika', 'Mubi North', 'Mubi South', 'Numan', 'Shelleng', 'Song', 'Toungo', 'Yola North', 'Yola South']),
    ...lgasFor('NG-AK', ['Abak', 'Eastern Obolo', 'Eket', 'Esit Eket', 'Essien Udim', 'Etim Ekpo', 'Etinan', 'Ibeno', 'Ibesikpo Asutan', 'Ibiono Ibom', 'Ika', 'Ikono', 'Ikot Abasi', 'Ikot Ekpene', 'Ini', 'Itu', 'Mbo', 'Mkpat Enin', 'Nsit Atai', 'Nsit Ibom', 'Nsit Ubium', 'Obot Akara', 'Okobo', 'Onna', 'Oron', 'Oruk Anam', 'Udung Uko', 'Ukanafun', 'Uruan', 'Urue-Offong/Oruko', 'Uyo']),
    ...lgasFor('NG-AN', ['Aguata', 'Anambra East', 'Anambra West', 'Anaocha', 'Awka North', 'Awka South', 'Ayamelum', 'Dunukofia', 'Ekwusigo', 'Idemili North', 'Idemili South', 'Ihiala', 'Njikoka', 'Nnewi North', 'Nnewi South', 'Ogbaru', 'Onitsha North', 'Onitsha South', 'Orumba North', 'Orumba South', 'Oyi']),
    ...lgasFor('NG-BA', ['Alkaleri', 'Bauchi', 'Bogoro', 'Damban', 'Darazo', 'Dass', 'Gamawa', 'Ganjuwa', 'Giade', "Itas/Gadau", "Jama'are", 'Katagum', 'Kirfi', 'Misau', 'Ningi', 'Shira', 'Tafawa Balewa', 'Toro', 'Warji', 'Zaki']),
    ...lgasFor('NG-BY', ['Brass', 'Ekeremor', 'Kolokuma/Opokuma', 'Nembe', 'Ogbia', 'Sagbama', 'Southern Ijaw', 'Yenagoa']),
    ...lgasFor('NG-BE', ['Ado', 'Agatu', 'Apa', 'Buruku', 'Gboko', 'Guma', 'Gwer East', 'Gwer West', 'Katsina-Ala', 'Konshisha', 'Kwande', 'Logo', 'Makurdi', 'Obi', 'Ogbadibo', 'Ohimini', 'Oju', 'Okpokwu', 'Otukpo', 'Tarka', 'Ukum', 'Ushongo', 'Vandeikya']),
    ...lgasFor('NG-BO', ['Abadam', 'Askira/Uba', 'Bama', 'Bayo', 'Biu', 'Chibok', 'Damboa', 'Dikwa', 'Gubio', 'Guzamala', 'Gwoza', 'Hawul', 'Jere', 'Kaga', 'Kala/Balge', 'Konduga', 'Kukawa', 'Kwaya Kusar', 'Mafa', 'Magumeri', 'Maiduguri', 'Marte', 'Mobbar', 'Monguno', 'Ngala', 'Nganzai', 'Shani']),
    ...lgasFor('NG-CR', ['Abi', 'Akamkpa', 'Akpabuyo', 'Bakassi', 'Bekwarra', 'Biase', 'Boki', 'Calabar Municipal', 'Calabar South', 'Etung', 'Ikom', 'Obanliku', 'Obubra', 'Obudu', 'Odukpani', 'Ogoja', 'Yakuur', 'Yala']),
    ...lgasFor('NG-DE', ['Aniocha North', 'Aniocha South', 'Bomadi', 'Burutu', 'Ethiope East', 'Ethiope West', 'Ika North East', 'Ika South', 'Isoko North', 'Isoko South', 'Ndokwa East', 'Ndokwa West', 'Okpe', 'Oshimili North', 'Oshimili South', 'Patani', 'Sapele', 'Udu', 'Ughelli North', 'Ughelli South', 'Ukwuani', 'Uvwie', 'Warri North', 'Warri South', 'Warri South West']),
    ...lgasFor('NG-EB', ['Abakaliki', 'Afikpo North', 'Afikpo South', 'Ebonyi', 'Ezza North', 'Ezza South', 'Ikwo', 'Ishielu', 'Ivo', 'Izzi', 'Ohaozara', 'Ohaukwu', 'Onicha']),
    ...lgasFor('NG-ED', ['Akoko-Edo', 'Egor', 'Esan Central', 'Esan North-East', 'Esan South-East', 'Esan West', 'Etsako Central', 'Etsako East', 'Etsako West', 'Igueben', 'Ikpoba Okha', 'Orhionmwon', 'Oredo', 'Ovia North-East', 'Ovia South-West', 'Owan East', 'Owan West', 'Uhunmwonde']),
    ...lgasFor('NG-EK', ['Ado Ekiti', 'Efon', 'Ekiti East', 'Ekiti South-West', 'Ekiti West', 'Emure', 'Gbonyin', 'Ido Osi', 'Ijero', 'Ikere', 'Ikole', 'Ilejemeje', 'Irepodun/Ifelodun', 'Ise/Orun', 'Moba', 'Oye']),
    ...lgasFor('NG-EN', ['Aninri', 'Awgu', 'Enugu East', 'Enugu North', 'Enugu South', 'Ezeagu', 'Igbo Etiti', 'Igbo Eze North', 'Igbo Eze South', 'Isi Uzo', 'Nkanu East', 'Nkanu West', 'Nsukka', 'Oji River', 'Udenu', 'Udi', 'Uzo Uwani']),
    ...lgasFor('NG-FC', ['Abaji', 'Abuja Municipal', 'Bwari', 'Gwagwalada', 'Kuje', 'Kwali']),
    ...lgasFor('NG-GO', ['Akko', 'Balanga', 'Billiri', 'Dukku', 'Funakaye', 'Gombe', 'Kaltungo', 'Kwami', 'Nafada', 'Shongom', 'Yamaltu/Deba']),
    ...lgasFor('NG-IM', ['Aboh Mbaise', 'Ahiazu Mbaise', 'Ehime Mbano', 'Ezinihitte', 'Ideato North', 'Ideato South', 'Ihitte/Uboma', 'Ikeduru', 'Isiala Mbano', 'Isu', 'Mbaitoli', 'Ngor Okpala', 'Njaba', 'Nkwerre', 'Nwangele', 'Obowo', 'Oguta', 'Ohaji/Egbema', 'Okigwe', 'Orlu', 'Orsu', 'Oru East', 'Oru West', 'Owerri Municipal', 'Owerri North', 'Owerri West', 'Unuimo']),
    ...lgasFor('NG-JI', ['Auyo', 'Babura', 'Biriniwa', 'Birnin Kudu', 'Buji', 'Dutse', 'Gagarawa', 'Garki', 'Gumel', 'Guri', 'Gwaram', 'Gwiwa', 'Hadejia', 'Jahun', 'Kafin Hausa', 'Kaugama', 'Kazaure', 'Kiri Kasama', 'Kiyawa', 'Maigatari', 'Malam Madori', 'Miga', 'Ringim', 'Roni', 'Sule Tankarkar', 'Taura', 'Yankwashi']),
    ...lgasFor('NG-KD', ['Birnin Gwari', 'Chikun', 'Giwa', 'Igabi', 'Ikara', 'Jaba', "Jema'a", 'Kachia', 'Kaduna North', 'Kaduna South', 'Kagarko', 'Kajuru', 'Kaura', 'Kauru', 'Kubau', 'Kudan', 'Lere', 'Makarfi', 'Sabon Gari', 'Sanga', 'Soba', 'Zangon Kataf', 'Zaria']),
    ...lgasFor('NG-KN', ['Ajingi', 'Albasu', 'Bagwai', 'Bebeji', 'Bichi', 'Bunkure', 'Dala', 'Dambatta', 'Dawakin Kudu', 'Dawakin Tofa', 'Doguwa', 'Fagge', 'Gabasawa', 'Garko', 'Garun Mallam', 'Gaya', 'Gezawa', 'Gwale', 'Gwarzo', 'Kabo', 'Kano Municipal', 'Karaye', 'Kibiya', 'Kiru', 'Kumbotso', 'Kunchi', 'Kura', 'Madobi', 'Makoda', 'Minjibir', 'Nasarawa', 'Rano', 'Rimin Gado', 'Rogo', 'Shanono', 'Sumaila', 'Takai', 'Tarauni', 'Tofa', 'Tsanyawa', 'Tudun Wada', 'Ungogo', 'Warawa', 'Wudil']),
    ...lgasFor('NG-KT', ['Bakori', 'Batagarawa', 'Batsari', 'Baure', 'Bindawa', 'Charanchi', 'Dandume', 'Danja', 'Dan Musa', 'Daura', 'Dutsi', "Dutsin-Ma", 'Faskari', 'Funtua', 'Ingawa', 'Jibia', 'Kafur', 'Kaita', 'Kankara', 'Kankia', 'Katsina', 'Kurfi', 'Kusada', "Mai'Adua", 'Malumfashi', 'Mani', 'Mashi', 'Matazu', 'Musawa', 'Rimi', 'Sabuwa', 'Safana', 'Sandamu', 'Zango']),
    ...lgasFor('NG-KE', ['Aleiro', 'Arewa Dandi', 'Argungu', 'Augie', 'Bagudo', 'Birnin Kebbi', 'Bunza', 'Dandi', 'Fakai', 'Gwandu', 'Jega', 'Kalgo', 'Koko/Besse', 'Maiyama', 'Ngaski', 'Sakaba', 'Shanga', 'Suru', 'Wasagu/Danko', 'Yauri', 'Zuru']),
    ...lgasFor('NG-KO', ['Adavi', 'Ajaokuta', 'Ankpa', 'Bassa', 'Dekina', 'Ibaji', 'Idah', 'Igalamela Odolu', 'Ijumu', 'Kabba/Bunu', 'Kogi', 'Lokoja', 'Mopa Muro', 'Ofu', 'Ogori/Magongo', 'Okehi', 'Okene', 'Olamaboro', 'Omala', 'Yagba East', 'Yagba West']),
    ...lgasFor('NG-KW', ['Asa', 'Baruten', 'Edu', 'Ekiti', 'Ifelodun', 'Ilorin East', 'Ilorin South', 'Ilorin West', 'Irepodun', 'Isin', 'Kaiama', 'Moro', 'Offa', 'Oke Ero', 'Oyun', 'Pategi']),
    ...lgasFor('NG-LA', ['Agege', 'Ajeromi-Ifelodun', 'Alimosho', 'Amuwo-Odofin', 'Apapa', 'Badagry', 'Epe', 'Eti-Osa', 'Ibeju-Lekki', 'Ifako-Ijaiye', 'Ikeja', 'Ikorodu', 'Isale-Eko', 'Kosofe', 'Lagos Island', 'Lagos Mainland', 'Mushin', 'Ojo', 'Oshodi-Isolo', 'Somolu']),
    ...lgasFor('NG-NA', ['Akwanga', 'Awe', 'Doma', 'Karu', 'Keana', 'Keffi', 'Kokona', 'Lafia', 'Nasarawa', 'Nasarawa Egon', 'Obi', 'Toto', 'Wamba']),
    ...lgasFor('NG-NI', ['Agaie', 'Agwara', 'Bida', 'Borgu', 'Bosso', 'Chanchaga', 'Edati', 'Gbako', 'Gurara', 'Katcha', 'Kontagora', 'Lapai', 'Lavun', 'Magama', 'Mariga', 'Mashegu', 'Mokwa', 'Moya', 'Paikoro', 'Rafi', 'Rijau', 'Shiroro', 'Suleja', 'Tafa', 'Wushishi']),
    ...lgasFor('NG-OG', ['Abeokuta North', 'Abeokuta South', 'Ado-Odo/Ota', 'Egbado North', 'Egbado South', 'Ewekoro', 'Ifo', 'Ijebu East', 'Ijebu North', 'Ijebu North East', 'Ijebu Ode', 'Ikenne', 'Imeko Afon', 'Ipokia', 'Obafemi Owode', 'Odeda', 'Odogbolu', 'Ogun Waterside', 'Remo North', 'Sagamu']),
    ...lgasFor('NG-ON', ['Akoko North-East', 'Akoko North-West', 'Akoko South-West', 'Akoko South-East', 'Akure North', 'Akure South', 'Ese Odo', 'Idanre', 'Ifedore', 'Ilaje', 'Ile Oluji/Okeigbo', 'Irele', 'Odigbo', 'Okitipupa', 'Ondo East', 'Ondo West', 'Ose', 'Owo']),
    ...lgasFor('NG-OS', ['Aiyedaade', 'Aiyedire', 'Atakunmosa East', 'Atakunmosa West', 'Boluwaduro', 'Boripe', 'Ede North', 'Ede South', 'Egbedore', 'Ejigbo', 'Ife Central', 'Ife East', 'Ife North', 'Ife South', 'Ifedayo', 'Ifelodun', 'Ila', 'Ilesa East', 'Ilesa West', 'Irepodun', 'Irewole', 'Isokan', 'Iwo', 'Obokun', 'Odo Otin', 'Ola Oluwa', 'Olorunda', 'Oriade', 'Orolu', 'Osogbo']),
    ...lgasFor('NG-OY', ['Afijio', 'Akinyele', 'Atiba', 'Atisbo', 'Egbeda', 'Ibadan North', 'Ibadan North-East', 'Ibadan North-West', 'Ibadan South-East', 'Ibadan South-West', 'Ibarapa Central', 'Ibarapa East', 'Ibarapa North', 'Ido', 'Irepo', 'Iseyin', 'Itesiwaju', 'Iwajowa', 'Kajola', 'Lagelu', 'Ogbomosho North', 'Ogbomosho South', 'Ogo Oluwa', 'Olorunsogo', 'Oluyole', 'Ona Ara', 'Orelope', 'Ori Ire', 'Oyo East', 'Oyo West', 'Saki East', 'Saki West', 'Surulere']),
    ...lgasFor('NG-PL', ['Bokkos', 'Barkin Ladi', 'Bassa', 'Jos East', 'Jos North', 'Jos South', 'Kanam', 'Kanke', 'Langtang North', 'Langtang South', 'Mangu', 'Mikang', 'Pankshin', "Qua'an Pan", 'Riyom', 'Shendam', 'Wase']),
    ...lgasFor('NG-RI', ['Abua/Odual', 'Ahoada East', 'Ahoada West', 'Akuku-Toru', 'Andoni', 'Asari-Toru', 'Bonny', 'Degema', 'Eleme', 'Emohua', 'Etche', 'Gokana', 'Ikwerre', 'Khana', 'Obio/Akpor', 'Ogba/Egbema/Ndoni', 'Ogu/Bolo', 'Okrika', 'Omuma', 'Opobo/Nkoro', 'Oyigbo', 'Port Harcourt', 'Tai']),
    ...lgasFor('NG-SO', ['Binji', 'Bodinga', 'Dange Shuni', 'Gada', 'Goronyo', 'Gudu', 'Gwadabawa', 'Illela', 'Isa', 'Kebbe', 'Kware', 'Rabah', 'Sabon Birni', 'Shagari', 'Silame', 'Sokoto North', 'Sokoto South', 'Tambuwal', 'Tangaza', 'Tureta', 'Wamako', 'Wurno', 'Yabo']),
    ...lgasFor('NG-TA', ['Ardo Kola', 'Bali', 'Donga', 'Gashaka', 'Gassol', 'Ibi', 'Jalingo', 'Karim Lamido', 'Kurmi', 'Lau', 'Sardauna', 'Takum', 'Ussa', 'Wukari', 'Yorro', 'Zing']),
    ...lgasFor('NG-YO', ['Bade', 'Bursari', 'Damaturu', 'Fika', 'Fune', 'Geidam', 'Gujba', 'Gulani', 'Jakusko', 'Karasuwa', 'Machina', 'Nangere', 'Nguru', 'Potiskum', 'Tarmuwa', 'Yunusari', 'Yusufari']),
    ...lgasFor('NG-ZA', ['Anka', 'Bakura', 'Birnin Magaji/Kiyaw', 'Bukkuyum', 'Bungudu', 'Gummi', 'Gusau', 'Kaura Namoda', 'Maradun', 'Maru', 'Shinkafi', 'Talata Mafara', 'Tsafe', 'Zurmi']),
  ];

  await prisma.lga.createMany({ data: lgas, skipDuplicates: true });
  console.log(`  ✓ lgas (${lgas.length})`);

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

  // Service codes (ISIC Rev.4 — Nigerian business activities)
  await prisma.serviceCode.createMany({
    data: [
      { code: '0111', description: 'Growing of cereals' },
      { code: '0112', description: 'Growing of rice' },
      { code: '4100', description: 'Construction of buildings' },
      { code: '4210', description: 'Construction of roads and railways' },
      { code: '4520', description: 'Building installation' },
      { code: '4540', description: 'Building completion and finishing' },
      { code: '4610', description: 'Wholesale on a fee or contract basis' },
      { code: '4620', description: 'Wholesale of agricultural raw materials' },
      { code: '4630', description: 'Wholesale of food, beverages and tobacco' },
      { code: '4641', description: 'Wholesale of textiles, clothing and footwear' },
      { code: '4649', description: 'Wholesale of other household goods' },
      { code: '4651', description: 'Wholesale of computers and equipment' },
      { code: '4659', description: 'Wholesale of other machinery' },
      { code: '4690', description: 'Non-specialised wholesale trade' },
      { code: '4711', description: 'Retail sale in non-specialised stores' },
      { code: '4719', description: 'Other retail sale in non-specialised stores' },
      { code: '4720', description: 'Retail sale of food in specialised stores' },
      { code: '4730', description: 'Retail sale of fuel' },
      { code: '4741', description: 'Retail sale of computers and software' },
      { code: '4742', description: 'Retail sale of telecommunications equipment' },
      { code: '4751', description: 'Retail sale of textiles' },
      { code: '4761', description: 'Retail sale of books' },
      { code: '4771', description: 'Retail sale of clothing' },
      { code: '4772', description: 'Retail sale of footwear' },
      { code: '4781', description: 'Retail sale of food via stalls and markets' },
      { code: '4791', description: 'Retail sale via mail order or internet' },
      { code: '4799', description: 'Other retail sale not in stores' },
      { code: '4911', description: 'Passenger rail transport' },
      { code: '4921', description: 'Urban and suburban passenger transport' },
      { code: '4922', description: 'Other passenger land transport' },
      { code: '4923', description: 'Freight transport by road' },
      { code: '5011', description: 'Sea and coastal passenger water transport' },
      { code: '5012', description: 'Sea and coastal freight water transport' },
      { code: '5110', description: 'Passenger air transport' },
      { code: '5120', description: 'Freight air transport' },
      { code: '5210', description: 'Warehousing and storage' },
      { code: '5221', description: 'Service activities for road transport' },
      { code: '5222', description: 'Service activities for water transport' },
      { code: '5223', description: 'Service activities for air transport' },
      { code: '5224', description: 'Cargo handling' },
      { code: '5229', description: 'Other transportation support' },
      { code: '5310', description: 'Postal activities' },
      { code: '5320', description: 'Courier activities' },
      { code: '5510', description: 'Short term accommodation activities' },
      { code: '5520', description: 'Camping grounds and recreational facilities' },
      { code: '5590', description: 'Other accommodation' },
      { code: '5610', description: 'Restaurants and mobile food service' },
      { code: '5621', description: 'Event catering activities' },
      { code: '5629', description: 'Other food service activities' },
      { code: '5630', description: 'Beverage serving activities' },
      { code: '5811', description: 'Book publishing' },
      { code: '5812', description: 'Publishing of directories' },
      { code: '5813', description: 'Publishing of newspapers' },
      { code: '5814', description: 'Publishing of journals and periodicals' },
      { code: '5819', description: 'Other publishing activities' },
      { code: '5820', description: 'Software publishing' },
      { code: '5911', description: 'Motion picture production' },
      { code: '5912', description: 'Motion picture post-production' },
      { code: '5913', description: 'Motion picture distribution' },
      { code: '5914', description: 'Motion picture projection activities' },
      { code: '5920', description: 'Sound recording and music publishing' },
      { code: '6010', description: 'Radio broadcasting' },
      { code: '6020', description: 'Television programming and broadcasting' },
      { code: '6110', description: 'Wired telecommunications activities' },
      { code: '6120', description: 'Wireless telecommunications activities' },
      { code: '6130', description: 'Satellite telecommunications activities' },
      { code: '6190', description: 'Other telecommunications activities' },
      { code: '6201', description: 'Computer programming activities' },
      { code: '6202', description: 'Computer consultancy activities' },
      { code: '6203', description: 'Computer facilities management' },
      { code: '6209', description: 'Other information technology service' },
      { code: '6311', description: 'Data processing and hosting activities' },
      { code: '6312', description: 'Web portals' },
      { code: '6391', description: 'News agency activities' },
      { code: '6399', description: 'Other information service activities' },
      { code: '6411', description: 'Central banking' },
      { code: '6419', description: 'Other monetary intermediation' },
      { code: '6420', description: 'Activities of holding companies' },
      { code: '6430', description: 'Trusts, funds and similar entities' },
      { code: '6491', description: 'Financial leasing' },
      { code: '6492', description: 'Other credit granting' },
      { code: '6499', description: 'Other financial service activities' },
      { code: '6511', description: 'Life insurance' },
      { code: '6512', description: 'Non-life insurance' },
      { code: '6520', description: 'Reinsurance' },
      { code: '6530', description: 'Pension funding' },
      { code: '6611', description: 'Administration of financial markets' },
      { code: '6612', description: 'Security and commodity contracts brokerage' },
      { code: '6619', description: 'Other auxiliary financial activities' },
      { code: '6621', description: 'Risk and damage evaluation' },
      { code: '6622', description: 'Insurance agents and brokers' },
      { code: '6629', description: 'Other auxiliary insurance activities' },
      { code: '6630', description: 'Fund management activities' },
      { code: '6810', description: 'Real estate activities with own property' },
      { code: '6820', description: 'Real estate activities on a fee basis' },
      { code: '6910', description: 'Legal activities' },
      { code: '6920', description: 'Accounting and auditing activities' },
      { code: '7010', description: 'Activities of head offices' },
      { code: '7020', description: 'Management consultancy activities' },
      { code: '7110', description: 'Architectural and engineering activities' },
      { code: '7120', description: 'Technical testing and analysis' },
      { code: '7210', description: 'Research and development' },
      { code: '7310', description: 'Advertising agencies' },
      { code: '7320', description: 'Market research and opinion polling' },
      { code: '7410', description: 'Specialised design activities' },
      { code: '7420', description: 'Photographic activities' },
      { code: '7490', description: 'Other professional activities' },
      { code: '7500', description: 'Veterinary activities' },
      { code: '7710', description: 'Renting of motor vehicles' },
      { code: '7720', description: 'Renting of personal goods' },
      { code: '7730', description: 'Renting of machinery and equipment' },
      { code: '7740', description: 'Leasing of intellectual property' },
      { code: '7810', description: 'Activities of employment placement agencies' },
      { code: '7820', description: 'Temporary employment agency activities' },
      { code: '7830', description: 'Human resources provision' },
      { code: '7911', description: 'Travel agency activities' },
      { code: '7912', description: 'Tour operator activities' },
      { code: '7990', description: 'Other reservation service activities' },
      { code: '8010', description: 'Private security activities' },
      { code: '8020', description: 'Security systems service activities' },
      { code: '8030', description: 'Investigation activities' },
      { code: '8110', description: 'Combined facilities support activities' },
      { code: '8121', description: 'General cleaning of buildings' },
      { code: '8122', description: 'Other building cleaning activities' },
      { code: '8129', description: 'Other cleaning activities' },
      { code: '8130', description: 'Landscape service activities' },
      { code: '8211', description: 'Combined office administrative activities' },
      { code: '8219', description: 'Photocopying and other office activities' },
      { code: '8220', description: 'Activities of call centres' },
      { code: '8230', description: 'Organisation of conventions and trade shows' },
      { code: '8291', description: 'Activities of collection agencies' },
      { code: '8292', description: 'Packaging activities' },
      { code: '8299', description: 'Other business support activities' },
      { code: '8411', description: 'General public administration' },
      { code: '8412', description: 'Regulation of health care' },
      { code: '8413', description: 'Regulation of business activities' },
      { code: '8421', description: 'Foreign affairs' },
      { code: '8422', description: 'Defence activities' },
      { code: '8423', description: 'Justice and judicial activities' },
      { code: '8424', description: 'Public order and safety activities' },
      { code: '8425', description: 'Fire service activities' },
      { code: '8430', description: 'Compulsory social security activities' },
      { code: '8510', description: 'Pre-primary education' },
      { code: '8520', description: 'Primary education' },
      { code: '8531', description: 'General secondary education' },
      { code: '8532', description: 'Technical and vocational education' },
      { code: '8541', description: 'Post-secondary non-tertiary education' },
      { code: '8542', description: 'Tertiary education' },
      { code: '8549', description: 'Other education' },
      { code: '8550', description: 'Educational support services' },
      { code: '8610', description: 'Hospital activities' },
      { code: '8620', description: 'Medical and dental practice activities' },
      { code: '8690', description: 'Other human health activities' },
      { code: '8710', description: 'Residential nursing care activities' },
      { code: '8720', description: 'Residential care for mental health' },
      { code: '8730', description: 'Residential care for elderly' },
      { code: '8790', description: 'Other residential care activities' },
      { code: '8810', description: 'Social work without accommodation' },
      { code: '8890', description: 'Other social work without accommodation' },
      { code: '9000', description: 'Creative arts and entertainment' },
      { code: '9001', description: 'Performing arts' },
      { code: '9002', description: 'Support activities for performing arts' },
      { code: '9003', description: 'Artistic creation' },
      { code: '9004', description: 'Operation of arts facilities' },
      { code: '9101', description: 'Library and archive activities' },
      { code: '9102', description: 'Museums activities' },
      { code: '9103', description: 'Historic sites activities' },
      { code: '9104', description: 'Botanical and zoological gardens' },
      { code: '9200', description: 'Gambling and betting activities' },
      { code: '9311', description: 'Operation of sports facilities' },
      { code: '9312', description: 'Activities of sports clubs' },
      { code: '9319', description: 'Other sports activities' },
      { code: '9321', description: 'Activities of amusement parks' },
      { code: '9329', description: 'Other amusement and recreation activities' },
      { code: '9411', description: 'Activities of business membership organisations' },
      { code: '9412', description: 'Activities of professional membership organisations' },
      { code: '9420', description: 'Activities of trade unions' },
      { code: '9491', description: 'Activities of religious organisations' },
      { code: '9492', description: 'Activities of political organisations' },
      { code: '9499', description: 'Activities of other organisations' },
      { code: '9511', description: 'Repair of computers' },
      { code: '9512', description: 'Repair of communication equipment' },
      { code: '9521', description: 'Repair of consumer electronics' },
      { code: '9522', description: 'Repair of household appliances' },
      { code: '9523', description: 'Repair of footwear and leather goods' },
      { code: '9524', description: 'Repair of furniture' },
      { code: '9529', description: 'Repair of other personal goods' },
      { code: '9601', description: 'Washing and dry cleaning' },
      { code: '9602', description: 'Hairdressing and beauty treatment' },
      { code: '9603', description: 'Funeral and related activities' },
      { code: '9609', description: 'Other personal service activities' },
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
