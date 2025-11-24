import { GoogleGenAI, Type, Schema } from "@google/genai";
import { AnalysisResult, DictionaryResult, ChatMessage } from "../types";

const API_KEY = process.env.API_KEY || '';

const ai = new GoogleGenAI({ apiKey: API_KEY });

// Using gemini-3-pro-preview for all complex tasks as requested
const MODEL_NAME = 'gemini-3-pro-preview';

export const analyzeArticle = async (text: string): Promise<AnalysisResult> => {
  if (!API_KEY) throw new Error("API Key is missing");

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      summary: {
        type: Type.STRING,
        description: "A concise summary of the article in 2-3 sentences.",
      },
      keyPoints: {
        type: Type.ARRAY,
        description: "A list of 5-8 most important pieces of information or arguments from the text.",
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "A short, catchy headline for this point." },
            description: { type: Type.STRING, description: "A brief explanation of the point." },
            quoteAnchor: {
              type: Type.STRING,
              description: "A unique, verbatim, EXACT text snippet (5-10 words) strictly copied from the article text. Do not change punctuation or capitalization. This anchor must be found in the text to allow scrolling to it.",
            },
          },
          required: ["title", "description", "quoteAnchor"],
        },
      },
    },
    required: ["summary", "keyPoints"],
  };

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `Analyze the following article text. Provide a summary and key points. For the 'quoteAnchor', you MUST select a unique string of text that exists EXACTLY in the source text below. \n\nText:\n${text}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  });

  const jsonStr = response.text || "{}";
  try {
    const result = JSON.parse(jsonStr) as AnalysisResult;
    // Add IDs for React keys
    result.keyPoints = result.keyPoints.map((kp, idx) => ({ ...kp, id: `kp-${idx}` }));
    return result;
  } catch (e) {
    console.error("Failed to parse analysis result", e);
    throw new Error("Failed to analyze article.");
  }
};

export const defineWord = async (word: string, contextSentence: string): Promise<DictionaryResult> => {
  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      word: { type: Type.STRING },
      englishDefinition: { type: Type.STRING, description: "Definition in English." },
      chineseDefinition: { type: Type.STRING, description: "Definition in Traditional Chinese (Taiwan/HK style)." },
      contextExplanation: { type: Type.STRING, description: "Explanation of how the word is specifically used in the provided context sentence." },
    },
    required: ["word", "englishDefinition", "chineseDefinition", "contextExplanation"],
  };

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `Define the word "${word}".\nContext sentence: "${contextSentence}"`,
    config: {
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  });

  return JSON.parse(response.text || "{}") as DictionaryResult;
};

export const chatWithGemini = async (history: ChatMessage[], newMessage: string, articleContext?: string): Promise<string> => {
  // Construct the conversation history for the model
  // We prepend a system instruction-like message if there's article context
  
  let prompt = "";
  if (articleContext) {
    prompt += `System: You are an AI assistant helping a user read an article.\nArticle Content: ${articleContext.substring(0, 10000)}...\n\n`;
  }
  
  history.forEach(msg => {
    prompt += `${msg.role === 'user' ? 'User' : 'AI'}: ${msg.text}\n`;
  });
  
  prompt += `User: ${newMessage}\nAI:`;

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: prompt,
  });

  return response.text || "I couldn't generate a response.";
};

export const analyzeImage = async (base64Image: string, prompt: string): Promise<string> => {
  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: "image/jpeg", // Assuming JPEG for simplicity, or detect from base64 header
            data: base64Image.split(',')[1] || base64Image,
          },
        },
        { text: prompt || "Describe this image in detail." },
      ],
    },
  });

  return response.text || "No analysis provided.";
};