import { marked } from 'marked';

// Content comes only from this repo's own Markdown files, so the HTML is trusted.
export const md = (s: string): string => marked.parse(s, { async: false }) as string;
export const mdInline = (s: string): string => marked.parseInline(s, { async: false }) as string;
