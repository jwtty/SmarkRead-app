import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  analyzeArticle, 
  defineWord, 
  chatWithGemini, 
  analyzeImage 
} from './services/geminiService';
import { 
  AnalysisResult, 
  DictionaryResult, 
  LoadingState, 
  ChatMessage
} from './types';
import { 
  BookOpenIcon, 
  ChatBubbleLeftRightIcon, 
  PhotoIcon, 
  SparklesIcon,
  XMarkIcon,
  MagnifyingGlassIcon,
  ArrowRightIcon,
  PaperClipIcon,
  SpeakerWaveIcon
} from '@heroicons/react/24/outline';

const App: React.FC = () => {
  // --- State ---
  const [urlInput, setUrlInput] = useState('https://example.com/blog-post');
  
  // Content State
  const [articleText, setArticleText] = useState<string>(''); // For AI analysis
  const [iframeHtml, setIframeHtml] = useState<string>(''); // For Display
  
  const [activeTab, setActiveTab] = useState<'analysis' | 'chat' | 'image'>('analysis');
  const [loadingState, setLoadingState] = useState<LoadingState>(LoadingState.IDLE);
  
  // Analysis State
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  
  // Dictionary State
  const [dictionary, setDictionary] = useState<DictionaryResult | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{x: number, y: number} | null>(null);
  const [selectedTextData, setSelectedTextData] = useState<{word: string, context: string} | null>(null);

  // Chat State
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');

  // Image State
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imagePrompt, setImagePrompt] = useState('');
  const [imageAnalysisResult, setImageAnalysisResult] = useState<string>('');

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // --- Helpers ---

  // Converts relative URLs in the DOM to absolute URLs based on the source
  const rewriteUrls = (doc: Document, baseUrl: string) => {
    const toAbsolute = (url: string) => {
      try {
        return new URL(url, baseUrl).href;
      } catch {
        return url;
      }
    };

    doc.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src');
      if (src) img.src = toAbsolute(src);
      // Remove srcset to force usage of the corrected src (simpler than parsing srcset)
      img.removeAttribute('srcset'); 
    });
    
    doc.querySelectorAll('link').forEach(link => {
      const href = link.getAttribute('href');
      if (href) link.href = toAbsolute(href);
    });
    
    doc.querySelectorAll('a').forEach(a => {
      const href = a.getAttribute('href');
      if (href) a.href = toAbsolute(href);
      // Make links open in new tab so they don't break the iframe
      a.target = "_blank"; 
    });
  };

  const handleLoadArticle = async () => {
    if (!urlInput) return;
    setLoadingState(LoadingState.ANALYZING);
    setAnalysis(null);
    setChatHistory([]); 
    setArticleText(''); 
    setIframeHtml('');
    setDictionary(null);

    try {
      let rawHtml = '';

      // Strategy: Try Primary Proxy (AllOrigins), if fail, try Secondary (CorsProxy)
      try {
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(urlInput)}`;
        const res = await fetch(proxyUrl);
        const text = await res.text();
        
        try {
          const data = JSON.parse(text);
          if (data.contents) {
            rawHtml = data.contents;
          } else {
            throw new Error("No content in AllOrigins response");
          }
        } catch (jsonErr) {
          throw new Error("Invalid JSON from AllOrigins");
        }
      } catch (err) {
        console.warn("Primary proxy failed, attempting fallback...", err);
        const fallbackUrl = `https://corsproxy.io/?${encodeURIComponent(urlInput)}`;
        const res = await fetch(fallbackUrl);
        if (!res.ok) throw new Error(`Fallback proxy failed: ${res.statusText}`);
        rawHtml = await res.text();
      }

      if (!rawHtml || rawHtml.length < 50) {
        throw new Error("Retrieved content is empty or too short.");
      }

      const parser = new DOMParser();
      const doc = parser.parseFromString(rawHtml, 'text/html');

      // 1. Sanitize: Remove scripts to prevent execution and breaking the app
      doc.querySelectorAll('script, iframe, object, embed').forEach(el => el.remove());
      
      // 2. Rewrite Assets to be absolute
      rewriteUrls(doc, urlInput);

      // 3. Inject CSS for highlighting and base styles
      const style = doc.createElement('style');
      style.textContent = `
        .smartread-highlight { background-color: #fef08a !important; color: #000 !important; transition: background-color 1s; border-radius: 2px; }
        body { cursor: default; }
        /* Hide common nuisance elements like cookie banners or ads */
        #onetrust-banner-sdk, .ads, .ad-container, [id*="cookie"], [class*="popup"] { display: none !important; }
      `;
      doc.head.appendChild(style);

      // 4. Save HTML for display
      setIframeHtml(doc.documentElement.outerHTML);

      // 5. Extract Text for AI
      // We want cleaner text for the AI than just the raw body
      const contentRoot = doc.querySelector('article') || 
                          doc.querySelector('main') || 
                          doc.querySelector('.content') || 
                          doc.body;
      
      const cleanText = (contentRoot.textContent || "")
        .replace(/\s+/g, ' ')
        .trim();

      if (cleanText.length < 100) throw new Error("Could not extract meaningful text from this page.");
      
      setArticleText(cleanText);

      // Trigger Analysis
      const result = await analyzeArticle(cleanText);
      setAnalysis(result);

    } catch (e) {
      console.error("Fetch error:", e);
      setIframeHtml(`<div style="padding: 20px; font-family: sans-serif; text-align: center; color: #666;">
        <h2>Oops! Could not load website.</h2>
        <p>${(e as Error).message}</p>
        <p>Some websites block proxy access. Try a simpler blog URL.</p>
      </div>`);
    } finally {
      setLoadingState(LoadingState.IDLE);
    }
  };

  const handleManualAnalyze = async () => {
    if (!articleText) return;
    setLoadingState(LoadingState.ANALYZING);
    try {
      const result = await analyzeArticle(articleText);
      setAnalysis(result);
    } catch (e) {
      alert("Failed to analyze.");
    } finally {
      setLoadingState(LoadingState.IDLE);
    }
  }

  // --- Interaction Handlers (Iframe) ---

  // Re-attach listeners whenever the iframe content changes
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !iframeHtml) return;

    // We write to the doc to ensure it renders our modified HTML
    const doc = iframe.contentDocument;
    if (doc) {
      doc.open();
      doc.write(iframeHtml);
      doc.close();

      // Add Context Menu Listener to Iframe Document
      const handleIframeContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        const selection = doc.getSelection();
        const word = selection?.toString().trim();
        
        if (word && word.length > 0) {
          // Get context (surrounding block)
          let context = "";
          if (selection && selection.anchorNode) {
             const parent = selection.anchorNode.parentElement;
             context = parent?.textContent || "";
             // Truncate context if too long
             if (context.length > 200) context = context.substring(0, 200) + "...";
          }

          // Calculate position relative to the main window
          const iframeRect = iframe.getBoundingClientRect();
          const x = iframeRect.left + e.clientX;
          const y = iframeRect.top + e.clientY;

          setSelectedTextData({ word, context });
          setContextMenuPos({ x, y });
        } else {
          setContextMenuPos(null);
        }
      };
      
      // We also want to clear the custom menu if user left clicks
      const handleIframeClick = () => setContextMenuPos(null);

      doc.addEventListener('contextmenu', handleIframeContextMenu);
      doc.addEventListener('click', handleIframeClick);
    }
  }, [iframeHtml]);


  const handleScrollToQuote = (anchor: string) => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc || !anchor) return;

    // Helper to find text node containing the string
    // This is a simplified search. Robust searching in HTML is complex.
    // We look for text nodes that contain a significant portion of the anchor.
    
    const cleanAnchor = anchor.trim();
    if (!cleanAnchor) return;

    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
    let node;
    let foundNode: Node | null = null;

    while (node = walker.nextNode()) {
      if (node.textContent?.includes(cleanAnchor)) {
        foundNode = node;
        break;
      }
    }

    if (foundNode && foundNode.parentElement) {
       // Highlight
       const parent = foundNode.parentElement;
       const originalHTML = parent.innerHTML;
       
       // Simple replacement highlight
       // Warning: This destroys events on this node, but for a reader it's acceptable
       try {
         parent.innerHTML = parent.innerHTML.replace(
           cleanAnchor, 
           `<span class="smartread-highlight" id="temp-highlight">${cleanAnchor}</span>`
         );
         
         const highlightEl = doc.getElementById('temp-highlight');
         highlightEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });

         // Remove highlight after 3s
         setTimeout(() => {
             // We can't just restore originalHTML easily because user might have scrolled away 
             // or other things might have happened. But usually safe for static content.
             // A cleaner way is to remove the span tag but keep text.
             if (highlightEl) {
               const text = doc.createTextNode(cleanAnchor);
               highlightEl.parentNode?.replaceChild(text, highlightEl);
             }
         }, 3000);
       } catch (e) {
         // Fallback if regex/replacement fails (e.g. special chars)
         foundNode.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
       }
    } else {
      // Fallback: window.find (works in most browsers for iframes)
      const win = iframe?.contentWindow as any;
      if (win && win.find) {
        // Reset selection to top to search from start? or just search
        const found = win.find(cleanAnchor);
        if (found) {
           // It selects the text, enabling native scroll.
           // We can verify valid selection
           const sel = win.getSelection();
           if (sel.rangeCount > 0) {
             const range = sel.getRangeAt(0);
             const span = doc.createElement('span');
             span.className = 'smartread-highlight';
             try {
               range.surroundContents(span);
               span.scrollIntoView({ behavior: 'smooth', block: 'center' });
               setTimeout(() => {
                 const parent = span.parentNode;
                 while (span.firstChild) parent?.insertBefore(span.firstChild, span);
                 parent?.removeChild(span);
               }, 3000);
             } catch (e) {
               // surroundContents can fail if range crosses node boundaries
               // Just let the window.find selection stay
             }
           }
        } else {
          alert("Could not find the exact text in the article view.");
        }
      }
    }
  };

  const handleDefineWord = async () => {
    setContextMenuPos(null);
    if (!selectedTextData) return;
    
    setLoadingState(LoadingState.DEFINING);
    try {
      const result = await defineWord(selectedTextData.word, selectedTextData.context);
      setDictionary(result);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingState(LoadingState.IDLE);
    }
  };

  const handlePlayAudio = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      window.speechSynthesis.speak(utterance);
    }
  };

  // --- Chat Handlers ---
  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;
    
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: chatInput,
      timestamp: Date.now()
    };
    
    const newHistory = [...chatHistory, userMsg];
    setChatHistory(newHistory);
    setChatInput('');
    setLoadingState(LoadingState.CHATTING);

    try {
      const responseText = await chatWithGemini(newHistory, userMsg.text, articleText);
      const botMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: responseText,
        timestamp: Date.now()
      };
      setChatHistory(prev => [...prev, botMsg]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingState(LoadingState.IDLE);
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  // --- Image Handlers ---
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
        setImageAnalysisResult(''); // Clear previous
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAnalyzeImage = async () => {
    if (!selectedImage) return;
    setLoadingState(LoadingState.IMAGE_ANALYZING);
    try {
      const result = await analyzeImage(selectedImage, imagePrompt);
      setImageAnalysisResult(result);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingState(LoadingState.IDLE);
    }
  };


  return (
    <div className="flex flex-col h-screen bg-white" onClick={() => setContextMenuPos(null)}>
      {/* Header */}
      <header className="flex-none bg-indigo-600 text-white p-4 shadow-md flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <BookOpenIcon className="h-6 w-6" />
          <h1 className="text-xl font-bold">SmartRead AI</h1>
        </div>
        <div className="flex items-center gap-2 w-1/2">
          <input 
            type="text" 
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            className="flex-1 px-4 py-2 rounded-lg bg-white text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            placeholder="Enter article URL (e.g., https://...)"
          />
          <button 
            onClick={handleLoadArticle}
            className="bg-indigo-800 hover:bg-indigo-900 px-4 py-2 rounded-lg transition-colors"
          >
            Load
          </button>
        </div>
        <div className="w-6"></div> {/* Spacer */}
      </header>

      {/* Main Layout */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Left Sidebar: Tools */}
        <div className="w-1/3 min-w-[350px] bg-gray-50 border-r border-gray-200 flex flex-col z-20 shadow-lg">
          {/* Tabs */}
          <div className="flex border-b border-gray-200 bg-white">
            <button 
              onClick={() => setActiveTab('analysis')}
              className={`flex-1 py-3 text-sm font-medium flex justify-center items-center gap-2 ${activeTab === 'analysis' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <SparklesIcon className="h-4 w-4" /> Summary
            </button>
            <button 
              onClick={() => setActiveTab('chat')}
              className={`flex-1 py-3 text-sm font-medium flex justify-center items-center gap-2 ${activeTab === 'chat' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <ChatBubbleLeftRightIcon className="h-4 w-4" /> Chat
            </button>
            <button 
              onClick={() => setActiveTab('image')}
              className={`flex-1 py-3 text-sm font-medium flex justify-center items-center gap-2 ${activeTab === 'image' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <PhotoIcon className="h-4 w-4" /> Visuals
            </button>
          </div>

          {/* Content Area for Tabs */}
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            
            {/* ANALYSIS TAB */}
            {activeTab === 'analysis' && (
              <div className="space-y-6">
                {!articleText && (
                  <div className="text-center text-gray-400 mt-10">
                    <p>Load an article to see analysis.</p>
                  </div>
                )}
                
                {articleText && !analysis && loadingState !== LoadingState.ANALYZING && (
                  <button 
                    onClick={handleManualAnalyze} 
                    className="w-full py-3 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200"
                  >
                    Analyze Article
                  </button>
                )}

                {loadingState === LoadingState.ANALYZING && (
                  <div className="flex flex-col items-center justify-center space-y-2 py-10">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                    <p className="text-sm text-gray-500">Processing article...</p>
                  </div>
                )}

                {analysis && (
                  <>
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Summary</h3>
                      <p className="text-gray-700 leading-relaxed text-sm">{analysis.summary}</p>
                    </div>

                    <div className="space-y-3">
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Key Insights</h3>
                      {analysis.keyPoints.map((kp) => (
                        <div 
                          key={kp.id}
                          onClick={() => handleScrollToQuote(kp.quoteAnchor)}
                          className="group bg-white p-3 rounded-lg border border-gray-200 hover:border-indigo-300 hover:shadow-md cursor-pointer transition-all"
                        >
                          <div className="flex justify-between items-start">
                            <h4 className="font-semibold text-gray-800 text-sm group-hover:text-indigo-600">{kp.title}</h4>
                            <ArrowRightIcon className="h-4 w-4 text-gray-300 group-hover:text-indigo-500" />
                          </div>
                          <p className="text-gray-600 text-xs mt-1">{kp.description}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* CHAT TAB */}
            {activeTab === 'chat' && (
              <div className="flex flex-col h-full">
                 <div className="flex-1 space-y-4 mb-4">
                   {chatHistory.length === 0 && (
                     <p className="text-gray-400 text-center text-sm mt-10">Ask a question about the article!</p>
                   )}
                   {chatHistory.map((msg) => (
                     <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                       <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                         msg.role === 'user' 
                          ? 'bg-indigo-600 text-white rounded-br-none' 
                          : 'bg-white border border-gray-200 text-gray-800 rounded-bl-none shadow-sm'
                       }`}>
                         {msg.text}
                       </div>
                     </div>
                   ))}
                   {loadingState === LoadingState.CHATTING && (
                     <div className="flex justify-start">
                       <div className="bg-gray-100 rounded-2xl px-4 py-2 text-sm text-gray-500 animate-pulse">
                         Typing...
                       </div>
                     </div>
                   )}
                   <div ref={chatEndRef} />
                 </div>
                 <div className="bg-white border-t border-gray-200 pt-3">
                   <div className="flex gap-2">
                     <input 
                      className="flex-1 bg-gray-100 border-0 rounded-full px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-300"
                      placeholder="Ask Gemini..."
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                     />
                     <button 
                      onClick={handleSendMessage}
                      disabled={loadingState === LoadingState.CHATTING}
                      className="bg-indigo-600 text-white p-2 rounded-full hover:bg-indigo-700 disabled:opacity-50"
                     >
                       <ArrowRightIcon className="h-4 w-4" />
                     </button>
                   </div>
                 </div>
              </div>
            )}

            {/* IMAGE TAB */}
            {activeTab === 'image' && (
              <div className="space-y-4">
                <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:bg-gray-50 transition-colors relative">
                  <input 
                    type="file" 
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  {selectedImage ? (
                    <img src={selectedImage} alt="Upload" className="max-h-48 mx-auto rounded shadow-sm" />
                  ) : (
                    <div className="text-gray-400">
                      <PaperClipIcon className="h-8 w-8 mx-auto mb-2" />
                      <p className="text-sm">Click or drag to upload image</p>
                    </div>
                  )}
                </div>

                {selectedImage && (
                  <>
                    <input 
                      type="text" 
                      value={imagePrompt}
                      onChange={(e) => setImagePrompt(e.target.value)}
                      placeholder="What do you want to know about this image?"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                    <button 
                      onClick={handleAnalyzeImage}
                      disabled={loadingState === LoadingState.IMAGE_ANALYZING}
                      className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm hover:bg-indigo-700 disabled:opacity-50 flex justify-center"
                    >
                      {loadingState === LoadingState.IMAGE_ANALYZING ? (
                        <span className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
                      ) : "Analyze Image"}
                    </button>
                  </>
                )}

                {imageAnalysisResult && (
                   <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 text-sm text-gray-700">
                     <h3 className="font-semibold mb-2 text-indigo-600">Analysis Result</h3>
                     <p className="whitespace-pre-wrap">{imageAnalysisResult}</p>
                   </div>
                )}
              </div>
            )}

          </div>
        </div>

        {/* Right Content: Embedded Article (Iframe) */}
        <div className="flex-1 bg-gray-100 relative overflow-hidden flex flex-col">
           {!iframeHtml ? (
             <div className="flex flex-col items-center justify-center h-full text-gray-400">
               <BookOpenIcon className="h-16 w-16 mb-4 opacity-30" />
               <p className="text-lg font-medium">Article View</p>
               <p className="text-sm mt-2">Enter a URL to browse and analyze.</p>
             </div>
           ) : (
             <iframe 
                ref={iframeRef}
                title="Article Content"
                className="w-full h-full border-none bg-white"
                sandbox="allow-same-origin" 
             />
           )}

           {/* Dictionary Popup/Tooltip (Overlaid on top of Iframe area) */}
           {dictionary && (
            <div className="absolute bottom-6 right-6 w-80 bg-white rounded-xl shadow-2xl border border-gray-200 p-4 z-50 animate-slide-up">
               <div className="flex justify-between items-start mb-2">
                 <div className="flex items-center gap-2">
                    <h3 className="text-xl font-bold text-indigo-700">{dictionary.word}</h3>
                    <button 
                      onClick={() => handlePlayAudio(dictionary.word)}
                      className="text-indigo-400 hover:text-indigo-600 p-1 rounded-full hover:bg-indigo-50"
                      title="Listen"
                    >
                      <SpeakerWaveIcon className="h-5 w-5" />
                    </button>
                 </div>
                 <button onClick={() => setDictionary(null)} className="text-gray-400 hover:text-gray-600">
                   <XMarkIcon className="h-5 w-5" />
                 </button>
               </div>
               
               <div className="space-y-3 text-sm">
                 <div>
                   <span className="font-semibold text-gray-500 text-xs uppercase">English</span>
                   <p className="text-gray-800">{dictionary.englishDefinition}</p>
                 </div>
                 <div>
                   <span className="font-semibold text-gray-500 text-xs uppercase">Chinese</span>
                   <p className="text-gray-800">{dictionary.chineseDefinition}</p>
                 </div>
                 <div className="bg-indigo-50 p-2 rounded-lg">
                   <span className="font-semibold text-indigo-500 text-xs uppercase">Context</span>
                   <p className="text-indigo-900 italic">{dictionary.contextExplanation}</p>
                 </div>
               </div>
            </div>
          )}
        </div>
      </div>

      {/* Custom Context Menu (Rendered in top level) */}
      {contextMenuPos && (
        <div 
          className="fixed bg-white shadow-lg rounded-lg py-1 z-[100] border border-gray-200 min-w-[150px]"
          style={{ top: contextMenuPos.y, left: contextMenuPos.x }}
        >
          <button 
            onClick={handleDefineWord}
            className="w-full text-left px-4 py-2 hover:bg-indigo-50 text-sm text-gray-700 flex items-center gap-2"
          >
            <MagnifyingGlassIcon className="h-4 w-4" />
            Explain "{selectedTextData?.word.substring(0, 12)}..."
          </button>
        </div>
      )}
      
      {loadingState === LoadingState.DEFINING && (
        <div 
          className="fixed bg-gray-900 text-white text-xs px-3 py-1 rounded shadow-lg z-[100] pointer-events-none"
          style={{ 
            top: contextMenuPos ? contextMenuPos.y + 10 : 0, 
            left: contextMenuPos ? contextMenuPos.x + 10 : 0 
          }}
        >
          Defining...
        </div>
      )}

    </div>
  );
};

export default App;