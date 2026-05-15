import type { AssistantMessage, Finding, WorkbookModel, WorkbookProfile } from '../types';
import {
  buildWorkbookProfile,
  compareSheets,
  createCleaningFindings,
  findDuplicates,
  findInconsistencies,
  makeSummaryFindings,
  normalizeText,
  searchWorkbook
} from './workbook';

const newId = () => Math.random().toString(36).slice(2, 10);

const formatFindings = (findings: Finding[], emptyText: string): string => {
  if (!findings.length) return emptyText;
  return findings
    .slice(0, 8)
    .map((finding, index) => {
      const place = finding.sheetName ? ` (${finding.sheetName}${finding.rows?.length ? ` row ${finding.rows.join(', ')}` : ''})` : '';
      return `${index + 1}. ${finding.title}${place}: ${finding.detail}`;
    })
    .join('\n');
};

const findMentionedSheets = (question: string, workbook: WorkbookModel): string[] => {
  const normalizedQuestion = normalizeText(question);
  return workbook.sheets
    .filter((sheet) => normalizedQuestion.includes(normalizeText(sheet.name)))
    .map((sheet) => sheet.name);
};

const createLocalAnswer = (question: string, workbook: WorkbookModel, profile: WorkbookProfile): AssistantMessage => {
  const normalized = normalizeText(question);
  let findings: Finding[] = [];
  let text = '';

  if (/(duplicate|repeated|same row)/.test(normalized)) {
    findings = findDuplicates(workbook);
    text = `I checked every sheet for exact normalized duplicate rows.\n\n${formatFindings(findings, 'No exact duplicate rows were found across the workbook.')}`;
  } else if (/(inconsisten|missing|blank|format|invalid|error|problem)/.test(normalized)) {
    findings = findInconsistencies(workbook);
    text = `I checked the workbook for inconsistent headers, sparse rows, missing values, and mixed column types.\n\n${formatFindings(findings, 'No major inconsistencies showed up in the current checks.')}`;
  } else if (/(clean|standardize|normalise|normalize|trim)/.test(normalized)) {
    findings = createCleaningFindings(workbook);
    text = `I prepared a basic cleaning review: trim extra spaces, normalize repeated whitespace, and convert simple numeric-looking text.\n\n${formatFindings(findings, 'No obvious cleanup actions were needed.')}`;
  } else if (/(summary|summarize|overview|describe)/.test(normalized)) {
    findings = makeSummaryFindings(workbook, profile);
    text = `${profile.fileName} contains ${profile.sheetCount} sheet${profile.sheetCount === 1 ? '' : 's'} and ${profile.totalRows} data rows.\n\n${formatFindings(findings, 'There is not enough workbook structure to summarize yet.')}`;
  } else if (/(compare|match|reconcile|missing from|not in)/.test(normalized)) {
    const mentionedSheets = findMentionedSheets(question, workbook);
    if (mentionedSheets.length >= 2) {
      findings = compareSheets(workbook, mentionedSheets[0], mentionedSheets[1]);
      text = `I compared ${mentionedSheets[0]} against ${mentionedSheets[1]} using normalized full-row matches.\n\n${formatFindings(findings, `Every non-empty row in ${mentionedSheets[0]} had an exact normalized match in ${mentionedSheets[1]}.`)}`;
    } else {
      text = `I can compare sheets, but I need two sheet names in the question. Available sheets: ${workbook.sheets.map((sheet) => sheet.name).join(', ')}.`;
    }
  } else {
    findings = searchWorkbook(workbook, question);
    text = `I searched across all sheets for the terms in your question.\n\n${formatFindings(findings, 'I did not find matching rows. Try a more specific ID, name, amount, invoice number, or sheet name.')}`;
  }

  return {
    id: newId(),
    role: 'assistant',
    text,
    findings
  };
};

export const askWorkbookAi = async (
  question: string,
  workbook: WorkbookModel,
  visibleFindings: Finding[]
): Promise<AssistantMessage> => {
  const profile = buildWorkbookProfile(workbook);

  try {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question,
        workbookProfile: profile,
        visibleFindings: visibleFindings.slice(0, 40)
      })
    });

    if (response.ok) {
      const data = await response.json();
      if (typeof data?.answer === 'string' && data.answer.trim()) {
        return {
          id: newId(),
          role: 'assistant',
          text: data.answer.trim()
        };
      }
    }
  } catch {
    // Local workbook tools keep the app useful when no AI provider is configured.
  }

  return createLocalAnswer(question, workbook, profile);
};

export const userMessage = (text: string): AssistantMessage => ({
  id: newId(),
  role: 'user',
  text
});
