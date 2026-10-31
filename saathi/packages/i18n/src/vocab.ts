import type { Locale, Vocabulary } from '@saathi/contracts';

// Vocabulary packs (build.md §1): change nouns and examples, never authorization semantics.

type Nouns = { records: string; recordsCap: string; record: string; people: string; place: string; recordsObj: string };

export const VOCAB: Record<Vocabulary, Record<Locale, Nouns>> = {
  generic: {
    en: { records: 'business records', recordsCap: 'Business records', record: 'record', people: 'staff', place: 'office', recordsObj: 'business records' },
    kn: { records: 'ವ್ಯವಹಾರ ದಾಖಲೆಗಳು', recordsCap: 'ವ್ಯವಹಾರ ದಾಖಲೆಗಳು', record: 'ದಾಖಲೆ', people: 'ಸಿಬ್ಬಂದಿ', place: 'ಕಚೇರಿ', recordsObj: 'ವ್ಯವಹಾರ ದಾಖಲೆಗಳನ್ನು' },
    hi: { records: 'व्यावसायिक रिकॉर्ड', recordsCap: 'व्यावसायिक रिकॉर्ड', record: 'रिकॉर्ड', people: 'कर्मचारी', place: 'कार्यालय', recordsObj: 'व्यावसायिक रिकॉर्ड' },
  },
  clinic: {
    en: { records: 'patient records', recordsCap: 'Patient records', record: 'patient record', people: 'clinic staff', place: 'clinic', recordsObj: 'patient records' },
    kn: { records: 'ರೋಗಿಗಳ ದಾಖಲೆಗಳು', recordsCap: 'ರೋಗಿಗಳ ದಾಖಲೆಗಳು', record: 'ರೋಗಿಯ ದಾಖಲೆ', people: 'ಚಿಕಿತ್ಸಾಲಯ ಸಿಬ್ಬಂದಿ', place: 'ಚಿಕಿತ್ಸಾಲಯ', recordsObj: 'ರೋಗಿಗಳ ದಾಖಲೆಗಳನ್ನು' },
    hi: { records: 'मरीज़ों के रिकॉर्ड', recordsCap: 'मरीज़ों के रिकॉर्ड', record: 'मरीज़ का रिकॉर्ड', people: 'क्लिनिक कर्मचारी', place: 'क्लिनिक', recordsObj: 'मरीज़ों के रिकॉर्ड' },
  },
  shop: {
    en: { records: 'customer records', recordsCap: 'Customer records', record: 'customer record', people: 'shop staff', place: 'shop', recordsObj: 'customer records' },
    kn: { records: 'ಗ್ರಾಹಕರ ದಾಖಲೆಗಳು', recordsCap: 'ಗ್ರಾಹಕರ ದಾಖಲೆಗಳು', record: 'ಗ್ರಾಹಕರ ದಾಖಲೆ', people: 'ಅಂಗಡಿ ಸಿಬ್ಬಂದಿ', place: 'ಅಂಗಡಿ', recordsObj: 'ಗ್ರಾಹಕರ ದಾಖಲೆಗಳನ್ನು' },
    hi: { records: 'ग्राहक रिकॉर्ड', recordsCap: 'ग्राहक रिकॉर्ड', record: 'ग्राहक रिकॉर्ड', people: 'दुकान कर्मचारी', place: 'दुकान', recordsObj: 'ग्राहक रिकॉर्ड' },
  },
  school: {
    en: { records: 'student records', recordsCap: 'Student records', record: 'student record', people: 'school staff', place: 'school', recordsObj: 'student records' },
    kn: { records: 'ವಿದ್ಯಾರ್ಥಿ ದಾಖಲೆಗಳು', recordsCap: 'ವಿದ್ಯಾರ್ಥಿ ದಾಖಲೆಗಳು', record: 'ವಿದ್ಯಾರ್ಥಿ ದಾಖಲೆ', people: 'ಶಾಲಾ ಸಿಬ್ಬಂದಿ', place: 'ಶಾಲೆ', recordsObj: 'ವಿದ್ಯಾರ್ಥಿ ದಾಖಲೆಗಳನ್ನು' },
    hi: { records: 'छात्र रिकॉर्ड', recordsCap: 'छात्र रिकॉर्ड', record: 'छात्र रिकॉर्ड', people: 'स्कूल कर्मचारी', place: 'स्कूल', recordsObj: 'छात्र रिकॉर्ड' },
  },
  ngo: {
    en: { records: 'beneficiary records', recordsCap: 'Beneficiary records', record: 'beneficiary record', people: 'team members', place: 'organization', recordsObj: 'beneficiary records' },
    kn: { records: 'ಫಲಾನುಭವಿ ದಾಖಲೆಗಳು', recordsCap: 'ಫಲಾನುಭವಿ ದಾಖಲೆಗಳು', record: 'ಫಲಾನುಭವಿ ದಾಖಲೆ', people: 'ತಂಡದ ಸದಸ್ಯರು', place: 'ಸಂಸ್ಥೆ', recordsObj: 'ಫಲಾನುಭವಿ ದಾಖಲೆಗಳನ್ನು' },
    hi: { records: 'लाभार्थी रिकॉर्ड', recordsCap: 'लाभार्थी रिकॉर्ड', record: 'लाभार्थी रिकॉर्ड', people: 'टीम सदस्य', place: 'संस्था', recordsObj: 'लाभार्थी रिकॉर्ड' },
  },
};

export function vocabParams(vocabulary: Vocabulary, locale: Locale): Nouns {
  return (VOCAB[vocabulary] ?? VOCAB.generic)[locale] ?? VOCAB.generic.en;
}
