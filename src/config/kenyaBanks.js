// Licensed Kenyan commercial banks — drives the Bank Name dropdown in the HR
// employee form. Kept alphabetical so a name is easy to find.
export const KENYA_BANKS = [
  'Absa Bank Kenya',
  'Access Bank Kenya',
  'Bank of Africa',
  'Bank of Baroda',
  'Bank of India',
  'Citibank',
  'Consolidated Bank',
  'Co-operative Bank',
  'Credit Bank',
  'Development Bank of Kenya',
  'Diamond Trust Bank (DTB)',
  'Ecobank',
  'Equity Bank',
  'Family Bank',
  'First Community Bank',
  'Guaranty Trust Bank (GTBank)',
  'Gulf African Bank',
  'Housing Finance (HFC)',
  'I&M Bank',
  'KCB Bank',
  'Kingdom Bank',
  'Middle East Bank',
  'NCBA Bank',
  'National Bank of Kenya',
  'Paramount Bank',
  'Prime Bank',
  'SBM Bank Kenya',
  'Sidian Bank',
  'Stanbic Bank',
  'Standard Chartered Bank',
  'UBA Kenya',
  'Victoria Commercial Bank',
];

// Branches of each bank, keyed by the exact bank names above. Used as the
// dependent Branch dropdown: pick a bank first, then one of its branches.
//
// These are the main branches, not a full register — banks open and close
// branches all the time. The form therefore always offers "Other (not
// listed)" so a missing branch can be typed rather than blocking the save.
const RAW_BRANCHES = {
  'Absa Bank Kenya': [
    'Buruburu', 'Eastleigh', 'Hurlingham', 'Industrial Area', 'Karen', 'Moi Avenue',
    'Queensway', 'Sarit Centre', 'The Junction', 'Upper Hill', 'Village Market',
    'Westlands', 'Yaya Centre',
    'Bungoma', 'Eldoret', 'Embu', 'Kakamega', 'Kericho', 'Kisii', 'Kisumu', 'Kitale',
    'Machakos', 'Malindi', 'Meru', 'Mombasa', 'Naivasha', 'Nakuru', 'Nanyuki',
    'Nyali', 'Nyeri', 'Thika',
  ],
  'Access Bank Kenya': [
    'Head Office', 'Industrial Area', 'Westlands',
    'Bomet', 'Eldoret', 'Kapsabet', 'Kericho', 'Kisumu', 'Kitale', 'Mombasa', 'Nakuru', 'Narok',
  ],
  'Bank of Africa': [
    'Industrial Area', 'Koinange Street', 'Ngong Road', 'River Road', 'Upper Hill', 'Westlands',
    'Eldoret', 'Kisumu', 'Kitale', 'Malindi', 'Meru', 'Mombasa', 'Nakuru', 'Thika',
  ],
  'Bank of Baroda': [
    'Industrial Area', 'Nairobi Main', 'Sarit Centre',
    'Eldoret', 'Kakamega', 'Kisumu', 'Mombasa – Digo Road', 'Mombasa – Nyali', 'Nakuru', 'Thika',
  ],
  'Bank of India': [
    'Industrial Area', 'Kenyatta Avenue', 'Westlands',
    'Kisumu', 'Mombasa',
  ],
  'Citibank': [
    'Upper Hill', 'Mombasa',
  ],
  'Consolidated Bank': [
    'Head Office', 'Industrial Area',
    'Embu', 'Isiolo', 'Maua', 'Meru', 'Mombasa', "Murang'a", 'Nyeri', 'Thika',
  ],
  'Co-operative Bank': [
    'Buruburu', 'Co-op House', 'Eastleigh', 'Industrial Area', 'Karen', 'Stima Plaza',
    'Ukulima', 'University Way', 'Upper Hill', 'Westlands',
    'Bungoma', 'Busia', 'Chuka', 'Eldoret', 'Embu', 'Garissa', 'Homa Bay', 'Isiolo',
    'Kakamega', 'Kapsabet', 'Karatina', 'Kericho', 'Kerugoya', 'Kiambu', 'Kilifi',
    'Kisii', 'Kisumu', 'Kitale', 'Kitengela', 'Kitui', 'Machakos', 'Malindi', 'Meru',
    'Migori', 'Mombasa', "Murang'a", 'Naivasha', 'Nakuru', 'Nanyuki', 'Narok',
    'Nyahururu', 'Nyamira', 'Nyeri', 'Ruiru', 'Siaya', 'Thika', 'Voi', 'Webuye',
  ],
  'Credit Bank': [
    'Head Office', 'Westlands',
    'Eldoret', 'Kisii', 'Kisumu', 'Kitengela', 'Machakos', 'Mombasa', 'Nakuru', 'Thika',
  ],
  'Development Bank of Kenya': [
    'Head Office – Finance House', 'Mombasa',
  ],
  'Diamond Trust Bank (DTB)': [
    'Buruburu', 'Capital Centre', 'Eastleigh', 'Industrial Area', 'Karen', 'Moi Avenue',
    'Nation Centre', 'Parklands', 'Prestige Plaza', 'Sarit Centre', 'Village Market', 'Westgate',
    'Bungoma', 'Busia', 'Eldoret', 'Garissa', 'Kakamega', 'Kisii', 'Kisumu', 'Kitale',
    'Machakos', 'Malindi', 'Meru', 'Mombasa', 'Mtwapa', 'Naivasha', 'Nakuru', 'Nanyuki',
    'Nyali', 'Thika',
  ],
  'Ecobank': [
    'Ecobank Towers', 'Upper Hill', 'Westlands',
    'Eldoret', 'Kisumu', 'Mombasa', 'Nakuru',
  ],
  'Equity Bank': [
    'Buruburu', 'Community', 'Eastleigh', 'Embakasi', 'Githurai', 'Industrial Area',
    'Kangemi', 'Karen', 'Kariobangi', 'Kasarani', 'Kawangware', 'Kayole',
    'Kenyatta Avenue', 'Tom Mboya', 'Upper Hill', 'Westlands',
    'Bomet', 'Bungoma', 'Busia', 'Chuka', 'Eldoret', 'Embu', 'Garissa', 'Homa Bay',
    'Isiolo', 'Iten', 'Kabarnet', 'Kajiado', 'Kakamega', 'Kapenguria', 'Kapsabet',
    'Karatina', 'Kericho', 'Kerugoya', 'Kiambu', 'Kikuyu', 'Kilifi', 'Kisii', 'Kisumu',
    'Kitale', 'Kitengela', 'Kitui', 'Kwale', 'Lamu', 'Limuru', 'Lodwar', 'Machakos',
    'Malindi', 'Mandera', 'Maralal', 'Marsabit', 'Meru', 'Migori', 'Mombasa', 'Moyale',
    "Murang'a", 'Naivasha', 'Nakuru', 'Nanyuki', 'Narok', 'Nyahururu', 'Nyamira',
    'Nyeri', 'Ol Kalou', 'Ongata Rongai', 'Ruiru', 'Siaya', 'Thika', 'Voi', 'Wajir',
    'Webuye', 'Wote',
  ],
  'Family Bank': [
    'Eastleigh', 'Family Bank Towers', 'Githurai', 'Kariobangi', 'Kayole', 'Moi Avenue', 'Westlands',
    'Eldoret', 'Embu', 'Githunguri', 'Kakamega', 'Karatina', 'Kerugoya', 'Kiambu',
    'Kikuyu', 'Kisii', 'Kisumu', 'Kitale', 'Kitengela', 'Limuru', 'Machakos', 'Meru',
    'Mombasa', "Murang'a", 'Naivasha', 'Nakuru', 'Nanyuki', 'Nyahururu', 'Nyeri',
    'Ruiru', 'Thika',
  ],
  'First Community Bank': [
    'Eastleigh', 'Head Office – Wabera Street',
    'Garissa', 'Isiolo', 'Lamu', 'Malindi', 'Mandera', 'Mombasa', 'Moyale', 'Wajir',
  ],
  'Guaranty Trust Bank (GTBank)': [
    'Industrial Area', 'Kenyatta Avenue', 'Westlands',
    'Eldoret', 'Kisumu', 'Mombasa', 'Nakuru', 'Thika',
  ],
  'Gulf African Bank': [
    'Eastleigh', 'Upper Hill', 'Westlands',
    'Garissa', 'Lamu', 'Malindi', 'Mombasa',
  ],
  'Housing Finance (HFC)': [
    'Buruburu', 'Karen', 'Rehani House', 'Thika Road Mall', 'Westlands',
    'Eldoret', 'Kisumu', 'Meru', 'Mombasa', 'Nakuru', 'Nyali', 'Nyeri', 'Thika',
  ],
  'I&M Bank': [
    'Gigiri', 'I&M Bank House', 'Industrial Area', 'Karen', 'Kenyatta Avenue', 'Lavington',
    'Riverside', 'Sarit Centre', 'Village Market', 'Westlands', 'Yaya Centre',
    'Eldoret', 'Kericho', 'Kisii', 'Kisumu', 'Kitale', 'Malindi', 'Mombasa', 'Naivasha',
    'Nakuru', 'Nanyuki', 'Nyali', 'Thika',
  ],
  'KCB Bank': [
    'Buruburu', 'Eastleigh', 'Industrial Area', 'JKIA', 'Jogoo Road', 'Karen', 'Kariobangi',
    'Kawangware', 'Kencom House', 'Kipande House', 'Moi Avenue', 'Sarit Centre',
    'Thika Road Mall', 'Upper Hill', 'Village Market', 'Westlands',
    'Athi River', 'Bomet', 'Bungoma', 'Busia', 'Chuka', 'Eldoret', 'Embu', 'Garissa',
    'Hola', 'Homa Bay', 'Isiolo', 'Iten', 'Kabarnet', 'Kajiado', 'Kakamega', 'Kapenguria',
    'Kapsabet', 'Kericho', 'Kerugoya', 'Kiambu', 'Kilifi', 'Kisii', 'Kisumu', 'Kitale',
    'Kitengela', 'Kitui', 'Kwale', 'Lamu', 'Lodwar', 'Machakos', 'Malindi', 'Mandera',
    'Maralal', 'Marsabit', 'Meru', 'Migori', 'Mombasa', 'Moyale', "Murang'a", 'Naivasha',
    'Nakuru', 'Nanyuki', 'Narok', 'Nyahururu', 'Nyamira', 'Nyeri', 'Ol Kalou', 'Ruiru',
    'Siaya', 'Thika', 'Voi', 'Wajir', 'Webuye', 'Wote',
  ],
  'Kingdom Bank': [
    'Head Office',
    'Eldoret', 'Kisumu', 'Kitengela', 'Machakos', 'Mombasa', 'Nakuru', 'Ruiru', 'Thika',
  ],
  'Middle East Bank': [
    'Head Office', 'Industrial Area',
    'Mombasa',
  ],
  'NCBA Bank': [
    'City Centre', 'Eastleigh', 'Galleria', 'Gigiri', 'Industrial Area', 'Karen', 'Kitengela',
    'Lavington', 'NCBA Centre – Upper Hill', 'Sarit Centre', 'The Junction',
    'Thika Road Mall', 'Two Rivers', 'Village Market', 'Westlands', 'Yaya Centre',
    'Eldoret', 'Kakamega', 'Kisii', 'Kisumu', 'Kitale', 'Machakos', 'Malindi', 'Meru',
    'Mombasa', 'Naivasha', 'Nakuru', 'Nanyuki', 'Nyali', 'Nyeri', 'Thika',
  ],
  'National Bank of Kenya': [
    'Eastleigh', 'Harambee Avenue', 'Hill', 'Industrial Area', 'Westlands',
    'Bungoma', 'Busia', 'Eldoret', 'Embu', 'Garissa', 'Homa Bay', 'Isiolo', 'Kakamega',
    'Kericho', 'Kiambu', 'Kisii', 'Kisumu', 'Kitale', 'Kitui', 'Lodwar', 'Machakos',
    'Malindi', 'Mandera', 'Meru', 'Mombasa', 'Nakuru', 'Nanyuki', 'Narok', 'Nyeri',
    'Thika', 'Voi', 'Wajir',
  ],
  'Paramount Bank': [
    'Industrial Area', 'Parklands', 'Westlands',
    'Mombasa',
  ],
  'Prime Bank': [
    'Capital Centre', 'Industrial Area', 'Karen', 'Kenindia House', 'Parklands',
    'Riverside Drive', 'Westlands',
    'Eldoret', 'Kisii', 'Kisumu', 'Mombasa', 'Nakuru', 'Nyali', 'Thika',
  ],
  'SBM Bank Kenya': [
    'Eastleigh', 'Industrial Area', 'Riverside', 'Upper Hill', 'Westlands',
    'Eldoret', 'Kisii', 'Kisumu', 'Kitale', 'Malindi', 'Mombasa', 'Nakuru', 'Nyeri', 'Thika',
  ],
  'Sidian Bank': [
    'Industrial Area', 'Kenyatta Avenue', 'Westlands',
    'Eldoret', 'Embu', 'Karatina', 'Kisii', 'Kisumu', 'Kitengela', 'Machakos', 'Meru',
    'Mombasa', "Murang'a", 'Nakuru', 'Nyeri', 'Thika',
  ],
  'Stanbic Bank': [
    'Chiromo', 'Gateway Mall', 'Industrial Area', 'Kenyatta Avenue', 'The Hub Karen',
    'Upper Hill', 'Warwick Centre', 'Westlands',
    'Eldoret', 'Kisumu', 'Kitale', 'Meru', 'Mombasa', 'Naivasha', 'Nakuru', 'Nanyuki',
    'Nyali', 'Thika',
  ],
  'Standard Chartered Bank': [
    'Chiromo', 'Eastleigh', 'Harambee Avenue', 'Industrial Area', 'Karen', 'Kenyatta Avenue',
    'Moi Avenue', 'Ruaraka', 'Sarit Centre', 'Upper Hill', 'Village Market', 'Westlands',
    'Yaya Centre',
    'Eldoret', 'Kericho', 'Kisii', 'Kisumu', 'Kitale', 'Malindi', 'Mombasa', 'Nakuru',
    'Nanyuki', 'Nyali', 'Nyeri', 'Thika',
  ],
  'UBA Kenya': [
    'Upper Hill', 'Westlands',
    'Mombasa',
  ],
  'Victoria Commercial Bank': [
    'Head Office',
    'Kisumu', 'Mombasa',
  ],
};

// Sorted here once so the source lists can stay grouped (city areas, then
// towns) for review while the dropdown always reads alphabetically.
export const BRANCHES_BY_BANK = Object.fromEntries(
  Object.entries(RAW_BRANCHES).map(([bank, branches]) => [
    bank,
    [...branches].sort((a, b) => a.localeCompare(b)),
  ]),
);

export const branchesFor = (bank) => BRANCHES_BY_BANK[bank] || [];
