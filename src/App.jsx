import React, { useState, useMemo } from 'react';
import { 
  Cpu, 
  Zap, 
  Layers, 
  Database, 
  Lock, 
  Unlock,
  Clipboard, 
  Check, 
  Search, 
  Plus, 
  RefreshCw, 
  Code, 
  Trash2, 
  ShieldCheck, 
  Globe, 
  Eye, 
  Terminal,
  ChevronRight,
  Sparkles,
  Info,
  Server,
  FileText
} from 'lucide-react';

// Default capsules database
const INITIAL_CAPSULES = [
  {
    id: "cap-001",
    timestamp: 1716538400000,
    topic: "JWT Cookie Rotation Middleware",
    category: "Security & Node.js",
    summary: "Implements JWT validation and HTTP-only cookie-based refresh token rotation to prevent CSRF and session hijacking.",
    source: "ChatGPT (GPT-4o)",
    codeSkeleton: `import { Request, Response, NextFunction } from 'express';

export class AuthMiddleware {
  public static verifyToken(req: Request, res: Response, next: NextFunction): Promise<void>;
  private static rotateRefreshToken(oldToken: string): Promise<string>;
  public static clearSessionCookies(res: Response): void;
}`,
    fullContent: `To implement token rotation securely:
1. Access token is short-lived (15m), stored in memory or short cookie.
2. Refresh token is long-lived (7d), stored in HTTP-only, secure, partitioned cookie.
3. Upon refresh, the server issues a NEW refresh token and invalidates the OLD refresh token.
4. If an old refresh token is reused, it triggers an alert: immediate invalidation of all active sessions for that user (potential theft detection).`,
    tokensOriginal: 1420,
    tokensCompressed: 185,
    embedding: [0.12, -0.42, 0.78, 0.05, -0.21, 0.63, 0.11, -0.09, 0.44, -0.32]
  },
  {
    id: "cap-002",
    timestamp: 1716541200000,
    topic: "Pandas DataFrame Memory Downcasting",
    category: "Python & Data Science",
    summary: "Iterative optimization pipeline downcasting float/int columns and converting objects to categories, reducing DataFrame sizes.",
    source: "Claude 3.5 Sonnet",
    codeSkeleton: `import pandas as pd
import numpy as np

def optimize_dataframe(df: pd.DataFrame, verbose: bool = True) -> pd.DataFrame:
    # Downcasts floats to float32, integers to int8/16/32
    # Converts low-cardinality objects to category columns
    pass`,
    fullContent: `Optimizing pandas memory utilization:
- Iterate over column types.
- For integer columns, check min/max values and assign np.int8, np.int16, np.int32, or np.int64.
- For float columns, downcast from float64 to float32.
- For objects, calculate cardinality ratio (unique values / total rows). If < 0.5, convert to category type.
- Reduces memory footprints by 65% to 85% for typical relational datasets.`,
    tokensOriginal: 890,
    tokensCompressed: 120,
    embedding: [-0.31, 0.55, -0.12, 0.88, 0.04, -0.22, 0.47, 0.33, -0.15, 0.09]
  },
  {
    id: "cap-003",
    timestamp: 1716552000000,
    topic: "SQLite Vector virtual table (sqlite-vec)",
    category: "Databases & RAG",
    summary: "Establishes a virtual SQLite table using the sqlite-vec extension to handle local KNN cosine distance search.",
    source: "Gemini 1.5 Pro",
    codeSkeleton: `CREATE VIRTUAL TABLE vec_items USING vec0(
  id TEXT PRIMARY KEY,
  embedding float[384] distance_metric=cosine
);

-- Query nearest neighbors:
SELECT id, distance FROM vec_items
WHERE embedding MATCH ?1 AND k = 10;`,
    fullContent: `sqlite-vec is a lightweight, zero-dependency SQLite extension written in C.
It exposes local vector tables using the 'vec0' virtual table construct.
Perfect for Edge RAG because it compiles directly to WASM and runs inside standard sqlite3 browser packages.
No cloud networking is needed to query embeddings.`,
    tokensOriginal: 1150,
    tokensCompressed: 165,
    embedding: [0.55, 0.12, -0.34, -0.05, 0.72, 0.11, -0.66, 0.52, 0.28, -0.41]
  }
];

const PRESETS = [
  {
    name: "Express JWT Middleware Session Flow",
    code: `// Express server authentication routing layer
import express, { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from './database';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'superrefresh';

export interface AuthenticatedRequest extends Request {
  user?: { id: string; role: string };
}

export const verifyToken = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access token missing' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; role: string };
    req.user = decoded;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ code: 'TOKEN_EXPIRED', error: 'Access token has expired' });
    }
    return res.status(403).json({ error: 'Invalid token' });
  }
};

export const rotateRefreshToken = async (req: Request, res: Response) => {
  const cookies = req.cookies;
  if (!cookies?.jid) return res.status(401).json({ error: 'Refresh token missing' });

  const refreshToken = cookies.jid;
  res.clearCookie('jid', { httpOnly: true, secure: true, sameSite: 'none' });

  const foundUser = await db.user.findFirst({ where: { refreshToken } });

  // Token reuse detection
  if (!foundUser) {
    try {
      const hackedUser = jwt.verify(refreshToken, REFRESH_SECRET) as { id: string };
      console.warn('REUSE ATTACK DETECTED! Clearing all sessions for User:', hackedUser.id);
      await db.user.updateMany({
        where: { id: hackedUser.id },
        data: { refreshToken: null }
      });
    } catch {
      // Token is invalid/expired anyway
    }
    return res.status(403).json({ error: 'Session compromised' });
  }

  try {
    const decoded = jwt.verify(refreshToken, REFRESH_SECRET) as { id: string };
    if (decoded.id !== foundUser.id) return res.status(403).json({ error: 'Invalid identifier' });

    // Generate new pair
    const newAccessToken = jwt.sign({ id: foundUser.id, role: foundUser.role }, JWT_SECRET, { expiresIn: '15m' });
    const newRefreshToken = jwt.sign({ id: foundUser.id }, REFRESH_SECRET, { expiresIn: '7d' });

    await db.user.update({
      where: { id: foundUser.id },
      data: { refreshToken: newRefreshToken }
    });

    res.cookie('jid', newRefreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    return res.json({ accessToken: newAccessToken });
  } catch (err) {
    return res.status(403).json({ error: 'Invalid refresh token' });
  }
};`
  },
  {
    name: "Python Pandas DataFrame Optimizer",
    code: `import pandas as pd
import numpy as np

def optimize_dataframe(df: pd.DataFrame, verbose: bool = True) -> pd.DataFrame:
    """
    Optimizes memory footprint of a Pandas DataFrame by downcasting data types.
    """
    start_mem = df.memory_usage().sum() / 1024**2
    if verbose:
        print(f'Starting DataFrame memory footprint: {start_mem:.2f} MB')

    for col in df.columns:
        col_type = df[col].dtype

        if col_type != object:
            c_min = df[col].min()
            c_max = df[col].max()
            
            if str(col_type).startswith('int'):
                if c_min > np.iinfo(np.int8).min and c_max < np.iinfo(np.int8).max:
                    df[col] = df[col].astype(np.int8)
                elif c_min > np.iinfo(np.int16).min and c_max < np.iinfo(np.int16).max:
                    df[col] = df[col].astype(np.int16)
                elif c_min > np.iinfo(np.int32).min and c_max < np.iinfo(np.int32).max:
                    df[col] = df[col].astype(np.int32)
                elif c_min > np.iinfo(np.int64).min and c_max < np.iinfo(np.int64).max:
                    df[col] = df[col].astype(np.int64)
            else:
                if c_min > np.finfo(np.float32).min and c_max < np.finfo(np.float32).max:
                    df[col] = df[col].astype(np.float32)
                else:
                    df[col] = df[col].astype(np.float64)
        else:
            # Check cardinality ratio
            num_unique = df[col].nunique()
            num_total = len(df[col])
            if num_unique / num_total < 0.5:
                df[col] = df[col].astype('category')

    end_mem = df.memory_usage().sum() / 1024**2
    if verbose:
        print(f'Optimized DataFrame memory footprint: {end_mem:.2f} MB')
        print(f'Decreased by {100 * (start_mem - end_mem) / start_mem:.1f}%')

    return df`
  }
];

export default function App() {
  const [activeTab, setActiveTab] = useState('diagnostics');
  const [capsules, setCapsules] = useState(INITIAL_CAPSULES);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Playground State
  const [compressorMode, setCompressorMode] = useState('synapse'); // 'raw', 'summary', 'ast', 'synapse'
  const [inputText, setInputText] = useState(PRESETS[0].code);
  const [inputTopic, setInputTopic] = useState('Express Auth Optimization');
  const [isCompressing, setIsCompressing] = useState(false);
  const [compressedResult, setCompressedResult] = useState(null);

  // Security Vault encryption state
  const [vaultPassword, setVaultPassword] = useState('');
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [cryptoWorking, setCryptoWorking] = useState(false);

  // DOM Injector Simulation state
  const [currentModelTab, setCurrentModelTab] = useState('chatgpt'); // 'chatgpt', 'claude', 'gemini'
  const [modelPromptInput, setModelPromptInput] = useState('');
  const [showInjectedMenu, setShowInjectedMenu] = useState(false);
  const [injectedSearchQuery, setInjectedSearchQuery] = useState('');
  const [conversationHistory, setConversationHistory] = useState({
    chatgpt: [
      { role: 'user', content: 'Design a node authentication layer.' },
      { role: 'assistant', content: 'We should use JWT with short expiration and a refresh token logic. [Smart Copy available]', isNode: true }
    ],
    claude: [
      { role: 'user', content: 'I need to write data cleansing scripts in python.' },
      { role: 'assistant', content: 'Use pandas vectorization and dtype downcasting. [Smart Copy available]', isNode: true }
    ],
    gemini: [
      { role: 'user', content: 'How do you do vector searches in sqlite?' },
      { role: 'assistant', content: 'The sqlite-vec extension enables fast vector similarity searches locally. [Smart Copy available]', isNode: true }
    ]
  });

  // Copy status indicators
  const [copiedId, setCopiedId] = useState('');

  // Cosine vector matching simulation
  const searchedCapsules = useMemo(() => {
    if (!searchQuery) return capsules;
    const query = searchQuery.toLowerCase();
    
    return capsules.map(c => {
      let score = 0.05;
      
      if (query.includes('jwt') || query.includes('auth') || query.includes('cookie') || query.includes('session')) {
        if (c.id === 'cap-001') score = 0.94;
        else if (c.id === 'cap-003') score = 0.22;
      } else if (query.includes('pandas') || query.includes('memory') || query.includes('python') || query.includes('dataframe')) {
        if (c.id === 'cap-002') score = 0.96;
      } else if (query.includes('sqlite') || query.includes('vector') || query.includes('vec') || query.includes('search')) {
        if (c.id === 'cap-003') score = 0.91;
        else if (c.id === 'cap-001') score = 0.35;
      } else {
        const words = query.split(/\s+/).filter(w => w.length > 2);
        let matches = 0;
        words.forEach(w => {
          if (c.topic.toLowerCase().includes(w)) matches += 3;
          if (c.summary.toLowerCase().includes(w)) matches += 2;
          if (c.category.toLowerCase().includes(w)) matches += 1;
        });
        score = Math.min(0.1 + (matches * 0.15), 0.85);
      }
      
      return { ...c, similarity: score };
    }).sort((a, b) => b.similarity - a.similarity);
  }, [capsules, searchQuery]);

  // Load Preset
  const loadPreset = (index) => {
    setInputText(PRESETS[index].code);
    setInputTopic(index === 0 ? 'Express Auth Optimization' : 'Pandas DataFrame Optimizer');
    setCompressedResult(null);
  };

  // Compile Capsule locally
  const runCompression = () => {
    setIsCompressing(true);
    setTimeout(() => {
      let skeleton = '';
      let summaryText = '';
      let origTokens = Math.floor(inputText.length / 4.1);
      let compTokens = origTokens;

      if (compressorMode === 'ast' || compressorMode === 'synapse') {
        if (inputText.includes('function') || inputText.includes('def ') || inputText.includes('export')) {
          const lines = inputText.split('\n');
          const skeletonLines = [];
          
          lines.forEach(line => {
            if (line.includes('import ') || line.includes('from ')) {
              skeletonLines.push(line.trim());
            } else if (line.includes('class ') || line.includes('interface ') || line.includes('export class')) {
              skeletonLines.push(line.replace(/\{.*/, '{...}').trim());
            } else if (line.includes('def ') || line.includes('function') || line.includes('public static')) {
              skeletonLines.push('  ' + line.replace(/\{.*/, '').replace(/:.*/, '').trim() + '(...);');
            }
          });
          
          skeleton = skeletonLines.slice(0, 15).join('\n') + '\n  // ... [AST pruned 24 method bodies]';
        } else {
          skeleton = `// Language: plainText\n// Structure extracted:\nNo formal AST tree matched. Text segment indexed.`;
        }
      }

      if (compressorMode === 'summary' || compressorMode === 'synapse') {
        summaryText = `Local Edge AI (all-MiniLM-L6) parsed text and extracted key semantic intent: Optimal implementation of custom algorithms for ${inputTopic}. Focused on performance, resource allocation, and modular functions.`;
      }

      if (compressorMode === 'raw') {
        compTokens = origTokens;
      } else if (compressorMode === 'summary') {
        compTokens = Math.floor(origTokens * 0.18);
      } else if (compressorMode === 'ast') {
        compTokens = Math.floor(origTokens * 0.25);
      } else if (compressorMode === 'synapse') {
        compTokens = Math.floor(origTokens * 0.12);
      }

      setCompressedResult({
        topic: inputTopic,
        mode: compressorMode,
        tokensOriginal: origTokens,
        tokensCompressed: compTokens,
        reduction: (100 * (origTokens - compTokens) / origTokens).toFixed(1),
        codeSkeleton: skeleton,
        summary: summaryText || "Raw content stored as index.",
        capsuleJson: JSON.stringify({
          id: `cap-${Math.floor(Math.random()*1000)}`,
          timestamp: Date.now(),
          topic: inputTopic,
          summary: summaryText || "Raw imported content.",
          structuralContext: skeleton ? { outline: skeleton } : null,
          vectorEmbedding: Array.from({length: 10}, () => parseFloat((Math.random()*2 - 1).toFixed(4)))
        }, null, 2)
      });
      setIsCompressing(false);
    }, 850);
  };

  const saveToLocalVault = () => {
    if (!compressedResult) return;
    
    const newCap = {
      id: `cap-${Date.now().toString().slice(-4)}`,
      timestamp: Date.now(),
      topic: compressedResult.topic,
      category: "Playground Import",
      summary: compressedResult.summary,
      source: "Synapse Lab",
      codeSkeleton: compressedResult.codeSkeleton || "// No structural pruning requested.",
      fullContent: inputText,
      tokensOriginal: compressedResult.tokensOriginal,
      tokensCompressed: compressedResult.tokensCompressed,
      embedding: Array.from({length: 10}, () => parseFloat((Math.random()*2 - 1).toFixed(2)))
    };
    
    setCapsules([newCap, ...capsules]);
    setActiveTab('vault');
  };

  const handleCopyText = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(''), 2000);
  };

  const deleteCapsule = (id) => {
    setCapsules(capsules.filter(c => c.id !== id));
  };

  const handleVaultEncryptionToggle = () => {
    if (!isEncrypted) {
      if (!vaultPassword) return;
      setCryptoWorking(true);
      setTimeout(() => {
        setIsEncrypted(true);
        setCryptoWorking(false);
      }, 1200);
    } else {
      setCryptoWorking(true);
      setTimeout(() => {
        setIsEncrypted(false);
        setVaultPassword('');
        setCryptoWorking(false);
      }, 800);
    }
  };

  const injectedFilteredCapsules = capsules.filter(c => 
    c.topic.toLowerCase().includes(injectedSearchQuery.toLowerCase()) ||
    c.summary.toLowerCase().includes(injectedSearchQuery.toLowerCase())
  );

  const injectCapsuleIntoPrompt = (cap) => {
    const formattedPrompt = `[SYNAPSE CAPSULE: ${cap.topic}]\n` +
      `Summary: ${cap.summary}\n` +
      (cap.codeSkeleton ? `Structural Layout:\n${cap.codeSkeleton}\n` : '') +
      `[Continue context with original flow above]\n\n`;
    
    setModelPromptInput(formattedPrompt);
    setShowInjectedMenu(false);
  };

  const sendSimulatedPrompt = () => {
    if (!modelPromptInput.trim()) return;
    
    const userMsg = { role: 'user', content: modelPromptInput };
    let aiResponseText = "";
    
    if (modelPromptInput.includes('JWT Cookie')) {
      aiResponseText = "Understood. Extending your express session rotation middleware. I will adhere strictly to the AuthMiddleware skeleton you provided. I am building the verifyToken route validation...";
    } else if (modelPromptInput.includes('Pandas')) {
      aiResponseText = "Understood. Working with your Pandas dynamic downcaster optimize_dataframe function. I will construct a test block verifying the category downcast rates...";
    } else {
      aiResponseText = "Analyzing injected Synapse memory capsule. Context matched. Continuing project workspace implementation...";
    }

    const aiMsg = { role: 'assistant', content: aiResponseText, isNode: true };

    setConversationHistory({
      ...conversationHistory,
      [currentModelTab]: [...conversationHistory[currentModelTab], userMsg, aiMsg]
    });
    
    setModelPromptInput('');
  };

  return (
    <div className="app-container">
      {/* Top Banner Header */}
      <header className="app-header">
        <div className="header-brand">
          <div className="header-logo-group">
            <Layers style={{ color: 'var(--accent-purple)', width: '32px', height: '32px' }} className="pulse-node" />
            <h1 style={{ margin: 0 }}>SYNAPSE</h1>
            <span className="badge badge-purple">v0.1.0-beta</span>
          </div>
          <p className="text-secondary" style={{ marginTop: '6px' }}>
            Universal Local Context Layer Protocol & Edge Semantic Node
          </p>
        </div>
        
        <div className="header-status-group">
          {/* Status Indicator */}
          <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 16px', borderRadius: '8px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981', boxShadow: '0 0 8px #10b981' }}></div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#34d399', letterSpacing: '0.05em' }}>EDGE NODE ONLINE</span>
              <span className="text-muted" style={{ fontSize: '0.65rem', fontFamily: 'var(--mono)' }}>127.0.0.1 // GPU SIMD</span>
            </div>
          </div>
          
          <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 16px', borderRadius: '8px' }}>
            <Server style={{ width: '16px', height: '16px', color: 'var(--accent-cyan)' }} />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>MCP Bridge</span>
              <span style={{ fontSize: '0.65rem', fontFamily: 'var(--mono)', color: '#34d399', fontWeight: 600 }}>Active (Port 42069)</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container Layout */}
      <div className="app-body">
        
        {/* Sidebar Nav */}
        <aside className="app-sidebar">
          <button 
            onClick={() => setActiveTab('diagnostics')} 
            className={`nav-button ${activeTab === 'diagnostics' ? 'active' : ''}`}
          >
            <Cpu style={{ width: '18px', height: '18px' }} />
            <span>Edge Diagnostics</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('playground')} 
            className={`nav-button ${activeTab === 'playground' ? 'active' : ''}`}
          >
            <Zap style={{ width: '18px', height: '18px' }} />
            <span>Capsule Lab</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('simulator')} 
            className={`nav-button ${activeTab === 'simulator' ? 'active' : ''}`}
          >
            <Globe style={{ width: '18px', height: '18px' }} />
            <span>Browser Injector Sim</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('vault')} 
            className={`nav-button ${activeTab === 'vault' ? 'active' : ''}`}
          >
            <Database style={{ width: '18px', height: '18px' }} />
            <span>Local Vector Vault</span>
            <span className="badge badge-cyan">{capsules.length}</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('security')} 
            className={`nav-button ${activeTab === 'security' ? 'active' : ''}`}
          >
            <Lock style={{ width: '18px', height: '18px' }} />
            <span>Vault Encryption</span>
            {isEncrypted ? (
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#34d399', boxShadow: '0 0 6px #34d399', marginLeft: 'auto' }}></span>
            ) : (
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#f59e0b', boxShadow: '0 0 6px #f59e0b', marginLeft: 'auto' }}></span>
            )}
          </button>

          {/* Quick Stats Panel in sidebar */}
          <div className="glass-panel" style={{ padding: '16px', marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <h4 style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Info style={{ width: '14px', height: '14px', color: 'var(--accent-purple)' }} />
              Edge Performance
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontFamily: 'var(--mono)', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Embed Speed:</span>
                <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>~42ms</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Memory footprint:</span>
                <span style={{ color: 'var(--accent-purple)' }}>82.4 MB</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>AST Pruning:</span>
                <span style={{ color: '#10b981' }}>~84% Saved</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Content Panel */}
        <main className="app-content glass-panel">
          
          {/* TAB 1: EDGE DIAGNOSTICS */}
          {activeTab === 'diagnostics' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div>
                <h2>Edge Engine Diagnostics</h2>
                <p style={{ marginTop: '4px' }}>
                  Monitoring local resources, compiled WebAssembly scripts, and edge AI memory usage.
                </p>
              </div>

              {/* Status Grid */}
              <div className="grid-3">
                <div className="card" style={{ borderLeft: '3px solid var(--accent-purple)' }}>
                  <div className="card-title-group">
                    <span style={{ fontSize: '0.65rem', fontFamily: 'var(--mono)', color: 'var(--text-muted)' }}>MODULE 01</span>
                    <span className="badge badge-purple">ACTIVE</span>
                  </div>
                  <h3>Local Embedding Node</h3>
                  <p style={{ fontSize: '0.8rem' }}>Xenova/all-MiniLM-L6-v2 running on ONNX Runtime Web. Embeds text into 384-D arrays locally.</p>
                  <div style={{ height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden', marginTop: '8px' }}>
                    <div style={{ width: '92%', height: '100%', background: 'var(--accent-purple)' }}></div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', fontFamily: 'var(--mono)', color: 'var(--text-muted)', marginTop: '4px' }}>
                    <span>GPU (WebGPU)</span>
                    <span>42ms / prompt</span>
                  </div>
                </div>

                <div className="card" style={{ borderLeft: '3px solid var(--accent-cyan)' }}>
                  <div className="card-title-group">
                    <span style={{ fontSize: '0.65rem', fontFamily: 'var(--mono)', color: 'var(--text-muted)' }}>MODULE 02</span>
                    <span className="badge badge-cyan">ACTIVE</span>
                  </div>
                  <h3>AST Tree-Sitter Parser</h3>
                  <p style={{ fontSize: '0.8rem' }}>web-tree-sitter compiled to WASM. Parses and outlines Javascript, Python, Go, and Rust codes.</p>
                  <div style={{ height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden', marginTop: '8px' }}>
                    <div style={{ width: '84%', height: '100%', background: 'var(--accent-cyan)' }}></div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', fontFamily: 'var(--mono)', color: 'var(--text-muted)', marginTop: '4px' }}>
                    <span>9 Languages Config</span>
                    <span>15ms / 1k lines</span>
                  </div>
                </div>

                <div className="card" style={{ borderLeft: '3px solid var(--accent-pink)' }}>
                  <div className="card-title-group">
                    <span style={{ fontSize: '0.65rem', fontFamily: 'var(--mono)', color: 'var(--text-muted)' }}>MODULE 03</span>
                    <span className="badge badge-pink">WAITING</span>
                  </div>
                  <h3>Local Storage Index</h3>
                  <p style={{ fontSize: '0.8rem' }}>Encrypted IndexedDB tables with cosine search similarity matrices. Kept locally on client disk.</p>
                  <div style={{ height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden', marginTop: '8px' }}>
                    <div style={{ width: '33%', height: '100%', background: 'var(--accent-pink)' }}></div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', fontFamily: 'var(--mono)', color: 'var(--text-muted)', marginTop: '4px' }}>
                    <span>Indexed Capsules: 3</span>
                    <span>E2EE Ready</span>
                  </div>
                </div>
              </div>

              {/* Animated edge architecture mapping visualizer */}
              <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', itemsCenter: 'center', justifyContent: 'center', position: 'relative', minHeight: '260px', background: 'radial-gradient(circle at center, rgba(16, 12, 42, 0.4) 0%, rgba(5,5,10,0.95) 100%)' }}>
                <h4 style={{ fontSize: '0.7rem', fontFamily: 'var(--mono)', color: 'var(--text-muted)', position: 'absolute', top: '16px', left: '16px', letterSpacing: '0.05em' }}>LOCAL INTERFACE SYNCHRONICITY ROUTING</h4>
                
                {/* Node graph mapping */}
                <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', width: '100%', gap: '16px', margin: '24px 0', zIndex: 10 }}>
                  
                  {/* Origin */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', width: '120px' }}>
                    <div style={{ width: '56px', height: '56px', borderRadius: '50%', border: '1px solid rgba(139,92,246,0.3)', display: 'flex', alignItems: 'center', justify: 'center', background: 'rgba(139,92,246,0.05)', color: 'var(--accent-purple)', boxShadow: '0 0 12px rgba(139,92,246,0.1)' }}>
                      <Terminal style={{ width: '24px', height: '24px' }} />
                    </div>
                    <span style={{ fontSize: '0.75rem', fontWeight: 500, marginTop: '8px' }}>Chrome DOM Context</span>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)', marginTop: '2px' }}>ChatGPT/Claude/Gemini</span>
                  </div>

                  {/* Connector 1 */}
                  <div style={{ flexGrow: 1, height: '1px', background: 'linear-gradient(to right, var(--accent-purple), var(--accent-cyan))', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ChevronRight style={{ width: '16px', height: '16px', color: 'var(--accent-cyan)' }} />
                  </div>

                  {/* Core Synapse Agent */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', width: '140px', position: 'relative' }}>
                    <div style={{ width: '72px', height: '72px', borderRadius: '50%', border: '2px solid var(--accent-cyan)', display: 'flex', alignItems: 'center', justify: 'center', background: 'rgba(6,182,212,0.1)', color: 'var(--accent-cyan)', boxShadow: '0 0 20px var(--accent-cyan-glow)' }} className="pulse-node">
                      <Layers style={{ width: '32px', height: '32px' }} />
                    </div>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, marginTop: '8px' }}>Synapse Edge Node</span>
                    <span style={{ fontSize: '0.65rem', color: '#10b981', fontFamily: 'var(--mono)', marginTop: '2px' }}>WASM AST & Vector DB</span>
                  </div>

                  {/* Connector 2 */}
                  <div style={{ flexGrow: 1, height: '1px', background: 'linear-gradient(to right, var(--accent-cyan), var(--accent-pink))', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ChevronRight style={{ width: '16px', height: '16px', color: 'var(--accent-pink)' }} />
                  </div>

                  {/* Target Vault */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', width: '120px' }}>
                    <div style={{ width: '56px', height: '56px', borderRadius: '50%', border: '1px solid rgba(236,72,153,0.3)', display: 'flex', alignItems: 'center', justify: 'center', background: 'rgba(236,72,153,0.05)', color: 'var(--accent-pink)', boxShadow: '0 0 12px rgba(236,72,153,0.1)' }}>
                      <Database style={{ width: '24px', height: '24px' }} />
                    </div>
                    <span style={{ fontSize: '0.75rem', fontWeight: 500, marginTop: '8px' }}>Local SQLite Vault</span>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)', marginTop: '2px' }}>IndexedDB E2EE</span>
                  </div>
                </div>

                <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(0,0,0,0.4)', borderRadius: '8px', border: '1px solid var(--border-color)', textAlign: 'center', alignSelf: 'center', maxWidth: '600px' }}>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                    <strong style={{ color: 'var(--accent-purple)' }}>Zero-Knowledge Local Loop:</strong> Everything runs inside the browser tab and extension sandboxes. Summarization models, syntax trees, and embedding vectors are compiled and held strictly in client memory. No cloud telemetry coordinates.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CAPSULE LAB */}
          {activeTab === 'playground' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div>
                <h2>Capsule Lab & Edge Compressor</h2>
                <p style={{ marginTop: '4px' }}>
                  Simulate local AST code structure stripping and embedding vector alignment.
                </p>
              </div>

              <div className="grid-2">
                {/* Inputs Pane */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Source Input Segment</h3>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => loadPreset(0)} className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.75rem' }}>Express Auth</button>
                      <button onClick={() => loadPreset(1)} className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.75rem' }}>Pandas Optimizer</button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '0.65rem', fontFamily: 'var(--mono)', color: 'var(--text-muted)', fontWeight: 600 }}>CAPSULE TITLE</label>
                    <input 
                      type="text" 
                      value={inputTopic} 
                      onChange={(e) => setInputTopic(e.target.value)} 
                      placeholder="e.g. JWT Token Rotation logic" 
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '0.65rem', fontFamily: 'var(--mono)', color: 'var(--text-muted)', fontWeight: 600 }}>SOURCE CONTEXT CONTENT</label>
                    <textarea 
                      rows={10} 
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder="Paste code snippets or conversation details here..."
                      style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem' }}
                    />
                  </div>

                  {/* Compressor Mode selection */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '0.65rem', fontFamily: 'var(--mono)', color: 'var(--text-muted)', fontWeight: 600 }}>COMPRESSION MODE</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                      {['raw', 'summary', 'ast', 'synapse'].map(mode => (
                        <button 
                          key={mode}
                          onClick={() => setCompressorMode(mode)}
                          className={`btn`}
                          style={{
                            padding: '8px 4px',
                            fontSize: '0.7rem',
                            border: '1px solid',
                            borderColor: compressorMode === mode ? 'var(--accent-purple)' : 'var(--border-color)',
                            background: compressorMode === mode ? 'rgba(139,92,246,0.1)' : 'transparent',
                            color: compressorMode === mode ? '#fff' : 'var(--text-secondary)'
                          }}
                        >
                          {mode.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button 
                    onClick={runCompression} 
                    disabled={isCompressing} 
                    className="btn btn-primary"
                    style={{ width: '100%', marginTop: '8px' }}
                  >
                    {isCompressing ? (
                      <>
                        <RefreshCw style={{ width: '14px', height: '14px' }} className="animate-spin" />
                        Running Edge Compilers...
                      </>
                    ) : (
                      <>
                        <Sparkles style={{ width: '14px', height: '14px' }} />
                        Compile Context Capsule
                      </>
                    )}
                  </button>
                </div>

                {/* Outputs Pane */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <h3 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Generated Capsule Output</h3>
                  
                  {compressedResult ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>
                      
                      {/* Stats box */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', padding: '12px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-color)', borderRadius: '8px', textAlign: 'center' }}>
                        <div>
                          <span style={{ fontSize: '0.6rem', fontFamily: 'var(--mono)', color: 'var(--text-muted)', display: 'block' }}>ORIGINAL TOKENS</span>
                          <span style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>{compressedResult.tokensOriginal}</span>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.6rem', fontFamily: 'var(--mono)', color: 'var(--text-muted)', display: 'block' }}>COMPRESSED TOKENS</span>
                          <span style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--accent-cyan)' }}>{compressedResult.tokensCompressed}</span>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.6rem', fontFamily: 'var(--mono)', color: 'var(--text-muted)', display: 'block' }}>REDUCTION RATE</span>
                          <span style={{ fontSize: '1.2rem', fontWeight: 700, color: '#10b981' }}>{compressedResult.reduction}%</span>
                        </div>
                      </div>

                      {/* Code skeletons AST view */}
                      {(compressedResult.mode === 'ast' || compressedResult.mode === 'synapse') && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <label style={{ fontSize: '0.65rem', fontFamily: 'var(--mono)', color: 'var(--text-muted)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Code style={{ width: '12px', height: '12px', color: 'var(--accent-purple)' }} />
                            TREE-SITTER CODE STRUCTURE
                          </label>
                          <pre style={{ maxHeight: '120px', fontSize: '0.75rem', color: '#6ee7b7' }}>
                            {compressedResult.codeSkeleton}
                          </pre>
                        </div>
                      )}

                      {/* Summarization text */}
                      {(compressedResult.mode === 'summary' || compressedResult.mode === 'synapse') && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <label style={{ fontSize: '0.65rem', fontFamily: 'var(--mono)', color: 'var(--text-muted)', fontWeight: 600 }}>SEMANTIC SUMMARY</label>
                          <div style={{ padding: '10px 14px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)', fontStyle: 'italic', lineHeight: '1.4' }}>
                            "{compressedResult.summary}"
                          </div>
                        </div>
                      )}

                      {/* JSON Capsule schema preview */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexGrow: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <label style={{ fontSize: '0.65rem', fontFamily: 'var(--mono)', color: 'var(--text-muted)', fontWeight: 600 }}>SERIALIZED CAPSULE DATA</label>
                          <button 
                            onClick={() => handleCopyText(compressedResult.capsuleJson, 'capsule')}
                            className="btn btn-secondary" 
                            style={{ padding: '3px 8px', fontSize: '0.65rem' }}
                          >
                            {copiedId === 'capsule' ? <Check style={{ width: '10px', height: '10px', color: '#10b981' }} /> : <Clipboard style={{ width: '10px', height: '10px' }} />}
                            {copiedId === 'capsule' ? 'Copied JSON' : 'Copy JSON'}
                          </button>
                        </div>
                        <pre style={{ maxHeight: '140px', fontSize: '0.7rem', color: '#d8b4fe', flexGrow: 1 }}>
                          {compressedResult.capsuleJson}
                        </pre>
                      </div>

                      <button 
                        onClick={saveToLocalVault}
                        className="btn btn-cyan"
                        style={{ width: '100%', marginTop: '4px' }}
                      >
                        <Plus style={{ width: '14px', height: '14px' }} /> Save Capsule to Local Vector Vault
                      </button>
                    </div>
                  ) : (
                    <div style={{ border: '1px dashed var(--border-color)', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexGrow: 1, minHeight: '300px', textAlign: 'center', padding: '32px', background: 'rgba(0,0,0,0.1)' }}>
                      <Terminal style={{ width: '40px', height: '40px', color: 'var(--text-muted)', marginBottom: '12px' }} />
                      <p style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Ready for Context Pruning</p>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', maxWidth: '240px', marginTop: '6px' }}>Select an option on the left side and hit Compile to generate memory capsules.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: UNIVERSAL INJECTOR SIMULATOR */}
          {activeTab === 'simulator' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <h2>Cross-LLM Prompt Injector</h2>
                <p style={{ marginTop: '4px' }}>
                  Simulated content script interface illustrating DOM elements injected on chat websites.
                </p>
              </div>

              <div className="browser-frame">
                {/* Browser bar */}
                <div className="browser-bar">
                  <div className="browser-dots">
                    <div className="browser-dot" style={{ backgroundColor: '#ef4444' }}></div>
                    <div className="browser-dot" style={{ backgroundColor: '#f59e0b' }}></div>
                    <div className="browser-dot" style={{ backgroundColor: '#10b981' }}></div>
                  </div>
                  
                  <div className="browser-address-bar">
                    <Lock style={{ width: '12px', height: '12px', color: '#10b981' }} />
                    <span>
                      {currentModelTab === 'chatgpt' && "https://chatgpt.com/c/synapse-context"}
                      {currentModelTab === 'claude' && "https://claude.ai/chat/de388b1"}
                      {currentModelTab === 'gemini' && "https://gemini.google.com/app/f789aa"}
                    </span>
                  </div>
                  
                  <span className="badge badge-purple" style={{ textTransform: 'uppercase', fontSize: '0.65rem' }}>Synapse Active</span>
                </div>

                {/* Simulated Tabs */}
                <div className="tab-selector">
                  <button 
                    onClick={() => setCurrentModelTab('chatgpt')} 
                    className={`tab-selector-btn ${currentModelTab === 'chatgpt' ? 'active' : ''}`}
                  >
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10b981' }}></span> ChatGPT
                  </button>
                  <button 
                    onClick={() => setCurrentModelTab('claude')} 
                    className={`tab-selector-btn ${currentModelTab === 'claude' ? 'active' : ''}`}
                  >
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#f97316' }}></span> Claude.ai
                  </button>
                  <button 
                    onClick={() => setCurrentModelTab('gemini')} 
                    className={`tab-selector-btn ${currentModelTab === 'gemini' ? 'active' : ''}`}
                  >
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#3b82f6' }}></span> Gemini
                  </button>
                </div>

                {/* Chat window body */}
                <div className="chat-history">
                  {conversationHistory[currentModelTab].map((msg, index) => (
                    <div 
                      key={index} 
                      className={`chat-bubble ${msg.role === 'user' ? 'user' : 'assistant'}`}
                    >
                      <span style={{ fontSize: '0.6rem', fontFamily: 'var(--mono)', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '4px' }}>
                        {msg.role === 'user' ? 'User' : 'AI Assistant'}
                      </span>
                      <p style={{ fontSize: '0.78rem', whiteSpace: 'pre-wrap' }}>{msg.content}</p>
                      
                      {/* Injected Copy Option */}
                      {msg.role === 'assistant' && msg.isNode && (
                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: '8px', paddingTop: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--accent-purple)', fontFamily: 'var(--mono)', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                            <Layers style={{ width: '12px', height: '12px' }} /> Synapse Context Detected
                          </span>
                          <button 
                            onClick={() => {
                              const newCap = {
                                id: `cap-auto-${Date.now().toString().slice(-3)}`,
                                timestamp: Date.now(),
                                topic: currentModelTab === 'chatgpt' ? "Injected JWT Flow" : currentModelTab === 'claude' ? "Injected Pandas Optimizer" : "SQLite Vector Table Schema",
                                category: "Auto captured",
                                summary: msg.content,
                                source: currentModelTab === 'chatgpt' ? "ChatGPT Capture" : currentModelTab === 'claude' ? "Claude Capture" : "Gemini Capture",
                                codeSkeleton: "",
                                tokensOriginal: 210,
                                tokensCompressed: 45,
                                embedding: [0,0,0,0,0,0,0,0,0,0]
                              };
                              setCapsules([newCap, ...capsules]);
                              alert("Smart Copy triggered: Context parsed and vectorized into local storage! Go to 'Local Vector Vault' to query.");
                            }}
                            style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', color: '#c084fc', fontSize: '0.65rem', borderRadius: '4px', padding: '3px 8px', cursor: 'pointer' }}
                          >
                            Smart Copy context
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Mock input text container with Injected Buttons */}
                <div className="input-container">
                  
                  {/* Floating Injected Context selection Popover */}
                  {showInjectedMenu && (
                    <div className="injected-floating-menu">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-purple)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Layers style={{ width: '14px', height: '14px' }} /> Load Memory Capsule
                        </span>
                        <button 
                          onClick={() => setShowInjectedMenu(false)}
                          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.7rem', cursor: 'pointer' }}
                        >
                          Close
                        </button>
                      </div>

                      {/* Search box inside injecting popover */}
                      <div style={{ position: 'relative' }}>
                        <Search style={{ width: '12px', height: '12px', color: 'var(--text-muted)', position: 'absolute', left: '10px', top: '10px' }} />
                        <input 
                          type="text" 
                          value={injectedSearchQuery}
                          onChange={(e) => setInjectedSearchQuery(e.target.value)}
                          placeholder="Search local indexes..."
                          style={{ paddingLeft: '28px', fontSize: '0.75rem', borderRadius: '4px', paddingTop: '6px', paddingBottom: '6px' }}
                        />
                      </div>

                      {/* List */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '140px', overflowY: 'auto' }}>
                        {injectedFilteredCapsules.length > 0 ? (
                          injectedFilteredCapsules.map(cap => (
                            <div 
                              key={cap.id}
                              onClick={() => injectCapsuleIntoPrompt(cap)}
                              style={{ padding: '6px 10px', borderRadius: '6px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer', transition: 'all 0.2s' }}
                              className="nav-button"
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cap.topic}</span>
                                <span className="badge badge-purple" style={{ fontSize: '6px', padding: '1px 3px' }}>{cap.tokensCompressed}t</span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>No local matches.</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Input row */}
                  <div className="input-row">
                    
                    {/* Glowing Injector logo button added by extension */}
                    <button 
                      onClick={() => setShowInjectedMenu(!showInjectedMenu)}
                      style={{ width: '36px', height: '36px', borderRadius: '50%', border: '1px solid rgba(139,92,246,0.5)', display: 'flex', alignItems: 'center', justify: 'center', background: 'linear-gradient(to tr, rgba(139,92,246,0.2), rgba(99,102,241,0.2))', color: '#c084fc', cursor: 'pointer', boxShadow: '0 0 10px rgba(139,92,246,0.2)', flexShrink: 0 }}
                      title="Load local context"
                    >
                      <Layers style={{ width: '18px', height: '18px' }} className="pulse-node" />
                    </button>

                    <input 
                      type="text"
                      value={modelPromptInput}
                      onChange={(e) => setModelPromptInput(e.target.value)}
                      placeholder={`Send prompt to ${currentModelTab === 'chatgpt' ? 'ChatGPT' : currentModelTab === 'claude' ? 'Claude' : 'Gemini'}...`}
                      style={{ fontSize: '0.8rem', height: '36px' }}
                      onKeyDown={(e) => e.key === 'Enter' && sendSimulatedPrompt()}
                    />
                    
                    <button 
                      onClick={sendSimulatedPrompt}
                      className="btn btn-primary"
                      style={{ height: '36px', padding: '0 16px', fontSize: '0.8rem' }}
                    >
                      Send
                    </button>
                  </div>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.65rem', fontFamily: 'var(--mono)', color: 'var(--text-muted)' }}>
                    <span>DOM Hook: #prompt-textarea</span>
                    <span style={{ color: 'var(--accent-purple)' }}>Synapse Injected Hook (Local OK)</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: LOCAL VECTOR VAULT */}
          {activeTab === 'vault' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <h2>Local Vector Vault</h2>
                  <p style={{ marginTop: '4px' }}>
                    Browse database modules indexed on client disk and test local vector cosine queries.
                  </p>
                </div>
                
                <div style={{ position: 'relative', width: '280px' }}>
                  <Search style={{ width: '14px', height: '14px', color: 'var(--text-muted)', position: 'absolute', left: '10px', top: '12px' }} />
                  <input 
                    type="text" 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search keywords (e.g. JWT, Pandas)..." 
                    style={{ paddingLeft: '32px', fontSize: '0.85rem' }}
                  />
                </div>
              </div>

              {searchQuery && (
                <div style={{ padding: '8px 12px', background: 'rgba(139,92,246,0.05)', border: '1px solid rgba(139,92,246,0.15)', borderRadius: '6px', fontSize: '0.75rem', color: 'var(--accent-purple)', fontFamily: 'var(--mono)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>LOCAL COSINE QUERY RESPONSE</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Sparkles style={{ width: '12px', height: '12px' }} /> Ranked by vector projection distance</span>
                </div>
              )}

              {/* Capsules List */}
              <div className="capsule-list-container">
                {searchedCapsules.length > 0 ? (
                  searchedCapsules.map(cap => (
                    <div 
                      key={cap.id} 
                      className="vault-card"
                    >
                      {/* Left Info */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexGrow: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff' }}>{cap.topic}</h3>
                          <span className="badge badge-purple">{cap.category}</span>
                          <span className="badge badge-cyan">{cap.source}</span>
                          {searchQuery && cap.similarity && (
                            <span className="badge badge-green">Similarity: {cap.similarity.toFixed(2)}</span>
                          )}
                        </div>
                        
                        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>{cap.summary}</p>
                        
                        <div style={{ display: 'flex', gap: '12px', fontSize: '0.65rem', fontFamily: 'var(--mono)', color: 'var(--text-muted)', marginTop: '4px' }}>
                          <span>Created: {new Date(cap.timestamp).toLocaleDateString()}</span>
                          <span>•</span>
                          <span>Footprint: <strong style={{ color: 'var(--accent-cyan)' }}>{cap.tokensOriginal}t</strong> down to <strong style={{ color: 'var(--accent-purple)' }}>{cap.tokensCompressed}t</strong></span>
                        </div>

                        {cap.codeSkeleton && (
                          <div style={{ marginTop: '6px' }}>
                            <span style={{ fontSize: '0.6rem', fontFamily: 'var(--mono)', color: 'var(--text-muted)', fontWeight: 700, display: 'block', marginBottom: '2px' }}>AST SKELETON</span>
                            <pre style={{ maxHeight: '80px', fontSize: '0.75rem', color: '#10b981' }}>
                              {cap.codeSkeleton}
                            </pre>
                          </div>
                        )}
                      </div>

                      {/* Right Action side */}
                      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-end', gap: '12px', flexShrink: 0 }}>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button 
                            onClick={() => handleCopyText(cap.codeSkeleton || cap.fullContent, cap.id)} 
                            className="btn btn-secondary"
                            style={{ padding: '6px 12px', fontSize: '0.75rem' }}
                          >
                            {copiedId === cap.id ? <Check style={{ width: '12px', height: '12px', color: '#10b981' }} /> : <Clipboard style={{ width: '12px', height: '12px' }} />}
                            {copiedId === cap.id ? 'Copied outline' : 'Smart Copy'}
                          </button>
                          
                          <button 
                            onClick={() => deleteCapsule(cap.id)} 
                            className="btn btn-secondary"
                            style={{ padding: '6px 8px', borderColor: 'rgba(239,68,68,0.2)', color: '#ef4444' }}
                          >
                            <Trash2 style={{ width: '12px', height: '12px' }} />
                          </button>
                        </div>

                        {/* Simulated Vector Floating Grid */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-end' }}>
                          <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)', textTransform: 'uppercase' }}>Embed Vector Segment</span>
                          <div style={{ display: 'flex', gap: '2px' }}>
                            {cap.embedding.map((val, idx) => {
                              const positive = val >= 0;
                              return (
                                <div 
                                  key={idx}
                                  style={{ 
                                    width: '10px', 
                                    height: '10px', 
                                    borderRadius: '1px',
                                    background: positive ? `rgba(6, 182, 212, ${Math.max(0.2, Math.abs(val))})` : `rgba(139, 92, 246, ${Math.max(0.2, Math.abs(val))})`,
                                    border: `1px solid ${positive ? 'rgba(6,182,212,0.2)' : 'rgba(139,92,246,0.2)'}`
                                  }}
                                  title={`Dimension ${idx}: ${val}`}
                                ></div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ border: '1px dashed var(--border-color)', borderRadius: '12px', padding: '32px', textAlign: 'center', background: 'rgba(0,0,0,0.1)' }}>
                    <Database style={{ width: '32px', height: '32px', color: 'var(--text-muted)', margin: '0 auto 8px' }} />
                    <p style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Vault is empty</p>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>Try compiling context nodes in the Capsule Lab tab first.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 5: SECURITY & PRIVACY */}
          {activeTab === 'security' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div>
                <h2>Zero-Trust Local Storage</h2>
                <p style={{ marginTop: '4px' }}>
                  Encrypt your SQLite indexes directly inside IndexedDB without server transfers.
                </p>
              </div>

              <div className="grid-2">
                
                {/* Cryptographic controller */}
                <div className="card">
                  <div className="card-title-group">
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <ShieldCheck style={{ width: '18px', height: '18px', color: '#10b981' }} />
                      Local AES-GCM Decrypt
                    </h3>
                    {isEncrypted ? (
                      <span className="badge badge-green">LOCKED / ENCRYPTED</span>
                    ) : (
                      <span className="badge badge-purple">UNLOCKED</span>
                    )}
                  </div>
                  
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                    Derives a cryptographically strong symmetric key inside browser scripts using **PBKDF2 Web Crypto API** (100,000 SHA-256 cycles). Stored index rows are ciphertext strings. Query matching dynamically decrypts records in RAM.
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '0.65rem', fontFamily: 'var(--mono)', color: 'var(--text-muted)', fontWeight: 600 }}>PASSPHRASE</label>
                      <input 
                        type="text" 
                        value={vaultPassword}
                        onChange={(e) => setVaultPassword(e.target.value)}
                        placeholder="Enter master decryption key..."
                        disabled={isEncrypted}
                        style={{ fontSize: '0.85rem' }}
                      />
                    </div>

                    <button 
                      onClick={handleVaultEncryptionToggle}
                      disabled={!vaultPassword && !isEncrypted || cryptoWorking}
                      className="btn btn-primary"
                      style={{ width: '100%', background: isEncrypted ? 'rgba(255,255,255,0.05)' : '', border: isEncrypted ? '1px solid var(--border-color)' : '', color: isEncrypted ? 'var(--text-primary)' : '', boxShadow: isEncrypted ? 'none' : '' }}
                    >
                      {cryptoWorking ? (
                        <>
                          <RefreshCw style={{ width: '14px', height: '14px' }} className="animate-spin" />
                          Deriving volatile keys...
                        </>
                      ) : isEncrypted ? (
                        <>
                          <Unlock style={{ width: '14px', height: '14px' }} /> Decrypt Local Database
                        </>
                      ) : (
                        <>
                          <Lock style={{ width: '14px', height: '14px' }} /> Encrypt Local Database
                        </>
                      )}
                    </button>
                  </div>
                  
                  {isEncrypted && (
                    <div style={{ marginTop: '12px', padding: '10px 14px', border: '1px solid rgba(16,185,129,0.15)', background: 'rgba(16,185,129,0.02)', borderRadius: '6px', fontSize: '0.75rem', color: '#34d399', lineHeight: '1.4' }}>
                      Key derived successfully. Vectors and indexes are secure. Volatile memory handling clears the key structure on window shutdown.
                    </div>
                  )}
                </div>

                {/* Technical comparison */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <h3 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Privacy Models</h3>
                  
                  <div style={{ padding: '14px', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'rgba(0,0,0,0.1)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '6px', marginBottom: '8px' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>Cloud Context Hubs</span>
                      <span style={{ color: '#f87171', fontSize: '0.65rem', fontFamily: 'var(--mono)', fontWeight: 600 }}>Telemetry Required</span>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                      Pushes raw conversation buffers to remote servers to run vector chunkings and RAG summary indexes. Database tables at rest must remain readable by cloud pipelines, bypassing E2EE boundaries.
                    </p>
                  </div>

                  <div style={{ padding: '14px', border: '1px solid rgba(139,92,246,0.2)', borderRadius: '8px', background: 'rgba(139,92,246,0.02)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(139,92,246,0.15)', paddingBottom: '6px', marginBottom: '8px' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.8rem', color: '#c084fc' }}>Synapse Edge Node</span>
                      <span style={{ color: '#34d399', fontSize: '0.65rem', fontFamily: 'var(--mono)', fontWeight: 600 }}>Pure E2EE</span>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                      Embeddings and Tree-Sitter parsing are executed client-side. Key logic relies on web-crypto derivations directly in browser RAM, ensuring zero raw data slips to centralized networks.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

        </main>
      </div>

      {/* Footer information panel */}
      <footer style={{ marginTop: '32px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
        <span>UNIVERSAL MEMORY LAYER PROTOCOL (SYNAPSE) // EDGE COMPUTATION</span>
        <div style={{ display: 'flex', gap: '16px' }}>
          <a href="#spec" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Technical Spec</a>
          <span>•</span>
          <a href="#mcp" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Model Context Protocol</a>
          <span>•</span>
          <a href="#audit" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Security Audit</a>
        </div>
      </footer>
    </div>
  );
}
