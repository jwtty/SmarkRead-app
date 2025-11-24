export interface KeyPoint {
  id: string;
  title: string;
  description: string;
  quoteAnchor: string; // Verbatim text segment to find in the DOM to scroll to
}

export interface AnalysisResult {
  summary: string;
  keyPoints: KeyPoint[];
}

export interface DictionaryResult {
  word: string;
  englishDefinition: string;
  chineseDefinition: string;
  contextExplanation: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export enum LoadingState {
  IDLE = 'IDLE',
  ANALYZING = 'ANALYZING',
  DEFINING = 'DEFINING',
  CHATTING = 'CHATTING',
  IMAGE_ANALYZING = 'IMAGE_ANALYZING',
}

export interface ArticleData {
  url: string;
  title?: string;
  content: string; // The raw text content
}
