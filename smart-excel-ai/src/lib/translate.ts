import type { CellValue, Finding, SheetData, WorkbookModel } from '../types';
import { cellToText, isBlank } from './workbook';

export type LanguageCode = 'en' | 'es' | 'fr' | 'de' | 'pt' | 'it';

export type LanguageOption = {
  code: LanguageCode;
  label: string;
};

export const supportedLanguages: LanguageOption[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'it', label: 'Italian' }
];

export type TranslationResult = {
  workbook: WorkbookModel;
  translatedCells: number;
  skippedCells: number;
  targetLanguage: LanguageCode;
  sheetName: string;
  sheetNames: string[];
  usedRemoteAi: boolean;
};

// Compact phrase dictionary covering common spreadsheet vocabulary. Keeps the
// feature useful offline, mirroring the local Ask AI fallback pattern.
const phraseDictionary: Record<string, Partial<Record<LanguageCode, string>>> = {
  amount: { en: 'Amount', es: 'Importe', fr: 'Montant', de: 'Betrag', pt: 'Valor', it: 'Importo' },
  date: { en: 'Date', es: 'Fecha', fr: 'Date', de: 'Datum', pt: 'Data', it: 'Data' },
  description: { en: 'Description', es: 'Descripción', fr: 'Description', de: 'Beschreibung', pt: 'Descrição', it: 'Descrizione' },
  name: { en: 'Name', es: 'Nombre', fr: 'Nom', de: 'Name', pt: 'Nome', it: 'Nome' },
  total: { en: 'Total', es: 'Total', fr: 'Total', de: 'Gesamt', pt: 'Total', it: 'Totale' },
  balance: { en: 'Balance', es: 'Saldo', fr: 'Solde', de: 'Saldo', pt: 'Saldo', it: 'Saldo' },
  category: { en: 'Category', es: 'Categoría', fr: 'Catégorie', de: 'Kategorie', pt: 'Categoria', it: 'Categoria' },
  customer: { en: 'Customer', es: 'Cliente', fr: 'Client', de: 'Kunde', pt: 'Cliente', it: 'Cliente' },
  invoice: { en: 'Invoice', es: 'Factura', fr: 'Facture', de: 'Rechnung', pt: 'Fatura', it: 'Fattura' },
  payment: { en: 'Payment', es: 'Pago', fr: 'Paiement', de: 'Zahlung', pt: 'Pagamento', it: 'Pagamento' },
  price: { en: 'Price', es: 'Precio', fr: 'Prix', de: 'Preis', pt: 'Preço', it: 'Prezzo' },
  quantity: { en: 'Quantity', es: 'Cantidad', fr: 'Quantité', de: 'Menge', pt: 'Quantidade', it: 'Quantità' },
  status: { en: 'Status', es: 'Estado', fr: 'Statut', de: 'Status', pt: 'Estado', it: 'Stato' },
  paid: { en: 'Paid', es: 'Pagado', fr: 'Payé', de: 'Bezahlt', pt: 'Pago', it: 'Pagato' },
  pending: { en: 'Pending', es: 'Pendiente', fr: 'En attente', de: 'Ausstehend', pt: 'Pendente', it: 'In sospeso' },
  overdue: { en: 'Overdue', es: 'Vencido', fr: 'En retard', de: 'Überfällig', pt: 'Vencido', it: 'Scaduto' },
  yes: { en: 'Yes', es: 'Sí', fr: 'Oui', de: 'Ja', pt: 'Sim', it: 'Sì' },
  no: { en: 'No', es: 'No', fr: 'Non', de: 'Nein', pt: 'Não', it: 'No' },
  bank: { en: 'Bank', es: 'Banco', fr: 'Banque', de: 'Bank', pt: 'Banco', it: 'Banca' },
  charge: { en: 'Charge', es: 'Cargo', fr: 'Frais', de: 'Gebühr', pt: 'Cobrança', it: 'Addebito' },
  transfer: { en: 'Transfer', es: 'Transferencia', fr: 'Virement', de: 'Überweisung', pt: 'Transferência', it: 'Bonifico' },
  account: { en: 'Account', es: 'Cuenta', fr: 'Compte', de: 'Konto', pt: 'Conta', it: 'Conto' },
  tax: { en: 'Tax', es: 'Impuesto', fr: 'Taxe', de: 'Steuer', pt: 'Imposto', it: 'Imposta' },
  salary: { en: 'Salary', es: 'Salario', fr: 'Salaire', de: 'Gehalt', pt: 'Salário', it: 'Stipendio' },
  expense: { en: 'Expense', es: 'Gasto', fr: 'Dépense', de: 'Ausgabe', pt: 'Despesa', it: 'Spesa' },
  income: { en: 'Income', es: 'Ingreso', fr: 'Revenu', de: 'Einkommen', pt: 'Renda', it: 'Reddito' },
  notes: { en: 'Notes', es: 'Notas', fr: 'Notes', de: 'Notizen', pt: 'Notas', it: 'Note' },
  address: { en: 'Address', es: 'Dirección', fr: 'Adresse', de: 'Adresse', pt: 'Endereço', it: 'Indirizzo' },
  city: { en: 'City', es: 'Ciudad', fr: 'Ville', de: 'Stadt', pt: 'Cidade', it: 'Città' },
  country: { en: 'Country', es: 'País', fr: 'Pays', de: 'Land', pt: 'País', it: 'Paese' },
  region: { en: 'Region', es: 'Región', fr: 'Région', de: 'Region', pt: 'Região', it: 'Regione' },
  product: { en: 'Product', es: 'Producto', fr: 'Produit', de: 'Produkt', pt: 'Produto', it: 'Prodotto' },
  reference: { en: 'Reference', es: 'Referencia', fr: 'Référence', de: 'Referenz', pt: 'Referência', it: 'Riferimento' },
  vendor: { en: 'Vendor', es: 'Proveedor', fr: 'Fournisseur', de: 'Lieferant', pt: 'Fornecedor', it: 'Fornitore' },
  currency: { en: 'Currency', es: 'Moneda', fr: 'Devise', de: 'Währung', pt: 'Moeda', it: 'Valuta' },
  month: { en: 'Month', es: 'Mes', fr: 'Mois', de: 'Monat', pt: 'Mês', it: 'Mese' },
  year: { en: 'Year', es: 'Año', fr: 'Année', de: 'Jahr', pt: 'Ano', it: 'Anno' },
  debit: { en: 'Debit', es: 'Débito', fr: 'Débit', de: 'Soll', pt: 'Débito', it: 'Debito' },
  credit: { en: 'Credit', es: 'Crédito', fr: 'Crédit', de: 'Haben', pt: 'Crédito', it: 'Credito' }
};

type ReverseEntry = { key: string; language: LanguageCode };

const buildReverseIndex = (): Map<string, ReverseEntry[]> => {
  const index = new Map<string, ReverseEntry[]>();
  Object.entries(phraseDictionary).forEach(([key, translations]) => {
    Object.entries(translations).forEach(([language, phrase]) => {
      if (!phrase) return;
      const normalized = phrase.toLowerCase();
      const entries = index.get(normalized) ?? [];
      entries.push({ key, language: language as LanguageCode });
      index.set(normalized, entries);
    });
  });
  return index;
};

const reverseIndex = buildReverseIndex();

const normalizePhrase = (value: string): string => value.replace(/\s+/g, ' ').trim().toLowerCase();

export const isTranslatableCell = (value: CellValue | undefined): value is string => {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text) return false;
  if (/^[-+]?[\d,.\s]+$/.test(text)) return false;
  if (/^[₦$€£]\s?-?[\d,.\s]+$/.test(text)) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return false;
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(text)) return false;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return false;
  return /[a-zA-ZÀ-ɏ]/.test(text);
};

export const detectSheetLanguage = (sheet: SheetData): LanguageCode | null => {
  const counts: Record<string, number> = {};

  sheet.rows.forEach((row) => {
    row.forEach((cell) => {
      if (!isTranslatableCell(cell)) return;
      const entries = reverseIndex.get(normalizePhrase(cell));
      entries?.forEach((entry) => {
        counts[entry.language] = (counts[entry.language] ?? 0) + 1;
      });
    });
  });

  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  return ranked[0][0] as LanguageCode;
};

const matchCasing = (source: string, translated: string): string => {
  if (source === source.toUpperCase() && /[A-Z]/.test(source)) return translated.toUpperCase();
  if (source === source.toLowerCase()) return translated.toLowerCase();
  return translated;
};

export const translatePhraseLocally = (text: string, targetLanguage: LanguageCode): string | null => {
  const entries = reverseIndex.get(normalizePhrase(text));
  if (!entries?.length) return null;
  const translated = phraseDictionary[entries[0].key][targetLanguage];
  if (!translated || normalizePhrase(translated) === normalizePhrase(text)) return null;
  return matchCasing(text.trim(), translated);
};

// Mirror the backend /v1/translate schema so no batch is rejected outright.
const MAX_BATCH_TEXTS = 200;
const MAX_TEXT_LENGTH = 500;

const collectTranslatableTexts = (sheet: SheetData): string[] => {
  const unique = new Set<string>();
  sheet.rows.forEach((row) => {
    row.forEach((cell) => {
      if (isTranslatableCell(cell) && cell.trim().length <= MAX_TEXT_LENGTH) unique.add(cell.trim());
    });
  });
  return Array.from(unique);
};

const fetchTranslationBatch = async (
  texts: string[],
  targetLanguage: LanguageCode
): Promise<string[] | null> => {
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ texts, targetLanguage })
  });
  if (!response.ok) return null;
  const data = await response.json();
  if (!Array.isArray(data?.translations) || data.translations.length !== texts.length) return null;
  return data.translations;
};

const fetchRemoteTranslations = async (
  texts: string[],
  targetLanguage: LanguageCode
): Promise<Map<string, string> | null> => {
  try {
    const map = new Map<string, string>();
    for (let start = 0; start < texts.length; start += MAX_BATCH_TEXTS) {
      const batch = texts.slice(start, start + MAX_BATCH_TEXTS);
      const translations = await fetchTranslationBatch(batch, targetLanguage);
      if (!translations) {
        // A failure on the very first batch means the provider is unavailable;
        // skip the remaining batches instead of repeating doomed requests.
        if (start === 0) return null;
        continue;
      }
      batch.forEach((text, index) => {
        const translated = translations[index];
        if (typeof translated === 'string' && translated.trim()) map.set(text, translated.trim());
      });
    }
    return map.size ? map : null;
  } catch {
    // Local dictionary keeps translation working when no AI provider is configured.
    return null;
  }
};

const scopeLabel = (sheetNames: string[]): string =>
  sheetNames.length === 1 ? sheetNames[0] : `${sheetNames.length} sheets`;

export const translateSheets = async (
  workbook: WorkbookModel,
  sheetNames: string[],
  targetLanguage: LanguageCode
): Promise<TranslationResult> => {
  const targets = workbook.sheets.filter((sheet) => sheetNames.includes(sheet.name));
  if (!targets.length) {
    return {
      workbook,
      translatedCells: 0,
      skippedCells: 0,
      targetLanguage,
      sheetName: scopeLabel(sheetNames.length ? sheetNames : ['(none)']),
      sheetNames,
      usedRemoteAi: false
    };
  }

  // One batched remote round-trip covers every targeted sheet.
  const texts = Array.from(new Set(targets.flatMap(collectTranslatableTexts)));
  const remote = texts.length ? await fetchRemoteTranslations(texts, targetLanguage) : null;

  let translatedCells = 0;
  let skippedCells = 0;

  const translateCell = (cell: CellValue): CellValue => {
    if (!isTranslatableCell(cell)) {
      if (!isBlank(cell)) skippedCells += 1;
      return cell;
    }
    const trimmed = cell.trim();
    const translated = remote?.get(trimmed) ?? translatePhraseLocally(trimmed, targetLanguage);
    if (translated === null || translated === undefined || translated === trimmed) {
      skippedCells += 1;
      return cell;
    }
    translatedCells += 1;
    return translated;
  };

  const translateOneSheet = (sheet: SheetData): SheetData => {
    const nextRows = sheet.rows.map((row) => row.map(translateCell));
    const nextHeaders = sheet.headers.map((header, index) => {
      const headerCell = nextRows[sheet.headerRowIndex]?.[index];
      return isBlank(headerCell) ? header : cellToText(headerCell);
    });
    return { ...sheet, rows: nextRows, headers: nextHeaders };
  };

  const targetNames = new Set(targets.map((sheet) => sheet.name));

  return {
    workbook: {
      ...workbook,
      sheets: workbook.sheets.map((sheet) => (targetNames.has(sheet.name) ? translateOneSheet(sheet) : sheet))
    },
    translatedCells,
    skippedCells,
    targetLanguage,
    sheetName: scopeLabel(targets.map((sheet) => sheet.name)),
    sheetNames: targets.map((sheet) => sheet.name),
    usedRemoteAi: Boolean(remote?.size)
  };
};

export const translateSheet = (
  workbook: WorkbookModel,
  sheetName: string,
  targetLanguage: LanguageCode
): Promise<TranslationResult> => translateSheets(workbook, [sheetName], targetLanguage);

export const translateWorkbook = (
  workbook: WorkbookModel,
  targetLanguage: LanguageCode
): Promise<TranslationResult> =>
  translateSheets(workbook, workbook.sheets.map((sheet) => sheet.name), targetLanguage);

export const languageLabel = (code: LanguageCode): string =>
  supportedLanguages.find((language) => language.code === code)?.label ?? code;

export const createTranslationFinding = (result: TranslationResult): Finding => ({
  id: `translate-${result.sheetName}-${result.targetLanguage}`,
  type: 'summary',
  severity: result.translatedCells ? 'info' : 'low',
  title: result.translatedCells ? 'Live translation applied' : 'No translatable text found',
  sheetName: result.sheetName,
  detail: result.translatedCells
    ? `${result.translatedCells} cell${result.translatedCells === 1 ? '' : 's'} translated to ${languageLabel(result.targetLanguage)} using ${result.usedRemoteAi ? 'the AI translation service' : 'the built-in phrase dictionary'}. ${result.skippedCells} value${result.skippedCells === 1 ? '' : 's'} (numbers, dates, IDs, unknown phrases) left unchanged.`
    : `No cells on ${result.sheetName} matched translatable text for ${languageLabel(result.targetLanguage)}. Numbers, dates, and identifiers are always preserved.`,
  suggestion: result.translatedCells
    ? 'Review the translated sheet, then use Revert Translation to restore the original text at any time.'
    : undefined
});
