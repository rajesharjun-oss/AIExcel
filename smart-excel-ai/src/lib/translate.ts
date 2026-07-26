import type { CellValue, Finding, SheetData, WorkbookModel } from '../types';
import { cellToText, isBlank } from './workbook';

export type LanguageCode = 'en' | 'es' | 'fr' | 'de' | 'pt';

export type LanguageOption = {
  code: LanguageCode;
  label: string;
};

export const supportedLanguages: LanguageOption[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' }
];

export type TranslationResult = {
  workbook: WorkbookModel;
  translatedCells: number;
  skippedCells: number;
  targetLanguage: LanguageCode;
  sheetName: string;
  usedRemoteAi: boolean;
};

// Compact phrase dictionary covering common spreadsheet vocabulary. Keeps the
// feature useful offline, mirroring the local Ask AI fallback pattern.
const phraseDictionary: Record<string, Partial<Record<LanguageCode, string>>> = {
  amount: { en: 'Amount', es: 'Importe', fr: 'Montant', de: 'Betrag', pt: 'Valor' },
  date: { en: 'Date', es: 'Fecha', fr: 'Date', de: 'Datum', pt: 'Data' },
  description: { en: 'Description', es: 'Descripción', fr: 'Description', de: 'Beschreibung', pt: 'Descrição' },
  name: { en: 'Name', es: 'Nombre', fr: 'Nom', de: 'Name', pt: 'Nome' },
  total: { en: 'Total', es: 'Total', fr: 'Total', de: 'Gesamt', pt: 'Total' },
  balance: { en: 'Balance', es: 'Saldo', fr: 'Solde', de: 'Saldo', pt: 'Saldo' },
  category: { en: 'Category', es: 'Categoría', fr: 'Catégorie', de: 'Kategorie', pt: 'Categoria' },
  customer: { en: 'Customer', es: 'Cliente', fr: 'Client', de: 'Kunde', pt: 'Cliente' },
  invoice: { en: 'Invoice', es: 'Factura', fr: 'Facture', de: 'Rechnung', pt: 'Fatura' },
  payment: { en: 'Payment', es: 'Pago', fr: 'Paiement', de: 'Zahlung', pt: 'Pagamento' },
  price: { en: 'Price', es: 'Precio', fr: 'Prix', de: 'Preis', pt: 'Preço' },
  quantity: { en: 'Quantity', es: 'Cantidad', fr: 'Quantité', de: 'Menge', pt: 'Quantidade' },
  status: { en: 'Status', es: 'Estado', fr: 'Statut', de: 'Status', pt: 'Estado' },
  paid: { en: 'Paid', es: 'Pagado', fr: 'Payé', de: 'Bezahlt', pt: 'Pago' },
  pending: { en: 'Pending', es: 'Pendiente', fr: 'En attente', de: 'Ausstehend', pt: 'Pendente' },
  overdue: { en: 'Overdue', es: 'Vencido', fr: 'En retard', de: 'Überfällig', pt: 'Vencido' },
  yes: { en: 'Yes', es: 'Sí', fr: 'Oui', de: 'Ja', pt: 'Sim' },
  no: { en: 'No', es: 'No', fr: 'Non', de: 'Nein', pt: 'Não' },
  bank: { en: 'Bank', es: 'Banco', fr: 'Banque', de: 'Bank', pt: 'Banco' },
  charge: { en: 'Charge', es: 'Cargo', fr: 'Frais', de: 'Gebühr', pt: 'Cobrança' },
  transfer: { en: 'Transfer', es: 'Transferencia', fr: 'Virement', de: 'Überweisung', pt: 'Transferência' },
  account: { en: 'Account', es: 'Cuenta', fr: 'Compte', de: 'Konto', pt: 'Conta' },
  tax: { en: 'Tax', es: 'Impuesto', fr: 'Taxe', de: 'Steuer', pt: 'Imposto' },
  salary: { en: 'Salary', es: 'Salario', fr: 'Salaire', de: 'Gehalt', pt: 'Salário' },
  expense: { en: 'Expense', es: 'Gasto', fr: 'Dépense', de: 'Ausgabe', pt: 'Despesa' },
  income: { en: 'Income', es: 'Ingreso', fr: 'Revenu', de: 'Einkommen', pt: 'Renda' },
  notes: { en: 'Notes', es: 'Notas', fr: 'Notes', de: 'Notizen', pt: 'Notas' },
  address: { en: 'Address', es: 'Dirección', fr: 'Adresse', de: 'Adresse', pt: 'Endereço' },
  city: { en: 'City', es: 'Ciudad', fr: 'Ville', de: 'Stadt', pt: 'Cidade' },
  country: { en: 'Country', es: 'País', fr: 'Pays', de: 'Land', pt: 'País' },
  region: { en: 'Region', es: 'Región', fr: 'Région', de: 'Region', pt: 'Região' },
  product: { en: 'Product', es: 'Producto', fr: 'Produit', de: 'Produkt', pt: 'Produto' },
  reference: { en: 'Reference', es: 'Referencia', fr: 'Référence', de: 'Referenz', pt: 'Referência' },
  vendor: { en: 'Vendor', es: 'Proveedor', fr: 'Fournisseur', de: 'Lieferant', pt: 'Fornecedor' },
  currency: { en: 'Currency', es: 'Moneda', fr: 'Devise', de: 'Währung', pt: 'Moeda' },
  month: { en: 'Month', es: 'Mes', fr: 'Mois', de: 'Monat', pt: 'Mês' },
  year: { en: 'Year', es: 'Año', fr: 'Année', de: 'Jahr', pt: 'Ano' },
  debit: { en: 'Debit', es: 'Débito', fr: 'Débit', de: 'Soll', pt: 'Débito' },
  credit: { en: 'Credit', es: 'Crédito', fr: 'Crédit', de: 'Haben', pt: 'Crédito' }
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

const collectTranslatableTexts = (sheet: SheetData): string[] => {
  const unique = new Set<string>();
  sheet.rows.forEach((row) => {
    row.forEach((cell) => {
      if (isTranslatableCell(cell)) unique.add(cell.trim());
    });
  });
  return Array.from(unique);
};

const fetchRemoteTranslations = async (
  texts: string[],
  targetLanguage: LanguageCode
): Promise<Map<string, string> | null> => {
  try {
    const response = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texts, targetLanguage })
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data?.translations) || data.translations.length !== texts.length) return null;
    const map = new Map<string, string>();
    texts.forEach((text, index) => {
      const translated = data.translations[index];
      if (typeof translated === 'string' && translated.trim()) map.set(text, translated.trim());
    });
    return map;
  } catch {
    // Local dictionary keeps translation working when no AI provider is configured.
    return null;
  }
};

export const translateSheet = async (
  workbook: WorkbookModel,
  sheetName: string,
  targetLanguage: LanguageCode
): Promise<TranslationResult> => {
  const sheet = workbook.sheets.find((candidate) => candidate.name === sheetName);
  if (!sheet) {
    return { workbook, translatedCells: 0, skippedCells: 0, targetLanguage, sheetName, usedRemoteAi: false };
  }

  const texts = collectTranslatableTexts(sheet);
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

  const nextRows = sheet.rows.map((row) => row.map(translateCell));
  const nextHeaders = sheet.headers.map((header, index) => {
    const headerCell = nextRows[sheet.headerRowIndex]?.[index];
    return isBlank(headerCell) ? header : cellToText(headerCell);
  });

  const nextSheet: SheetData = { ...sheet, rows: nextRows, headers: nextHeaders };

  return {
    workbook: {
      ...workbook,
      sheets: workbook.sheets.map((candidate) => (candidate.name === sheetName ? nextSheet : candidate))
    },
    translatedCells,
    skippedCells,
    targetLanguage,
    sheetName,
    usedRemoteAi: Boolean(remote?.size)
  };
};

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
