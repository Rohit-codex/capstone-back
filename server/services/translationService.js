import axios from 'axios';

// All Indian languages supported by Google Translate + Kaithi & Devanagari
export const INDIAN_LANGUAGES = {
  "1":  { name: "Hindi", code: "hi" },
  "2":  { name: "Bengali", code: "bn" },
  "3":  { name: "Telugu", code: "te" },
  "4":  { name: "Marathi", code: "mr" },
  "5":  { name: "Tamil", code: "ta" },
  "6":  { name: "Urdu", code: "ur" },
  "7":  { name: "Gujarati", code: "gu" },
  "8":  { name: "Kannada", code: "kn" },
  "9":  { name: "Odia", code: "or" },
  "10": { name: "Punjabi", code: "pa" },
  "11": { name: "Malayalam", code: "ml" },
  "12": { name: "Assamese", code: "as" },
  "13": { name: "Maithili", code: "mai" },
  "14": { name: "Sanskrit", code: "sa" },
  "15": { name: "Nepali", code: "ne" },
  "16": { name: "Sindhi", code: "sd" },
  "17": { name: "Konkani", code: "gom" },
  "18": { name: "Dogri", code: "doi" },
  "19": { name: "Manipuri", code: "mni-Mtei" },
  "20": { name: "Mizo", code: "lus" },
  "21": { name: "Bodo", code: "brx" },
  "22": { name: "Kashmiri", code: "ks" },
  "23": { name: "Kaithi (transliterated)", code: "kaithi" },
  "24": { name: "Devanagari script", code: "devanagari" }
};

export const DEVANAGARI_TO_KAITHI = {
  "अ": "\u{11083}", "आ": "\u{11084}", "इ": "\u{11085}", "ई": "\u{11086}",
  "उ": "\u{11087}", "ऊ": "\u{11088}", "ए": "\u{11089}", "ऐ": "\u{1108A}",
  "ओ": "\u{1108B}", "औ": "\u{1108C}",
  "ं": "\u{11081}", "ः": "\u{11082}", "ँ": "\u{11080}",
  "क": "\u{1108E}", "ख": "\u{1108F}", "ग": "\u{11090}", "घ": "\u{11091}",
  "ङ": "\u{11092}", "च": "\u{11093}", "छ": "\u{11094}", "ज": "\u{11095}",
  "झ": "\u{11096}", "ञ": "\u{11097}", "ट": "\u{11098}", "ठ": "\u{11099}",
  "ड": "\u{1109A}", "ढ": "\u{1109B}", "ण": "\u{1109C}", "त": "\u{1109D}",
  "थ": "\u{1109E}", "द": "\u{1109F}", "ध": "\u{110A0}", "न": "\u{110A1}",
  "प": "\u{110A2}", "फ": "\u{110A3}", "ब": "\u{110A4}", "भ": "\u{110A5}",
  "म": "\u{110A6}", "य": "\u{110A7}", "र": "\u{110A8}", "ल": "\u{110A9}",
  "व": "\u{110AA}", "श": "\u{110AB}", "ष": "\u{110AC}", "स": "\u{110AD}",
  "ह": "\u{110AE}",
  "़": "\u{1108D}",
  "ा": "\u{110B0}", "ि": "\u{110B1}", "ी": "\u{110B2}", "ु": "\u{110B3}",
  "ू": "\u{110B4}", "े": "\u{110B5}", "ै": "\u{110B6}", "ो": "\u{110B7}",
  "ौ": "\u{110B8}",
  "्": "\u{110B9}",
  "।": "\u{110BE}", "॥": "\u{110BF}",
  "०": "\u{110F0}", "१": "\u{110F1}", "२": "\u{110F2}", "३": "\u{110F3}",
  "४": "\u{110F4}", "५": "\u{110F5}", "६": "\u{110F6}", "७": "\u{110F7}",
  "८": "\u{110F8}", "९": "\u{110F9}"
};

export const KAITHI_TO_DEVANAGARI = Object.fromEntries(
  Object.entries(DEVANAGARI_TO_KAITHI).map(([k, v]) => [v, k])
);

export function transliterateDevanagariToKaithi(hindiText = '') {
  return Array.from(hindiText)
    .map(ch => DEVANAGARI_TO_KAITHI[ch] || ch)
    .join('');
}

export function transliterateKaithiToDevanagari(kaithiText = '') {
  const chars = Array.from(kaithiText);
  return chars
    .map(ch => {
      if (KAITHI_TO_DEVANAGARI[ch]) return KAITHI_TO_DEVANAGARI[ch];
      const code = ch.codePointAt(0);
      if (code >= 0x11080 && code <= 0x110CF) return ''; // Drop unmapped Kaithi glyphs
      return ch;
    })
    .join('');
}

export async function translateSingleText(text, sourceLang = 'auto', targetLang = 'hi') {
  if (!text || !text.trim()) return '';
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sourceLang)}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await axios.get(url, { timeout: 15000 });
    if (response.data && Array.isArray(response.data[0])) {
      return response.data[0].map(item => item[0]).filter(Boolean).join('');
    }
    return text;
  } catch (err) {
    console.warn(`Translation fetch failed (${sourceLang} -> ${targetLang}):`, err.message);
    return text;
  }
}

export async function translateText(text, langCode = 'hi', direction = 'to_indian') {
  if (!text || !text.trim()) return '';

  if (direction === 'to_hindi') {
    if (langCode === 'kaithi') {
      return transliterateKaithiToDevanagari(text);
    }
    if (langCode === 'devanagari') {
      return text;
    }
    if (langCode === 'fa') {
      return await translateSingleText(text, 'fa', 'hi');
    }
    return text;
  }

  if (direction === 'to_indian') {
    if (langCode === 'kaithi') {
      const hindiText = await translateSingleText(text, 'en', 'hi');
      return transliterateDevanagariToKaithi(hindiText);
    }
    if (langCode === 'devanagari') {
      return await translateSingleText(text, 'en', 'hi');
    }
    return await translateSingleText(text, 'en', langCode);
  }

  // direction === 'to_english'
  if (langCode === 'kaithi') {
    const hindiText = transliterateKaithiToDevanagari(text);
    return await translateSingleText(hindiText, 'hi', 'en');
  }
  if (langCode === 'devanagari') {
    return await translateSingleText(text, 'hi', 'en');
  }
  return await translateSingleText(text, langCode, 'en');
}

export async function translateDocumentText({ text, langCode = 'hi', direction = 'to_indian' }) {
  if (!text) return { originalText: '', translatedText: '' };
  
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
  const translatedParas = [];

  for (const para of paragraphs) {
    const lines = para.split('\n');
    const translatedLines = [];
    for (const line of lines) {
      if (!line.trim()) {
        translatedLines.push('');
        continue;
      }
      const trans = await translateText(line, langCode, direction);
      translatedLines.push(trans);
    }
    translatedParas.push(translatedLines.join('\n'));
  }

  const translatedText = translatedParas.join('\n\n');
  return {
    originalText: text,
    translatedText
  };
}

export default {
  INDIAN_LANGUAGES,
  transliterateDevanagariToKaithi,
  transliterateKaithiToDevanagari,
  translateText,
  translateDocumentText
};
